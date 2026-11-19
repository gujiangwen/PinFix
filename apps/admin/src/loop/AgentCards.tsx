import type { Session } from "@sightloop/shared";
import { pageHash } from "../routes";
import { useI18n } from "../i18n";
import { sessionTitle } from "../ui/format";
import { ROLES, type RoleId, type TaskPlacement } from "./queues";
import { runningInRole } from "./task-list";

const ROLE_LABEL = {
  planner: "queues.planner",
  implementer: "queues.implementer",
  reviewer: "queues.reviewer",
} as const;

export function AgentCards(props: {
  tasks: readonly TaskPlacement[];
  /** Role of the task selected on the left, when it still sits in a role. */
  selectedRole: RoleId | null;
  /** Set when the last click was an idle card. That card stays idle. */
  idleRole: RoleId | null;
  selectedId: string | null;
  ready: boolean;
  onPick: () => void;
  onIdle: (role: RoleId) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="agent-slot">
      <div className="agent-row">
        {ROLES.map((role) => {
          const running = props.ready ? runningInRole(props.tasks, role) : [];
          const highlighted = props.idleRole === role || (props.idleRole === null && props.selectedRole === role);
          return (
            <section
              key={role}
              className={`agent-card${highlighted ? " is-current" : ""}`}
              aria-labelledby={`agent-${role}`}
            >
              <h2 id={`agent-${role}`}>{t(ROLE_LABEL[role])}</h2>
              {!props.ready ? (
                <p className="muted">{t("loop.loading")}</p>
              ) : running.length === 0 ? (
                <button
                  type="button"
                  className="agent-idle"
                  aria-pressed={props.idleRole === role}
                  onClick={() => props.onIdle(role)}
                >
                  {t("queues.idle")}
                </button>
              ) : (
                <ul className="agent-running">
                  {running.map((task) => (
                    <li key={task.session.id}>
                      <RunningTask
                        session={task.session}
                        selected={props.idleRole === null && task.session.id === props.selectedId}
                        onPick={props.onPick}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RunningTask(props: { session: Session; selected: boolean; onPick: () => void }) {
  const { t } = useI18n();
  return (
    <a
      className={`agent-run${props.selected ? " is-selected" : ""}`}
      href={pageHash({ name: "loop", sessionId: props.session.id })}
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onPick}
    >
      <span className="queue-item-title">{sessionTitle(props.session)}</span>
      <span className="queue-mark is-running">{t("queues.taskRunning")}</span>
    </a>
  );
}
