import { useEffect, useState, type FormEvent } from "react";
import type {
  Project,
  ProjectMode,
  Session,
  AgentStep,
  Review,
  Knowledge,
  Metrics,
  AuditEvent,
  KnowledgeKind,
} from "@sightloop/shared";
import {
  api,
  baseUrl,
  type ExtensionInstallInfo,
  type LlmRoleId,
  type LlmSettingsPatch,
  type LlmSettingsPublic,
} from "./api";
import { useI18n } from "./i18n";
import { useTheme } from "./theme";

type Tab =
  | "projects"
  | "sessions"
  | "knowledge"
  | "audit"
  | "metrics"
  | "extension"
  | "models";

type FormState = {
  name: string;
  repo_path: string;
  origin_pattern: string;
  verify_cmd: string;
  file_whitelist: string;
  mode: ProjectMode;
  default_branch: string;
};

const emptyForm = (): FormState => ({
  name: "",
  repo_path: "",
  origin_pattern: "http://localhost:*/*",
  verify_cmd: "",
  file_whitelist: "src/**\nAGENTS.md",
  mode: "hmr",
  default_branch: "main",
});

function parseWhitelist(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function tabFromHash(): Tab {
  const h = (location.hash.replace(/^#/, "") || "projects") as Tab;
  if (
    h === "projects" ||
    h === "sessions" ||
    h === "knowledge" ||
    h === "audit" ||
    h === "metrics" ||
    h === "extension" ||
    h === "models"
  ) {
    return h;
  }
  return "projects";
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [projects, setProjects] = useState<Project[]>([]);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function refreshProjects() {
    const list = await api.listProjects();
    setProjects(list);
  }

  useEffect(() => {
    (async () => {
      try {
        const h = await api.health();
        setDaemonOk(true);
        setVersion(h.version);
        await refreshProjects();
        setStatus(
          t("status.connected", { url: baseUrl, version: h.version }),
        );
      } catch (err) {
        setDaemonOk(false);
        setError(
          t("status.unreachable", {
            url: baseUrl,
            message: (err as Error).message,
          }),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  function go(next: Tab) {
    location.hash = next;
    setTab(next);
  }

  const tabs = [
    ["projects", t("nav.projects")],
    ["sessions", t("nav.sessions")],
    ["knowledge", t("nav.knowledge")],
    ["audit", t("nav.audit")],
    ["metrics", t("nav.metrics")],
    ["extension", t("nav.extension")],
    ["models", t("nav.models")],
  ] as const;

  return (
    <div className="shell wide">
      <header className="topbar">
        <div className="brand">
          <h1>SightLoop</h1>
          <span className="tag">{t("brand.tag")}</span>
          {daemonOk != null ? (
            <span className={`dot ${daemonOk ? "ok" : "bad"}`} title={status} />
          ) : null}
        </div>
        <nav className="tabs" aria-label={t("nav.aria")}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="chrome-prefs" aria-label={`${t("chrome.lang")} · ${t("chrome.theme")}`}>
          <div className="lang-quiet" role="group" aria-label={t("chrome.lang")}>
            <button
              type="button"
              className={locale === "zh-CN" ? "on" : ""}
              aria-pressed={locale === "zh-CN"}
              onClick={() => setLocale("zh-CN")}
            >
              {t("chrome.lang.zh")}
            </button>
            <span className="sep" aria-hidden="true">
              |
            </span>
            <button
              type="button"
              className={locale === "en" ? "on" : ""}
              aria-pressed={locale === "en"}
              onClick={() => setLocale("en")}
            >
              {t("chrome.lang.en")}
            </button>
          </div>
          <button
            type="button"
            className="theme-quiet"
            aria-label={
              theme === "dark"
                ? t("chrome.theme.light")
                : t("chrome.theme.dark")
            }
            title={
              theme === "dark"
                ? t("chrome.theme.light")
                : t("chrome.theme.dark")
            }
            onClick={() => toggleTheme()}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 4.5a1 1 0 0 1 1 1V7a1 1 0 1 1-2 0V5.5a1 1 0 0 1 1-1Zm0 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5-2.5a1 1 0 1 1 0-2H21a1 1 0 1 1 0 2h-1.5ZM3 12a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm13.95 5.45a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 1 1-1.41 1.41l-1.06-1.06a1 1 0 0 1 0-1.41ZM4.58 4.58a1 1 0 0 1 1.41 0L7.05 5.64A1 1 0 1 1 5.64 7.05L4.58 5.99a1 1 0 0 1 0-1.41Zm12.73-1.41 1.06 1.06a1 1 0 1 1-1.41 1.41L15.9 4.58a1 1 0 0 1 1.41-1.41ZM5.64 16.95l1.06 1.06a1 1 0 1 1-1.41 1.41L4.23 18.36a1 1 0 0 1 1.41-1.41ZM12 17a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V18a1 1 0 0 1 1-1Z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M14.6 3.1a1 1 0 0 1 1.2 1.3A7.5 7.5 0 1 0 19.6 14a1 1 0 0 1 1.85.76A9.5 9.5 0 1 1 13.4 2.85a1 1 0 0 1 1.2.25Z"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      <p className="lede">
        {t("lede")}{" "}
        <code>
          {baseUrl}
          {version ? ` · ${version}` : ""}
        </code>
      </p>

      {error ? <p className="status error">{error}</p> : null}

      {tab === "projects" ? (
        <ProjectsPanel
          projects={projects}
          onRefresh={refreshProjects}
          onStatus={setStatus}
          onError={setError}
        />
      ) : null}
      {tab === "sessions" ? (
        <SessionsPanel projects={projects} onError={setError} />
      ) : null}
      {tab === "knowledge" ? (
        <KnowledgePanel
          projects={projects}
          onError={setError}
          onStatus={setStatus}
        />
      ) : null}
      {tab === "audit" ? (
        <AuditPanel projects={projects} onError={setError} />
      ) : null}
      {tab === "metrics" ? <MetricsPanel onError={setError} /> : null}
      {tab === "extension" ? (
        <ExtensionPanel onError={setError} onStatus={setStatus} />
      ) : null}
      {tab === "models" ? (
        <ModelsPanel onError={setError} onStatus={setStatus} />
      ) : null}

      {!error && status ? (
        <p className="status ok footer-status">{status}</p>
      ) : null}
    </div>
  );
}

function ProjectsPanel(props: {
  projects: Project[];
  onRefresh: () => Promise<void>;
  onStatus: (s: string) => void;
  onError: (s: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(p: Project) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      repo_path: p.repo_path,
      origin_pattern: p.origin_pattern,
      verify_cmd: p.verify_cmd ?? "",
      file_whitelist: p.file_whitelist.join("\n"),
      mode: p.mode,
      default_branch: p.default_branch,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    props.onError("");
    try {
      const payload = {
        name: form.name.trim(),
        repo_path: form.repo_path.trim(),
        origin_pattern: form.origin_pattern.trim(),
        verify_cmd: form.verify_cmd.trim() || null,
        file_whitelist: parseWhitelist(form.file_whitelist),
        mode: form.mode,
        default_branch: form.default_branch.trim() || "main",
      };
      if (editingId) {
        await api.updateProject(editingId, payload);
        props.onStatus(
          t("projects.status.updated", { id: editingId, mode: payload.mode }),
        );
      } else {
        const created = await api.createProject(payload);
        props.onStatus(t("projects.status.created", { id: created.id }));
      }
      resetForm();
      await props.onRefresh();
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(p: Project, mode: ProjectMode) {
    setBusy(true);
    props.onError("");
    try {
      await api.updateProject(p.id, { mode });
      props.onStatus(
        mode === "pr"
          ? t("projects.status.prMode", { name: p.name })
          : t("projects.status.hmrMode", { name: p.name }),
      );
      await props.onRefresh();
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel mode-doc">
        <h2>{t("projects.modeDoc.title")}</h2>
        <ul className="doc-list">
          <li>
            <strong>HMR</strong> — {t("projects.modeDoc.hmr").replace(/^HMR — /, "")}
          </li>
          <li>
            <strong>PR</strong> — {t("projects.modeDoc.pr").replace(/^PR — /, "")}
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>
          {editingId ? t("projects.form.edit") : t("projects.form.register")}
        </h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            {t("projects.form.name")}
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t("projects.form.repo")}
            <input
              required
              className="mono"
              value={form.repo_path}
              onChange={(e) => setForm({ ...form, repo_path: e.target.value })}
            />
          </label>
          <label>
            {t("projects.form.origin")}
            <input
              required
              value={form.origin_pattern}
              onChange={(e) =>
                setForm({ ...form, origin_pattern: e.target.value })
              }
            />
          </label>
          <label>
            {t("projects.form.verify")}
            <input
              value={form.verify_cmd}
              onChange={(e) => setForm({ ...form, verify_cmd: e.target.value })}
            />
          </label>
          <label>
            {t("projects.form.whitelist")}
            <textarea
              value={form.file_whitelist}
              onChange={(e) =>
                setForm({ ...form, file_whitelist: e.target.value })
              }
            />
          </label>
          <div className="row">
            <label>
              {t("projects.form.mode")}
              <select
                value={form.mode}
                onChange={(e) =>
                  setForm({ ...form, mode: e.target.value as ProjectMode })
                }
              >
                <option value="hmr">hmr</option>
                <option value="pr">pr</option>
              </select>
            </label>
            <label>
              {t("projects.form.branch")}
              <input
                value={form.default_branch}
                onChange={(e) =>
                  setForm({ ...form, default_branch: e.target.value })
                }
              />
            </label>
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>
              {editingId ? t("projects.form.save") : t("projects.form.create")}
            </button>
            {editingId ? (
              <button
                className="btn secondary"
                type="button"
                onClick={resetForm}
                disabled={busy}
              >
                {t("projects.form.cancel")}
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>{t("projects.list.title")}</h2>
        {props.projects.length === 0 ? (
          <p className="empty">{t("projects.list.empty")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("projects.col.name")}</th>
                  <th>{t("projects.col.mode")}</th>
                  <th>{t("projects.col.repo")}</th>
                  <th>{t("projects.col.origin")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div>{p.name}</div>
                      <div className="mono muted">{p.id}</div>
                    </td>
                    <td>
                      <span className={`badge ${p.mode}`}>{p.mode}</span>
                      <div className="row tight">
                        <button
                          type="button"
                          className="btn secondary tiny"
                          disabled={busy || p.mode === "hmr"}
                          onClick={() => setMode(p, "hmr")}
                        >
                          {t("projects.btn.hmr")}
                        </button>
                        <button
                          type="button"
                          className="btn secondary tiny"
                          disabled={busy || p.mode === "pr"}
                          onClick={() => setMode(p, "pr")}
                        >
                          {t("projects.btn.pr")}
                        </button>
                      </div>
                    </td>
                    <td className="mono">{p.repo_path}</td>
                    <td className="mono">{p.origin_pattern}</td>
                    <td>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => startEdit(p)}
                        disabled={busy}
                      >
                        {t("projects.btn.edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SessionsPanel(props: {
  projects: Project[];
  onError: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    session: Session;
    steps: AgentStep[];
    reviews: Review[];
  } | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function loadList() {
    setBusy(true);
    props.onError("");
    try {
      setSessions(await api.listSessions(projectId || undefined));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function openSession(id: string) {
    setSelected(id);
    setBusy(true);
    props.onError("");
    try {
      const d = await api.getSession(id);
      setDetail(d);
      try {
        const diffRes = await api.getDiff(id);
        setDiff(diffRes.patch || t("sessions.diffEmpty"));
      } catch {
        setDiff(t("sessions.diffUnavailable"));
      }
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const projectName = (id: string) =>
    props.projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="split">
      <div className="panel">
        <div className="row between">
          <h2>{t("sessions.title")}</h2>
          <button
            type="button"
            className="btn secondary tiny"
            onClick={() => void loadList()}
            disabled={busy}
          >
            {t("sessions.refresh")}
          </button>
        </div>
        <label className="inline-filter">
          {t("sessions.project")}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t("sessions.all")}</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {sessions.length === 0 ? (
          <p className="empty">{t("sessions.empty")}</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`session-item ${selected === s.id ? "active" : ""}`}
                  onClick={() => void openSession(s.id)}
                >
                  <span className={`badge status-${s.status}`}>{s.status}</span>
                  <span className="mono">{s.id.slice(0, 10)}</span>
                  <span className="muted">
                    {projectName(s.project_id)} ·{" "}
                    {t("sessions.steps", { count: s.step_count })}
                  </span>
                  <span className="muted tiny">{fmtTime(s.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>{t("sessions.timeline")}</h2>
        {!detail ? (
          <p className="empty">{t("sessions.select")}</p>
        ) : (
          <>
            <div className="meta-grid">
              <div>
                <span className="muted">{t("sessions.status")}</span>
                <div>
                  <span className={`badge status-${detail.session.status}`}>
                    {detail.session.status}
                  </span>
                </div>
              </div>
              <div>
                <span className="muted">{t("sessions.page")}</span>
                <div className="mono wrap">{detail.session.page_url}</div>
              </div>
              <div>
                <span className="muted">{t("sessions.baseTemp")}</span>
                <div className="mono wrap">
                  {(detail.session.git_base_sha ?? "—").slice(0, 8)} →{" "}
                  {(detail.session.temp_commit_sha ?? "—").slice(0, 8)}
                </div>
              </div>
            </div>

            <h3 className="subhead">{t("sessions.stepTimeline")}</h3>
            <ol className="timeline">
              {detail.steps.map((step) => (
                <li key={step.id}>
                  <div className="tl-head">
                    <span className="badge phase">{step.phase}</span>
                    <span className="mono">
                      #{step.idx} {step.tool_name ?? ""}
                    </span>
                    {step.duration_ms != null ? (
                      <span className="muted">{step.duration_ms}ms</span>
                    ) : null}
                    {step.tokens_in != null || step.tokens_out != null ? (
                      <span className="muted">
                        tok {step.tokens_in ?? "—"}/{step.tokens_out ?? "—"}
                      </span>
                    ) : null}
                  </div>
                  {step.summary ? (
                    <p className="tl-summary">{step.summary}</p>
                  ) : null}
                  {step.error ? (
                    <p className="status error">{step.error}</p>
                  ) : null}
                  {step.tool_name === "list_knowledge" ? (
                    <RecallHits output={step.output} />
                  ) : null}
                  {step.output && step.tool_name !== "list_knowledge" ? (
                    <pre className="code-block">
                      {JSON.stringify(step.output, null, 2).slice(0, 1200)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>

            {detail.reviews.length > 0 ? (
              <>
                <h3 className="subhead">{t("sessions.reviews")}</h3>
                <ul className="doc-list">
                  {detail.reviews.map((r) => (
                    <li key={r.id}>
                      <span className="badge">{r.decision}</span>{" "}
                      {r.note ?? ""}{" "}
                      <span className="muted">{fmtTime(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h3 className="subhead">{t("sessions.diff")}</h3>
            <pre className="code-block diff">{diff}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function RecallHits({ output }: { output: unknown }) {
  const { t } = useI18n();
  if (!output || typeof output !== "object") return null;
  const hits = (output as { hits?: unknown }).hits;
  if (!Array.isArray(hits) || hits.length === 0) {
    return <p className="muted">{t("sessions.recallNone")}</p>;
  }
  return (
    <div className="recall">
      <div className="muted">{t("sessions.recallTitle")}</div>
      <ul>
        {hits.map((h, i) => {
          const hit = h as {
            title?: string;
            score?: number | null;
            id?: string | null;
            distance?: number | null;
            retrieve?: string | null;
          };
          return (
            <li key={hit.id ?? i}>
              <strong>{hit.title ?? t("sessions.untitled")}</strong>
              {hit.score != null ? (
                <span className="muted">
                  {" "}
                  score={Number(hit.score).toFixed(2)}
                </span>
              ) : null}
              {hit.distance != null ? (
                <span className="muted">
                  {" "}
                  dist={Number(hit.distance).toFixed(3)}
                </span>
              ) : null}
              {hit.retrieve ? (
                <span className="muted"> · {hit.retrieve}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KnowledgePanel(props: {
  projects: Project[];
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [stack, setStack] = useState("");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<Knowledge[]>([]);
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    body_md: "",
    kind: "pattern" as KnowledgeKind,
    tags: "",
    stack: "",
  });

  async function load() {
    setBusy(true);
    props.onError("");
    try {
      const list = await api.listKnowledge({
        project_id: projectId || undefined,
        stack: stack || undefined,
        tag: tag || undefined,
        q: q || undefined,
        include_archived: includeArchived,
        limit: 100,
      });
      setItems(list);
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, includeArchived]);

  function startEdit(k: Knowledge) {
    setEditing(k);
    setDraft({
      title: k.title,
      body_md: k.body_md,
      kind: k.kind,
      tags: (k.tags ?? []).join(", "),
      stack: k.stack ?? "",
    });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    props.onError("");
    try {
      await api.updateKnowledge(editing.id, {
        title: draft.title,
        body_md: draft.body_md,
        kind: draft.kind,
        tags: draft.tags
          .split(/[,]/)
          .map((x) => x.trim())
          .filter(Boolean),
        stack: draft.stack.trim() || null,
      });
      props.onStatus(t("knowledge.status.updated", { id: editing.id }));
      setEditing(null);
      await load();
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(k: Knowledge) {
    await api.updateKnowledge(k.id, { pinned: !k.pinned });
    await load();
  }

  async function toggleArchive(k: Knowledge) {
    await api.updateKnowledge(k.id, { archived: !k.archived });
    await load();
  }

  async function exportCard(k: Knowledge) {
    const res = await api.exportKnowledge(k.id);
    const blob = new Blob([res.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sightloop-${k.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function syncAgents(dryRun: boolean) {
    if (!projectId) {
      props.onError(t("knowledge.err.selectProject"));
      return;
    }
    setBusy(true);
    props.onError("");
    try {
      const pinned = items
        .filter((i) => i.pinned && !i.archived)
        .map((i) => i.id);
      const sync = await api.syncAgentsMd(projectId, {
        knowledge_ids: pinned.length ? pinned : undefined,
        dry_run: dryRun,
      });
      props.onStatus(
        dryRun
          ? t("knowledge.status.preview", {
              bytes: sync.bytes,
              path: sync.path,
            })
          : t("knowledge.status.wrote", {
              bytes: sync.bytes,
              path: sync.path,
            }),
      );
      if (dryRun) {
        console.info(sync.markdown);
      }
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="row between">
          <h2>{t("knowledge.title")}</h2>
          <div className="row">
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void syncAgents(true)}
            >
              {t("knowledge.previewAgents")}
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={busy}
              onClick={() => void syncAgents(false)}
            >
              {t("knowledge.syncAgents")}
            </button>
          </div>
        </div>
        <div className="filters">
          <label>
            {t("knowledge.project")}
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">{t("knowledge.all")}</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("knowledge.stack")}
            <input
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              placeholder="react"
            />
          </label>
          <label>
            {t("knowledge.tag")}
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="ProductCard"
            />
          </label>
          <label>
            {t("knowledge.search")}
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t("knowledge.includeArchived")}
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            {t("knowledge.filter")}
          </button>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <h2>{t("knowledge.cards", { count: items.length })}</h2>
          {items.length === 0 ? (
            <p className="empty">{t("knowledge.empty")}</p>
          ) : (
            <ul className="knowledge-list">
              {items.map((k) => (
                <li key={k.id} className={k.archived ? "archived" : ""}>
                  <div className="row between">
                    <div>
                      {k.pinned ? (
                        <span className="pin">{t("knowledge.pinned")}</span>
                      ) : null}
                      <strong>{k.title}</strong>
                      <div className="muted">
                        {k.kind}
                        {k.stack ? ` · ${k.stack}` : ""}
                        {(k.tags ?? []).length
                          ? ` · ${(k.tags ?? []).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    <div className="row tight">
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => startEdit(k)}
                      >
                        {t("knowledge.edit")}
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void togglePin(k)}
                      >
                        {k.pinned ? t("knowledge.unpin") : t("knowledge.pin")}
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void toggleArchive(k)}
                      >
                        {k.archived
                          ? t("knowledge.unarchive")
                          : t("knowledge.archive")}
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void exportCard(k)}
                      >
                        {t("knowledge.export")}
                      </button>
                    </div>
                  </div>
                  <pre className="code-block compact">
                    {k.body_md.slice(0, 400)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h2>
            {editing ? t("knowledge.editCard") : t("knowledge.editor")}
          </h2>
          {!editing ? (
            <p className="empty">{t("knowledge.selectEdit")}</p>
          ) : (
            <form className="form-grid" onSubmit={saveEdit}>
              <label>
                {t("knowledge.titleField")}
                <input
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.kind")}
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      kind: e.target.value as KnowledgeKind,
                    })
                  }
                >
                  <option value="pattern">pattern</option>
                  <option value="anti_pattern">anti_pattern</option>
                  <option value="selector_map">selector_map</option>
                  <option value="fix_snippet">fix_snippet</option>
                </select>
              </label>
              <label>
                {t("knowledge.stack")}
                <input
                  value={draft.stack}
                  onChange={(e) =>
                    setDraft({ ...draft, stack: e.target.value })
                  }
                />
              </label>
              <label>
                {t("knowledge.tags")}
                <input
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
              </label>
              <label>
                {t("knowledge.body")}
                <textarea
                  className="tall"
                  value={draft.body_md}
                  onChange={(e) =>
                    setDraft({ ...draft, body_md: e.target.value })
                  }
                />
              </label>
              <div className="row">
                <button className="btn" type="submit" disabled={busy}>
                  {t("knowledge.save")}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  {t("knowledge.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function AuditPanel(props: {
  projects: Project[];
  onError: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    props.onError("");
    try {
      setEvents(
        await api.audit({
          project_id: projectId || undefined,
          limit: 150,
        }),
      );
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="panel">
      <div className="row between">
        <h2>{t("audit.title")}</h2>
        <button
          type="button"
          className="btn secondary tiny"
          disabled={busy}
          onClick={() => void load()}
        >
          {t("audit.refresh")}
        </button>
      </div>
      <label className="inline-filter">
        {t("audit.project")}
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">{t("audit.all")}</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {events.length === 0 ? (
        <p className="empty">{t("audit.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("audit.col.when")}</th>
                <th>{t("audit.col.event")}</th>
                <th>{t("audit.col.project")}</th>
                <th>{t("audit.col.session")}</th>
                <th>{t("audit.col.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtTime(e.created_at)}</td>
                  <td>
                    <span className="badge">{e.event}</span>
                  </td>
                  <td className="mono">{(e.project_id ?? "—").slice(0, 10)}</td>
                  <td className="mono">{(e.session_id ?? "—").slice(0, 10)}</td>
                  <td>
                    <pre className="code-block compact">
                      {JSON.stringify(e.detail, null, 2).slice(0, 400)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricsPanel(props: { onError: (s: string) => void }) {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMetrics(await api.metrics());
      } catch (err) {
        props.onError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!metrics) return <p className="empty">{t("metrics.loading")}</p>;

  return (
    <div className="panel">
      <h2>{t("metrics.title")}</h2>
      <div className="metrics-grid">
        <Metric label={t("metrics.sessions")} value={String(metrics.sessions_total)} />
        <Metric
          label={t("metrics.failureRate")}
          value={`${Math.round(metrics.failure_rate * 1000) / 10}%`}
        />
        <Metric label={t("metrics.avgSteps")} value={String(metrics.avg_steps)} />
        <Metric
          label={t("metrics.knowledge")}
          value={String(metrics.knowledge_total)}
        />
        <Metric
          label={t("metrics.pinned")}
          value={String(metrics.knowledge_pinned)}
        />
        <Metric
          label={t("metrics.auditEvents")}
          value={String(metrics.audit_total)}
        />
        <Metric
          label={t("metrics.vec")}
          value={
            metrics.vec_ready
              ? t("metrics.vecReady", { count: metrics.vec_indexed ?? 0 })
              : t("metrics.vecUnavailable")
          }
        />
      </div>
      <h3 className="subhead">{t("metrics.byStatus")}</h3>
      <pre className="code-block">
        {JSON.stringify(metrics.sessions_by_status, null, 2)}
      </pre>
      <h3 className="subhead">{t("metrics.byDecision")}</h3>
      <pre className="code-block">
        {JSON.stringify(metrics.reviews_by_decision, null, 2)}
      </pre>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="muted">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function ExtensionPanel(props: {
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<ExtensionInstallInfo | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    props.onError("");
    try {
      setInfo(await api.getExtension());
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onBuild() {
    setBusy(true);
    props.onError("");
    try {
      const res = await api.buildExtension();
      setInfo(res.extension);
      props.onStatus(t("ext.builtOk"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    setBusy(true);
    props.onError("");
    try {
      const { blob, filename } = await api.downloadExtensionZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      props.onStatus(t("ext.downloaded"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCopyPath() {
    const path = info?.host_dist || info?.container_dist;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      props.onStatus(t("ext.copied"));
    } catch {
      props.onError(t("ext.copyFail"));
    }
  }

  const steps =
    info == null
      ? []
      : locale === "zh-CN"
        ? info.steps.zh
        : info.steps.en;

  return (
    <>
      <div className="panel">
        <div className="row between">
          <h2>{t("ext.title")}</h2>
          <div className="row">
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {t("ext.refresh")}
            </button>
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void onBuild()}
            >
              {t("ext.build")}
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={busy || !info?.zip_available}
              onClick={() => void onDownload()}
            >
              {t("ext.download")}
            </button>
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy || !(info?.host_dist || info?.container_dist)}
              onClick={() => void onCopyPath()}
            >
              {t("ext.copyPath")}
            </button>
          </div>
        </div>
        <p className="lede" style={{ marginBottom: "1rem" }}>
          {t("ext.lede")}
        </p>
        {!info ? (
          <p className="empty">{t("metrics.loading")}</p>
        ) : (
          <>
            <div className="meta-grid">
              <div>
                <span className="muted">{t("ext.built")}</span>
                <div>
                  <span className={`badge ${info.built ? "hmr" : "pr"}`}>
                    {info.built ? t("ext.built") : t("ext.notBuilt")}
                  </span>
                  {info.version ? (
                    <span className="muted"> · v{info.version}</span>
                  ) : null}
                </div>
              </div>
              <div>
                <span className="muted">{t("ext.hostPath")}</span>
                <div className="mono wrap">
                  {info.host_dist ?? "—"}
                </div>
              </div>
              <div>
                <span className="muted">{t("ext.containerPath")}</span>
                <div className="mono wrap">{info.container_dist}</div>
              </div>
            </div>
            <h3 className="subhead">{t("ext.limits")}</h3>
            <ul className="doc-list">
              <li>{t("ext.limit.silent")}</li>
              <li>{t("ext.limit.load")}</li>
              <li>{t("ext.limit.chromeUrl")}</li>
              <li>{t("ext.limit.crx")}</li>
            </ul>
            <h3 className="subhead">{t("ext.steps")}</h3>
            <ol className="doc-list">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </>
  );
}

function ModelsPanel(props: {
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [dualLoop, setDualLoop] = useState(false);
  const [dualMock, setDualMock] = useState(true);
  const [crossJudge, setCrossJudge] = useState(false);
  const [draft, setDraft] = useState<
    Record<
      LlmRoleId,
      {
        provider: string;
        model: string;
        base_url: string;
        api_key: string;
        clear_api_key: boolean;
      }
    >
  >({
    planner: {
      provider: "",
      model: "",
      base_url: "",
      api_key: "",
      clear_api_key: false,
    },
    implementer: {
      provider: "",
      model: "",
      base_url: "",
      api_key: "",
      clear_api_key: false,
    },
    reviewer: {
      provider: "",
      model: "",
      base_url: "",
      api_key: "",
      clear_api_key: false,
    },
    judge: {
      provider: "",
      model: "",
      base_url: "",
      api_key: "",
      clear_api_key: false,
    },
  });

  function hydrate(s: LlmSettingsPublic) {
    setSettings(s);
    setDualLoop(s.dual_loop_enabled);
    setDualMock(s.dual_loop_mock);
    setCrossJudge(s.cross_judge);
    setDraft({
      planner: {
        provider: s.roles.planner.provider ?? "",
        model: s.roles.planner.model ?? "",
        base_url: s.roles.planner.base_url ?? "",
        api_key: "",
        clear_api_key: false,
      },
      implementer: {
        provider: s.roles.implementer.provider ?? "",
        model: s.roles.implementer.model ?? "",
        base_url: s.roles.implementer.base_url ?? "",
        api_key: "",
        clear_api_key: false,
      },
      reviewer: {
        provider: s.roles.reviewer.provider ?? "",
        model: s.roles.reviewer.model ?? "",
        base_url: s.roles.reviewer.base_url ?? "",
        api_key: "",
        clear_api_key: false,
      },
      judge: {
        provider: s.roles.judge.provider ?? "",
        model: s.roles.judge.model ?? "",
        base_url: s.roles.judge.base_url ?? "",
        api_key: "",
        clear_api_key: false,
      },
    });
  }

  useEffect(() => {
    (async () => {
      try {
        hydrate(await api.getLlmSettings());
      } catch (err) {
        props.onError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    props.onError("");
    try {
      const patch: LlmSettingsPatch = {
        dual_loop_enabled: dualLoop,
        dual_loop_mock: dualMock,
        cross_judge: crossJudge,
      };
      for (const role of [
        "planner",
        "implementer",
        "reviewer",
        "judge",
      ] as const) {
        const d = draft[role];
        patch[role] = {
          provider: role === "implementer" || role === "judge" ? undefined : d.provider,
          model: d.model,
          base_url:
            role === "implementer" || role === "judge" ? undefined : d.base_url,
          api_key: d.clear_api_key ? undefined : d.api_key || undefined,
          clear_api_key: d.clear_api_key || undefined,
        };
      }
      const res = await api.putLlmSettings(patch);
      hydrate(res.settings);
      props.onStatus(t("models.saved"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const roles: LlmRoleId[] = [
    "planner",
    "implementer",
    "reviewer",
    "judge",
  ];

  if (!settings) return <p className="empty">{t("metrics.loading")}</p>;

  return (
    <div className="panel">
      <h2>{t("models.title")}</h2>
      <p className="lede" style={{ marginBottom: "1rem" }}>
        {t("models.lede")}
      </p>
      <form className="form-grid" onSubmit={onSave}>
        <label className="check">
          <input
            type="checkbox"
            checked={dualLoop}
            onChange={(e) => setDualLoop(e.target.checked)}
          />
          {t("models.dualLoop")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={dualMock}
            onChange={(e) => setDualMock(e.target.checked)}
          />
          {t("models.dualMock")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={crossJudge}
            onChange={(e) => setCrossJudge(e.target.checked)}
          />
          {t("models.crossJudge")}
        </label>

        {roles.map((role) => {
          const r = settings.roles[role];
          const d = draft[role];
          const showProvider = role === "planner" || role === "reviewer";
          const roleTitle =
            role === "planner"
              ? t("models.role.planner")
              : role === "implementer"
                ? t("models.role.implementer")
                : role === "reviewer"
                  ? t("models.role.reviewer")
                  : t("models.role.judge");
          return (
            <div key={role} className="panel" style={{ marginBottom: 0 }}>
              <h3 className="subhead" style={{ marginTop: 0 }}>
                {roleTitle}
                <span className="muted">
                  {" "}
                  ·{" "}
                  {r.api_key_set
                    ? t("models.keySet", { hint: r.api_key_hint ?? "••••" })
                    : t("models.keyMissing")}
                </span>
              </h3>
              <div className="form-grid">
                {showProvider ? (
                  <label>
                    {t("models.provider")}
                    <input
                      value={d.provider}
                      placeholder="openai | anthropic | compatible"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [role]: { ...d, provider: e.target.value },
                        })
                      }
                    />
                  </label>
                ) : null}
                <label>
                  {t("models.model")}
                  <input
                    value={d.model}
                    placeholder="gpt-4o-mini"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [role]: { ...d, model: e.target.value },
                      })
                    }
                  />
                </label>
                {showProvider ? (
                  <label>
                    {t("models.baseUrl")}
                    <input
                      value={d.base_url}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [role]: { ...d, base_url: e.target.value },
                        })
                      }
                    />
                  </label>
                ) : null}
                <label>
                  {t("models.apiKey")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={d.api_key}
                    placeholder={t("models.apiKeyPlaceholder")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [role]: {
                          ...d,
                          api_key: e.target.value,
                          clear_api_key: false,
                        },
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={d.clear_api_key}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [role]: {
                          ...d,
                          clear_api_key: e.target.checked,
                          api_key: e.target.checked ? "" : d.api_key,
                        },
                      })
                    }
                  />
                  {t("models.clearKey")}
                </label>
              </div>
            </div>
          );
        })}

        <p className="muted mono wrap">
          {t("models.path")}: {settings.settings_path}
        </p>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {t("models.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
