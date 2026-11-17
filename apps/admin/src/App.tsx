import { useEffect, useState, type FormEvent } from "react";
import type { Project, ProjectMode } from "@sightloop/shared";
import { api, baseUrl } from "./api";

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
  file_whitelist: "src/**",
  mode: "hmr",
  default_branch: "main",
});

function parseWhitelist(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);

  async function refresh() {
    const list = await api.listProjects();
    setProjects(list);
  }

  useEffect(() => {
    (async () => {
      try {
        await api.health();
        setDaemonOk(true);
        await refresh();
        setStatus(`Connected to ${baseUrl}`);
      } catch (err) {
        setDaemonOk(false);
        setError(
          `Cannot reach daemon at ${baseUrl}: ${(err as Error).message}`,
        );
      }
    })();
  }, []);

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
    setError("");
    setStatus(`Editing ${p.name}`);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
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
        setStatus(`Updated project ${editingId}`);
      } else {
        const created = await api.createProject(payload);
        setStatus(`Created project ${created.id}`);
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm(`Delete project ${id}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteProject(id);
      if (editingId === id) resetForm();
      setStatus(`Deleted ${id}`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="brand">
        <h1>SightLoop</h1>
        <span className="tag">Admin · Project Registry</span>
      </div>
      <p className="lede">
        Register local repos the daemon may touch. Paths must fall under{" "}
        <code>SIGHTLOOP_ALLOWED_ROOTS</code>. This is the M1 shell — full
        observability arrives in M4.
      </p>

      <div className="panel">
        <h2>{editingId ? "Edit project" : "Register project"}</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my-app"
            />
          </label>
          <label>
            Repo path (absolute)
            <input
              required
              className="mono"
              value={form.repo_path}
              onChange={(e) => setForm({ ...form, repo_path: e.target.value })}
              placeholder="/tmp/sightloop-demo"
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
              placeholder="http://localhost:5173/*"
            />
          </label>
          <label>
            Verify command (optional)
            <input
              value={form.verify_cmd}
              onChange={(e) => setForm({ ...form, verify_cmd: e.target.value })}
              placeholder="pnpm test"
            />
          </label>
          <label>
            File whitelist (one glob per line)
            <textarea
              value={form.file_whitelist}
              onChange={(e) =>
                setForm({ ...form, file_whitelist: e.target.value })
              }
              placeholder={"src/**\napps/web/**"}
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
        {error ? <p className="status error">{error}</p> : null}
        {!error && status ? (
          <p className={daemonOk ? "status ok" : "status"}>{status}</p>
        ) : null}
      </div>

      <div className="panel">
        <h2>Projects</h2>
        {projects.length === 0 ? (
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
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div>{p.name}</div>
                      <div className="mono" style={{ color: "var(--muted)" }}>
                        {p.id}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${p.mode}`}>{p.mode}</span>
                    </td>
                    <td className="mono">{p.repo_path}</td>
                    <td className="mono">{p.origin_pattern}</td>
                    <td>
                      <div className="row">
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => startEdit(p)}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          className="btn danger"
                          type="button"
                          onClick={() => onDelete(p.id)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
