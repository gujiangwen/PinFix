import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
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
};

export { baseUrl };
