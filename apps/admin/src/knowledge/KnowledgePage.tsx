import { useEffect, useState, type FormEvent } from "react";
import type { Project, Knowledge, KnowledgeKind } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";

export function KnowledgePage(props: {
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
