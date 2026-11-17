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
`;
