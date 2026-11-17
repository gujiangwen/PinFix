import {
  sniffElement,
  collectPageSourceMappingUrls,
} from "@sightloop/sniff";
import {
  EXT_SOURCE,
  PAGE_SOURCE,
  type PageBridgeMessage,
} from "../shared/protocol";

declare global {
  interface Window {
    __SIGHTLOOP_INJECTED__?: boolean;
  }
}

if (!window.__SIGHTLOOP_INJECTED__) {
  window.__SIGHTLOOP_INJECTED__ = true;
  install();
}

function install(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as PageBridgeMessage | undefined;
    if (!data || data.source !== EXT_SOURCE) return;

    if (data.type === "sl.ping") {
      post({ source: PAGE_SOURCE, type: "sl.pong", nonce: data.nonce });
      return;
    }

    if (data.type === "sl.sniff_at") {
      try {
        const el = document.elementFromPoint(data.x, data.y);
        if (!el || el.id === "sightloop-root") {
          post({
            source: PAGE_SOURCE,
            type: "sl.sniff_result",
            requestId: data.requestId,
            nonce: data.nonce,
            ok: false,
            error: "No element under pointer",
          });
          return;
        }
        // Prefer deepest non-SightLoop element.
        const target = resolveTarget(el);
        const result = sniffElement(target) as unknown as Record<string, unknown>;
        try {
          const maps = collectPageSourceMappingUrls(document);
          if (maps.length) result.source_mapping_urls = maps;
        } catch {
          /* ignore map collection failures */
        }
        post({
          source: PAGE_SOURCE,
          type: "sl.sniff_result",
          requestId: data.requestId,
          nonce: data.nonce,
          ok: true,
          result,
        });
      } catch (err) {
        post({
          source: PAGE_SOURCE,
          type: "sl.sniff_result",
          requestId: data.requestId,
          nonce: data.nonce,
          ok: false,
          error: (err as Error).message ?? String(err),
        });
      }
    }
  });
}

function resolveTarget(el: Element): Element {
  let node: Element | null = el;
  while (node) {
    if (node.id === "sightloop-root") {
      return document.body;
    }
    node = node.parentElement;
  }
  return el;
}

function post(msg: PageBridgeMessage): void {
  window.postMessage(msg, "*");
}
