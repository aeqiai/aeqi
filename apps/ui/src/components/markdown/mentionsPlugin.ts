import type { Root, Element, Text, ElementContent, Parent } from "hast";

const LINK_RE = /(!?)\[\[([^[\]\n]+)\]\]/g;

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
    const name = m[2].trim();
    const tag = isEmbed ? "idea-embed" : "idea-mention";
    const el: Element = {
      type: "element",
      tagName: tag,
      properties: { name },
      children: [{ type: "text", value: name }],
    };
    out.push(el);
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
 * Rehype plugin that turns `[[X]]` in idea content into an `idea-mention`
 * element and `![[X]]` into an `idea-embed` element. The parent
 * `RichMarkdown` renders those tags as chips and inline cards.
 *
 * Names are resolved to idea IDs at render time; the body keeps names
 * so agents can write references that make sense in prose even when the
 * target doesn't yet exist.
 */
export default function rehypeIdeaMentions() {
  return (tree: Root) => {
    walk(tree);
  };
}
