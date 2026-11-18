import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Session } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { settingsHash } from "../routes";
import { fmtTime, sessionTitle } from "../ui/format";
import { HumanDecision } from "./HumanDecision";
import { STATUS_LABEL } from "./labels";
import { buildLoopModel, focusNode, type NodeId } from "./loop-model";
import { LoopTrack } from "./LoopTrack";
import { NodeDetail } from "./NodeDetail";
import { SessionRail } from "./SessionRail";
import { useSessionLive } from "./useSessionLive";

const LIST_POLL_MS = 5000;

/**
 * What the user picked in the track. Anything not picked follows the loop, and
 * a pick lasts only until the session changes status, so the view returns to
 * whatever needs attention next (above all: the human decision).
 */
type Pin = {
  sessionId: string;
  status: Session["status"];
  round: number | null;
  node: NodeId | null;
};

export function LoopPage(props: {
  projects: Project[];
  /** Session named in the URL; null means "follow the newest session". */
  sessionId: string | null;
  daemonUp: boolean;
  onRefreshProjects: () => Promise<void>;
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t } = useI18n();
  const { onError } = props;
  const [projectId, setProjectId] = useState("");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [dualHint, setDualHint] = useState<boolean | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.listSessions(projectId || undefined);
      setSessions([...list].sort((a, b) => b.created_at - a.created_at));
    } catch (err) {
      onError((err as Error).message);
    }
  }, [projectId, onError]);

  // The Daemon only pushes events per subscribed session, so the list polls.
  useEffect(() => {
    if (!props.daemonUp) return;
    void loadSessions();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadSessions();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadSessions, props.daemonUp]);

  // Projects can be created outside the Admin (extension, DX bootstrap); a
  // session from one the app has not seen means the project list is stale.
  const { projects, onRefreshProjects } = props;
  const askedFor = useRef("");
  useEffect(() => {
    const known = new Set(projects.map((p) => p.id));
    const unknown = [
      ...new Set((sessions ?? []).map((s) => s.project_id)),
    ].filter((id) => !known.has(id));
    const key = unknown.sort().join(",");
    if (!key || key === askedFor.current) return;
    askedFor.current = key;
    onRefreshProjects().catch((err: Error) => onError(err.message));
  }, [sessions, projects, onRefreshProjects, onError]);

  useEffect(() => {
    if (!props.daemonUp) return;
    api
      .getLlmSettings()
      .then((s) => setDualHint(s.dual_loop_enabled))
      .catch(() => setDualHint(null));
  }, [props.daemonUp]);

  const selectedId = props.sessionId ?? sessions?.[0]?.id ?? null;
  const live = useSessionLive(selectedId);
  const { detail } = live;

  // Keep the rail's status in step with the session being watched.
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
            dualHint,
          })
        : null,
    [detail, live.liveNode, dualHint],
  );

  if (sessions === null && !detail) {
    return props.daemonUp ? <p className="muted">{t("loop.loading")}</p> : null;
  }

  // With a project filter set, keep the rail so the filter can be changed back.
  if (!selectedId && !projectId) {
    return <EmptyLoop hasProjects={props.projects.length > 0} />;
  }

  const status = detail?.session.status;
  const ownPin =
    pin && pin.sessionId === selectedId && pin.status === status ? pin : null;
  const lastIndex = model ? model.rounds.length - 1 : 0;
  const roundIndex = Math.min(ownPin?.round ?? lastIndex, lastIndex);
  const round = model?.rounds[roundIndex];
  const nodeId = ownPin?.node ?? (round ? focusNode(round) : "retrieve");
  const project = detail
    ? props.projects.find((p) => p.id === detail.session.project_id)
    : undefined;

  return (
    <div className="loop-layout">
      <SessionRail
        projects={props.projects}
        sessions={sessions ?? []}
        selectedId={selectedId}
        projectId={projectId}
        onProjectChange={setProjectId}
      />
      <div className="loop-main">
        {!selectedId ? (
          <p className="muted">{t("sessions.empty")}</p>
        ) : live.error && !detail ? (
          <p className="status error">{live.error}</p>
        ) : !detail || !model || !round ? (
          <p className="muted">{t("loop.loading")}</p>
        ) : (
          <>
            <header className="session-head">
              <h2>{sessionTitle(detail.session)}</h2>
              <p className="session-meta">
                <span className={`badge status-${detail.session.status}`}>
                  {t(STATUS_LABEL[detail.session.status])}
                </span>
                {project ? <span>{project.name}</span> : null}
                <a
                  className="mono wrap"
                  href={detail.session.page_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {detail.session.page_url}
                </a>
                <span>{fmtTime(detail.session.created_at)}</span>
                <span
                  className={`live ${live.connected ? "on" : ""}`}
                  title={live.connected ? t("loop.live.on") : t("loop.live.off")}
                >
                  {live.connected ? t("loop.live.on") : t("loop.live.off")}
                </span>
              </p>
            </header>

            <LoopTrack
              rounds={model.rounds}
              roundIndex={roundIndex}
              selected={nodeId}
              onSelectRound={(index) =>
                setPin({
                  sessionId: detail.session.id,
                  status: detail.session.status,
                  // Choosing the newest round means "follow the loop" again.
                  round: index === lastIndex ? null : index,
                  node: null,
                })
              }
              onSelectNode={(id) =>
                setPin({
                  sessionId: detail.session.id,
                  status: detail.session.status,
                  round: ownPin?.round ?? null,
                  node: id,
                })
              }
            />

            <NodeDetail
              node={round.nodes[nodeId]}
              round={round}
              isLastRound={roundIndex === lastIndex}
              detail={detail}
              patch={live.patch}
              decisionControls={
                <HumanDecision
                  key={detail.session.id}
                  session={detail.session}
                  project={project}
                  onDone={props.onStatus}
                  refresh={live.refresh}
                />
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyLoop({ hasProjects }: { hasProjects: boolean }) {
  const { t } = useI18n();
  return (
    <div className="panel empty-loop">
      <h2>{t("loop.empty.title")}</h2>
      {hasProjects ? (
        <>
          <p className="muted">{t("loop.empty.noSessions")}</p>
          <a className="btn secondary" href={settingsHash("extension")}>
            {t("loop.empty.extension")}
          </a>
        </>
      ) : (
        <>
          <p className="muted">{t("loop.empty.noProjects")}</p>
          <a className="btn" href={settingsHash("projects")}>
            {t("loop.empty.addProject")}
          </a>
        </>
      )}
    </div>
  );
}
