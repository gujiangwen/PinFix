import { useState, type ReactNode } from "react";
import type { AcceptanceReport, AgentStep } from "@sightloop/shared";
import type { SessionDetail } from "../api";
import { useI18n } from "../i18n";
import { pageHash, settingsHash } from "../routes";
import { fmtDuration, fmtTime } from "../ui/format";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Changes } from "./Changes";
import { DECISION_LABEL, NODE_LABEL } from "./labels";
import { nodeStateText } from "./LoopTrack";
import { gateSkipReason, type LoopNode, type LoopRound } from "./loop-model";

const RAW_OUTPUT_LIMIT = 6000;

// Step outputs are untyped JSON written by the Daemon; read them defensively.
function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
  return list(value).filter((v): v is string => typeof v === "string");
}

function isGuard(step: AgentStep): boolean {
  return (step.tool_name ?? "").endsWith("_guard");
}

function lastOutput(
  steps: AgentStep[],
  match: (step: AgentStep) => boolean = () => true,
): Record<string, unknown> | null {
  const step = [...steps].reverse().find(match);
  return rec(step?.output);
}

type BodyProps = {
  node: LoopNode;
  round: LoopRound;
  /** Read-model fields describe the session's latest state, so they only apply to the last round. */
  isLastRound: boolean;
  detail: SessionDetail;
  patch: string | null;
  onArchiveKnowledge?: (id: string) => Promise<void>;
};

export function NodeDetail(props: BodyProps & { decisionControls: ReactNode }) {
  const { t } = useI18n();
  const { node, round } = props;
  const errors = node.steps.filter((s) => s.error);

  return (
    <section className="panel node-detail" aria-labelledby="node-detail-title">
      <header className="row between">
        <h2 id="node-detail-title">{t(NODE_LABEL[node.id])}</h2>
        <span className={`state-text state-${node.state}`}>
          {nodeStateText(t, node, round)}
          {node.durationMs != null ? ` · ${fmtDuration(node.durationMs)}` : ""}
        </span>
      </header>

      {errors.map((s) => (
        <p key={s.id} className="status error wrap">
          {s.tool_name ? `${s.tool_name}: ` : ""}
          {s.error}
        </p>
      ))}

      {node.id === "human" ? (
        <HumanBody {...props} decisionControls={props.decisionControls} />
      ) : node.steps.length === 0 && !hasReadModelData(props) ? (
        <p className="muted">
          {node.state === "active"
            ? t("loop.detail.running")
            : node.state === "off"
              ? t("loop.detail.off")
              : t("loop.detail.pending")}
        </p>
      ) : (
        <NodeBody {...props} />
      )}

      {node.steps.length > 0 ? <RawSteps steps={node.steps} /> : null}
    </section>
  );
}

function hasReadModelData({ node, isLastRound, detail }: BodyProps): boolean {
  if (!isLastRound) return false;
  if (node.id === "gate") return detail.acceptance_gate != null;
  if (node.id === "implement") return detail.diff_summary != null;
  return false;
}

