import { sniffDom, type DomSniff } from "./dom.js";
import { sniffReact, type ReactSniff } from "./react.js";
import { sniffVue, type VueSniff } from "./vue.js";
import {
  attachLocationToSniff,
  type SourceLocation,
} from "./location.js";

export type { DomSniff } from "./dom.js";
export type { ReactSniff, ComponentFrame, DebugSource } from "./react.js";
export type { VueSniff, VueComponentFrame } from "./vue.js";
export type { SourceLocation, LocationMethod, ConfidenceLevel } from "./location.js";
export {
  PROP_BLACKLIST,
  isBlacklistedKey,
  summarizeProps,
} from "./privacy.js";
export { buildSelector, buildDomPath } from "./dom.js";
export {
  attachLocationToSniff,
  locationFromDebugSource,
  locationFromVueFile,
  locationFromHeuristic,
  domFingerprint,
  confidenceLevel,
  normalizeRepoRelative,
} from "./location.js";
export {
  extractSourceMappingUrl,
  parseInlineSourceMap,
  collectPageSourceMappingUrls,
  pickSourceForComponent,
} from "./source-map.js";

export type SniffResult = (ReactSniff | VueSniff | DomSniff) & {
  location?: SourceLocation;
  fingerprint?: string;
};

/**
 * Waterfall: React Fiber → Vue 3 → generic DOM, then attach location + fingerprint.
 * Call only in response to an explicit user pick gesture.
 */
export function sniffElement(el: Element): SniffResult {
  let base: ReactSniff | VueSniff | DomSniff;
  const react = sniffReact(el);
  if (react) base = react;
  else {
    const vue = sniffVue(el);
    base = vue ?? sniffDom(el);
  }
  return attachLocationToSniff(base as unknown as Record<string, unknown>, el) as SniffResult;
}

export { sniffReact, sniffVue, sniffDom };
