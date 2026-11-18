import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Session } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { settingsHash } from "../routes";
import { QueueBoard } from "./QueueBoard";
import { RoleFlow } from "./RoleFlow";
import { buildLoopModel } from "./loop-model";
import { buildQueues, placeSession, roleFromModel, type TaskPlacement } from "./queues";
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
}) {
  const { t } = useI18n();
  const { onError } = props;
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [placements, setPlacements] = useState<TaskPlacement[]>([]);

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

  const live = useSessionLive(props.sessionId);
  const { detail } = live;
  const watchedStatus = detail?.session.status;
  useEffect(() => {
    if (watchedStatus) void loadSessions();
  }, [watchedStatus, loadSessions]);

  const queues = useMemo(() => buildQueues(placements), [placements]);
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

  if (!props.daemonUp && sessions === null) return null;
  if (sessions === null) return <p className="muted">{t("loop.loading")}</p>;

  return (
    <div className="workbench">
      <QueueBoard
        queues={queues}
        projects={props.projects}
        selectedId={props.sessionId}
      />
      <div className="task-flow-slot">
        {!props.sessionId ? (
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
