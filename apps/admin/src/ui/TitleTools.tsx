import { useId } from "react";
import { useI18n, type Locale } from "../i18n";
import { useTheme, type Theme } from "../theme";

// Language names stay in their own language so they are readable from either locale.
const LOCALES: { id: Locale; label: string }[] = [
  { id: "zh-CN", label: "中文" },
  { id: "en", label: "English" },
];

const THEMES: { id: Theme; label: "chrome.theme.light" | "chrome.theme.dark" }[] =
  [
    { id: "light", label: "chrome.theme.light" },
    { id: "dark", label: "chrome.theme.dark" },
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
          <label key={item.id}>
            <input
              type="radio"
              name={`${group}-locale`}
              checked={locale === item.id}
              onChange={() => setLocale(item.id)}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="title-switch">
        <legend>{t("chrome.theme")}</legend>
        {THEMES.map((item) => (
          <label key={item.id}>
            <input
              type="radio"
              name={`${group}-theme`}
              checked={theme === item.id}
              onChange={() => setTheme(item.id)}
            />
            {t(item.label)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
