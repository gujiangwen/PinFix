import { sniffDom, type DomSniff } from "./dom.js";
import { sniffReact, type ReactSniff } from "./react.js";
import { sniffVue, type VueSniff } from "./vue.js";

export type { DomSniff } from "./dom.js";
export type { ReactSniff, ComponentFrame, DebugSource } from "./react.js";
export type { VueSniff, VueComponentFrame } from "./vue.js";
export {
  PROP_BLACKLIST,
  isBlacklistedKey,
  summarizeProps,
} from "./privacy.js";
export { buildSelector, buildDomPath } from "./dom.js";

export type SniffResult = ReactSniff | VueSniff | DomSniff;

/**
 * Waterfall: React Fiber → Vue 3 → generic DOM.
 * Call only in response to an explicit user pick gesture.
 */
export function sniffElement(el: Element): SniffResult {
  const react = sniffReact(el);
  if (react) return react;

  const vue = sniffVue(el);
  if (vue) return vue;

  return sniffDom(el);
}

export { sniffReact, sniffVue, sniffDom };
