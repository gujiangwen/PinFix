import { useState } from "react";
import { useI18n } from "../../i18n";
import { promptInstall, useInstallState, type InstallOutcome } from "../../pwa";

const OUTCOME_TEXT = {
  installed: "install.done",
  dismissed: "install.dismissed",
  failed: "install.failed",
} as const satisfies Record<InstallOutcome, string>;

export function AppearanceSection() {
  return <InstallApp />;
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
