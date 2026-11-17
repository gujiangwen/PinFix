/** Injected into closed Shadow DOM — host page CSS cannot reach these. */
export const TOOLBAR_CSS = `
:host, * { box-sizing: border-box; }
:host {
  all: initial;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  color: #e8eef7;
}

.sl-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
}

.sl-highlight {
  position: fixed;
  pointer-events: none;
  border: 2px solid #3dd6c6;
  background: rgba(61, 214, 198, 0.12);
  border-radius: 2px;
  z-index: 2147483645;
  transition: top 40ms linear, left 40ms linear, width 40ms linear, height 40ms linear;
}

.sl-toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(360px, calc(100vw - 24px));
  pointer-events: auto;
  background: linear-gradient(160deg, #152033 0%, #0d1522 100%);
  border: 1px solid rgba(61, 214, 198, 0.35);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sl-brand {
  font-family: "IBM Plex Serif", Georgia, serif;
  font-size: 15px;
  letter-spacing: 0.02em;
  color: #3dd6c6;
}

.sl-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.sl-btn {
  appearance: none;
  border: 1px solid rgba(232, 238, 247, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: #e8eef7;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.sl-btn:hover { background: rgba(61, 214, 198, 0.18); border-color: #3dd6c6; }
.sl-btn.primary {
  background: #3dd6c6;
  color: #0d1522;
  border-color: #3dd6c6;
  font-weight: 600;
}
.sl-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.sl-btn.danger {
  border-color: rgba(255, 120, 120, 0.45);
  color: #ffc9c9;
}
.sl-btn.danger:hover {
  background: rgba(255, 80, 80, 0.2);
  border-color: #ff8080;
}

.sl-review {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(61, 214, 198, 0.08);
  border: 1px solid rgba(61, 214, 198, 0.25);
}
.sl-review[hidden] { display: none !important; }
.sl-review-title {
  font-size: 12px;
  font-weight: 600;
  color: #3dd6c6;
}
.sl-review-summary {
  font-size: 11px;
  color: rgba(232, 238, 247, 0.75);
  line-height: 1.35;
}
.sl-review textarea {
  width: 100%;
  min-height: 44px;
  resize: vertical;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #e8eef7;
  font: inherit;
  padding: 6px;
}

.sl-dx {
  font-size: 11px;
  color: rgba(61, 214, 198, 0.9);
  letter-spacing: 0.02em;
  cursor: pointer;
  margin-bottom: 2px;
}

.sl-viz {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
  margin: 6px 0 8px;
  padding-right: 2px;
}
.sl-viz-block h4 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(61, 214, 198, 0.95);
  text-transform: none;
  letter-spacing: 0;
}
.sl-viz-body {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(232, 238, 247, 0.88);
}
.sl-viz-body.muted { color: rgba(232, 238, 247, 0.55); }
.sl-viz-body.ok { color: #3ecf8e; }
.sl-viz-body.bad { color: #e35d6a; }
.sl-viz-pre {
  margin: 4px 0 0;
  max-height: 100px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px;
}
.sl-viz-details summary {
  cursor: pointer;
  font-size: 11px;
  color: rgba(232, 238, 247, 0.65);
  margin-top: 4px;
}
.sl-diff-file {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
}
.sl-timeline {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 11px;
  display: grid;
  gap: 3px;
}
.sl-recall {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 4px;
}
.sl-distill {
  border: 1px solid rgba(61, 214, 198, 0.35);
  border-radius: 8px;
  padding: 8px;
  margin: 6px 0 8px;
  background: rgba(61, 214, 198, 0.08);
}
.sl-distill-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  color: #3dd6c6;
}
.muted { color: rgba(232, 238, 247, 0.55); }

.sl-status {
  font-size: 11px;
  color: rgba(232, 238, 247, 0.7);
  line-height: 1.35;
}

.sl-status strong { color: #e8eef7; }

.sl-queue {
  max-height: 140px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sl-item {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px;
  font-size: 11px;
}

.sl-item-title {
  font-weight: 600;
  margin-bottom: 4px;
  color: #c9f7f0;
}

.sl-item textarea {
  width: 100%;
  min-height: 44px;
  resize: vertical;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #e8eef7;
  font: inherit;
  padding: 6px;
}

.sl-item-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.sl-bubble {
  position: fixed;
  pointer-events: auto;
  z-index: 2147483647;
  width: 280px;
  background: #101a2b;
  border: 1px solid rgba(61, 214, 198, 0.4);
  border-radius: 10px;
  padding: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.sl-bubble h3 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #3dd6c6;
  font-family: "IBM Plex Serif", Georgia, serif;
}

.sl-bubble pre {
  margin: 0 0 8px;
  max-height: 90px;
  overflow: auto;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.sl-bubble textarea {
  width: 100%;
  min-height: 56px;
  resize: vertical;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #e8eef7;
  font: inherit;
  padding: 6px;
  margin-bottom: 8px;
}

.sl-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
}

.sl-loc {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.sl-loc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sl-loc-file {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #c9f7f0;
  word-break: break-all;
  flex: 1;
}
.sl-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.sl-badge.high {
  color: #0d1522;
  background: #3ecf8e;
  border-color: #3ecf8e;
}
.sl-badge.medium {
  color: #0d1522;
  background: #e6c35c;
  border-color: #e6c35c;
}
.sl-badge.low {
  color: #0d1522;
  background: #e35d6a;
  border-color: #e35d6a;
}
.sl-loc-hint {
  font-size: 10px;
  color: rgba(232, 238, 247, 0.55);
}
.sl-loc-search {
  width: 100%;
  margin-top: 4px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #e8eef7;
  font: inherit;
  font-size: 11px;
  padding: 5px 6px;
}
.sl-loc-results {
  margin: 4px 0 0;
  max-height: 90px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sl-loc-results button {
  appearance: none;
  text-align: left;
  border: 0;
  background: transparent;
  color: #c9f7f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: 4px;
}
.sl-loc-results button:hover {
  background: rgba(61, 214, 198, 0.15);
}
.sl-bubble { width: min(320px, calc(100vw - 24px)); }
`;
