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
import { api, baseUrl } from "./api";

type Tab = "projects" | "sessions" | "knowledge" | "audit" | "metrics";

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
    h === "metrics"
  ) {
    return h;
  }
  return "projects";
}

export function App() {
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
        setStatus(`Connected to ${baseUrl} (v${h.version})`);
      } catch (err) {
        setDaemonOk(false);
        setError(
          `Cannot reach daemon at ${baseUrl}: ${(err as Error).message}`,
        );
      }
    })();
  }, []);

  function go(next: Tab) {
    location.hash = next;
    setTab(next);
  }

  return (
    <div className="shell wide">
      <header className="topbar">
        <div className="brand">
          <h1>SightLoop</h1>
          <span className="tag">Admin · Observability</span>
          {daemonOk != null ? (
            <span className={`dot ${daemonOk ? "ok" : "bad"}`} title={status} />
          ) : null}
        </div>
        <nav className="tabs" aria-label="Admin sections">
          {(
            [
              ["projects", "Projects"],
              ["sessions", "Sessions"],
              ["knowledge", "Knowledge"],
              ["audit", "Audit"],
              ["metrics", "Metrics"],
            ] as const
          ).map(([id, label]) => (
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
      </header>

      <p className="lede">
        Full M4 observability: session timelines, knowledge dual-loop, HMR/PR
        mode, audit, and metrics. Daemon{" "}
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
        <KnowledgePanel projects={projects} onError={setError} onStatus={setStatus} />
      ) : null}
      {tab === "audit" ? (
        <AuditPanel projects={projects} onError={setError} />
      ) : null}
      {tab === "metrics" ? <MetricsPanel onError={setError} /> : null}

      {!error && status ? <p className="status ok footer-status">{status}</p> : null}
    </div>
  );
}

