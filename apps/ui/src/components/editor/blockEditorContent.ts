/**
 * Helpers for the dual-shape `idea.content` field.
 *
 * Phase 1 stores serialized BlockNote JSON when an idea has been
 * touched after this ship, but legacy ideas still hold plaintext (with
 * markdown sprinkles). Every read site that wants a flat string for
 * preview / search / truncation goes through `blockTreeToPlainText`
 * here so the dual shape stays a single concern.
 */

interface InlineLike {
  type?: string;
  text?: string;
  content?: unknown;
}

interface BlockLike {
  type?: string;
  content?: unknown;
  children?: unknown;
}

/** Best-effort plaintext extractor for BlockNote inline content. */
function inlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  let out = "";
  for (const node of value as InlineLike[]) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.text === "string") {
      out += node.text;
      continue;
    }
    // Mention / link / styled-text — fall back to nested content.
    if (node.content !== undefined) {
      out += inlineText(node.content);
    }
  }
  return out;
}

/** Walk a BlockNote document and emit one paragraph of text per block. */
function walkBlocks(blocks: BlockLike[] | unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  const out: string[] = [];
  for (const block of blocks as BlockLike[]) {
    if (!block || typeof block !== "object") continue;
    const inline = inlineText(block.content);
    if (inline.trim().length > 0) out.push(inline);
    if (Array.isArray(block.children) && block.children.length > 0) {
      out.push(...walkBlocks(block.children));
    }
  }
  return out;
}

/**
 * Extract plaintext from the dual-shape content field. Returns `""`
 * for null / empty input. Plaintext input is returned as-is.
 */
export function blockTreeToPlainText(raw: string | null | undefined): string {
  if (!raw) return "";
  // JSON path — try first, fall through on parse failure.
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return walkBlocks(parsed).join("\n\n");
      }
    } catch {
      /* fall through */
    }
  }
  return raw;
}

/**
 * Truncate a string to ~`max` characters, breaking on word boundaries
 * where possible. Used by preview cards.
 */
export function truncatePreview(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.6) return cut.slice(0, lastSpace) + "…";
  return cut + "…";
}
