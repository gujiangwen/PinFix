import { useEffect, useState } from "react";
import type { Project } from "@sightloop/shared";
import type { SessionDetail } from "../api";
import { useI18n, type TranslateFn } from "../i18n";
import { fmtDuration, fmtTime, sessionTitle } from "../ui/format";
import { HumanDecision } from "./HumanDecision";
import { DECISION_LABEL, STATUS_LABEL } from "./labels";
import type { LoopModel } from "./loop-model";
import { ROLES, type RoleId } from "./queues";
import { buildRoleStages, type RoleStage, type StageFact } from "./role-stage";

const ROLE_LABEL = {
  planner: "queues.planner",
  implementer: "queues.implementer",
  reviewer: "queues.reviewer",
} as const;

const STATE_LABEL = {
  pending: "stage.pending",
  active: "stage.active",
  waiting: "stage.waiting",
  done: "stage.done",
  warn: "stage.warn",
  failed: "stage.failed",
  off: "stage.off",
} as const;

export function RoleFlow(props: {
  detail: SessionDetail;
  model: LoopModel;
  project: Project | undefined;
  onDone: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const round = props.model.rounds[props.model.rounds.length - 1];
  const [pinned, setPinned] = useState<RoleId | null>(null);

  useEffect(() => {
    setPinned(null);
  }, [props.detail.session.id]);

  if (!round) return <p className="muted">{t("loop.loading")}</p>;

  const stages = buildRoleStages({
    session: props.detail.session,
    round,
    plan: props.detail.plan,
    review: props.detail.agent_review,
    recall: props.detail.recall_hits.map((hit) => hit.title),
    gateStatus: props.detail.acceptance_gate?.status ?? null,
  });
  const active = props.model.rounds.length
    ? currentRole(stages)
    : "planner";
  const role = pinned ?? active;
  const stage = stages[role];

  return (
    <article className="task-flow" aria-labelledby="task-flow-title">
      <header className="task-flow-head">
        <h2 id="task-flow-title">{sessionTitle(props.detail.session)}</h2>
        <p className="session-meta">
          <span className={`badge status-${props.detail.session.status}`}>
            {t(STATUS_LABEL[props.detail.session.status])}
          </span>
          {props.project ? <span>{props.project.name}</span> : null}
          <span>{fmtTime(props.detail.session.created_at)}</span>
          {props.model.rounds.length > 1 ? (
            <span>{t("loop.round", { n: round.number })}</span>
          ) : null}
        </p>
      </header>

      <div className="role-switch" role="group" aria-label={t("flow.stages")}>
        {ROLES.map((id) => (
          <button
            key={id}
            type="button"
            className="role-switch-btn"
            aria-pressed={id === role}
            onClick={() => setPinned(id)}
          >
            {t(ROLE_LABEL[id])}
          </button>
        ))}
      </div>

      <section className="stage-block" aria-labelledby="stage-status">
        <p id="stage-status" className={`state-text state-${stage.state}`}>
          {t(STATE_LABEL[stage.state])}
        </p>
        <StageFacts title={t("flow.input")} facts={stage.input} empty={t("flow.none")} />
        <StageFacts title={t("flow.output")} facts={stage.output} empty={t("flow.none")} />
        <h3>{t("flow.time")}</h3>
        <p className="stage-copy">
          {stage.durationMs != null
            ? fmtDuration(stage.durationMs)
            : stage.startedAt != null
              ? fmtTime(stage.startedAt)
              : t("flow.timeNone")}
          {stage.durationMs != null && stage.startedAt != null
            ? ` · ${fmtTime(stage.startedAt)}`
            : ""}
        </p>
        {role === "reviewer" ? (
          <p className="muted stage-copy">{t("flow.reviewerScope")}</p>
        ) : null}
        {stage.judge ? (
          <p className="muted stage-copy">
            {t("flow.judgeDetail", {
              skipped: stage.judge.skipped ? t("flow.yes") : t("flow.no"),
              pass:
                stage.judge.agentPass == null
                  ? t("flow.unknown")
                  : stage.judge.agentPass
                    ? t("flow.yes")
                    : t("flow.no"),
              reason: stage.judge.reason ?? t("flow.unknown"),
            })}
          </p>
        ) : null}
        {role === "reviewer" && props.detail.session.status === "awaiting_review" ? (
          <HumanDecision
            key={props.detail.session.id}
            session={props.detail.session}
            project={props.project}
            onDone={props.onDone}
            refresh={props.refresh}
          />
        ) : null}
      </section>
    </article>
  );
}

function currentRole(stages: Record<RoleId, RoleStage>): RoleId {
  const active = ROLES.find((role) => stages[role].state === "active" || stages[role].state === "waiting");
  if (active) return active;
  const touched = [...ROLES].reverse().find((role) => {
    const state = stages[role].state;
    return state === "done" || state === "warn" || state === "failed";
  });
  return touched ?? "planner";
}

function StageFacts(props: { title: string; facts: StageFact[]; empty: string }) {
  const { t } = useI18n();
  return (
    <>
      <h3>{props.title}</h3>
      {props.facts.length === 0 ? (
        <p className="muted stage-copy">{props.empty}</p>
      ) : (
        <dl className="facts stage-copy">
          {props.facts.map((fact, index) => (
            <div className="fact" key={`${fact.k}-${index}`}>
              <dt>{factLabel(t, fact)}</dt>
              <dd>{factBody(t, fact)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

function factLabel(t: TranslateFn, fact: StageFact): string {
  switch (fact.k) {
    case "note":
      return t("flow.fact.note");
    case "page":
      return t("flow.fact.page");
    case "files":
      return t("flow.fact.files");
    case "cause":
      return t("flow.fact.cause");
    case "summary":
      return t("flow.fact.summary");
    case "verdict":
      return t("flow.fact.verdict");
    case "notes":
      return t("flow.fact.notes");
    case "decision":
      return t("flow.fact.decision");
    case "verify":
      return t("flow.fact.verify");
    case "gate":
      return t("flow.fact.gate");
    case "recall":
      return t("flow.fact.recall");
  }
}

function factBody(t: TranslateFn, fact: StageFact): string {
  if (fact.k === "files" || fact.k === "recall") return fact.v.join("\n");
  if (fact.k === "gate") {
    if (fact.v === "deferred_to_post_act") return t("loop.gate.skip.deferred");
    if (fact.v === "disabled") return t("loop.gate.skip.disabled");
    return fact.v;
  }
  if (fact.k === "verify") {
    return fact.v === "ok" ? t("flow.verifyOk") : t("flow.verifyFailed");
  }
  if (fact.k === "decision") {
    if (fact.v === "accept" || fact.v === "refine" || fact.v === "revert") {
      return t(DECISION_LABEL[fact.v]);
    }
    return fact.v;
  }
  return fact.v;
}
