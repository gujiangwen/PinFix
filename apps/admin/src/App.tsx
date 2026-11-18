import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@sightloop/shared";
import { api, baseUrl } from "./api";
import { useI18n } from "./i18n";
import { HOME_HASH, type SettingsSection } from "./routes";
import { useRoute } from "./useRoute";
import { NoticeBar, useNotice } from "./ui/Notice";
import { LoopPage } from "./loop/LoopPage";
import { KnowledgePage } from "./knowledge/KnowledgePage";
import { SettingsPanel } from "./settings/SettingsPanel";
import { PiSection } from "./settings/sections/PiSection";
import { ProjectsSection } from "./settings/sections/ProjectsSection";
import { ExtensionSection } from "./settings/sections/ExtensionSection";
import { AppearanceSection } from "./settings/sections/AppearanceSection";
import { AuditSection } from "./settings/sections/AuditSection";
import { MetricsSection } from "./settings/sections/MetricsSection";

const HEALTH_POLL_MS = 15_000;

type Daemon =
  | { state: "checking" }
  | { state: "ok"; version: string }
  | { state: "down"; message: string };

export function App() {
  const { t } = useI18n();
  const route = useRoute();
  const [projects, setProjects] = useState<Project[]>([]);
  const [daemon, setDaemon] = useState<Daemon>({ state: "checking" });
  const pageNotice = useNotice();
  const settingsNotice = useNotice();
  const wasOk = useRef(false);

  const refreshProjects = useCallback(async () => {
    setProjects(await api.listProjects());
  }, []);

  const checkDaemon = useCallback(async () => {
    try {
      const health = await api.health();
      setDaemon({ state: "ok", version: health.version });
      if (!wasOk.current) {
        wasOk.current = true;
        await refreshProjects();
      }
    } catch (err) {
      wasOk.current = false;
      setDaemon({ state: "down", message: (err as Error).message });
    }
  }, [refreshProjects]);

  useEffect(() => {
    void checkDaemon();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void checkDaemon();
    }, HEALTH_POLL_MS);
    return () => clearInterval(timer);
  }, [checkDaemon]);

  const daemonTitle =
    daemon.state === "ok"
      ? t("status.connected", { url: baseUrl, version: daemon.version })
      : daemon.state === "down"
        ? t("status.unreachable", { url: baseUrl, message: daemon.message })
        : baseUrl;

  return (
    <div className="shell wide">
      <header className="topbar">
        <a className="brand" href={HOME_HASH}>
          <h1>SightLoop</h1>
        </a>
        {daemon.state !== "checking" ? (
          <span
            className={`dot ${daemon.state === "ok" ? "ok" : "bad"}`}
            role="img"
            aria-label={daemonTitle}
            title={daemonTitle}
          />
        ) : null}
        <div className="topnav">
          <button
            type="button"
            className="icon-btn"
            aria-label={t("settings.title")}
            title={t("settings.title")}
            onClick={() => route.openSettings("pi")}
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
          </button>
        </div>
      </header>

      {daemon.state === "down" ? (
        <div className="banner" role="alert">
          <span>{daemonTitle}</span>
          <button
            type="button"
            className="btn secondary tiny"
            onClick={() => void checkDaemon()}
          >
            {t("daemon.retry")}
          </button>
        </div>
      ) : null}

      <NoticeBar notice={pageNotice.notice} onDismiss={pageNotice.clear} />

      <main>
        {route.page.name === "loop" ? (
          <LoopPage
            projects={projects}
            sessionId={route.page.sessionId}
            daemonUp={daemon.state === "ok"}
            onRefreshProjects={refreshProjects}
            onError={pageNotice.onError}
            onStatus={pageNotice.onStatus}
          />
        ) : (
          <KnowledgePage
            projects={projects}
            cardId={route.page.cardId}
            onError={pageNotice.onError}
            onStatus={pageNotice.onStatus}
          />
        )}
      </main>

      <SettingsPanel
        section={route.settings}
        onClose={route.closeSettings}
        notice={
          <NoticeBar
            notice={settingsNotice.notice}
            onDismiss={settingsNotice.clear}
          />
        }
      >
        {route.settings ? (
          <SettingsSectionView
            section={route.settings}
            projects={projects}
            onRefreshProjects={refreshProjects}
            onError={settingsNotice.onError}
            onStatus={settingsNotice.onStatus}
          />
        ) : null}
      </SettingsPanel>
    </div>
  );
}

function SettingsSectionView(props: {
  section: SettingsSection;
  projects: Project[];
  onRefreshProjects: () => Promise<void>;
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { onError, onStatus } = props;
  switch (props.section) {
    case "pi":
      return <PiSection onError={onError} onStatus={onStatus} />;
    case "projects":
      return (
        <ProjectsSection
          projects={props.projects}
          onRefresh={props.onRefreshProjects}
          onError={onError}
          onStatus={onStatus}
        />
      );
    case "extension":
      return <ExtensionSection onError={onError} onStatus={onStatus} />;
    case "appearance":
      return <AppearanceSection />;
    case "audit":
      return <AuditSection projects={props.projects} onError={onError} />;
    case "metrics":
      return <MetricsSection onError={onError} />;
  }
}
