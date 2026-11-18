import { useEffect, useState } from "react";
import type { Project, Session, AgentStep, Review } from "@sightloop/shared";
import { api } from "../api";
import { useI18n } from "../i18n";
import { fmtTime } from "../ui/format";

export function LoopPage(props: {
  projects: Project[];
  onError: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    session: Session;
    steps: AgentStep[];
    reviews: Review[];
  } | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function loadList() {
    setBusy(true);
    props.onError("");
    try {
      setSessions(await api.listSessions(projectId || undefined));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function openSession(id: string) {
    setSelected(id);
    setBusy(true);
    props.onError("");
    try {
      const d = await api.getSession(id);
      setDetail(d);
      try {
        const diffRes = await api.getDiff(id);
        setDiff(diffRes.patch || t("sessions.diffEmpty"));
      } catch {
        setDiff(t("sessions.diffUnavailable"));
      }
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const projectName = (id: string) =>
    props.projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="split">
      <div className="panel">
        <div className="row between">
          <h2>{t("sessions.title")}</h2>
          <button
            type="button"
            className="btn secondary tiny"
            onClick={() => void loadList()}
            disabled={busy}
          >
            {t("sessions.refresh")}
          </button>
        </div>
        <label className="inline-filter">
          {t("sessions.project")}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t("sessions.all")}</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {sessions.length === 0 ? (
          <p className="empty">{t("sessions.empty")}</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`session-item ${selected === s.id ? "active" : ""}`}
                  onClick={() => void openSession(s.id)}
                >
                  <span className={`badge status-${s.status}`}>{s.status}</span>
                  <span className="mono">{s.id.slice(0, 10)}</span>
                  <span className="muted">
                    {projectName(s.project_id)} ·{" "}
                    {t("sessions.steps", { count: s.step_count })}
                  </span>
                  <span className="muted tiny">{fmtTime(s.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>{t("sessions.timeline")}</h2>
        {!detail ? (
          <p className="empty">{t("sessions.select")}</p>
        ) : (
          <>
            <div className="meta-grid">
              <div>
                <span className="muted">{t("sessions.status")}</span>
                <div>
                  <span className={`badge status-${detail.session.status}`}>
                    {detail.session.status}
                  </span>
                </div>
              </div>
              <div>
                <span className="muted">{t("sessions.page")}</span>
                <div className="mono wrap">{detail.session.page_url}</div>
              </div>
              <div>
                <span className="muted">{t("sessions.baseTemp")}</span>
                <div className="mono wrap">
                  {(detail.session.git_base_sha ?? "—").slice(0, 8)} →{" "}
                  {(detail.session.temp_commit_sha ?? "—").slice(0, 8)}
                </div>
              </div>
            </div>

            <h3 className="subhead">{t("sessions.stepTimeline")}</h3>
            <ol className="timeline">
              {detail.steps.map((step) => (
                <li key={step.id}>
                  <div className="tl-head">
                    <span className="badge phase">{step.phase}</span>
                    <span className="mono">
                      #{step.idx} {step.tool_name ?? ""}
                    </span>
                    {step.duration_ms != null ? (
                      <span className="muted">{step.duration_ms}ms</span>
                    ) : null}
                    {step.tokens_in != null || step.tokens_out != null ? (
                      <span className="muted">
                        tok {step.tokens_in ?? "—"}/{step.tokens_out ?? "—"}
                      </span>
                    ) : null}
                  </div>
                  {step.summary ? (
                    <p className="tl-summary">{step.summary}</p>
                  ) : null}
                  {step.error ? (
                    <p className="status error">{step.error}</p>
                  ) : null}
                  {step.tool_name === "list_knowledge" ? (
                    <RecallHits output={step.output} />
                  ) : null}
                  {step.output && step.tool_name !== "list_knowledge" ? (
                    <pre className="code-block">
                      {JSON.stringify(step.output, null, 2).slice(0, 1200)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>

            {detail.reviews.length > 0 ? (
              <>
                <h3 className="subhead">{t("sessions.reviews")}</h3>
                <ul className="doc-list">
                  {detail.reviews.map((r) => (
                    <li key={r.id}>
                      <span className="badge">{r.decision}</span>{" "}
                      {r.note ?? ""}{" "}
                      <span className="muted">{fmtTime(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h3 className="subhead">{t("sessions.diff")}</h3>
            <pre className="code-block diff">{diff}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function RecallHits({ output }: { output: unknown }) {
  const { t } = useI18n();
  if (!output || typeof output !== "object") return null;
  const hits = (output as { hits?: unknown }).hits;
  if (!Array.isArray(hits) || hits.length === 0) {
    return <p className="muted">{t("sessions.recallNone")}</p>;
  }
  return (
    <div className="recall">
      <div className="muted">{t("sessions.recallTitle")}</div>
      <ul>
        {hits.map((h, i) => {
          const hit = h as {
            title?: string;
            score?: number | null;
            id?: string | null;
            distance?: number | null;
            retrieve?: string | null;
          };
          return (
            <li key={hit.id ?? i}>
              <strong>{hit.title ?? t("sessions.untitled")}</strong>
              {hit.score != null ? (
                <span className="muted">
                  {" "}
                  score={Number(hit.score).toFixed(2)}
                </span>
              ) : null}
              {hit.distance != null ? (
                <span className="muted">
                  {" "}
                  dist={Number(hit.distance).toFixed(3)}
                </span>
              ) : null}
              {hit.retrieve ? (
                <span className="muted"> · {hit.retrieve}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
