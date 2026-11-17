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
            <h4>Diff 摘要</h4>
            <div data-ref="diff-summary" class="sl-viz-body muted">加载中…</div>
            <details class="sl-viz-details">
              <summary>查看统一 diff</summary>
              <pre data-ref="diff-full" class="sl-viz-pre"></pre>
            </details>
          </section>
          <section class="sl-viz-block">
            <h4>Verify</h4>
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
    const top = Math.min(y + 12, window.innerHeight - 220);
    const left = Math.min(x + 12, window.innerWidth - 300);
    bubble.style.top = `${Math.max(8, top)}px`;
    bubble.style.left = `${Math.max(8, left)}px`;

    const preview = JSON.stringify(item.sniff, null, 2).slice(0, 600);
    bubble.innerHTML = `
      <h3>${escapeHtml(item.label)}</h3>
      <pre>${escapeHtml(preview)}</pre>
      <textarea placeholder="Annotation note (optional)" data-ref="note"></textarea>
      <div class="sl-row">
        <button class="sl-btn" data-action="queue">Add to batch</button>
        <button class="sl-btn primary" data-action="submit-one">Submit</button>
        <button class="sl-btn" data-action="dismiss">Dismiss</button>
      </div>
    `;

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
    this.setStatus(
      session
        ? `Session ${escapeHtml(session.id.slice(0, 8))}… → ${escapeHtml(session.status)}`
        : "Session created",
    );
    this.togglePick(false);
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

  private async review(
    decision: "accept" | "refine" | "revert",
  ): Promise<void> {
    if (!this.activeSessionId) {
      this.setStatus("No active session to review.");
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
