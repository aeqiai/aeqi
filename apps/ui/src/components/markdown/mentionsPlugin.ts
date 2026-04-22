import type { Root, Element, Text, ElementContent, Parent } from "hast";

// UUID-loose pattern — lowercase hex groups separated by hyphens.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_KINDS = new Set(["agent", "event", "idea", "quest"]);

/**
 * Token forms:
 *   [[aeqi:idea:<uuid>]]    → aeqi-ref  (kind=idea, id=<uuid>)
 *   [[aeqi:event:<uuid>]]   → aeqi-ref  (kind=event, id=<uuid>)
 *   [[aeqi:agent:<uuid>]]   → aeqi-ref  (kind=agent, id=<uuid>)
 *   [[aeqi:quest:<uuid>]]   → aeqi-ref  (kind=quest, id=<uuid>)
 *   [[aeqi:<uuid>]]         → aeqi-ref  (kind=null, id=<uuid>)
 *   ![[name]]               → idea-embed
 *   [[name]]                → idea-mention
 */
const LINK_RE = /(!?)\[\[([^[\]\n]+)\]\]/g;

function parseToken(isEmbed: boolean, inner: string): Element {
  const trimmed = inner.trim();

  // Check for aeqi-typed refs: [[aeqi:kind:uuid]] or [[aeqi:uuid]]
  if (trimmed.startsWith("aeqi:")) {
    const rest = trimmed.slice(5); // strip "aeqi:"
    const parts = rest.split(":");
    if (parts.length === 2 && VALID_KINDS.has(parts[0]) && UUID_RE.test(parts[1])) {
      // [[aeqi:kind:uuid]]
      return {
        type: "element",
        tagName: "aeqi-ref",
        properties: { kind: parts[0], id: parts[1] },
        children: [{ type: "text", value: trimmed }],
      };
    }
    if (parts.length === 1 && UUID_RE.test(parts[0])) {
      // [[aeqi:uuid]]
      return {
        type: "element",
        tagName: "aeqi-ref",
        properties: { kind: null, id: parts[0] },
        children: [{ type: "text", value: trimmed }],
      };
    }
  }

  // Legacy idea mention / embed
  const tag = isEmbed ? "idea-embed" : "idea-mention";
  return {
    type: "element",
    tagName: tag,
    properties: { name: trimmed },
    children: [{ type: "text", value: trimmed }],
  };
}

function splitTextNode(node: Text): ElementContent[] {
  const text = node.value;
  if (!text.includes("[[")) return [node];
  const out: ElementContent[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    const isEmbed = m[1] === "!";
    const inner = m[2];
    out.push(parseToken(isEmbed, inner));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out;
}

function isSkippable(node: Element): boolean {
  return node.tagName === "code" || node.tagName === "pre";
}

function walk(node: Parent): void {
  const next: (typeof node.children)[number][] = [];
  let changed = false;
  for (const child of node.children) {
    if (child.type === "text") {
      const split = splitTextNode(child);
      if (split.length !== 1 || split[0] !== child) changed = true;
      for (const s of split) next.push(s as (typeof node.children)[number]);
    } else {
      if (
        child.type === "element" &&
        !isSkippable(child as Element) &&
        "children" in child &&
        Array.isArray((child as Parent).children)
      ) {
        walk(child as Parent);
      } else if (
        child.type !== "element" &&
        "children" in child &&
        Array.isArray((child as Parent).children)
      ) {
        walk(child as Parent);
      }
      next.push(child);
    }
  }
  if (changed) node.children = next;
}

/**
 * Rehype plugin that turns inline `[[...]]` tokens into typed hast elements:
 *
 *  - `[[aeqi:kind:uuid]]` / `[[aeqi:uuid]]` → `<aeqi-ref kind="…" id="…">`
 *  - `[[name]]`   → `<idea-mention name="…">`
 *  - `![[name]]`  → `<idea-embed name="…">`
 *
 * The parent `RichMarkdown` maps each tag name to its React component.
 */
export default function rehypeIdeaMentions() {
  return (tree: Root) => {
    walk(tree);
  };
}
