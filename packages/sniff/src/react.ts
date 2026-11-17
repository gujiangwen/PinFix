import { summarizeProps } from "./privacy.js";
import { buildDomPath, buildSelector } from "./dom.js";

export type DebugSource = {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
};

export type ComponentFrame = {
  name: string;
  key?: string | null;
  props?: Record<string, unknown>;
};

export type ReactSniff = {
  framework: "react";
  componentStack: ComponentFrame[];
  debugSource?: DebugSource;
  selector: string;
  domPath: string;
};

type FiberLike = {
  type?: unknown;
  elementType?: unknown;
  key?: string | null;
  memoizedProps?: Record<string, unknown> | null;
  pendingProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
  _debugSource?: DebugSource | null;
  tag?: number;
};

const MAX_STACK = 16;

export function getReactFiber(el: Element): FiberLike | null {
  const record = el as unknown as Record<string, unknown>;
  // React expandos are often non-enumerable — use ownKeys, not Object.keys.
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") continue;
    if (
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$")
    ) {
      return (record[key] as FiberLike) ?? null;
    }
  }
  return null;
}

export function sniffReact(el: Element): ReactSniff | null {
  const fiber = getReactFiber(el);
  if (!fiber) return null;

  const componentStack: ComponentFrame[] = [];
  let debugSource: DebugSource | undefined;
  let cursor: FiberLike | null = fiber;

  while (cursor && componentStack.length < MAX_STACK) {
    const name = fiberDisplayName(cursor);
    if (name && !isHostFiber(cursor)) {
      const propsRaw = cursor.memoizedProps ?? cursor.pendingProps ?? null;
      componentStack.push({
        name,
        key: cursor.key ?? null,
        props: summarizeProps(propsRaw ?? undefined),
      });
      if (!debugSource && cursor._debugSource?.fileName) {
        debugSource = {
          fileName: cursor._debugSource.fileName,
          lineNumber: cursor._debugSource.lineNumber,
          ...(cursor._debugSource.columnNumber !== undefined
            ? { columnNumber: cursor._debugSource.columnNumber }
            : {}),
        };
      }
    }
    cursor = cursor.return ?? null;
  }

  if (componentStack.length === 0) return null;

  return {
    framework: "react",
    componentStack,
    ...(debugSource ? { debugSource } : {}),
    selector: buildSelector(el),
    domPath: buildDomPath(el),
  };
}

function fiberDisplayName(fiber: FiberLike): string | null {
  const type = fiber.type ?? fiber.elementType;
  if (!type) return null;
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || "Anonymous";
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as {
      displayName?: string;
      name?: string;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string };
    };
    return (
      obj.displayName ||
      obj.name ||
      obj.render?.displayName ||
      obj.render?.name ||
      obj.type?.displayName ||
      obj.type?.name ||
      "Anonymous"
    );
  }
  return null;
}

/** Host / DOM fibers (tag 5 = HostComponent in React reconciler). */
function isHostFiber(fiber: FiberLike): boolean {
  if (typeof fiber.type === "string") return true;
  return fiber.tag === 5 || fiber.tag === 6;
}
