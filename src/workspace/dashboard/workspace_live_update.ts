/** Browser-side reconciliation of safe, host-rendered progress without document reloads. */
export interface ProgressDomNode {
  readonly nodeType: number;
  readonly nodeName: string;
  nodeValue: string | null;
  readonly childNodes: ArrayLike<ProgressDomNode>;
  readonly attributes?: ArrayLike<{
    readonly name: string;
    readonly value: string;
  }>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  appendChild(node: ProgressDomNode): unknown;
  replaceChild(next: ProgressDomNode, previous: ProgressDomNode): unknown;
  removeChild(node: ProgressDomNode): unknown;
  cloneNode(deep: boolean): ProgressDomNode;
  contains?(node: ProgressDomNode): boolean;
  focus?(options: { readonly preventScroll: boolean }): void;
}

export interface ProgressDomDocument {
  getElementById(id: string): ProgressDomNode | null;
  createElement(tag: "template"): {
    innerHTML: string;
    readonly content: ProgressDomNode;
  };
  readonly activeElement?: ProgressDomNode | null;
  readonly scrollingElement?: {
    readonly scrollTop: number;
    readonly scrollLeft: number;
    scrollTo(options: { readonly top: number; readonly left: number }): void;
  } | null;
}

/** Self-contained: this exact function is injected into the nonce-authorized controller. */
export const applyOperationProgressUpdate = (
  document: ProgressDomDocument,
  message: unknown,
): boolean => {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).length !== 2 ||
    !Object.hasOwn(message, "type") ||
    !Object.hasOwn(message, "html")
  )
    return false;
  const update = message as { readonly type: unknown; readonly html: unknown };
  if (
    update.type !== "operationProgressUpdated" ||
    typeof update.html !== "string" ||
    update.html.trim().length === 0 ||
    update.html.length > 256 * 1024 ||
    new TextEncoder().encode(update.html).byteLength > 256 * 1024
  )
    return false;
  const root = document.getElementById("operation-progress");
  if (!root) return false;
  const template = document.createElement("template");
  template.innerHTML = update.html;
  const tags = new Set([
    "article",
    "div",
    "span",
    "p",
    "strong",
    "small",
    "h2",
    "dl",
    "dt",
    "dd",
    "details",
    "summary",
    "ol",
    "li",
    "time",
    "code",
  ]);
  let nodes = 0;
  const safe = (node: ProgressDomNode, depth: number): boolean => {
    if (++nodes > 20_000 || depth > 24) return false;
    if (node.nodeType === 3) return true;
    if (node.nodeType !== 1 || !tags.has(node.nodeName.toLowerCase()))
      return false;
    const attributes = Array.from(node.attributes ?? []);
    if (attributes.length > 4) return false;
    for (const { name, value } of attributes) {
      if (!(
        (name === "class" && /^[a-z\d _-]{0,240}$/iu.test(value)) ||
        (name === "role" && value === "status") ||
        (name === "aria-live" && value === "polite") ||
        (name === "aria-atomic" && ["true", "false"].includes(value)) ||
        (name === "datetime" &&
          node.nodeName.toLowerCase() === "time" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
          Number.isFinite(Date.parse(value)))
      ))
        return false;
    }
    return Array.from(node.childNodes).every((child) => safe(child, depth + 1));
  };
  const incoming = Array.from(template.content.childNodes);
  if (
    !incoming.some((node) => node.nodeType === 1) ||
    !incoming.every(
      (node) =>
        (node.nodeType === 3 && !node.nodeValue?.trim()) ||
        (node.nodeType === 1 &&
          node.nodeName.toLowerCase() === "article" &&
          safe(node, 0)),
    )
  )
    return false;
  const focused = document.activeElement;
  const focusedWithin = Boolean(focused && root.contains?.(focused));
  const scrolling = document.scrollingElement;
  const top = scrolling?.scrollTop ?? 0;
  const left = scrolling?.scrollLeft ?? 0;
  const reconcile = (
    current: ProgressDomNode,
    desired: ProgressDomNode,
  ): void => {
    const children = Array.from(desired.childNodes);
    for (const [index, next] of children.entries()) {
      const previous = current.childNodes[index];
      if (!previous) {
        current.appendChild(next.cloneNode(true));
      } else if (
        previous.nodeType !== next.nodeType ||
        previous.nodeName !== next.nodeName
      ) {
        current.replaceChild(next.cloneNode(true), previous);
      } else if (next.nodeType === 3) {
        if (previous.nodeValue !== next.nodeValue)
          previous.nodeValue = next.nodeValue;
      } else {
        const nextAttributes = Array.from(next.attributes ?? []);
        for (const attribute of Array.from(previous.attributes ?? [])) {
          // Expanded evidence is the user's choice, not part of a live receipt.
          if (
            previous.nodeName.toLowerCase() === "details" &&
            attribute.name === "open"
          )
            continue;
          if (!nextAttributes.some(({ name }) => name === attribute.name))
            previous.removeAttribute?.(attribute.name);
        }
        for (const { name, value } of nextAttributes) {
          if (previous.getAttribute?.(name) !== value)
            previous.setAttribute?.(name, value);
        }
        reconcile(previous, next);
      }
    }
    while (current.childNodes.length > children.length) {
      const extra = current.childNodes[current.childNodes.length - 1];
      if (extra) current.removeChild(extra);
    }
  };
  reconcile(root, template.content);
  if (focusedWithin && focused && !root.contains?.(focused))
    root.focus?.({ preventScroll: true });
  scrolling?.scrollTo({ top, left });
  return true;
};
