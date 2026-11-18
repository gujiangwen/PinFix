import { useI18n, type Locale } from "../../i18n";
import { useTheme, type Theme } from "../../theme";

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

export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div className="panel">
      <h2>{t("settings.section.appearance")}</h2>
      <fieldset className="choice">
        <legend>{t("chrome.lang")}</legend>
        {LOCALES.map((l) => (
          <label key={l.id}>
            <input
              type="radio"
              name="locale"
              checked={locale === l.id}
              onChange={() => setLocale(l.id)}
            />
            {l.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="choice">
        <legend>{t("chrome.theme")}</legend>
        {THEMES.map((th) => (
          <label key={th.id}>
            <input
              type="radio"
              name="theme"
              checked={theme === th.id}
              onChange={() => setTheme(th.id)}
            />
            {t(th.label)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
