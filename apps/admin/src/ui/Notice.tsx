import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";

export type Notice = { kind: "ok" | "error"; text: string };

const OK_DISMISS_MS = 5000;

/**
 * Inline feedback for the panel callbacks (`onStatus` / `onError`).
 * Confirmations clear themselves; errors stay until dismissed or replaced.
 */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const timer = setTimeout(() => setNotice(null), OK_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Panels call onError("") before each request to reset the previous error.
  const onError = useCallback((text: string) => {
    setNotice((prev) =>
      text ? { kind: "error", text } : prev?.kind === "error" ? null : prev,
    );
  }, []);

  const onStatus = useCallback((text: string) => {
    if (text) setNotice({ kind: "ok", text });
  }, []);

  const clear = useCallback(() => setNotice(null), []);

  return { notice, onError, onStatus, clear };
}

export function NoticeBar(props: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const { notice } = props;
  // The live region stays mounted so screen readers announce text set later.
  return (
    <div
      className={`notice ${notice ? notice.kind : "empty"}`}
      role={notice?.kind === "error" ? "alert" : "status"}
    >
      {notice ? (
        <>
          <span className="notice-text">{notice.text}</span>
          <button
            type="button"
            className="notice-close"
            aria-label={t("notice.dismiss")}
            onClick={props.onDismiss}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
