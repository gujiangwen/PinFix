import { TOOLBAR_CSS } from "./styles";
import { ensureBridge, sniffAt } from "./bridge";
import type { PickItem, RuntimeMessage, RuntimeResponse } from "../shared/protocol";

function labelFromSniff(sniff: Record<string, unknown>): string {
  const framework = String(sniff.framework ?? "unknown");
  const stack = sniff.componentStack as Array<{ name?: string }> | undefined;
  if (stack?.[0]?.name) return `${framework}: ${stack[0].name}`;
  if (typeof sniff.selector === "string") return `${framework}: ${sniff.selector}`;
  return framework;
}

type LocInfo = {
  file: string;
  line?: number | null;
  confidence?: number;
  confidence_level?: string;
  method?: string;
};

function readLocation(sniff: unknown): LocInfo | null {
  if (!sniff || typeof sniff !== "object" || Array.isArray(sniff)) return null;
  const loc = (sniff as { location?: LocInfo }).location;
  if (!loc || typeof loc.file !== "string") return null;
  return loc;
}

function locationHtml(loc: LocInfo | null): string {
  if (!loc) {
    return `<div class="sl-loc"><div class="sl-loc-hint">无源码定位</div></div>`;
  }
  const level = (loc.confidence_level ?? "low").toLowerCase();
  const unsure = level !== "high";
  return `
    <div class="sl-loc" data-ref="loc">
      <div class="sl-loc-row">
        <span class="sl-badge ${escapeHtml(level)}">${escapeHtml(level)}</span>
        <span class="sl-loc-file" title="${escapeHtml(loc.method ?? "")}">${escapeHtml(loc.file)}${loc.line != null ? `:${loc.line}` : ""}</span>
      </div>
      ${unsure ? `<div class="sl-loc-hint">可能不准确 · method=${escapeHtml(loc.method ?? "unknown")}</div>` : `<div class="sl-loc-hint">method=${escapeHtml(loc.method ?? "")}</div>`}
      <div class="sl-row">
        <button class="sl-btn" data-action="correct-file" type="button">纠正文件</button>
      </div>
      <div data-ref="correct-panel" hidden>
        <input class="sl-loc-search" data-ref="file-q" placeholder="搜索仓内文件…" />
        <div class="sl-loc-results" data-ref="file-results"></div>
      </div>
    </div>
  `;
}

export class SightLoopToolbar {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private highlight: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private reviewEl!: HTMLElement;
  private bubble: HTMLDivElement | null = null;
  private statusEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private dxEl!: HTMLElement;
  private pickActive = false;
  private queue: PickItem[] = [];
  private activeSessionId: string | null = null;
  private reviewPreview: {
    summary?: string;
    temp_commit_sha?: string | null;
    mode?: string;
  } | null = null;
  private gateRefineDraft: string | null = null;
  private gateStatus: string | null = null;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "sightloop-root";
    this.host.setAttribute("data-sightloop", "host");
    this.shadow = this.host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = TOOLBAR_CSS;
    this.shadow.appendChild(style);

    const root = document.createElement("div");
    root.className = "sl-root";
    this.shadow.appendChild(root);

    this.highlight = document.createElement("div");
    this.highlight.className = "sl-highlight";
    this.highlight.style.display = "none";
    root.appendChild(this.highlight);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "sl-toolbar";
    this.toolbar.innerHTML = `
      <div class="sl-brand">SightLoop</div>
      <div class="sl-dx" data-ref="dx" title="Open the extension Popup for local DX">Daemon · Runner: …</div>
      <div class="sl-status" data-ref="status">Idle — press <span class="sl-kbd">Alt+Shift+A</span> or Pick</div>
      <div class="sl-row">
        <button class="sl-btn primary" data-action="toggle-pick">Pick</button>
        <button class="sl-btn" data-action="submit-batch" disabled>Submit batch</button>
        <button class="sl-btn" data-action="clear" disabled>Clear</button>
      </div>
      <div class="sl-review" data-ref="review" hidden>
        <div class="sl-review-title">验收</div>
        <div class="sl-review-summary" data-ref="review-summary"></div>
        <div class="sl-viz" data-ref="viz">
          <section class="sl-viz-block">
            <h4>浏览器验收</h4>
            <div data-ref="gate-summary" class="sl-viz-body muted">尚未运行</div>
            <div class="sl-row" style="margin-top:6px">
              <button class="sl-btn" data-action="rerun-gate" type="button">重新跑 Playwright</button>
              <button class="sl-btn" data-action="gate-to-refine" type="button" hidden>填入 Refine</button>
            </div>
          </section>
          <section class="sl-viz-block">
            <h4>源码定位</h4>
            <div data-ref="loc-summary" class="sl-viz-body muted">暂无 location</div>
          </section>
          <section class="sl-viz-block">
            <h4>Diff 摘要</h4>
            <div data-ref="diff-summary" class="sl-viz-body muted">加载中…</div>
            <details class="sl-viz-details">
              <summary>查看统一 diff</summary>
              <pre data-ref="diff-full" class="sl-viz-pre"></pre>
            </details>
          </section>
          <section class="sl-viz-block">
            <h4>命令验证</h4>
            <div data-ref="verify-summary" class="sl-viz-body muted">无 verify_cmd 或尚未运行</div>
          </section>
          <section class="sl-viz-block">
            <h4>本轮召回</h4>
            <div data-ref="recall-list" class="sl-viz-body muted">暂无知识召回</div>
          </section>
          <section class="sl-viz-block">
            <h4>时间线</h4>
            <ol data-ref="timeline" class="sl-timeline"></ol>
          </section>
        </div>
        <div class="sl-distill" data-ref="distill" hidden>
          <div class="sl-distill-title">已写入知识</div>
          <div data-ref="distill-body" class="sl-viz-body"></div>
          <button class="sl-btn" data-action="dismiss-distill" type="button">关闭</button>
        </div>
        <textarea data-ref="refine-note" placeholder="Refine note（可选，进入下一轮）"></textarea>
        <div class="sl-row">
          <button class="sl-btn primary" data-action="accept">Accept</button>
          <button class="sl-btn" data-action="refine">Refine</button>
          <button class="sl-btn danger" data-action="revert">Revert</button>
        </div>
      </div>
      <div class="sl-queue" data-ref="queue"></div>
    `;
    root.appendChild(this.toolbar);

