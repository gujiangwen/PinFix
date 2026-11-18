import type { Project, Session } from "@sightloop/shared";
import { pageHash } from "../routes";
import { useI18n } from "../i18n";
import { fmtTime, sessionTitle } from "../ui/format";
import type { RoleQueue } from "./queues";

const ROLE_LABEL = {
  planner: "queues.planner",
  implementer: "queues.implementer",
  reviewer: "queues.reviewer",
} as const;

export function QueueBoard(props: {
  queues: RoleQueue[];
  projects: Project[];
  selectedId: string | null;
}) {
  const { t } = useI18n();
  const names = new Map(props.projects.map((project) => [project.id, project.name]));

  return (
    <div className="queue-board">
      {props.queues.map((queue) => (
        <section key={queue.role} className="queue" aria-labelledby={`queue-${queue.role}`}>
          <header className="queue-head">
            <h2 id={`queue-${queue.role}`}>{t(ROLE_LABEL[queue.role])}</h2>
            <p className={`queue-run${queue.state === "running" ? " is-running" : ""}`}>
              {queue.state === "running" ? t("queues.running") : t("queues.idle")}
            </p>
            <p className="queue-count">
              {t("queues.count", {
                running: queue.runningCount,
                waiting: queue.waitingCount,
              })}
            </p>
          </header>
          {queue.tasks.length === 0 ? (
            <p className="muted queue-empty">{t("queues.empty")}</p>
          ) : (
            <ul className="queue-list">
              {queue.tasks.map((task, index) => (
                <li key={task.session.id}>
                  <QueueItem
                    session={task.session}
                    project={names.get(task.session.project_id) ?? null}
                    executing={task.executing}
                    head={index === 0}
                    selected={task.session.id === props.selectedId}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function QueueItem(props: {
  session: Session;
  project: string | null;
  executing: boolean;
  head: boolean;
  selected: boolean;
}) {
  const { t } = useI18n();
  return (
    <a
      className={`queue-item${props.selected ? " is-selected" : ""}${props.head ? " is-head" : ""}`}
      href={pageHash({ name: "loop", sessionId: props.session.id })}
      aria-current={props.selected ? "true" : undefined}
    >
      <span className="queue-item-title">{sessionTitle(props.session)}</span>
      <span className={`queue-mark${props.executing ? " is-running" : ""}`}>
        {props.executing ? t("queues.taskRunning") : t("queues.taskWaiting")}
      </span>
      <span className="muted tiny">
        {[props.project, fmtTime(props.session.created_at)].filter(Boolean).join(" · ")}
      </span>
    </a>
  );
}
