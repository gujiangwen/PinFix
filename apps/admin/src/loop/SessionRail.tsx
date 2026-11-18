import type { Project, Session } from "@sightloop/shared";
import { useI18n } from "../i18n";
import { pageHash } from "../routes";
import { fmtTime, sessionTitle } from "../ui/format";
import { STATUS_LABEL } from "./labels";

export function SessionRail(props: {
  projects: Project[];
  sessions: Session[];
  selectedId: string | null;
  projectId: string;
  onProjectChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const projectName = (id: string) =>
    props.projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  return (
    <nav className="rail" aria-label={t("sessions.title")}>
      {props.projects.length > 1 ? (
        <label className="inline-filter">
          {t("sessions.project")}
          <select
            value={props.projectId}
            onChange={(e) => props.onProjectChange(e.target.value)}
          >
            <option value="">{t("sessions.all")}</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <ul className="rail-list">
        {props.sessions.map((s) => {
          const active = s.id === props.selectedId;
          return (
            <li key={s.id}>
              <a
                href={pageHash({ name: "loop", sessionId: s.id })}
                className={`rail-item ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="rail-title">{sessionTitle(s)}</span>
                <span className="rail-meta">
                  <span className={`state-text status-${s.status}`}>
                    {t(STATUS_LABEL[s.status])}
                  </span>
                  <span>{projectName(s.project_id)}</span>
                  <span>{fmtTime(s.created_at)}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
