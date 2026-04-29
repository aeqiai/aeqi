/**
 * Tiny frontmatter parser for Markdown imports.
 *
 * Intentionally not a `gray-matter` dep — Import flows only need to
 * read a flat key/value YAML-ish block, which a 10-line regex handles.
 * Supports:
 *   - Scalar strings (quoted or unquoted)
 *   - Inline arrays  (`tags: [a, b, c]`)
 *   - Block arrays   (`tags:` followed by `  - a` / `  - b` lines)
 *
 * Any deeper YAML feature (nested objects, anchors, multi-line strings)
 * is intentionally unsupported — fall back to the body if you need it.
 */
export interface ParsedFrontmatter {
  /** Body content with the frontmatter block stripped. */
  body: string;
  /** Parsed scalar / array fields. Empty when no frontmatter present. */
  data: Record<string, string | string[]>;
}

/** Match the leading `---\n...\n---` block. Newline-tolerant. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { body: raw, data: {} };
  const block = match[1];
  const body = raw.slice(match[0].length);
  return { body, data: parseBlock(block) };
}

function parseBlock(block: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const valueRaw = m[2].trim();

    // Inline array: tags: [a, b, "c"]
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      out[key] = parseInlineArray(valueRaw);
      i += 1;
      continue;
    }

    // Block array: tags:\n  - a\n  - b
    if (valueRaw === "") {
      const arr: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        arr.push(stripQuotes(lines[j].replace(/^\s*-\s+/, "").trim()));
        j += 1;
      }
      if (arr.length > 0) {
        out[key] = arr;
        i = j;
        continue;
      }
    }

    // Scalar.
    out[key] = stripQuotes(valueRaw);
    i += 1;
  }
  return out;
}

function parseInlineArray(s: string): string[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((p) => stripQuotes(p.trim()))
    .filter(Boolean);
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Coerce a frontmatter field to a string array — accepts string ("a, b"),
 *  array, or undefined. Empty entries dropped. */
export function asStringArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => x.trim()).filter(Boolean);
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
