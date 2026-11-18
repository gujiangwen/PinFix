import { useEffect, useRef } from "react";
import { useI18n, type TranslateFn } from "../i18n";
import { fmtDuration } from "../ui/format";
import { DECISION_LABEL, NODE_LABEL, STATE_LABEL } from "./labels";
import {
  NODE_IDS,
  type LoopNode,
  type LoopRound,
  type NodeId,
  type NodeState,
} from "./loop-model";

const STATE_GLYPH: Record<NodeState, string> = {
  pending: "",
  active: "",
  done: "✓",
  warn: "↺",
  failed: "✕",
  off: "–",
};

/** What a node says under its name; the human node speaks in decisions. */
export function nodeStateText(
  t: TranslateFn,
  node: LoopNode,
  round: LoopRound,
): string {
  if (node.id === "human") {
    if (round.decision) return t(DECISION_LABEL[round.decision.decision]);
    if (node.state === "active") return t("loop.human.waiting");
  }
  return t(STATE_LABEL[node.state]);
}

export function LoopTrack(props: {
  rounds: LoopRound[];
  roundIndex: number;
  selected: NodeId;
  onSelectRound: (index: number) => void;
  onSelectNode: (id: NodeId) => void;
}) {
  const { t } = useI18n();
  const round = props.rounds[props.roundIndex]!;
  const scroller = useRef<HTMLDivElement>(null);

  // On narrow screens the track scrolls sideways; keep the selected node in
  // view without scrollIntoView, which would also move the page vertically.
  useEffect(() => {
    const box = scroller.current;
    // The step's offsetParent is the scroller (the nearest positioned ancestor).
    const step = box?.querySelector<HTMLElement>(".track-step.selected");
    if (!box || !step || box.scrollWidth <= box.clientWidth) return;
    const left = step.offsetLeft;
    const right = left + step.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left;
    else if (right > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = right - box.clientWidth;
    }
  }, [props.selected, props.roundIndex]);

  return (
    <div className="track-wrap">
      {props.rounds.length > 1 ? (
        <div className="rounds" role="group" aria-label={t("loop.rounds")}>
          {props.rounds.map((r, i) => (
            <button
              key={r.number}
              type="button"
              className={`round-chip ${i === props.roundIndex ? "active" : ""}`}
              aria-pressed={i === props.roundIndex}
              onClick={() => props.onSelectRound(i)}
            >
              {t("loop.round", { n: r.number })}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="track-scroll"
        ref={scroller}
        role="region"
        aria-label={t("loop.track")}
        tabIndex={0}
      >
        <ol className="track">
          {NODE_IDS.map((id) => {
            const node = round.nodes[id];
            const selected = id === props.selected;
            return (
              <li
                key={id}
                className={`track-step state-${node.state} ${selected ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className={`node ${selected ? "selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => props.onSelectNode(id)}
                >
                  <span className="node-mark" aria-hidden="true">
                    {STATE_GLYPH[node.state]}
                  </span>
                  <span className="node-name">{t(NODE_LABEL[id])}</span>
                  <span className="node-meta">
                    {nodeStateText(t, node, round)}
                    {node.durationMs != null
                      ? ` · ${fmtDuration(node.durationMs)}`
                      : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
