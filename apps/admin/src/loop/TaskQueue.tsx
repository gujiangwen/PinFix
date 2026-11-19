import type { Session } from "@sightloop/shared";
import { pageHash } from "../routes";
import { useI18n, type TranslateFn } from "../i18n";
import { fmtTime, sessionTitle } from "../ui/format";
import { STATUS_LABEL } from "./labels";
import { QUEUE_SWITCHES, type QueueSwitch } from "./task-list";

const SWITCH_LABEL = {
  planner: "queues.planner",
  implementer: "queues.implementer",
  reviewer: "queues.reviewer",
  human: "queues.human",
} as const;

export type TaskRow = {
  session: Session;
  projectName: string | null;
  queue: QueueSwitch;
  executing: boolean;
};

export function TaskQueue(props: {
  queue: QueueSwitch;
  onQueue: (queue: QueueSwitch) => void;
  query: string;
  onQuery: (query: string) => void;
  rows: TaskRow[];
  /** Why the list is empty: a keyword miss, or the switch itself. */
  empty: "match" | "queue" | null;
  selectedId: string | null;
  onPick: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="task-queue">
      <search className="queue-find">
        <fieldset className="queue-switch">
          <legend>{t("queues.switch")}</legend>
          {QUEUE_SWITCHES.map((id) => (
            <label key={id}>
              <input
                type="radio"
                name="task-queue"
                value={id}
                checked={props.queue === id}
                onChange={() => props.onQueue(id)}
              />
              <span>{t(SWITCH_LABEL[id])}</span>
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
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
          />
        </div>
      </search>
      <div className="rail-scroll">
        {props.empty ? (
          <p className="muted queue-empty">
            {props.empty === "match" ? t("queues.noMatch") : t("queues.empty")}
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
  if (row.queue === "human") return t(STATUS_LABEL[row.session.status]);
  return row.executing ? t("queues.taskRunning") : t("queues.taskWaiting");
}
