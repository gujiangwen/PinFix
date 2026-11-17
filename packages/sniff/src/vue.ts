import { summarizeProps } from "./privacy.js";
import { buildDomPath, buildSelector } from "./dom.js";

export type VueComponentFrame = {
  name: string;
  file?: string;
  props?: Record<string, unknown>;
};

export type VueSniff = {
  framework: "vue3";
  componentStack: VueComponentFrame[];
  selector: string;
  domPath: string;
};

type VueInstance = {
  type?: {
    __name?: string;
    name?: string;
    __file?: string;
  };
  vnode?: { type?: { __name?: string; name?: string; __file?: string } };
  props?: Record<string, unknown>;
  parent?: VueInstance | null;
};

const MAX_STACK = 16;

export function getVueParent(el: Element): VueInstance | null {
  const record = el as unknown as Record<string, unknown>;
  const direct = record.__vueParentComponent;
  if (direct && typeof direct === "object") return direct as VueInstance;

  // Some builds expose __vue_app__ on root only; walk parents for __vueParentComponent.
  let node: Element | null = el.parentElement;
  while (node) {
    const parent = (node as unknown as Record<string, unknown>)
      .__vueParentComponent;
    if (parent && typeof parent === "object") return parent as VueInstance;
    node = node.parentElement;
  }
  return null;
}

export function sniffVue(el: Element): VueSniff | null {
  const root = getVueParent(el);
  if (!root) return null;

  const componentStack: VueComponentFrame[] = [];
  let cursor: VueInstance | null = root;

  while (cursor && componentStack.length < MAX_STACK) {
    const type = cursor.type ?? cursor.vnode?.type;
    const name =
      type?.__name || type?.name || (type as { name?: string } | undefined)?.name;
    if (name) {
      const file = type?.__file;
      componentStack.push({
        name,
        ...(file ? { file } : {}),
        props: summarizeProps(cursor.props),
      });
    }
    cursor = cursor.parent ?? null;
  }

  if (componentStack.length === 0) return null;

  return {
    framework: "vue3",
    componentStack,
    selector: buildSelector(el),
    domPath: buildDomPath(el),
  };
}
