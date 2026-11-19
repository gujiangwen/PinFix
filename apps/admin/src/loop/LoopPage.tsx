import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Project, Session } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { HOME_HASH, settingsHash } from "../routes";
import { RoleFlow } from "./RoleFlow";
import { TaskQueue, type TaskRow } from "./TaskQueue";
import { buildLoopModel } from "./loop-model";
import { placeSession, roleFromModel, type TaskPlacement } from "./queues";
import {
  byCreated,
  defaultRunningId,
  matchesKeyword,
  queueOf,
  taskHaystack,
  type QueueSwitch,
} from "./task-list";
import { useSessionLive } from "./useSessionLive";

const LIST_POLL_MS = 5000;

export function LoopPage(props: {
  projects: Project[];
  /** Session named in the URL. Null leaves the flow pane empty. */
  sessionId: string | null;
  daemonUp: boolean;
  onRefreshProjects: () => Promise<void>;
  onError: (s: string) => void;
  onStatus: (s: string) => void;
  onOpenSettings: () => void;
  onRetryDaemon: () => void;
  daemonState: "checking" | "ok" | "down";
  daemonTitle: string;
  notice: ReactNode;
}) {
  const { t } = useI18n();
  const { onError } = props;
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [placements, setPlacements] = useState<TaskPlacement[]>([]);
  const [queue, setQueue] = useState<QueueSwitch>("planner");
  const [query, setQuery] = useState("");
  /** Honor the URL session until the user picks a different switch. */
  const [stick, setStick] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
      const next: TaskPlacement[] = [];
      for (const session of list) {
        if (session.status !== "acting") {
          const placed = placeSession(session, null);
          if (placed) next.push(placed);
          continue;
        }
        try {
          const detail = await api.getSession(session.id);
          const model = buildLoopModel({
            session: detail.session,
            steps: detail.steps,
            reviews: detail.reviews,
            gateRun: detail.acceptance_gate,
          });
          const placed = placeSession(detail.session, roleFromModel(model));
          if (placed) next.push(placed);
        } catch (err) {
          onError((err as Error).message);
          const placed = placeSession(session, null);
          if (placed) next.push(placed);
        }
      }
      setPlacements(next);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    if (!props.daemonUp) return;
    void loadSessions();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadSessions();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadSessions, props.daemonUp]);

  const { projects, onRefreshProjects } = props;
  const askedFor = useRef("");
  useEffect(() => {
    const known = new Set(projects.map((project) => project.id));
    const unknown = [
      ...new Set((sessions ?? []).map((session) => session.project_id)),
    ].filter((id) => !known.has(id));
    const key = unknown.sort().join(",");
    if (!key || key === askedFor.current) return;
    askedFor.current = key;
    onRefreshProjects().catch((err: Error) => onError(err.message));
  }, [sessions, projects, onRefreshProjects, onError]);

  useEffect(() => {
    if (!stick || !props.sessionId || sessions === null) return;
    const session = sessions.find((item) => item.id === props.sessionId);
    if (!session) return;
    const task = placements.find((item) => item.session.id === session.id) ?? null;
    if (session.status === "acting" && !task) return;
    const next = queueOf(session, task);
    if (next) setQueue((current) => (current === next ? current : next));
  }, [stick, props.sessionId, sessions, placements]);

  const rows = useMemo(() => {
    const placed = new Map(placements.map((task) => [task.session.id, task]));
    const names = new Map(props.projects.map((project) => [project.id, project.name]));
    const next: TaskRow[] = [];
    for (const session of sessions ?? []) {
      const task = placed.get(session.id) ?? null;
      if (queueOf(session, task) !== queue) continue;
      const projectName = names.get(session.project_id) ?? null;
      if (!matchesKeyword(taskHaystack(session, projectName), query)) continue;
      next.push({
        session,
        projectName,
        queue,
        executing: task?.executing ?? false,
      });
    }
    return byCreated(next);
  }, [sessions, placements, props.projects, queue, query]);

  const explicitId =
    stick && props.sessionId && rows.some((row) => row.session.id === props.sessionId)
      ? props.sessionId
      : null;
  const shownId = explicitId ?? defaultRunningId(rows);

  const live = useSessionLive(shownId);
  const { detail } = live;
  const watchedStatus = detail?.session.status;
  useEffect(() => {
    if (watchedStatus) void loadSessions();
  }, [watchedStatus, loadSessions]);

  const model = useMemo(
    () =>
      detail
        ? buildLoopModel({
            session: detail.session,
            steps: detail.steps,
            reviews: detail.reviews,
            gateRun: detail.acceptance_gate,
            liveNode: live.liveNode,
          })
        : null,
    [detail, live.liveNode],
  );
  const project = detail
    ? props.projects.find((item) => item.id === detail.session.project_id)
    : undefined;

  function selectQueue(next: QueueSwitch) {
    setStick(false);
    setQueue(next);
    if (window.location.hash !== HOME_HASH) {
      const url = new URL(window.location.href);
      url.hash = HOME_HASH;
      history.replaceState(null, "", url);
    }
  }

  return (
    <div className="home-stage">
      <div className="home-rail">
        {sessions === null ? (
          props.daemonUp ? <p className="muted">{t("loop.loading")}</p> : null
        ) : (
          <TaskQueue
            queue={queue}
            onQueue={selectQueue}
            query={query}
            onQuery={setQuery}
            rows={rows}
            empty={rows.length === 0 ? (query.trim() ? "match" : "queue") : null}
            selectedId={shownId}
            onPick={() => setStick(true)}
          />
        )}
        <button
          type="button"
          className="rail-settings"
          aria-label={t("settings.title")}
          onClick={props.onOpenSettings}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
          <span>{t("settings.title")}</span>
        </button>
      </div>
      <div className="home-canvas">
        {props.notice}
        {props.daemonState === "down" ? (
          <div className="banner" role="alert">
            <span>{props.daemonTitle}</span>
            <button
              type="button"
              className="btn secondary tiny"
              onClick={props.onRetryDaemon}
            >
              {t("daemon.retry")}
            </button>
          </div>
        ) : null}
        {sessions === null ? (
          props.daemonUp ? <p className="muted">{t("loop.loading")}</p> : null
        ) : !shownId ? (
          <FlowEmpty hasProjects={props.projects.length > 0} />
        ) : live.error && !detail ? (
          <p className="status error">{live.error}</p>
        ) : !detail || !model ? (
          <p className="muted">{t("loop.loading")}</p>
        ) : (
          <RoleFlow
            detail={detail}
            model={model}
            project={project}
            onDone={props.onStatus}
            refresh={live.refresh}
          />
        )}
      </div>
    </div>
  );
}

function FlowEmpty({ hasProjects }: { hasProjects: boolean }) {
  const { t } = useI18n();
  return (
    <div className="task-flow task-flow-empty">
      <p className="muted stage-copy">
        {hasProjects ? t("flow.empty") : t("flow.emptyNoProjects")}
      </p>
      {hasProjects ? null : (
        <a className="btn" href={settingsHash("projects")}>
          {t("loop.empty.addProject")}
        </a>
      )}
    </div>
  );
}
