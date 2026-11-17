import type {
  ExtensionSettings,
  RuntimeResponse,
} from "../shared/protocol";
import { DEFAULT_SETTINGS } from "../shared/protocol";

const daemonUrl = document.getElementById("daemonUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const projectId = document.getElementById("projectId") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLParagraphElement;

function setStatus(msg: string): void {
  status.textContent = msg;
}

async function send(message: unknown): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function readForm(): ExtensionSettings {
  return {
    daemonUrl: daemonUrl.value.trim() || DEFAULT_SETTINGS.daemonUrl,
    token: token.value.trim() || DEFAULT_SETTINGS.token,
    projectId: projectId.value,
  };
}

async function load(): Promise<void> {
  const res = await send({ type: "get_settings" });
  if (!res.ok) {
    setStatus(res.error);
    return;
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(res.data as ExtensionSettings),
  };
  daemonUrl.value = settings.daemonUrl;
  token.value = settings.token;
  await refreshProjects(settings.projectId);
}

async function refreshProjects(selectId?: string): Promise<void> {
  // Persist URL/token first so list_projects uses them.
  await send({ type: "save_settings", settings: readForm() });
  const res = await send({ type: "list_projects" });
  if (!res.ok) {
    setStatus(`Projects: ${res.error}`);
    return;
  }
  const projects =
    (
      res.data as {
        projects?: Array<{ id: string; name: string; repo_path: string }>;
      }
    ).projects ?? [];
  projectId.innerHTML = "";
  if (projects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No projects — register via Admin/curl";
    projectId.appendChild(opt);
    setStatus("Daemon reachable, but no projects yet.");
    return;
  }
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.id.slice(0, 8)}…)`;
    projectId.appendChild(opt);
  }
  const preferred = selectId || readForm().projectId;
  if (preferred && projects.some((p) => p.id === preferred)) {
    projectId.value = preferred;
  }
  setStatus(`${projects.length} project(s) loaded.`);
}

document.getElementById("save")!.addEventListener("click", async () => {
  const res = await send({ type: "save_settings", settings: readForm() });
  setStatus(res.ok ? "Saved." : res.error);
});

document.getElementById("refresh")!.addEventListener("click", () => {
  void refreshProjects();
});

document.getElementById("pick")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    setStatus("No active tab.");
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle_pick" });
    setStatus("Toggled pick mode on tab.");
    window.close();
  } catch {
    setStatus("Content script not on this tab (open a localhost page).");
  }
});

void load();
