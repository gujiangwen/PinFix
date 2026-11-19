import type { ReactNode } from "react";
import { useI18n, type Locale } from "../i18n";
import { pageHash } from "../routes";
import { useTheme } from "../theme";

/** Language, theme, and the knowledge entry. Kept on the title bar, not in Settings. */
export function TitleTools(props: { knowledgeOpen?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const nextLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  const mark = locale === "zh-CN" ? "CN" : "EN";
  const sep = locale === "zh-CN" ? "，" : ", ";
  const langName = `${mark}${sep}${t("chrome.lang")}${sep}${locale === "zh-CN" ? "中文" : "English"}`;
  const themeName = `${t("chrome.theme")}${sep}${t(theme === "light" ? "chrome.theme.light" : "chrome.theme.dark")}`;

  return (
    <div className="title-tools">
      <button
        type="button"
        className="icon-btn lang-mark"
        aria-label={langName}
        title={langName}
        onClick={() => setLocale(nextLocale)}
      >
        {mark}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={themeName}
        title={themeName}
        onClick={toggleTheme}
      >
        {theme === "light" ? <SunIcon /> : <MoonIcon />}
      </button>
      <a
        className="icon-btn"
        href={pageHash({ name: "knowledge", cardId: null })}
        aria-label={t("knowledge.title")}
        title={t("knowledge.title")}
        aria-current={props.knowledgeOpen ? "page" : undefined}
      >
        <KnowledgeIcon />
      </a>
    </div>
  );
}

function Icon(props: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <Icon>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z" />
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H19" />
    </Icon>
  );
}

function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </Icon>
  );
}

function MoonIcon() {
  return (
    <Icon>
      <path d="M15.5 3.8a7 7 0 1 0 4.8 11.8A5.6 5.6 0 0 1 15.5 3.8Z" />
    </Icon>
  );
}
