import { useEffect, useRef, useState, type Ref } from "react";
import type { Project, Knowledge } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { pageHash } from "../routes";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { fmtTime } from "../ui/format";

function isStrategy(card: Knowledge): boolean {
  return (
    (card.tags ?? []).includes("strategy") ||
    card.body_md.includes("sightloop:strategy") ||
    card.title.toLowerCase().includes("strategy")
  );
}

export function KnowledgePage(props: {
  projects: Project[];
  /** Card named in the URL (`#/knowledge/<id>`); highlighted when set. */
  cardId: string | null;
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [showStopped, setShowStopped] = useState(false);
  const [items, setItems] = useState<Knowledge[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement>(null);

  async function load() {
    setBusy(true);
    props.onError("");
    try {
      const list = await api.listKnowledge({
        project_id: projectId || undefined,
        tag: "strategy",
        q: q || undefined,
        include_archived: showStopped,
        limit: 100,
      });
      setItems(list.filter(isStrategy));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, showStopped]);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.cardId, items]);

  async function saveTitle(card: Knowledge, title: string) {
    const next = title.trim();
    if (!next || next === card.title) return;
    props.onError("");
    try {
      await api.updateKnowledge(card.id, { title: next });
      props.onStatus(t("knowledge.status.updated", { id: card.id }));
      await load();
    } catch (err) {
      props.onError((err as Error).message);
    }
  }

  async function togglePin(card: Knowledge) {
    await api.updateKnowledge(card.id, { pinned: !card.pinned });
    await load();
  }

  async function archive(id: string) {
    await api.updateKnowledge(id, { archived: true });
    setArchiveId(null);
    await load();
  }

  async function syncAgents(dryRun: boolean) {
    if (!projectId) {
      props.onError(t("knowledge.err.selectProject"));
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
      if (dryRun) setPreview(sync.markdown);
      props.onStatus(
        dryRun
          ? t("knowledge.status.preview", { bytes: sync.bytes, path: sync.path })
          : t("knowledge.status.wrote", { bytes: sync.bytes, path: sync.path }),
      );
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = items.filter((k) => !k.archived);
  const stopped = items.filter((k) => k.archived);

  return (
    <section className="panel">
      <header className="row between">
        <div>
          <h2>{t("knowledge.title")}</h2>
          <p className="hint">{t("knowledge.lede")}</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void syncAgents(true)}
          >
            {t("knowledge.previewAgents")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void syncAgents(false)}
          >
            {t("knowledge.syncAgents")}
          </button>
        </div>
      </header>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
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
          {t("knowledge.search")}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) e.preventDefault();
            }}
          />
        </label>
        <button type="submit" className="btn secondary" disabled={busy}>
          {t("knowledge.filter")}
        </button>
      </form>

      {preview ? <pre className="code-block agents-preview">{preview}</pre> : null}

      {active.length === 0 ? (
        <p className="empty">{t("knowledge.empty")}</p>
      ) : (
        <ul className="ledger">
          {active.map((card) => (
            <LessonRow
              key={card.id}
              card={card}
              highlighted={card.id === props.cardId}
              rowRef={card.id === props.cardId ? highlightRef : undefined}
              onSave={saveTitle}
              onPin={togglePin}
              onArchive={setArchiveId}
            />
          ))}
        </ul>
      )}

      <details
        className="fold"
        onToggle={(e) => setShowStopped((e.target as HTMLDetailsElement).open)}
      >
        <summary>{t("knowledge.showStopped")}</summary>
        {stopped.length === 0 ? null : (
          <ul className="ledger">
            {stopped.map((card) => (
              <LessonRow
                key={card.id}
                card={card}
                highlighted={card.id === props.cardId}
                onSave={saveTitle}
                onPin={togglePin}
                onArchive={setArchiveId}
              />
            ))}
          </ul>
        )}
      </details>

      <ConfirmDialog
        open={archiveId !== null}
        title={t("knowledge.archiveTitle")}
        confirmLabel={t("knowledge.archive")}
        cancelLabel={t("knowledge.cancel")}
        onCancel={() => setArchiveId(null)}
        onConfirm={() => {
          if (archiveId) void archive(archiveId);
        }}
      >
        <p>{t("knowledge.archiveBody")}</p>
      </ConfirmDialog>
    </section>
  );
}

function LessonRow(props: {
  card: Knowledge;
  highlighted: boolean;
  rowRef?: Ref<HTMLLIElement>;
  onSave: (card: Knowledge, title: string) => Promise<void>;
  onPin: (card: Knowledge) => Promise<void>;
  onArchive: (id: string) => void;
}) {
  const { t } = useI18n();
  const { card } = props;
  const [title, setTitle] = useState(card.title);
  useEffect(() => setTitle(card.title), [card.title]);

  return (
    <li
      ref={props.rowRef}
      className={props.highlighted ? "ledger-row highlight" : "ledger-row"}
    >
      <input
        className="lesson-input"
        aria-label={t("knowledge.lesson")}
        value={title}
        disabled={card.archived}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void props.onSave(card, title)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {card.session_id ? (
        <a href={pageHash({ name: "loop", sessionId: card.session_id })}>
          {t("knowledge.source")}
        </a>
      ) : (
        <span className="muted">{t("knowledge.source")}</span>
      )}
      {card.last_used_at && card.last_used_session_id ? (
        <a href={pageHash({ name: "loop", sessionId: card.last_used_session_id })}>
          {fmtTime(card.last_used_at)}
        </a>
      ) : (
        <span className="muted">{t("knowledge.unused")}</span>
      )}
      <label className="remember">
        <input
          type="checkbox"
          checked={card.pinned}
          disabled={card.archived}
          onChange={() => void props.onPin(card)}
        />
        {t("knowledge.writeRepo")}
      </label>
      {card.archived ? (
        <span className="muted">{t("knowledge.archive")}</span>
      ) : (
        <button
          type="button"
          className="btn danger"
          onClick={() => props.onArchive(card.id)}
        >
          {t("knowledge.archive")}
        </button>
      )}
    </li>
  );
}
