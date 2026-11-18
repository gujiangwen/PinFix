import { useEffect, useState } from "react";
import type { Project, AuditEvent } from "@sightloop/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { fmtTime } from "../../ui/format";

export function AuditSection(props: {
  projects: Project[];
  onError: (s: string) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    props.onError("");
    try {
      setEvents(
        await api.audit({
          project_id: projectId || undefined,
          limit: 150,
        }),
      );
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="panel">
      <div className="row between">
        <h2>{t("audit.title")}</h2>
        <button
          type="button"
          className="btn secondary tiny"
          disabled={busy}
          onClick={() => void load()}
        >
          {t("audit.refresh")}
        </button>
      </div>
      <label className="inline-filter">
        {t("audit.project")}
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">{t("audit.all")}</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {events.length === 0 ? (
        <p className="empty">{t("audit.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("audit.col.when")}</th>
                <th>{t("audit.col.event")}</th>
                <th>{t("audit.col.project")}</th>
                <th>{t("audit.col.session")}</th>
                <th>{t("audit.col.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtTime(e.created_at)}</td>
                  <td>
                    <span className="badge">{e.event}</span>
                  </td>
                  <td className="mono">{(e.project_id ?? "—").slice(0, 10)}</td>
                  <td className="mono">{(e.session_id ?? "—").slice(0, 10)}</td>
                  <td>
                    <pre className="code-block compact">
                      {JSON.stringify(e.detail, null, 2).slice(0, 400)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
