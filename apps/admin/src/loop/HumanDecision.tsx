import { useEffect, useRef, useState } from "react";
import type { PlanIR, Project, ReviewDecision, Session } from "@sightloop/shared";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type Problem =
  | { kind: "stale" }
  | {
      kind: "gate";
      status: string;
      failedChecks: string[];
      /** Why a rerun asked for from here could not start. */
      rerunError?: string;
    }
  | { kind: "other"; message: string };

type Busy = ReviewDecision | "gate" | null;

const DONE_TEXT = {
  accept: "loop.decide.done.accept",
  refine: "loop.decide.done.refine",
  revert: "loop.decide.done.revert",
} as const satisfies Record<ReviewDecision, string>;

function gateProblem(details: unknown): Problem {
  const d = (details ?? {}) as { status?: unknown; failed_checks?: unknown };
  return {
    kind: "gate",
    status: typeof d.status === "string" ? d.status : "unknown",
    failedChecks: Array.isArray(d.failed_checks)
      ? d.failed_checks.filter((c): c is string => typeof c === "string")
      : [],
  };
}

/**
 * The human turn of the loop: accept the change, send it back with a note, or
 * revert it. Shown only while the session is awaiting review.
 */
export function HumanDecision(props: {
  session: Session;
  project: Project | undefined;
  plan: PlanIR | null;
  onDone: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { session } = props;
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [refining, setRefining] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState("");
  const [worked, setWorked] = useState("");
  const [avoid, setAvoid] = useState("");
  const [remember, setRemember] = useState(true);
  const [confirming, setConfirming] = useState<"revert" | "force" | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const allowForce = props.project?.acceptance_gate?.allow_force_accept === true;

  useEffect(() => {
    if (refining) noteRef.current?.focus();
  }, [refining]);

  async function decide(decision: ReviewDecision, force = false) {
    if (busy) return;
    setBusy(decision);
    setProblem(null);
    try {
      await api.reviewSession(session.id, {
        decision,
        ...(decision === "refine" ? { note: note.trim() } : {}),
        ...(decision === "accept"
          ? {
              remember,
              ...(remember && summary.trim()
                ? {
                    lesson: {
                      summary: summary.trim(),
                      ...(worked.trim() ? { worked: worked.trim() } : {}),
                      ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
                    },
                  }
                : {}),
            }
          : {}),
        ...(force ? { force_accept: true } : {}),
      });
      props.onDone(t(DONE_TEXT[decision]));
      await props.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_status") {
        // Someone decided already (the extension, or another window).
        setProblem({ kind: "stale" });
        await props.refresh();
      } else if (err instanceof ApiError && err.code === "acceptance_gate_failed") {
        setProblem(gateProblem(err.details));
      } else {
        setProblem({ kind: "other", message: (err as Error).message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function rerunGate() {
    if (busy) return;
    setBusy("gate");
    try {
      const run = await api.runAcceptanceGate(session.id);
      // Anything but a pass still blocks Accept, so keep the way out visible.
      setProblem(
        run.status === "passed"
          ? null
          : {
              kind: "gate",
              status: run.status,
              failedChecks: run.report?.failed_checks ?? [],
            },
      );
    } catch (err) {
      const message = (err as Error).message;
      // Keep the callout: the way out (force accept, refine, revert) is still needed.
      setProblem((prev) =>
        prev?.kind === "gate"
          ? { ...prev, rerunError: message }
          : { kind: "other", message },
      );
    } finally {
      await props.refresh();
      setBusy(null);
    }
  }

  function openAccept() {
    const noteLine = session.annotation?.note?.trim().split(/\r?\n/)[0] ?? "";
    const root = props.plan?.root_cause?.trim() ?? "";
    const selector = session.annotation?.selector?.trim() ?? "";
    const line = (noteLine || root || selector || session.page_url).slice(0, 200);
    const done = (props.plan?.issue_resolutions ?? [])
      .map((item) => item.rationale?.trim())
      .filter((item): item is string => Boolean(item))
      .slice(0, 2)
      .join(" ")
      .slice(0, 500);
    setSummary(line);
    setWorked(done);
    setAvoid("");
    setRemember(true);
    setRefining(false);
    setAccepting(true);
  }

  function composing(e: { nativeEvent: KeyboardEvent }) {
    return e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
  }

  return (
    <div className="decide">
      {problem?.kind === "gate" ? (
        <div className="callout" role="alert">
          <p>
            <strong>{t("loop.decide.gateBlocked")}</strong>{" "}
            {t("loop.decide.gateStatus", { status: problem.status })}
            {problem.failedChecks.length > 0
              ? ` · ${problem.failedChecks.join(", ")}`
              : ""}
          </p>
          {problem.rerunError ? (
            <p className="state-text state-failed wrap">
              {t("loop.decide.gateRerunFailed", { message: problem.rerunError })}
            </p>
          ) : null}
          <div className="row">
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy !== null}
              onClick={() => void rerunGate()}
            >
              {busy === "gate"
                ? t("loop.decide.gateRunning")
                : t("loop.decide.gateRerun")}
            </button>
            {allowForce ? (
              <button
                type="button"
                className="btn danger tiny"
                disabled={busy !== null}
                onClick={() => setConfirming("force")}
              >
                {t("loop.decide.force")}
              </button>
            ) : null}
          </div>
        </div>
      ) : problem ? (
        <p className="status error wrap" role="alert">
          {problem.kind === "stale"
            ? t("loop.decide.stale")
            : problem.message}
        </p>
      ) : null}

      {refining ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void decide("refine");
          }}
        >
          <label>
            {t("loop.decide.noteLabel")}
            <textarea
              ref={noteRef}
              value={note}
              maxLength={8000}
              required
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              type="submit"
              className="btn"
              disabled={busy !== null || !note.trim()}
            >
              {t("loop.decide.sendRefine")}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy !== null}
              onClick={() => setRefining(false)}
            >
              {t("projects.form.cancel")}
            </button>
          </div>
        </form>
      ) : accepting ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (!remember || summary.trim()) void decide("accept");
          }}
        >
          <label>
            {t("loop.decide.summary")}
            <input
              value={summary}
              maxLength={200}
              required={remember}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => {
                if (composing(e)) e.preventDefault();
              }}
            />
          </label>
          <label>
            {t("loop.decide.worked")}
            <input
              value={worked}
              maxLength={500}
              onChange={(e) => setWorked(e.target.value)}
              onKeyDown={(e) => {
                if (composing(e)) e.preventDefault();
              }}
            />
          </label>
          <label>
            {t("loop.decide.avoid")}
            <input
              value={avoid}
              maxLength={500}
              onChange={(e) => setAvoid(e.target.value)}
              onKeyDown={(e) => {
                if (composing(e)) e.preventDefault();
              }}
            />
          </label>
          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t("loop.decide.remember")}
          </label>
          <div className="row">
            <button
              type="submit"
              className="btn"
              disabled={busy !== null || (remember && !summary.trim())}
            >
              {t("loop.decision.accept")}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy !== null}
              onClick={() => setAccepting(false)}
            >
              {t("loop.decide.back")}
            </button>
          </div>
        </form>
      ) : (
        <div className="row decide-actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={openAccept}
          >
            {t("loop.decision.accept")}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => setRefining(true)}
          >
            {t("loop.decision.refine")}
          </button>
          <button
            type="button"
            className="btn danger push-end"
            disabled={busy !== null}
            onClick={() => setConfirming("revert")}
          >
            {t("loop.decision.revert")}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming === "revert"}
        title={t("loop.decide.revertTitle")}
        confirmLabel={t("loop.decision.revert")}
        cancelLabel={t("projects.form.cancel")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void decide("revert");
        }}
      >
        <p>
          {t("loop.decide.revertBody", {
            sha: (session.git_base_sha ?? "?").slice(0, 8),
          })}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "force"}
        title={t("loop.decide.forceTitle")}
        confirmLabel={t("loop.decide.force")}
        cancelLabel={t("projects.form.cancel")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void decide("accept", true);
        }}
      >
        <p>{t("loop.decide.forceBody")}</p>
      </ConfirmDialog>
    </div>
  );
}
