import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
  Session,
  AgentStep,
  Review,
  Knowledge,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  Metrics,
  AuditEvent,
  SyncAgentsMdResult,
  SessionDiffResponse,
} from "@sightloop/shared";

const baseUrl = (import.meta.env.VITE_DAEMON_URL as string | undefined) ??
  "http://127.0.0.1:7420";
const token = (import.meta.env.VITE_DAEMON_TOKEN as string | undefined) ??
  "dev-token-change-me";

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-SightLoop-Token": token,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message ===
        "string"
        ? (body as { error: { message: string } }).error.message
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export type KnowledgeQuery = {
  project_id?: string;
  stack?: string;
  tag?: string;
  kind?: string;
  pinned?: boolean;
  include_archived?: boolean;
  q?: string;
  limit?: number;
};

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: () =>
    request<{ ok: boolean; service: string; version: string }>("/health"),
  listProjects: () =>
    request<{ projects: Project[] }>("/v1/projects").then((r) => r.projects),
  createProject: (input: CreateProjectInput) =>
    request<{ project: Project }>("/v1/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.project),
  updateProject: (id: string, input: UpdateProjectInput) =>
    request<{ project: Project }>(`/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.project),
  deleteProject: (id: string) =>
    request<void>(`/v1/projects/${id}`, { method: "DELETE" }),

  listSessions: (projectId?: string) =>
    request<{ sessions: Session[] }>(
      `/v1/sessions${qs({ project_id: projectId })}`,
    ).then((r) => r.sessions),
  getSession: (id: string) =>
    request<{
      session: Session;
      steps: AgentStep[];
      reviews: Review[];
    }>(`/v1/sessions/${id}`),
  getDiff: (id: string) =>
    request<SessionDiffResponse>(`/v1/sessions/${id}/diff`),

  listKnowledge: (query: KnowledgeQuery = {}) =>
    request<{ knowledge: Knowledge[] }>(`/v1/knowledge${qs(query)}`).then(
      (r) => r.knowledge,
    ),
  createKnowledge: (input: CreateKnowledgeInput) =>
    request<{ knowledge: Knowledge }>("/v1/knowledge", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.knowledge),
  updateKnowledge: (id: string, input: UpdateKnowledgeInput) =>
    request<{ knowledge: Knowledge }>(`/v1/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.knowledge),
  deleteKnowledge: (id: string) =>
    request<void>(`/v1/knowledge/${id}`, { method: "DELETE" }),
  exportKnowledge: (id: string) =>
    request<{ knowledge: Knowledge; markdown: string }>(
      `/v1/knowledge/${id}/export`,
    ),
  syncAgentsMd: (
    projectId: string,
    body: { knowledge_ids?: string[]; dry_run?: boolean } = {},
  ) =>
    request<{ sync: SyncAgentsMdResult }>(
      `/v1/projects/${projectId}/knowledge/sync-agents`,
      { method: "POST", body: JSON.stringify(body) },
    ).then((r) => r.sync),

  metrics: () =>
    request<{ metrics: Metrics }>("/v1/admin/metrics").then((r) => r.metrics),
  audit: (opts: { project_id?: string; session_id?: string; limit?: number } = {}) =>
    request<{ audit: AuditEvent[] }>(`/v1/admin/audit${qs(opts)}`).then(
      (r) => r.audit,
    ),

  getLlmSettings: () =>
    request<{ settings: LlmSettingsPublic }>("/v1/admin/llm-settings").then(
      (r) => r.settings,
    ),
  putLlmSettings: (body: LlmSettingsPatch) =>
    request<{
      settings: LlmSettingsPublic;
      applied_live: boolean;
      restart_hint: string;
    }>("/v1/admin/llm-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getExtension: () =>
    request<{ extension: ExtensionInstallInfo }>("/v1/admin/extension").then(
      (r) => r.extension,
    ),
  buildExtension: () =>
    request<{
      ok: boolean;
      extension: ExtensionInstallInfo;
      log_tail: string;
    }>("/v1/admin/extension/build", { method: "POST" }),
  downloadExtensionZip: async () => {
    const res = await fetch(`${baseUrl}/v1/admin/extension/zip`, {
      headers: { "X-SightLoop-Token": token },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { message?: string };
        };
        if (body.error?.message) msg = body.error.message;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { blob, filename: m?.[1] ?? "sightloop-extension.zip" };
  },
};

export type LlmRoleId = "planner" | "implementer" | "reviewer" | "judge";

export type PiConnectionPublic = {
  provider: string | null;
  base_url: string | null;
  default_model: string | null;
  api_key_set: boolean;
  api_key_hint: string | null;
};

export type LlmSettingsPublic = {
  dual_loop_enabled: boolean;
  dual_loop_mock: boolean;
  cross_judge: boolean;
  pi: PiConnectionPublic;
  role_models: Record<LlmRoleId, string | null>;
  settings_path: string;
  host_env_note: string;
};

export type LlmSettingsPatch = {
  dual_loop_enabled?: boolean;
  dual_loop_mock?: boolean;
  cross_judge?: boolean;
  pi?: {
    provider?: string | null;
    base_url?: string | null;
    default_model?: string | null;
    api_key?: string | null;
    clear_api_key?: boolean;
  };
  role_models?: Partial<Record<LlmRoleId, string | null>>;
};

export type ExtensionInstallInfo = {
  built: boolean;
  container_dist: string;
  host_dist: string | null;
  manifest_version: number | null;
  name: string | null;
  version: string | null;
  zip_available: boolean;
  chrome_allows: {
    silent_force_install: false;
    load_unpacked: true;
    web_pages_open_chrome_extensions: false;
    crx_from_http: false;
  };
  steps: { en: string[]; zh: string[] };
};

export { baseUrl, token };
