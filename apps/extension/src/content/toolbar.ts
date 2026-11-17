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
  private bubble: HTMLDivElement | null = null;
  private statusEl!: HTMLElement;
  private queueEl!: HTMLElement;
  private pickActive = false;
  private queue: PickItem[] = [];
  private lastSessionStatus = "";

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "sightloop-root";
    this.host.setAttribute("data-sightloop", "host");
    // Closed shadow isolates from host CSS.
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
      <div class="sl-status" data-ref="status">Idle — press <span class="sl-kbd">Alt+Shift+A</span> or Pick</div>
      <div class="sl-row">
        <button class="sl-btn primary" data-action="toggle-pick">Pick</button>
        <button class="sl-btn" data-action="submit-batch" disabled>Submit batch</button>
        <button class="sl-btn" data-action="clear" disabled>Clear</button>
      </div>
      <div class="sl-queue" data-ref="queue"></div>
    `;
    root.appendChild(this.toolbar);

    this.statusEl = this.toolbar.querySelector('[data-ref="status"]')!;
    this.queueEl = this.toolbar.querySelector('[data-ref="queue"]')!;

    this.toolbar.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null;
      const action = t?.closest("[data-action]")?.getAttribute("data-action");
      if (action === "toggle-pick") this.togglePick();
      if (action === "submit-batch") void this.submitBatch();
      if (action === "clear") this.clearQueue();
    });

    document.documentElement.appendChild(this.host);
    ensureBridge();
  }

  setStatus(text: string): void {
    this.statusEl.innerHTML = text;
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

  private async submitOne(item: PickItem): Promise<void> {
    this.hideBubble();
    this.setStatus("Creating session…");
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
    });
    if (!res.ok) {
      this.setStatus(`Submit failed: ${escapeHtml(res.error)}`);
      return;
    }
    const session = (res.data as { session?: { id: string; status: string } })
      ?.session;
    this.lastSessionStatus = session
      ? `Session ${session.id.slice(0, 8)}… → ${session.status}`
      : "Session created";
    this.setStatus(escapeHtml(this.lastSessionStatus));
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
    const count =
      (res.data as { sessions?: unknown[] })?.sessions?.length ?? items.length;
    this.clearQueue();
    this.setStatus(`Batch OK — ${count} session(s) created & WS subscribed.`);
    this.togglePick(false);
  }

  onSessionStatus(sessionId: string, status: string, stepCount: number): void {
    this.setStatus(
      `WS <strong>${escapeHtml(sessionId.slice(0, 8))}…</strong> → ${escapeHtml(status)} (steps ${stepCount})`,
    );
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
