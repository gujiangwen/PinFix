import { useId, type ReactNode } from "react";
import { useI18n, type Locale } from "../i18n";
import { useTheme, type Theme } from "../theme";

// Names stay available to hover and assistive tech. Language names stay in
// their own language so they are readable from either locale.
const LOCALES: { id: Locale; label: string; icon: ReactNode }[] = [
  { id: "zh-CN", label: "中文", icon: <LangZhIcon /> },
  { id: "en", label: "English", icon: <LangEnIcon /> },
];

const THEMES: {
  id: Theme;
  label: "chrome.theme.light" | "chrome.theme.dark";
  icon: ReactNode;
}[] = [
  { id: "light", label: "chrome.theme.light", icon: <SunIcon /> },
  { id: "dark", label: "chrome.theme.dark", icon: <MoonIcon /> },
];

/** Language and theme, kept on the title bar rather than in Settings. */
export function TitleTools() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const group = useId();

  return (
    <div className="title-tools">
      <fieldset className="title-switch">
        <legend>{t("chrome.lang")}</legend>
        {LOCALES.map((item) => (
          <label key={item.id} title={item.label}>
            <input
              type="radio"
              name={`${group}-locale`}
              checked={locale === item.id}
              aria-label={item.label}
              title={item.label}
              onChange={() => setLocale(item.id)}
            />
            {item.icon}
          </label>
        ))}
      </fieldset>
      <fieldset className="title-switch">
        <legend>{t("chrome.theme")}</legend>
        {THEMES.map((item) => {
          const label = t(item.label);
          return (
            <label key={item.id} title={label}>
              <input
                type="radio"
                name={`${group}-theme`}
                checked={theme === item.id}
                aria-label={label}
                title={label}
                onChange={() => setTheme(item.id)}
              />
              {item.icon}
            </label>
          );
        })}
      </fieldset>
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
