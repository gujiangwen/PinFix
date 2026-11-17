const OUTER_HTML_LIMIT = 2048;

export type DomSniff = {
  framework: "unknown";
  selector: string;
  domPath: string;
  outerHTML: string;
  tagName: string;
  textPreview?: string;
};

export function sniffDom(el: Element): DomSniff {
  const selector = buildSelector(el);
  const domPath = buildDomPath(el);
  const raw = el.outerHTML ?? "";
  const outerHTML =
    raw.length > OUTER_HTML_LIMIT
      ? `${raw.slice(0, OUTER_HTML_LIMIT)}…`
      : raw;

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const textPreview =
    text.length > 0
      ? text.length > 120
        ? `${text.slice(0, 120)}…`
        : text
      : undefined;

  return {
    framework: "unknown",
    selector,
    domPath,
    outerHTML,
    tagName: el.tagName.toLowerCase(),
    ...(textPreview ? { textPreview } : {}),
  };
}

export function buildSelector(el: Element): string {
  if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id)) {
    return `#${CSS.escape(el.id)}`;
  }

  const testId =
    el.getAttribute("data-testid") ??
    el.getAttribute("data-test-id") ??
    el.getAttribute("data-test");
  if (testId) {
    return `[data-testid="${cssAttr(testId)}"]`;
  }

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    if (node.id && /^[A-Za-z][\w:-]*$/.test(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    const stable = stableClass(node);
    if (stable) part += `.${CSS.escape(stable)}`;
    parts.unshift(part);
    node = parent;
    if (!node || node === document.documentElement) break;
  }
  return parts.join(" > ");
}

export function buildDomPath(el: Element): string {
  const names: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && names.length < 12) {
    let name = node.tagName.toLowerCase();
    if (node.id) name += `#${node.id}`;
    else {
      const testId = node.getAttribute("data-testid");
      if (testId) name += `[testid=${testId}]`;
    }
    names.unshift(name);
    node = node.parentElement;
  }
  return names.join(" / ");
}

function stableClass(el: Element): string | undefined {
  const list = Array.from(el.classList);
  return list.find(
    (c) =>
      c.length > 1 &&
      c.length < 40 &&
      !/^css-/.test(c) &&
      !/^emotion-/.test(c) &&
      !/^sc-/.test(c) &&
      !/^[a-f0-9]{6,}$/i.test(c),
  );
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
