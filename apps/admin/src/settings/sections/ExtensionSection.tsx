import { useEffect, useState } from "react";
import { api, type ExtensionInstallInfo } from "../../api";
import { useI18n } from "../../i18n";

export function ExtensionSection(props: {
  onError: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<ExtensionInstallInfo | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    props.onError("");
    try {
      setInfo(await api.getExtension());
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onBuild() {
    setBusy(true);
    props.onError("");
    try {
      const res = await api.buildExtension();
      setInfo(res.extension);
      props.onStatus(t("ext.builtOk"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    setBusy(true);
    props.onError("");
    try {
      const { blob, filename } = await api.downloadExtensionZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      props.onStatus(t("ext.downloaded"));
    } catch (err) {
      props.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCopyPath() {
    const path = info?.host_dist || info?.container_dist;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      props.onStatus(t("ext.copied"));
    } catch {
      props.onError(t("ext.copyFail"));
    }
  }

  const steps =
    info == null
      ? []
      : locale === "zh-CN"
        ? info.steps.zh
        : info.steps.en;

  return (
    <>
      <div className="panel">
        <div className="row between">
          <h2>{t("ext.title")}</h2>
          <div className="row">
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {t("ext.refresh")}
            </button>
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy}
              onClick={() => void onBuild()}
            >
              {t("ext.build")}
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={busy || !info?.zip_available}
              onClick={() => void onDownload()}
            >
              {t("ext.download")}
            </button>
            <button
              type="button"
              className="btn secondary tiny"
              disabled={busy || !(info?.host_dist || info?.container_dist)}
              onClick={() => void onCopyPath()}
            >
              {t("ext.copyPath")}
            </button>
          </div>
        </div>
        <p className="lede" style={{ marginBottom: "1rem" }}>
          {t("ext.lede")}
        </p>
        {!info ? (
          <p className="empty">{t("metrics.loading")}</p>
        ) : (
          <>
            <div className="meta-grid">
              <div>
                <span className="muted">{t("ext.built")}</span>
                <div>
                  <span className={`badge ${info.built ? "hmr" : "pr"}`}>
                    {info.built ? t("ext.built") : t("ext.notBuilt")}
                  </span>
                  {info.version ? (
                    <span className="muted"> · v{info.version}</span>
                  ) : null}
                </div>
              </div>
              <div>
                <span className="muted">{t("ext.hostPath")}</span>
                <div className="mono wrap">
                  {info.host_dist ?? "—"}
                </div>
              </div>
              <div>
                <span className="muted">{t("ext.containerPath")}</span>
                <div className="mono wrap">{info.container_dist}</div>
              </div>
            </div>
            <h3 className="subhead">{t("ext.limits")}</h3>
            <ul className="doc-list">
              <li>{t("ext.limit.silent")}</li>
              <li>{t("ext.limit.load")}</li>
              <li>{t("ext.limit.chromeUrl")}</li>
              <li>{t("ext.limit.crx")}</li>
            </ul>
            <h3 className="subhead">{t("ext.steps")}</h3>
            <ol className="doc-list">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        )}
      </div>
    </>
  );
}
