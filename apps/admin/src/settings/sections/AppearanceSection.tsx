import { useState } from "react";
import { useI18n, type Locale } from "../../i18n";
import { promptInstall, useInstallState, type InstallOutcome } from "../../pwa";
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

const OUTCOME_TEXT = {
  installed: "install.done",
  dismissed: "install.dismissed",
  failed: "install.failed",
} as const satisfies Record<InstallOutcome, string>;

export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <>
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
      <InstallApp />
    </>
  );
}

function InstallApp() {
  const { t } = useI18n();
  const state = useInstallState();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  async function onInstall() {
    if (busy) return;
    setBusy(true);
    // No await before this call: installing needs the click's user activation.
    const result = await promptInstall();
    setOutcome(result);
    setBusy(false);
  }

  return (
    <div className="panel">
      <h2>{t("install.title")}</h2>
      <p className="hint">{t("install.lede")}</p>
      {state === "available" ? (
        <button
          type="button"
          className="btn install-btn"
          // aria-disabled keeps focus on the button while the browser prompt is open.
          aria-disabled={busy}
          onClick={() => void onInstall()}
        >
          {t("install.button")}
        </button>
      ) : null}
      <p className="hint install-status" role="status">
        {outcome
          ? t(OUTCOME_TEXT[outcome])
          : state === "standalone"
            ? t("install.standalone")
            : state === "unavailable"
              ? t("install.unavailable")
              : ""}
      </p>
    </div>
  );
}