    this.statusEl = this.toolbar.querySelector('[data-ref="status"]')!;
    this.queueEl = this.toolbar.querySelector('[data-ref="queue"]')!;
    this.reviewEl = this.toolbar.querySelector('[data-ref="review"]')!;
    this.dxEl = this.toolbar.querySelector('[data-ref="dx"]')!;

    this.toolbar.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-ref=dx]")) {
        this.setStatus("Open the SightLoop extension Popup for the local DX wizard.");
        return;
      }
      const action = t?.closest("[data-action]")?.getAttribute("data-action");
      if (action === "toggle-pick") this.togglePick();
      if (action === "submit-batch") void this.submitBatch();
      if (action === "clear") this.clearQueue();
      if (action === "accept") void this.review("accept");
      if (action === "refine") void this.review("refine");
      if (action === "revert") void this.review("revert");
      if (action === "rerun-gate") void this.rerunAcceptanceGate();
      if (action === "gate-to-refine") this.fillRefineFromGate();
      if (action === "dismiss-distill") this.hideDistill();
    });

    document.documentElement.appendChild(this.host);
    ensureBridge();
    void this.refreshDxStrip();
  }

  async refreshDxStrip(): Promise<void> {
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "dx_status",
      })) as RuntimeResponse;
      if (!res.ok) {
        this.dxEl.textContent = "Daemon ✗ · open Popup";
        return;
      }
      const dx = res.data as { runner?: { mode?: string } };
      this.dxEl.textContent = `Daemon ● · Runner: ${dx.runner?.mode ?? "?"}`;
    } catch {
      this.dxEl.textContent = "Daemon ✗ · open Popup";
    }
  }

  setStatus(text: string): void {
    this.statusEl.innerHTML = text;
  }

  private setReviewVisible(visible: boolean): void {
    if (visible) this.reviewEl.removeAttribute("hidden");
    else this.reviewEl.setAttribute("hidden", "");
  }

  togglePick(force?: boolean): void {
    this.pickActive = force ?? !this.pickActive;
    if (this.pickActive) {
      this.setStatus(
        `Pick mode — hover to highlight, click to capture. <span class="sl-kbd">Esc</span> cancels.`,
      );
      document.addEventListener("mousemove", this.onMove, true);
      document.addEventListener("click", this.onClick, true);
      document.addEventListener("keydown", this.onKey, true);
      this.toolbar.querySelector('[data-action="toggle-pick"]')!.textContent =
        "Stop";
    } else {
      this.setStatus(
        `Idle — press <span class="sl-kbd">Alt+Shift+A</span> or Pick`,
      );
      document.removeEventListener("mousemove", this.onMove, true);
      document.removeEventListener("click", this.onClick, true);
      document.removeEventListener("keydown", this.onKey, true);
      this.highlight.style.display = "none";
      this.hideBubble();
      this.toolbar.querySelector('[data-action="toggle-pick"]')!.textContent =
        "Pick";
    }
  }

  private onMove = (ev: MouseEvent): void => {
    if (!this.pickActive) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el === this.host || this.host.contains(el)) {
      this.highlight.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    this.highlight.style.display = "block";
    this.highlight.style.top = `${rect.top}px`;
    this.highlight.style.left = `${rect.left}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;
  };

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this.togglePick(false);
    }
  };

  private onClick = (ev: MouseEvent): void => {
    if (!this.pickActive) return;
    const path = ev.composedPath();
    if (path.includes(this.host) || path.includes(this.toolbar)) return;
    if (this.bubble && path.includes(this.bubble)) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    void this.capture(ev.clientX, ev.clientY);
  };

  private async capture(x: number, y: number): Promise<void> {
    try {
      this.setStatus("Sniffing…");
      const result = await sniffAt(x, y);
      const item: PickItem = {
        id: crypto.randomUUID(),
        sniffedAt: Date.now(),
        pageUrl: location.href,
        sniff: result,
        note: "",
        label: labelFromSniff(result),
      };
      this.showBubble(item, x, y);
      this.setStatus(
        `Captured <strong>${escapeHtml(item.label)}</strong> — annotate & queue or submit`,
      );
    } catch (err) {
      this.setStatus(`Sniff failed: ${escapeHtml((err as Error).message)}`);
    }
  }

  private showBubble(item: PickItem, x: number, y: number): void {
    this.hideBubble();
    const bubble = document.createElement("div");
    bubble.className = "sl-bubble";
    const top = Math.min(y + 12, window.innerHeight - 280);
    const left = Math.min(x + 12, window.innerWidth - 340);
    bubble.style.top = `${Math.max(8, top)}px`;
    bubble.style.left = `${Math.max(8, left)}px`;

    const loc = readLocation(item.sniff);
    const preview = JSON.stringify(item.sniff, null, 2).slice(0, 400);
    bubble.innerHTML = `
      <h3>${escapeHtml(item.label)}</h3>
      ${locationHtml(loc)}
      <pre>${escapeHtml(preview)}</pre>
      <textarea placeholder="Annotation note (optional)" data-ref="note"></textarea>
      <div class="sl-row">
        <button class="sl-btn" data-action="queue">Add to batch</button>
        <button class="sl-btn primary" data-action="submit-one">Submit</button>
        <button class="sl-btn" data-action="dismiss">Dismiss</button>
      </div>
    `;

    this.bindCorrectUi(bubble, item);

    bubble.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement | null)
        ?.closest("[data-action]")
        ?.getAttribute("data-action");
      const note =
        (bubble.querySelector('[data-ref="note"]') as HTMLTextAreaElement)
          ?.value ?? "";
      if (action === "dismiss") {
        this.hideBubble();
        return;
      }
      if (action === "queue") {
        item.note = note;
        this.queue.push(item);
        this.renderQueue();
        this.hideBubble();
        this.setStatus(`Queued (${this.queue.length}). Keep picking or submit batch.`);
        return;
      }
      if (action === "submit-one") {
        item.note = note;
        void this.submitOne(item);
      }
    });

    this.shadow.querySelector(".sl-root")!.appendChild(bubble);
    this.bubble = bubble;

    // Best-effort daemon locate upgrade when confidence is low/medium.
    void this.maybeUpgradeLocation(item, bubble);
  }

  private bindCorrectUi(root: HTMLElement, item: PickItem): void {
    root.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement | null)
        ?.closest("[data-action]")
        ?.getAttribute("data-action");
      if (action !== "correct-file") return;
      e.stopPropagation();
      const panel = root.querySelector(
        '[data-ref="correct-panel"]',
      ) as HTMLElement | null;
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        const input = panel.querySelector(
          '[data-ref="file-q"]',
        ) as HTMLInputElement | null;
        input?.focus();
        void this.runFileSearch(root, item, input?.value ?? "");
      }
    });

    root
      .querySelector('[data-ref="file-q"]')
      ?.addEventListener("input", (e) => {
        const q = (e.target as HTMLInputElement).value;
        void this.runFileSearch(root, item, q);
      });
  }

  private async runFileSearch(
    root: HTMLElement,
    item: PickItem,
    query: string,
  ): Promise<void> {
    const resultsEl = root.querySelector(
      '[data-ref="file-results"]',
    ) as HTMLElement | null;
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="sl-loc-hint">搜索中…</div>`;
    const res = await sendRuntime({
      type: "search_files",
      query,
      limit: 12,
    });
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="sl-loc-hint">${escapeHtml(res.error)}</div>`;
      return;
    }
    const files =
      ((res.data as { files?: string[] } | undefined)?.files as string[]) ?? [];
    if (!files.length) {
      resultsEl.innerHTML = `<div class="sl-loc-hint">无匹配（检查 whitelist）</div>`;
      return;
    }
    resultsEl.innerHTML = files
      .map(
        (f) =>
          `<button type="button" data-pick-file="${escapeHtml(f)}">${escapeHtml(f)}</button>`,
      )
      .join("");
    resultsEl.querySelectorAll("[data-pick-file]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const file = (btn as HTMLElement).getAttribute("data-pick-file");
        if (!file) return;
        void this.applyHumanCorrect(item, file, root);
      });
    });
  }

  private async applyHumanCorrect(
    item: PickItem,
    file: string,
    root: HTMLElement,
  ): Promise<void> {
    const sniff =
      item.sniff && typeof item.sniff === "object" && !Array.isArray(item.sniff)
        ? ({ ...(item.sniff as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : ({} as Record<string, unknown>);
    sniff.location = {
      file,
      line: null,
      column: null,
      confidence: 1,
      confidence_level: "high",
      method: "human",
    };
    item.sniff = sniff;
    item.label = labelFromSniff(sniff);

    const locHost = root.querySelector('[data-ref="loc"]');
    if (locHost) {
      locHost.outerHTML = locationHtml(readLocation(sniff));
      this.bindCorrectUi(root, item);
    }

    if (this.activeSessionId) {
      const selector =
        typeof sniff.selector === "string" ? sniff.selector : undefined;
      const fingerprint =
        typeof sniff.fingerprint === "string" ? sniff.fingerprint : undefined;
      const res = await sendRuntime({
        type: "source_correct",
        sessionId: this.activeSessionId,
        file,
        selector,
        fingerprint,
        note: item.note || undefined,
      });
      if (!res.ok) {
        this.setStatus(`纠正失败：${escapeHtml(res.error)}`);
        return;
      }
      this.setStatus(
        `已纠正为 <strong>${escapeHtml(file)}</strong>（已写入 hints + knowledge）`,
      );
      return;
    }

    this.setStatus(
      `已选择 <strong>${escapeHtml(file)}</strong> — Submit 后会写入映射`,
    );
  }

  private async maybeUpgradeLocation(
    item: PickItem,
    bubble: HTMLElement,
  ): Promise<void> {
    const loc = readLocation(item.sniff);
    if (!loc || loc.confidence_level === "high") return;
    const sniff =
      item.sniff && typeof item.sniff === "object" && !Array.isArray(item.sniff)
        ? (item.sniff as Record<string, unknown>)
        : null;
    if (!sniff) return;
    const stack = sniff.componentStack as Array<{ name?: string }> | undefined;
    const res = await sendRuntime({
      type: "locate_source",
      selector: typeof sniff.selector === "string" ? sniff.selector : undefined,
      fingerprint:
        typeof sniff.fingerprint === "string" ? sniff.fingerprint : undefined,
      component_name: stack?.[0]?.name,
      source_mapping_urls: Array.isArray(sniff.source_mapping_urls)
        ? (sniff.source_mapping_urls as string[])
        : undefined,
    });
    if (!res.ok) return;
    const next = (res.data as { location?: LocInfo } | undefined)?.location;
    if (!next?.file) return;
    if ((next.confidence ?? 0) <= (loc.confidence ?? 0)) return;
    sniff.location = next;
    item.sniff = sniff;
    const locHost = bubble.querySelector('[data-ref="loc"]');
    if (locHost) {
      locHost.outerHTML = locationHtml(next);
      this.bindCorrectUi(bubble, item);
    }
  }

  private hideBubble(): void {
    this.bubble?.remove();
    this.bubble = null;
  }

  private renderQueue(): void {
    this.queueEl.innerHTML = "";
    const batchBtn = this.toolbar.querySelector(
      '[data-action="submit-batch"]',
    ) as HTMLButtonElement;
    const clearBtn = this.toolbar.querySelector(
      '[data-action="clear"]',
    ) as HTMLButtonElement;
    batchBtn.disabled = this.queue.length === 0;
    clearBtn.disabled = this.queue.length === 0;

    for (const item of this.queue) {
      const row = document.createElement("div");
      row.className = "sl-item";
      row.innerHTML = `
        <div class="sl-item-title">${escapeHtml(item.label)}</div>
        <textarea data-id="${item.id}" placeholder="Note">${escapeHtml(item.note)}</textarea>
        <div class="sl-item-actions">
          <button class="sl-btn" data-remove="${item.id}">Remove</button>
        </div>
      `;
      row.querySelector("textarea")?.addEventListener("change", (e) => {
        item.note = (e.target as HTMLTextAreaElement).value;
      });
      row.querySelector("[data-remove]")?.addEventListener("click", () => {
        this.queue = this.queue.filter((q) => q.id !== item.id);
        this.renderQueue();
      });
      this.queueEl.appendChild(row);
    }
  }

  private clearQueue(): void {
    this.queue = [];
    this.renderQueue();
    this.setStatus("Queue cleared.");
  }

  private rememberSession(session?: { id?: string; status?: string }): void {
    if (!session?.id) return;
    this.activeSessionId = session.id;
    if (session.status === "awaiting_review") {
      this.setReviewVisible(true);
    }
  }

  private async submitOne(item: PickItem): Promise<void> {
    this.hideBubble();
    this.setStatus("Creating session + starting loop…");
    const selector =
      typeof item.sniff === "object" &&
      item.sniff &&
      !Array.isArray(item.sniff) &&
      typeof (item.sniff as { selector?: unknown }).selector === "string"
        ? (item.sniff as { selector: string }).selector
        : undefined;
    const res = await sendRuntime({
      type: "create_session",
      pageUrl: item.pageUrl,
      sniff: item.sniff,
      annotation: {
        note: item.note || undefined,
        selector,
      },
      start: true,
    });
    if (!res.ok) {
      this.setStatus(`Submit failed: ${escapeHtml(res.error)}`);
      return;
    }
    const data = res.data as {
      session?: { id: string; status: string };
      started?: { id: string; status: string };
    };
    const session = data.started ?? data.session;
    this.rememberSession(session);
    await this.persistHumanLocationIfNeeded(item, session?.id);
    this.setStatus(
      session
        ? `Session ${escapeHtml(session.id.slice(0, 8))}… → ${escapeHtml(session.status)}`
        : "Session created",
    );
    this.togglePick(false);
  }

  private async persistHumanLocationIfNeeded(
    item: PickItem,
    sessionId?: string,
  ): Promise<void> {
    if (!sessionId) return;
    const loc = readLocation(item.sniff);
    if (!loc || loc.method !== "human") return;
    const sniff =
      item.sniff && typeof item.sniff === "object" && !Array.isArray(item.sniff)
        ? (item.sniff as Record<string, unknown>)
        : {};
    await sendRuntime({
      type: "source_correct",
      sessionId,
      file: loc.file,
      selector: typeof sniff.selector === "string" ? sniff.selector : undefined,
      fingerprint:
        typeof sniff.fingerprint === "string" ? sniff.fingerprint : undefined,
      note: item.note || undefined,
    });
  }

  private async submitBatch(): Promise<void> {
    if (this.queue.length === 0) return;
    this.setStatus(`Submitting batch (${this.queue.length})…`);
    const items = this.queue.map((item) => {
      const selector =
        typeof item.sniff === "object" &&
        item.sniff &&
        !Array.isArray(item.sniff) &&
        typeof (item.sniff as { selector?: unknown }).selector === "string"
          ? (item.sniff as { selector: string }).selector
          : undefined;
      return {
        sniff: item.sniff,
        annotation: {
          note: item.note || undefined,
          selector,
        },
      };
    });
    const res = await sendRuntime({
      type: "create_sessions_batch",
      pageUrl: location.href,
      items,
    });
    if (!res.ok) {
      this.setStatus(`Batch failed: ${escapeHtml(res.error)}`);
      return;
    }
    const sessions =
      (res.data as { sessions?: Array<{ session?: { id: string; status: string }; started?: { id: string; status: string } }> })
        ?.sessions ?? [];
    const last = sessions[sessions.length - 1];
    this.rememberSession(last?.started ?? last?.session);
    this.clearQueue();
    this.setStatus(`Batch OK — ${sessions.length} session(s); loop started.`);
    this.togglePick(false);
  }

  onSessionStatus(sessionId: string, status: string, stepCount: number): void {
    this.activeSessionId = sessionId;
    this.setStatus(
      `WS <strong>${escapeHtml(sessionId.slice(0, 8))}…</strong> → ${escapeHtml(status)} (steps ${stepCount})`,
    );
    if (status === "awaiting_review") {
      this.setReviewVisible(true);
      void this.loadAcceptancePanel(sessionId);
    } else if (status === "accepted") {
      // Keep panel open so distilled knowledge card stays visible.
      this.setReviewVisible(true);
    } else if (status === "reverted" || status === "failed") {
      this.setReviewVisible(false);
      this.reviewPreview = null;
      this.hideDistill();
    } else if (status === "refined" || status === "retrieving" || status === "acting") {
      this.setReviewVisible(false);
    }
  }

  onAwaitingReview(
    sessionId: string,
    preview: {
      summary?: string;
      temp_commit_sha?: string | null;
      mode?: string;
    },
  ): void {
    this.activeSessionId = sessionId;
    this.reviewPreview = preview;
    this.setReviewVisible(true);
    const summaryEl = this.reviewEl.querySelector(
      '[data-ref="review-summary"]',
    ) as HTMLElement;
    const sha = preview.temp_commit_sha
      ? preview.temp_commit_sha.slice(0, 8)
      : "—";
    summaryEl.textContent = `${preview.summary ?? "Changes ready"} · commit ${sha}${preview.mode ? ` · ${preview.mode}` : ""}`;
    this.setStatus(
      `Awaiting review — <strong>${escapeHtml(sessionId.slice(0, 8))}…</strong>`,
    );
    void this.loadAcceptancePanel(sessionId);
  }

  onTerminal(sessionId: string, status: string): void {
    this.activeSessionId = sessionId;
    if (status !== "accepted") {
      this.setReviewVisible(false);
    }
    this.setStatus(
      `Done <strong>${escapeHtml(sessionId.slice(0, 8))}…</strong> → ${escapeHtml(status)}`,
    );
  }

  onVerify(
    sessionId: string,
    verify: { ok?: boolean; log_tail?: string; command?: string | null },
  ): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) return;
    this.renderVerify(verify);
  }

  onRecall(
    sessionId: string,
    hits: Array<{ title?: string; score?: number | null; body_preview?: string }>,
  ): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) return;
    this.renderRecall(hits);
  }

  onTimelineEvent(
    sessionId: string,
    event: { label?: string; detail?: string | null; kind?: string },
  ): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) return;
    const ol = this.reviewEl.querySelector(
      '[data-ref="timeline"]',
    ) as HTMLOListElement | null;
    if (!ol) return;
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(event.label ?? event.kind ?? "event")}</strong>${
      event.detail ? ` — ${escapeHtml(String(event.detail).slice(0, 120))}` : ""
    }`;
    ol.appendChild(li);
  }

  onKnowledgeDistilled(
    sessionId: string,
    knowledge: {
      id?: string;
      title?: string;
      kind?: string;
      body_preview?: string;
    },
  ): void {
    this.activeSessionId = sessionId;
    this.showDistill(knowledge);
  }

  onAcceptanceGate(
    sessionId: string,
    status: string,
    reportSummary: {
      failed_checks?: string[];
      failed_steps?: Array<{ id: string; message: string }>;
      refine_note_draft?: string;
    } | null,
  ): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) return;
    this.renderGateSummary({
      status,
      report: reportSummary
        ? {
            failed_checks: reportSummary.failed_checks,
            failed_steps: reportSummary.failed_steps,
            refine_note_draft: reportSummary.refine_note_draft,
          }
        : null,
    });
  }

  private hideDistill(): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="distill"]',
    ) as HTMLElement | null;
    el?.setAttribute("hidden", "");
  }

  private showDistill(knowledge: {
    title?: string;
    kind?: string;
    body_preview?: string;
    id?: string;
  }): void {
    const wrap = this.reviewEl.querySelector(
      '[data-ref="distill"]',
    ) as HTMLElement | null;
    const body = this.reviewEl.querySelector(
      '[data-ref="distill-body"]',
    ) as HTMLElement | null;
    if (!wrap || !body) return;
    body.innerHTML = `<strong>${escapeHtml(knowledge.title ?? "Knowledge")}</strong>
      <div class="muted">${escapeHtml(knowledge.kind ?? "")}${
        knowledge.id ? ` · ${escapeHtml(knowledge.id.slice(0, 10))}…` : ""
      }</div>
      <p>${escapeHtml(knowledge.body_preview ?? "")}</p>
      <div class="muted">Admin Knowledge Hub · http://127.0.0.1:5173/#knowledge</div>`;
    wrap.removeAttribute("hidden");
    this.setReviewVisible(true);
  }

  private renderVerify(verify: {
    ok?: boolean;
    log_tail?: string;
    command?: string | null;
  } | null): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="verify-summary"]',
    ) as HTMLElement | null;
    if (!el) return;
    if (!verify) {
      el.className = "sl-viz-body muted";
      el.textContent = "无 verify_cmd 或尚未运行";
      return;
    }
    el.className = `sl-viz-body ${verify.ok ? "ok" : "bad"}`;
    el.innerHTML = `<div>${verify.ok ? "pass" : "fail"}${
      verify.command ? ` · <code>${escapeHtml(verify.command)}</code>` : ""
    }</div><pre class="sl-viz-pre">${escapeHtml(
      (verify.log_tail ?? "").slice(-800) || "(empty)",
    )}</pre>`;
  }

  private renderRecall(
    hits: Array<{
      title?: string;
      score?: number | null;
      body_preview?: string;
      knowledge_id?: string | null;
    }>,
  ): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="recall-list"]',
    ) as HTMLElement | null;
    if (!el) return;
    if (!hits.length) {
      el.className = "sl-viz-body muted";
      el.textContent = "暂无知识召回";
      return;
    }
    el.className = "sl-viz-body";
    el.innerHTML = `<ul class="sl-recall">${hits
      .map(
        (h) =>
          `<li><strong>${escapeHtml(h.title ?? "")}</strong>${
            h.score != null ? ` <span class="muted">score=${Number(h.score).toFixed(2)}</span>` : ""
          }${
            h.body_preview
              ? `<div class="muted">${escapeHtml(h.body_preview.slice(0, 140))}</div>`
              : ""
          }</li>`,
      )
      .join("")}</ul>`;
  }

  private renderTimeline(
    events: Array<{ label?: string; detail?: string | null; kind?: string }>,
  ): void {
    const ol = this.reviewEl.querySelector(
      '[data-ref="timeline"]',
    ) as HTMLOListElement | null;
    if (!ol) return;
    ol.innerHTML = events
      .map(
        (e) =>
          `<li><strong>${escapeHtml(e.label ?? e.kind ?? "event")}</strong>${
            e.detail
              ? ` — ${escapeHtml(String(e.detail).slice(0, 140))}`
              : ""
          }</li>`,
      )
      .join("");
  }

  private renderLocationSummary(sniff: unknown): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="loc-summary"]',
    ) as HTMLElement | null;
    if (!el) return;
    const loc = readLocation(sniff);
    if (!loc) {
      el.className = "sl-viz-body muted";
      el.textContent = "暂无 location";
      return;
    }
    const level = (loc.confidence_level ?? "low").toLowerCase();
    el.className = "sl-viz-body";
    el.innerHTML = `<div class="sl-loc-row"><span class="sl-badge ${escapeHtml(level)}">${escapeHtml(level)}</span> <code>${escapeHtml(loc.file)}${loc.line != null ? `:${loc.line}` : ""}</code></div><div class="muted">method=${escapeHtml(loc.method ?? "")}</div>`;
  }

  private renderDiffSummary(
    summary: {
      files?: Array<{ path: string; additions: number; deletions: number }>;
      additions?: number;
      deletions?: number;
    } | null,
    patch: string,
  ): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="diff-summary"]',
    ) as HTMLElement | null;
    const pre = this.reviewEl.querySelector(
      '[data-ref="diff-full"]',
    ) as HTMLElement | null;
    if (pre) {
      pre.textContent = (patch || "(empty patch)").slice(0, 12000);
    }
    if (!el) return;
    if (!summary?.files?.length) {
      el.className = "sl-viz-body muted";
      el.textContent = "暂无文件变更摘要";
      return;
    }
    el.className = "sl-viz-body";
    const head = `+${summary.additions ?? 0} / −${summary.deletions ?? 0} · ${summary.files.length} file(s)`;
    const rows = summary.files
      .slice(0, 12)
      .map(
        (f) =>
          `<div class="sl-diff-file"><code>${escapeHtml(f.path)}</code> <span class="muted">+${f.additions} −${f.deletions}</span></div>`,
      )
      .join("");
    el.innerHTML = `<div>${escapeHtml(head)}</div>${rows}`;
  }

  private async loadAcceptancePanel(sessionId: string): Promise<void> {
    const res = await sendRuntime({ type: "get_session", sessionId });
    if (!res.ok) {
      this.setStatus(`加载验收面板失败：${escapeHtml(res.error)}`);
      return;
    }
    const data = res.data as {
      session?: { sniff?: unknown };
      acceptance_gate?: {
        status?: string;
        report?: {
          failed_checks?: string[];
          failed_steps?: Array<{ id: string; message: string }>;
          refine_note_draft?: string;
        } | null;
      } | null;
      diff_summary?: {
        files?: Array<{ path: string; additions: number; deletions: number }>;
        additions?: number;
        deletions?: number;
      } | null;
      verify?: { ok?: boolean; log_tail?: string; command?: string | null } | null;
      recall_hits?: Array<{
        title?: string;
        score?: number | null;
        body_preview?: string;
      }>;
      timeline?: Array<{ label?: string; detail?: string | null; kind?: string }>;
      latest_knowledge?: {
        id?: string;
        title?: string;
        kind?: string;
        body_preview?: string;
      } | null;
    };
    this.renderGateSummary(data.acceptance_gate ?? null);
    this.renderLocationSummary(data.session?.sniff);
    const diffRes = await sendRuntime({ type: "get_diff", sessionId });
    const patch =
      diffRes.ok
        ? String((diffRes.data as { patch?: string })?.patch ?? "")
        : "";
    this.renderDiffSummary(
      data.diff_summary ??
        (diffRes.ok
          ? ((diffRes.data as { summary?: typeof data.diff_summary }).summary ??
            null)
          : null),
      patch,
    );
    this.renderVerify(data.verify ?? null);
    this.renderRecall(data.recall_hits ?? []);
    this.renderTimeline(data.timeline ?? []);
    if (data.latest_knowledge) this.showDistill(data.latest_knowledge);
  }

  private renderGateSummary(
    gate: {
      status?: string;
      report?: {
        failed_checks?: string[];
        failed_steps?: Array<{ id: string; message: string }>;
        refine_note_draft?: string;
      } | null;
    } | null,
  ): void {
    const el = this.reviewEl.querySelector(
      '[data-ref="gate-summary"]',
    ) as HTMLElement | null;
    const fillBtn = this.reviewEl.querySelector(
      '[data-action="gate-to-refine"]',
    ) as HTMLButtonElement | null;
    const acceptBtn = this.reviewEl.querySelector(
      '[data-action="accept"]',
    ) as HTMLButtonElement | null;
    if (!el) return;
    this.gateStatus = gate?.status ?? null;
    this.gateRefineDraft = gate?.report?.refine_note_draft ?? null;
    if (!gate?.status) {
      el.className = "sl-viz-body muted";
      el.textContent = "尚未运行 / 排队中";
      if (fillBtn) fillBtn.hidden = true;
      if (acceptBtn) acceptBtn.disabled = true;
      return;
    }
    if (gate.status === "passed") {
      el.className = "sl-viz-body ok";
      el.textContent = "浏览器验收已通过 · 页面与标注一致";
      if (fillBtn) fillBtn.hidden = true;
      if (acceptBtn) acceptBtn.disabled = false;
      return;
    }
    if (gate.status === "queued" || gate.status === "running") {
      el.className = "sl-viz-body muted";
      el.textContent =
        gate.status === "queued" ? "浏览器验收排队中…" : "浏览器验收运行中…";
      if (fillBtn) fillBtn.hidden = true;
      if (acceptBtn) acceptBtn.disabled = true;
      return;
    }
    const checks = (gate.report?.failed_checks ?? []).join(", ") || "unknown";
    const steps = (gate.report?.failed_steps ?? [])
      .slice(0, 4)
      .map((s) => `<li><code>${escapeHtml(s.id)}</code> ${escapeHtml(s.message)}</li>`)
      .join("");
    el.className = "sl-viz-body bad";
    el.innerHTML = `浏览器验收未通过 · ${escapeHtml(checks)}<ul class="sl-recall">${steps}</ul>`;
    if (fillBtn) fillBtn.hidden = !this.gateRefineDraft;
    if (acceptBtn) acceptBtn.disabled = true;
  }

  private async rerunAcceptanceGate(): Promise<void> {
    if (!this.activeSessionId) return;
    this.setStatus("重新跑 Playwright…");
    const res = await sendRuntime({
      type: "run_acceptance_gate",
      sessionId: this.activeSessionId,
    });
    if (!res.ok) {
      this.setStatus(`Gate 失败：${escapeHtml(res.error)}`);
      return;
    }
    const run = (res.data as { run?: { status?: string; report?: unknown } })
      ?.run;
    this.renderGateSummary(
      run
        ? {
            status: run.status,
            report: run.report as {
              failed_checks?: string[];
              failed_steps?: Array<{ id: string; message: string }>;
              refine_note_draft?: string;
            },
          }
        : null,
    );
    this.setStatus(
      run?.status === "passed"
        ? "浏览器验收已通过"
        : `浏览器验收 → ${escapeHtml(run?.status ?? "done")}`,
    );
  }

  private fillRefineFromGate(): void {
    if (!this.gateRefineDraft) return;
    const ta = this.reviewEl.querySelector(
      '[data-ref="refine-note"]',
    ) as HTMLTextAreaElement | null;
    if (ta) ta.value = this.gateRefineDraft;
    this.setStatus("已填入 Refine 失败摘要");
  }

  private async review(
    decision: "accept" | "refine" | "revert",
  ): Promise<void> {
    if (!this.activeSessionId) {
      this.setStatus("No active session to review.");
      return;
    }
    if (
      decision === "accept" &&
      this.gateStatus &&
      this.gateStatus !== "passed"
    ) {
      this.setStatus("浏览器验收未通过 · 请 Refine 或重新跑 Playwright");
      return;
    }
    const note =
      (
        this.reviewEl.querySelector(
          '[data-ref="refine-note"]',
        ) as HTMLTextAreaElement
      )?.value ?? "";
    this.setStatus(`${decision}…`);
    const res = await sendRuntime({
      type: "review_session",
      sessionId: this.activeSessionId,
      decision,
      note: note || undefined,
    });
    if (!res.ok) {
      this.setStatus(`Review failed: ${escapeHtml(res.error)}`);
      return;
    }
    const data = res.data as {
      session?: { status: string };
      distilled_knowledge?: {
        id?: string;
        title?: string;
        kind?: string;
        body_preview?: string;
      };
      timeline?: Array<{ label?: string; detail?: string | null; kind?: string }>;
    };
    this.setStatus(
      `Review ${decision} → ${escapeHtml(data.session?.status ?? "ok")}`,
    );
    if (data.timeline) this.renderTimeline(data.timeline);
    if (decision === "accept" && data.distilled_knowledge) {
      this.showDistill(data.distilled_knowledge);
    } else if (decision === "revert") {
      this.setReviewVisible(false);
      this.hideDistill();
    } else if (decision === "refine") {
      this.setReviewVisible(false);
      // Panel will reopen on next awaiting_review; keep timeline for next load.
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendRuntime(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}
