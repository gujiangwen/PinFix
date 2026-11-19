import type { Session } from "@sightloop/shared";
import { pageHash } from "../routes";
import { useI18n, type TranslateFn } from "../i18n";
import { fmtTime, sessionTitle } from "../ui/format";
import { STATUS_LABEL } from "./labels";
import type { RoleId } from "./queues";
import { STATUS_FILTERS, type StatusFilter } from "./task-list";

const ROLE_LABEL = {
  planner: "queues.planner",
  implementer: "queues.implementer",
  reviewer: "queues.reviewer",
} as const;

const FILTER_LABEL = {
  open: "queues.filter.open",
  queued: "queues.filter.queued",
  running: "queues.filter.running",
  review: "queues.filter.review",
  done: "queues.filter.done",
} as const;

export type TaskRow = {
  session: Session;
  projectName: string | null;
  role: RoleId | null;
  executing: boolean;
};

export function TaskQueue(props: {
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  rows: TaskRow[];
  /** Why the list is empty: a keyword miss, or the status chip itself. */
  empty: "match" | "status" | null;
  selectedId: string | null;
  onPick: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="task-queue">
      <fieldset className="status-filter">
        <legend>{t("queues.filter")}</legend>
        {STATUS_FILTERS.map((id) => (
          <label key={id}>
            <input
              type="radio"
              name="task-status"
              value={id}
              checked={props.filter === id}
              onChange={() => props.onFilter(id)}
            />
            <span>{t(FILTER_LABEL[id])}</span>
          </label>
        ))}
      </fieldset>
      <div className="task-search">
        <label htmlFor="task-search">{t("queues.search")}</label>
        <input
          id="task-search"
          type="search"
          name="q"
          enterKeyHint="search"
          autoComplete="off"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </div>
      <div className="rail-scroll">
        {props.empty ? (
          <p className="muted queue-empty">
            {props.empty === "match" ? t("queues.noMatch") : t("queues.emptyFilter")}
          </p>
        ) : (
          <ul className="queue-list">
            {props.rows.map((row) => (
              <li key={row.session.id}>
                <a
                  className={`queue-item${row.session.id === props.selectedId ? " is-selected" : ""}`}
                  href={pageHash({ name: "loop", sessionId: row.session.id })}
                  aria-current={row.session.id === props.selectedId ? "true" : undefined}
                  onClick={props.onPick}
                >
                  <span className="queue-item-title">{sessionTitle(row.session)}</span>
                  <span className={`queue-mark${row.executing ? " is-running" : ""}`}>
                    {rowMark(t, row)}
                  </span>
                  <span className="muted tiny">
                    {[row.projectName, fmtTime(row.session.created_at)].filter(Boolean).join(" · ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function rowMark(t: TranslateFn, row: TaskRow): string {
  if (!row.role) return t(STATUS_LABEL[row.session.status]);
  const role = t(ROLE_LABEL[row.role]);
  const mark = row.executing ? t("queues.taskRunning") : t("queues.taskWaiting");
  return `${role} · ${mark}`;
}
