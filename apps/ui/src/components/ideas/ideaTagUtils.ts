export function extractHashtags(text: string): string[] {
  const re = /(?:^|\s)#([a-z0-9_-]+)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].toLowerCase());
  return Array.from(out);
}

export function mergeTags(body: string, typed: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...typed, ...extractHashtags(body)]) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
