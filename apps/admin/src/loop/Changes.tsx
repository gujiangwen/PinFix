import type { DiffSummary } from "@sightloop/shared";
import { useI18n } from "../i18n";

const MAX_PATCH_LINES = 1500;

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-file";
  if (line.startsWith("diff --git")) return "diff-file";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "";
}

/** The session's code change: per-file totals, then the patch itself. */
export function Changes(props: {
  summary: DiffSummary | null;
  patch: string | null;
  /** Show the patch expanded, for when it is the thing being reviewed. */
  open?: boolean;
}) {
  const { t } = useI18n();
  const { summary, patch } = props;

  if (!summary || summary.files.length === 0) {
    return <p className="muted">{t("loop.changes.none")}</p>;
  }

  const lines = patch ? patch.split("\n") : [];
  const shown = lines.slice(0, MAX_PATCH_LINES);

  return (
    <div className="changes">
      <p className="changes-total">
        {t("loop.changes.total", { files: summary.files.length })}{" "}
        <span className="diff-add">+{summary.additions}</span>{" "}
        <span className="diff-del">−{summary.deletions}</span>
      </p>
      <ul className="file-list">
        {summary.files.map((f) => (
          <li key={f.path}>
            <span className="mono wrap">{f.path}</span>
            <span className="diff-add">+{f.additions}</span>
            <span className="diff-del">−{f.deletions}</span>
          </li>
        ))}
      </ul>
      {summary.truncated ? (
        <p className="hint">{t("loop.changes.moreFiles")}</p>
      ) : null}
      {patch ? (
        <details className="fold" open={props.open}>
          <summary>{t("loop.changes.patch")}</summary>
          <pre className="code-block diff">
            {shown.map((line, i) => (
              <span key={i} className={lineClass(line)}>
                {line}
                {"\n"}
              </span>
            ))}
          </pre>
          {lines.length > shown.length ? (
            <p className="hint">
              {t("loop.changes.truncated", {
                shown: shown.length,
                total: lines.length,
              })}
            </p>
          ) : null}
        </details>
      ) : (
        <p className="hint">{t("sessions.diffUnavailable")}</p>
      )}
    </div>
  );
}
