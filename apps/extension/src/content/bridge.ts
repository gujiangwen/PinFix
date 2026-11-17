import {
  EXT_SOURCE,
  PAGE_SOURCE,
  type PageBridgeMessage,
} from "../shared/protocol";

let nonce = crypto.randomUUID();
let pageReady = false;

export function currentNonce(): string {
  return nonce;
}

/** Main-world script is declared in the manifest (`world: "MAIN"`). */
export function ensureBridge(): void {
  window.postMessage(
    { source: EXT_SOURCE, type: "sl.ping", nonce } satisfies PageBridgeMessage,
    "*",
  );
}

export function sniffAt(
  x: number,
  y: number,
  timeoutMs = 2500,
): Promise<Record<string, unknown>> {
  ensureBridge();
  const requestId = crypto.randomUUID();
  const n = nonce;

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          "Sniff timed out — Main World inject may be missing on this page",
        ),
      );
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      const data = event.data as PageBridgeMessage | undefined;
      if (!data || data.source !== PAGE_SOURCE) return;
      if (data.type === "sl.pong" && data.nonce === n) {
        pageReady = true;
        return;
      }
      if (data.type !== "sl.sniff_result") return;
      if (data.requestId !== requestId || data.nonce !== n) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error));
    }

    window.addEventListener("message", onMessage);

    const send = () => {
      window.postMessage(
        {
          source: EXT_SOURCE,
          type: "sl.sniff_at",
          requestId,
          nonce: n,
          x,
          y,
        } satisfies PageBridgeMessage,
        "*",
      );
    };

    // Small delay so ping/pong can settle on first pick.
    if (pageReady) send();
    else window.setTimeout(send, 50);
  });
}