function NodeBody(props: BodyProps) {
  switch (props.node.id) {
    case "retrieve":
      return <RetrieveBody {...props} />;
    case "plan":
      return <PlanBody {...props} />;
    case "implement":
      return <ImplementBody {...props} />;
    case "verify":
      return <VerifyBody {...props} />;
    case "gate":
      return <GateBody {...props} />;
    case "review":
      return <ReviewBody {...props} />;
    case "human":
      return null;
  }
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/** Which model answered, and whether the Daemon fell back from the one configured. */
function ModelFacts({ output }: { output: Record<string, unknown> }) {
  const { t } = useI18n();
  const model = str(output.model) ?? str(output.reviewer_model);
  const backend = str(output.backend);
  const fallback = str(output.fallback_reason);
  return (
    <>
      {model || backend ? (
        <Fact label={t("loop.fact.model")}>
          <span className="mono">
            {[model, backend].filter(Boolean).join(" · ")}
          </span>
        </Fact>
      ) : null}
      {fallback ? (
        <Fact label={t("loop.fact.fallback")}>
          <span className="state-text state-warn mono">{fallback}</span>
        </Fact>
      ) : null}
    </>
  );
}

function RetrieveBody({ node, isLastRound, detail, onArchiveKnowledge }: BodyProps) {
  const { t } = useI18n();
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const output = lastOutput(node.steps, (s) => s.tool_name === "list_knowledge");
  const fromStep = list(output?.hits).map((h) => {
    const hit = rec(h) ?? {};
    return {
      id: str(hit.id),
      title: str(hit.title) ?? t("sessions.untitled"),
      score: typeof hit.score === "number" ? hit.score : null,
      retrieve: str(hit.retrieve),
      source: null as string | null,
    };
  });
  const fromReadModel = isLastRound
    ? detail.recall_hits.map((h) => ({
        id: h.knowledge_id,
        title: h.title,
        score: h.score ?? null,
        retrieve: h.retrieve ?? null,
        source: h.source_session_id ?? null,
      }))
    : [];
  const hits = fromReadModel.length > 0 ? fromReadModel : fromStep;

  if (hits.length === 0) {
    return <p className="muted">{t("loop.retrieve.none")}</p>;
  }
  return (
    <>
      <ul className="hit-list">
        {hits.map((hit, i) => (
          <li key={hit.id ?? i}>
            <div className="hit-actions">
              {hit.id ? (
                <a href={pageHash({ name: "knowledge", cardId: hit.id })}>
                  {hit.title}
                </a>
              ) : (
                <strong>{hit.title}</strong>
              )}
              {hit.source ? (
                <a href={pageHash({ name: "loop", sessionId: hit.source })}>
                  {t("loop.retrieve.source")}
                </a>
              ) : null}
              {hit.score != null ? (
                <span className="muted tiny mono">{hit.score.toFixed(2)}</span>
              ) : null}
              {hit.id && onArchiveKnowledge ? (
                stopped === hit.id ? (
                  <span className="muted tiny">{t("loop.retrieve.stopped")}</span>
                ) : (
                  <button
                    type="button"
                    className="btn danger tiny"
                    onClick={() => setStopId(hit.id)}
                  >
                    {t("loop.retrieve.stop")}
                  </button>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={stopId !== null}
        title={t("loop.retrieve.stopTitle")}
        confirmLabel={t("loop.retrieve.stop")}
        cancelLabel={t("knowledge.cancel")}
        onCancel={() => setStopId(null)}
        onConfirm={() => {
          const id = stopId;
          setStopId(null);
          if (!id || !onArchiveKnowledge) return;
          void onArchiveKnowledge(id).then(() => setStopped(id));
        }}
      >
        <p>{t("loop.retrieve.stopBody")}</p>
      </ConfirmDialog>
    </>
  );
}

function PlanBody({ node }: BodyProps) {
  const { t } = useI18n();
  const output = lastOutput(node.steps, (s) => !isGuard(s));
  if (!output) return null;
  const files = strings(output.allowed_files);
  const resolutions = list(output.issue_resolutions).map(rec).filter((r) => r !== null);
  const shell = list(rec(output.verify_contract)?.shell).map(rec).filter((r) => r !== null);

  return (
    <dl className="facts">
      {str(output.root_cause) ? (
        <Fact label={t("loop.plan.rootCause")}>{str(output.root_cause)}</Fact>
      ) : null}
      {files.length > 0 ? (
        <Fact label={t("loop.plan.allowedFiles")}>
          <ul className="plain-list mono">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {shell.length > 0 ? (
        <Fact label={t("loop.plan.contract")}>
          <ul className="plain-list mono">
            {shell.map((item, i) => (
              <li key={str(item.id) ?? i}>
                {str(item.cmd) ?? str(item.id)}
                {str(item.cmd) && str(item.id) ? (
                  <span className="muted"> — {str(item.id)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {resolutions.length > 0 ? (
        <Fact label={t("loop.plan.resolutions")}>
          <ul className="plain-list">
            {resolutions.map((r, i) => (
              <li key={str(r.issue_id) ?? i}>
                <span className="mono">{str(r.issue_id)}</span>{" "}
                <span className="badge">{str(r.status)}</span>{" "}
                {str(r.rationale)}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      <ModelFacts output={output} />
    </dl>
  );
}

function ImplementBody({ node, isLastRound, detail, patch }: BodyProps) {
  const { t } = useI18n();
  const runner = [...node.steps].reverse().find((s) => !isGuard(s));
  const output = rec(runner?.output);
  const touched = strings(output?.filesTouched);
  const guards = node.steps.filter(isGuard);

  return (
    <>
      <dl className="facts">
        {runner?.summary ? (
          <Fact label={t("loop.fact.summary")}>{runner.summary}</Fact>
        ) : null}
        {/* Older rounds have no diff of their own; list what the runner reported. */}
        {!isLastRound && touched.length > 0 ? (
          <Fact label={t("loop.implement.touched")}>
            <ul className="plain-list mono">
              {touched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Fact>
        ) : null}
        {guards.length > 0 ? (
          <Fact label={t("loop.implement.guards")}>
            <ul className="plain-list">
              {guards.map((g) => (
                <li key={g.id}>
                  <span className="mono">{g.tool_name}</span>{" "}
                  <span className={g.error ? "state-text state-failed" : "muted"}>
                    {g.error ?? g.summary ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
        {output ? <ModelFacts output={output} /> : null}
      </dl>
      {isLastRound ? (
        <Changes summary={detail.diff_summary} patch={patch} />
      ) : null}
    </>
  );
}

function VerifyBody({ node, isLastRound, detail }: BodyProps) {
  const { t } = useI18n();
  const output = lastOutput(node.steps);
  const ok = typeof output?.ok === "boolean" ? output.ok : null;
  const log =
    str(output?.log_tail) ??
    str(output?.output) ??
    (isLastRound ? str(detail.verify?.log_tail) : null);
  // Keyed by contract item id.
  const results = Object.entries(rec(output?.contract_results) ?? {}).flatMap(
    ([id, value]) => {
      const result = rec(value);
      return result ? [{ id, ok: result.ok, summary: str(result.summary) }] : [];
    },
  );

  return (
    <>
      <dl className="facts">
        {ok != null ? (
          <Fact label={t("loop.verify.result")}>
            <span className={`state-text state-${ok ? "done" : "failed"}`}>
              {ok ? t("loop.verify.pass") : t("loop.verify.fail")}
            </span>
          </Fact>
        ) : null}
        {isLastRound && detail.verify?.command ? (
          <Fact label={t("loop.verify.command")}>
            <span className="mono wrap">{detail.verify.command}</span>
          </Fact>
        ) : null}
        {results.length > 0 ? (
          <Fact label={t("loop.plan.contract")}>
            <ul className="plain-list">
              {results.map((r) => (
                <li key={r.id}>
                  {typeof r.ok === "boolean" ? (r.ok ? "✓ " : "✕ ") : ""}
                  <span className="mono">{r.id}</span>
                  {r.summary ? (
                    <span className="muted"> — {r.summary}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
      </dl>
      {log ? <pre className="code-block">{log}</pre> : null}
    </>
  );
}

function GateBody({ node, isLastRound, detail }: BodyProps) {
  const { t } = useI18n();
  const run = isLastRound ? detail.acceptance_gate : null;
  const report =
    run?.report ??
    (rec(lastOutput(node.steps)?.report) as AcceptanceReport | null);
  const status = run?.status ?? report?.status ?? null;
  const error = run?.error ?? report?.error ?? null;
  const skipReason = status ? null : gateSkipReason(node);

  if (skipReason === "disabled") {
    return (
      <p className="muted">
        {t("loop.gate.skip.disabled")}{" "}
        <a href={settingsHash("projects")}>{t("loop.gate.skip.enable")}</a>
      </p>
    );
  }
  if (skipReason) {
    return (
      <p className="muted">
        {skipReason === "deferred_to_post_act"
          ? t("loop.gate.skip.deferred")
          : t("loop.gate.skip.other", { reason: skipReason })}
      </p>
    );
  }

  return (
    <dl className="facts">
      {status ? (
        <Fact label={t("loop.gate.status")}>
          <span className="badge">{status}</span>
          {report?.duration_ms != null
            ? ` ${fmtDuration(report.duration_ms)}`
            : ""}
        </Fact>
      ) : null}
      {error ? (
        <Fact label={t("loop.gate.error")}>
          {/* Runner errors are multi-line (stack traces, CLI banners). */}
          <pre className="code-block">{error}</pre>
        </Fact>
      ) : null}
      {report?.failed_checks?.length ? (
        <Fact label={t("loop.gate.failedChecks")}>
          {report.failed_checks.join(", ")}
        </Fact>
      ) : null}
      {report?.failed_steps?.length ? (
        <Fact label={t("loop.gate.failedSteps")}>
          <ul className="plain-list">
            {report.failed_steps.map((s) => (
              <li key={s.id}>
                <span className="mono">{s.id}</span> {s.message}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {report?.console_errors?.length ? (
        <Fact label={t("loop.gate.console")}>
          <ul className="plain-list mono">
            {report.console_errors.map((line, i) => (
              <li key={i} className="wrap">
                {line}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {report?.network_failures?.length ? (
        <Fact label={t("loop.gate.network")}>
          <ul className="plain-list mono">
            {report.network_failures.map((f, i) => (
              <li key={i} className="wrap">
                {f.status} {f.method} {f.url}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {report?.screenshots?.length ? (
        <Fact label={t("loop.gate.screenshots")}>
          <ul className="plain-list">
            {report.screenshots.map((s) => (
              <li key={s.name}>
                {s.passed ? "✓" : "✕"} <span className="mono">{s.name}</span>
                {s.diff_ratio != null
                  ? ` · ${(s.diff_ratio * 100).toFixed(2)}%`
                  : ""}
                {s.baseline_created ? ` · ${t("loop.gate.baseline")}` : ""}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
    </dl>
  );
}

function ReviewBody({ node }: BodyProps) {
  const { t } = useI18n();
  const output = lastOutput(node.steps);
  if (!output) return null;
  const verdict = str(output.verdict);
  const issues = list(output.blocking_issues).map(rec).filter((r) => r !== null);
  const judgeSkipped = output.judge_skipped === true;

  return (
    <dl className="facts">
      {verdict ? (
        <Fact label={t("loop.review.verdict")}>
          <span
            className={`state-text state-${verdict === "pass" ? "done" : "warn"}`}
          >
            {verdict === "pass"
              ? t("loop.review.pass")
              : t("loop.review.refine")}
          </span>
        </Fact>
      ) : null}
      {str(output.notes) ? (
        <Fact label={t("loop.review.notes")}>{str(output.notes)}</Fact>
      ) : null}
      {issues.length > 0 ? (
        <Fact label={t("loop.review.issues")}>
          <ul className="plain-list">
            {issues.map((issue, i) => (
              <li key={i}>
                <span className="mono">{str(issue.code)}</span>{" "}
                {str(issue.message)}
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {typeof output.agent_judge_pass === "boolean" || judgeSkipped ? (
        <Fact label={t("loop.review.judge")}>
          {judgeSkipped
            ? `${t("loop.review.judgeSkipped")}${
                str(output.judge_skip_reason)
                  ? ` (${str(output.judge_skip_reason)})`
                  : ""
              }`
            : output.agent_judge_pass
              ? t("loop.review.pass")
              : t("loop.review.refine")}
        </Fact>
      ) : null}
      <ModelFacts output={output} />
    </dl>
  );
}

function HumanBody(props: BodyProps & { decisionControls: ReactNode }) {
  const { t } = useI18n();
  const { node, round, isLastRound, detail, patch } = props;
  const decision = round.decision;
  const awaiting = node.state === "active";
  const knowledge = isLastRound ? detail.latest_knowledge : null;

  return (
    <>
      {decision ? (
        <dl className="facts">
          <Fact label={t("loop.human.decision")}>
            {t(DECISION_LABEL[decision.decision])}{" "}
            <span className="muted tiny">{fmtTime(decision.created_at)}</span>
          </Fact>
          {decision.note ? (
            <Fact label={t("loop.human.note")}>
              <span className="pre-wrap">{decision.note}</span>
            </Fact>
          ) : null}
          {decision.decision === "accept" && knowledge ? (
            <Fact label={t("loop.human.distilled")}>
              <a href={pageHash({ name: "knowledge", cardId: knowledge.id })}>
                {knowledge.title}
              </a>
            </Fact>
          ) : null}
        </dl>
      ) : awaiting ? (
        <>
          <p className="hint">{t("loop.human.prompt")}</p>
          <Changes summary={detail.diff_summary} patch={patch} open />
          {props.decisionControls}
        </>
      ) : (
        <p className="muted">
          {node.state === "off"
            ? t("loop.human.notAsked")
            : t("loop.detail.pending")}
        </p>
      )}
    </>
  );
}

function RawSteps({ steps }: { steps: AgentStep[] }) {
  const { t } = useI18n();
  return (
    <details className="fold">
      <summary>{t("loop.detail.steps", { count: steps.length })}</summary>
      <ol className="step-list">
        {steps.map((step) => {
          const raw =
            step.output != null ? JSON.stringify(step.output, null, 2) : "";
          return (
            <li key={step.id}>
              <div className="tl-head">
                <span className="mono">
                  #{step.idx} {step.tool_name ?? step.phase}
                </span>
                {step.duration_ms != null ? (
                  <span className="muted">{fmtDuration(step.duration_ms)}</span>
                ) : null}
                {step.tokens_in != null || step.tokens_out != null ? (
                  <span className="muted">
                    tok {step.tokens_in ?? "—"}/{step.tokens_out ?? "—"}
                  </span>
                ) : null}
              </div>
              {step.summary ? <p className="tl-summary">{step.summary}</p> : null}
              {raw ? (
                <pre className="code-block">
                  {raw.length > RAW_OUTPUT_LIMIT
                    ? `${raw.slice(0, RAW_OUTPUT_LIMIT)}\n…`
                    : raw}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
