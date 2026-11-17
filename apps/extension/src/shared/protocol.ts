/** Cross-world + extension message contracts (M2–M5). */

export const EXT_SOURCE = "sightloop-ext" as const;
export const PAGE_SOURCE = "sightloop-page" as const;

export type PickItem = {
  id: string;
  sniffedAt: number;
  pageUrl: string;
  sniff: Record<string, unknown> | unknown[];
  note: string;
  label: string;
};

export type ExtensionSettings = {
  daemonUrl: string;
  token: string;
  projectId: string;
  /** When true (default), start Agent Loop right after session create. */
  autoStart?: boolean;
  /** ISO timestamp when DX wizard completed once. */
  dxOnboardedAt?: string | null;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  daemonUrl: "http://127.0.0.1:7420",
  token: "dev-token-change-me",
  projectId: "",
  autoStart: true,
  dxOnboardedAt: null,
};

export const DAEMON_PORT_CANDIDATES = [7420, 7421, 7430] as const;

/** window.postMessage between content ↔ injected */
export type PageBridgeMessage =
  | {
      source: typeof EXT_SOURCE;
      type: "sl.ping";
      nonce: string;
    }
  | {
      source: typeof EXT_SOURCE;
      type: "sl.sniff_at";
      requestId: string;
      nonce: string;
      x: number;
      y: number;
    }
  | {
      source: typeof PAGE_SOURCE;
      type: "sl.pong";
      nonce: string;
    }
  | {
      source: typeof PAGE_SOURCE;
      type: "sl.sniff_result";
      requestId: string;
      nonce: string;
      ok: true;
      result: Record<string, unknown>;
    }
  | {
      source: typeof PAGE_SOURCE;
      type: "sl.sniff_result";
      requestId: string;
      nonce: string;
      ok: false;
      error: string;
    };

/** chrome.runtime messages */
export type RuntimeMessage =
  | { type: "get_settings" }
  | { type: "save_settings"; settings: ExtensionSettings }
  | { type: "list_projects" }
  | { type: "discover_daemon" }
  | { type: "dx_status" }
  | { type: "dx_bootstrap" }
  | { type: "dx_ensure_fixture" }
  | {
      type: "dx_bind_repo";
      repo_path: string;
      name?: string;
      origin_pattern?: string;
      mode?: "hmr" | "pr";
    }
  | {
      type: "create_session";
      pageUrl: string;
      sniff: unknown;
      annotation?: { note?: string; selector?: string };
      /** Override settings.autoStart for this call. */
      start?: boolean;
    }
  | {
      type: "create_sessions_batch";
      pageUrl: string;
      items: Array<{
        sniff: unknown;
        annotation?: { note?: string; selector?: string };
      }>;
    }
  | { type: "start_session"; sessionId: string }
  | {
      type: "review_session";
      sessionId: string;
      decision: "accept" | "refine" | "revert";
      note?: string;
      force_accept?: boolean;
    }
  | { type: "run_acceptance_gate"; sessionId: string }
  | { type: "get_acceptance_gate"; sessionId: string }
  | { type: "get_diff"; sessionId: string }
  | { type: "get_session"; sessionId: string }
  | { type: "subscribe_session"; sessionId: string }
  | {
      type: "source_correct";
      sessionId: string;
      file: string;
      line?: number;
      note?: string;
      selector?: string;
      fingerprint?: string;
    }
  | { type: "search_files"; query: string; limit?: number }
  | {
      type: "locate_source";
      selector?: string;
      fingerprint?: string;
      component_name?: string;
      source_mapping_urls?: string[];
    }
  | { type: "toggle_pick" }
  | { type: "pick_state"; active: boolean };

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };
