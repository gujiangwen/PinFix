import { useEffect, useState } from "react";
import type { Metrics } from "@sightloop/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";

export function MetricsSection(props: { onError: (s: string) => void }) {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMetrics(await api.metrics());
      } catch (err) {
        props.onError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!metrics) return <p className="empty">{t("metrics.loading")}</p>;

  return (
    <div className="panel">
      <h2>{t("metrics.title")}</h2>
      <div className="metrics-grid">
        <Metric label={t("metrics.sessions")} value={String(metrics.sessions_total)} />
        <Metric
          label={t("metrics.failureRate")}
          value={`${Math.round(metrics.failure_rate * 1000) / 10}%`}
        />
        <Metric label={t("metrics.avgSteps")} value={String(metrics.avg_steps)} />
        <Metric
          label={t("metrics.knowledge")}
          value={String(metrics.knowledge_total)}
        />
        <Metric
          label={t("metrics.pinned")}
          value={String(metrics.knowledge_pinned)}
        />
        <Metric
          label={t("metrics.auditEvents")}
          value={String(metrics.audit_total)}
        />
        <Metric
          label={t("metrics.vec")}
          value={
            metrics.vec_ready
              ? t("metrics.vecReady", { count: metrics.vec_indexed ?? 0 })
              : t("metrics.vecUnavailable")
          }
        />
      </div>
      <h3 className="subhead">{t("metrics.byStatus")}</h3>
      <pre className="code-block">
        {JSON.stringify(metrics.sessions_by_status, null, 2)}
      </pre>
      <h3 className="subhead">{t("metrics.byDecision")}</h3>
      <pre className="code-block">
        {JSON.stringify(metrics.reviews_by_decision, null, 2)}
      </pre>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="muted">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
