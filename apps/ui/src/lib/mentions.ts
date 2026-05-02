/**
 * @-mention parser for the UI layer.
 *
 * Mirrors the token grammar of the Rust parser in
 * `crates/aeqi-orchestrator/src/mentions.rs` so rendering is consistent
 * with what the backend persisted. Pure function — no network, no state.
 *
 * Recognised shapes:
 *   @agent:<id>         → kind="agent",    id=<id>
 *   @user:<id>          → kind="user",     id=<id>
 *   @position(<title>)  → kind="position", id=<title>
 *   @<name>             → kind="fuzzy",    id=<name>   (display as-is)
 */

export type MentionKind = "agent" | "user" | "position" | "fuzzy";

export interface MentionToken {
  kind: MentionKind;
  /** Resolved entity id, user id, position title, or bare name. */
  id: string;
  /** The verbatim text matched, including the leading `@`. */
  rawText: string;
  /** Start index in the body string. */
  start: number;
  /** End index (exclusive) in the body string. */
  end: number;
}

/**
 * One segment of a rendered body: either plain text or a mention token.
 */
export type BodySegment = { kind: "text"; text: string } | { kind: "mention"; token: MentionToken };

/** Characters that end a mention token. */
function isTerminal(ch: string): boolean {
  return /[\s,;!?'"()[\]{}]/.test(ch);
}

/** True when the character is a word character (prevents `word@foo` matching). */
function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

export function parseMentions(body: string): MentionToken[] {
  const out: MentionToken[] = [];
  const seen = new Set<string>();
  const len = body.length;

  let i = 0;
  while (i < len) {
    if (body[i] !== "@") {
      i++;
      continue;
    }
    // Guard: don't match `word@foo`.
    if (i > 0 && isWordChar(body[i - 1])) {
      i++;
      continue;
    }
    const atPos = i;
    const tokenStart = i + 1;
    if (tokenStart >= len || isTerminal(body[tokenStart])) {
      i++;
      continue;
    }

    // @agent:<id> or @user:<id>
    const prefixMatch = body.slice(tokenStart).match(/^(agent|user):/);
    if (prefixMatch) {
      const kind = prefixMatch[1] as "agent" | "user";
      const idStart = tokenStart + prefixMatch[0].length;
      let idEnd = idStart;
      while (idEnd < len && !isTerminal(body[idEnd])) idEnd++;
      const id = body.slice(idStart, idEnd);
      if (id) {
        const key = `${kind}:${id.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            kind,
            id,
            rawText: body.slice(atPos, idEnd),
            start: atPos,
            end: idEnd,
          });
        }
        i = idEnd;
        continue;
      }
    }

    // @position(<title>)
    if (body.slice(tokenStart).startsWith("position(")) {
      const parenOpen = tokenStart + "position(".length;
      const parenClose = body.indexOf(")", parenOpen);
      if (parenClose !== -1) {
        const title = body.slice(parenOpen, parenClose).trim();
        if (title) {
          const end = parenClose + 1;
          const key = `position:${title.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              kind: "position",
              id: title,
              rawText: body.slice(atPos, end),
              start: atPos,
              end,
            });
          }
          i = end;
          continue;
        }
      }
    }

    // Bare @<name>
    let nameEnd = tokenStart;
    while (nameEnd < len && !isTerminal(body[nameEnd])) nameEnd++;
    // Strip trailing dot.
    let name = body.slice(tokenStart, nameEnd);
    if (name.endsWith(".")) {
      name = name.slice(0, -1);
      nameEnd = tokenStart + name.length;
    }
    if (name) {
      const end = atPos + 1 + name.length;
      const key = `fuzzy:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          kind: "fuzzy",
          id: name,
          rawText: body.slice(atPos, end),
          start: atPos,
          end,
        });
      }
    }
    i = nameEnd;
  }

  return out;
}

/**
 * Split a body string into alternating text and mention segments, in
 * document order. Used by rendering components to produce inline spans.
 */
export function splitBodyIntoSegments(body: string): BodySegment[] {
  const tokens = parseMentions(body);
  if (tokens.length === 0) {
    return [{ kind: "text", text: body }];
  }

  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, token.start) });
    }
    segments.push({ kind: "mention", token });
    cursor = token.end;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}
