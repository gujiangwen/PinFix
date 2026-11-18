import { useState, type FormEvent } from "react";
import type { Project, ProjectMode } from "@sightloop/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";

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

export function ProjectsSection(props: {
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
          <p className="hint">
            {form.mode === "pr"
              ? t("projects.modeDoc.pr")
              : t("projects.modeDoc.hmr")}
          </p>
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
