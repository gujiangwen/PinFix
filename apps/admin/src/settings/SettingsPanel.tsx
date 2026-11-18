import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { lightDismiss } from "../ui/dialog";
import {
  SETTINGS_SECTIONS,
  settingsHash,
  type SettingsSection,
} from "../routes";

const SECTION_LABEL = {
  pi: "settings.section.pi",
  projects: "settings.section.projects",
  extension: "settings.section.extension",
  appearance: "settings.section.appearance",
  audit: "settings.section.audit",
  metrics: "settings.section.metrics",
} as const satisfies Record<SettingsSection, string>;

export function SettingsPanel(props: {
  section: SettingsSection | null;
  onClose: () => void;
  notice: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const open = props.section !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      {...lightDismiss}
      onClose={props.onClose}
    >
      <header className="settings-head">
        <h2 id="settings-title">{t("settings.title")}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("settings.close")}
          onClick={() => ref.current?.close()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {SETTINGS_SECTIONS.map((id) => (
            <a
              key={id}
              href={settingsHash(id)}
              className={id === props.section ? "active" : ""}
              aria-current={id === props.section ? "page" : undefined}
            >
              {t(SECTION_LABEL[id])}
            </a>
          ))}
        </nav>
        <div className="settings-body">
          {props.notice}
          {open ? props.children : null}
        </div>
      </div>
    </dialog>
  );
}
