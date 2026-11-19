import type { ReactNode } from "react";
import { useI18n, type Locale } from "../i18n";
import { useTheme } from "../theme";

/** Language and theme, one icon each, kept on the title bar rather than in Settings. */
export function TitleTools() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const nextLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  const sep = locale === "zh-CN" ? "，" : ", ";
  const langName = `${t("chrome.lang")}${sep}${locale === "zh-CN" ? "中文" : "English"}`;
  const themeName = `${t("chrome.theme")}${sep}${t(theme === "light" ? "chrome.theme.light" : "chrome.theme.dark")}`;

  return (
    <div className="title-tools">
      <button
        type="button"
        className="icon-btn"
        aria-label={langName}
        title={langName}
        onClick={() => setLocale(nextLocale)}
      >
        {locale === "zh-CN" ? <LangZhIcon /> : <LangEnIcon />}
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

function LangZhIcon() {
  return (
    <Icon>
      <path d="M4 6h16" />
      <path d="M12 6v13" />
      <path d="M7.5 11c1.6 1.5 3 2.3 4.5 5" />
      <path d="M16.5 11c-1.6 1.5-3 2.3-4.5 5" />
    </Icon>
  );
}

function LangEnIcon() {
  return (
    <Icon>
      <path d="M6.5 18 12 5l5.5 13" />
      <path d="M8.8 13.5h6.4" />
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
