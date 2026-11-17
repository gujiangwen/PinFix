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
};

export { baseUrl, token };