function ProjectsPanel(props: {
  projects: Project[];
  onRefresh: () => Promise<void>;
  onStatus: (s: string) => void;
  onError: (s: string) => void;
}) {
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
        props.onStatus(`Updated project ${editingId} (mode=${payload.mode})`);
      } else {
        const created = await api.createProject(payload);
        props.onStatus(`Created project ${created.id}`);
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
          ? `Project ${p.name} → PR mode (Accept runs gh pr create)`
          : `Project ${p.name} → HMR mode (Accept keeps local commit)`,
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
        <h2>HMR vs PR mode</h2>
        <ul className="doc-list">
          <li>
            <strong>HMR</strong> — Accept keeps the local temp commit for hot
            reload preview; no remote push.
          </li>
          <li>
            <strong>PR</strong> — Accept additionally runs{" "}
            <code>gh pr create</code> (requires <code>gh</code> authenticated
            for the repo). Failures are recorded in Audit without failing the
            Accept/distill path.
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>{editingId ? "Edit project" : "Register project"}</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Repo path (absolute)
            <input
              required
              className="mono"
              value={form.repo_path}
              onChange={(e) => setForm({ ...form, repo_path: e.target.value })}
            />
          </label>
          <label>
            Origin pattern
            <input
              required
              value={form.origin_pattern}
              onChange={(e) =>
                setForm({ ...form, origin_pattern: e.target.value })
              }
            />
          </label>
          <label>
            Verify command (optional)
            <input
              value={form.verify_cmd}
              onChange={(e) => setForm({ ...form, verify_cmd: e.target.value })}
            />
          </label>
          <label>
            File whitelist (include AGENTS.md for Knowledge sync)
            <textarea
              value={form.file_whitelist}
              onChange={(e) =>
                setForm({ ...form, file_whitelist: e.target.value })
              }
            />
          </label>
          <div className="row">
            <label>
              Mode
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
              Default branch
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
              {editingId ? "Save changes" : "Create project"}
            </button>
            {editingId ? (
              <button
                className="btn secondary"
                type="button"
                onClick={resetForm}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Projects</h2>
        {props.projects.length === 0 ? (
          <p className="empty">No projects registered yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mode</th>
                  <th>Repo</th>
                  <th>Origin</th>
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
                          HMR
                        </button>
                        <button
                          type="button"
                          className="btn secondary tiny"
                          disabled={busy || p.mode === "pr"}
                          onClick={() => setMode(p, "pr")}
                        >
                          PR
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
                        Edit
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
        setDiff(diffRes.patch || "(empty patch)");
      } catch {
        setDiff("(diff unavailable)");
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
          <h2>Sessions</h2>
          <button
            type="button"
            className="btn secondary tiny"
            onClick={() => void loadList()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
        <label className="inline-filter">
          Project
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {sessions.length === 0 ? (
          <p className="empty">No sessions yet.</p>
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
                    {projectName(s.project_id)} · steps {s.step_count}
                  </span>
                  <span className="muted tiny">{fmtTime(s.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>Timeline &amp; diff</h2>
        {!detail ? (
          <p className="empty">Select a session to inspect steps, recall hits, and patch.</p>
        ) : (
          <>
            <div className="meta-grid">
              <div>
                <span className="muted">Status</span>
                <div>
                  <span className={`badge status-${detail.session.status}`}>
                    {detail.session.status}
                  </span>
                </div>
              </div>
              <div>
                <span className="muted">Page</span>
                <div className="mono wrap">{detail.session.page_url}</div>
              </div>
              <div>
                <span className="muted">Base → temp</span>
                <div className="mono wrap">
                  {(detail.session.git_base_sha ?? "—").slice(0, 8)} →{" "}
                  {(detail.session.temp_commit_sha ?? "—").slice(0, 8)}
                </div>
              </div>
            </div>

            <h3 className="subhead">Step timeline</h3>
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
                  {step.summary ? <p className="tl-summary">{step.summary}</p> : null}
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
                <h3 className="subhead">Reviews</h3>
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

            <h3 className="subhead">Diff viewer</h3>
            <pre className="code-block diff">{diff}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function RecallHits({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const hits = (output as { hits?: unknown }).hits;
  if (!Array.isArray(hits) || hits.length === 0) {
    return <p className="muted">No knowledge recall hits.</p>;
  }
  return (
    <div className="recall">
      <div className="muted">Knowledge recall (preferred before markup)</div>
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
              <strong>{hit.title ?? "(untitled)"}</strong>
              {hit.score != null ? (
                <span className="muted"> score={Number(hit.score).toFixed(2)}</span>
              ) : null}
              {hit.distance != null ? (
                <span className="muted"> dist={Number(hit.distance).toFixed(3)}</span>
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
          .map((t) => t.trim())
          .filter(Boolean),
        stack: draft.stack.trim() || null,
      });
      props.onStatus(`Updated knowledge ${editing.id}`);
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
      props.onError("Select a project to sync AGENTS.md");
      return;
    }
    setBusy(true);
    props.onError("");
    try {
      const pinned = items.filter((i) => i.pinned && !i.archived).map((i) => i.id);
      const sync = await api.syncAgentsMd(projectId, {
        knowledge_ids: pinned.length ? pinned : undefined,
        dry_run: dryRun,
      });
      props.onStatus(
        dryRun
          ? `Preview AGENTS.md (${sync.bytes} bytes) → ${sync.path}`
          : `Wrote AGENTS.md (${sync.bytes} bytes) → ${sync.path}`,
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
          <h2>Knowledge Hub</h2>
          <div className="row">
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void syncAgents(true)}
            >
              Preview AGENTS.md
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={busy}
              onClick={() => void syncAgents(false)}
            >
              Sync AGENTS.md
            </button>
          </div>
        </div>
        <div className="filters">
          <label>
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">All</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stack
            <input
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              placeholder="react"
            />
          </label>
          <label>
            Tag
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="ProductCard"
            />
          </label>
          <label>
            Search
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Filter
          </button>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <h2>Cards ({items.length})</h2>
          {items.length === 0 ? (
            <p className="empty">No knowledge cards.</p>
          ) : (
            <ul className="knowledge-list">
              {items.map((k) => (
                <li key={k.id} className={k.archived ? "archived" : ""}>
                  <div className="row between">
                    <div>
                      {k.pinned ? <span className="pin">Pinned</span> : null}
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
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void togglePin(k)}
                      >
                        {k.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void toggleArchive(k)}
                      >
                        {k.archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary tiny"
                        onClick={() => void exportCard(k)}
                      >
                        Export
                      </button>
                    </div>
                  </div>
                  <pre className="code-block compact">{k.body_md.slice(0, 400)}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h2>{editing ? "Edit card" : "Editor"}</h2>
          {!editing ? (
            <p className="empty">Select Edit on a card.</p>
          ) : (
            <form className="form-grid" onSubmit={saveEdit}>
              <label>
                Title
                <input
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                Kind
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
                Stack
                <input
                  value={draft.stack}
                  onChange={(e) =>
                    setDraft({ ...draft, stack: e.target.value })
                  }
                />
              </label>
              <label>
                Tags (comma-separated)
                <input
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
              </label>
              <label>
                Body (Markdown)
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
                  Save
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
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
        <h2>Security audit log</h2>
        <button
          type="button"
          className="btn secondary tiny"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      <label className="inline-filter">
        Project
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">All</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {events.length === 0 ? (
        <p className="empty">No audit events.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Project</th>
                <th>Session</th>
                <th>Detail</th>
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

  if (!metrics) return <p className="empty">Loading metrics…</p>;

  return (
    <div className="panel">
      <h2>Basic metrics</h2>
      <div className="metrics-grid">
        <Metric label="Sessions" value={String(metrics.sessions_total)} />
        <Metric
          label="Failure rate"
          value={`${Math.round(metrics.failure_rate * 1000) / 10}%`}
        />
        <Metric label="Avg steps" value={String(metrics.avg_steps)} />
        <Metric label="Knowledge" value={String(metrics.knowledge_total)} />
        <Metric label="Pinned" value={String(metrics.knowledge_pinned)} />
        <Metric label="Audit events" value={String(metrics.audit_total)} />
        <Metric
          label="sqlite-vec"
          value={
            metrics.vec_ready
              ? `ready · ${metrics.vec_indexed ?? 0} indexed`
              : "unavailable"
          }
        />
      </div>
      <h3 className="subhead">Sessions by status</h3>
      <pre className="code-block">
        {JSON.stringify(metrics.sessions_by_status, null, 2)}
      </pre>
      <h3 className="subhead">Reviews by decision</h3>
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
