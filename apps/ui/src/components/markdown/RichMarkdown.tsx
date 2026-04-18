import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import type { Idea } from "@/lib/types";
import { IdeaMention, IdeaEmbed } from "./IdeaRef";
import rehypeIdeaMentions from "./mentionsPlugin";

export type RichMarkdownVariant = "session" | "idea";

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "";
  const code = String(children).replace(/\n$/, "");
  return (
    <div className="asv-codeblock">
      <div className="asv-codeblock-header">
        <span className="asv-codeblock-lang">{lang}</span>
        <button
          className="asv-codeblock-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function buildComponents(
  variant: RichMarkdownVariant,
  ideasByName?: Map<string, Idea>,
  agentId?: string,
) {
  const withCodeBlock = variant === "session";
  return {
    code({ className, children, ...props }: any) {
      const isBlock = className?.startsWith("language-");
      if (isBlock && withCodeBlock) {
        return <CodeBlock className={className}>{children}</CodeBlock>;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }: any) {
      return withCodeBlock ? <>{children}</> : <pre>{children}</pre>;
    },
    "idea-mention"({ name }: any) {
      return <IdeaMention name={String(name ?? "")} ideasByName={ideasByName} agentId={agentId} />;
    },
    "idea-embed"({ name }: any) {
      return <IdeaEmbed name={String(name ?? "")} ideasByName={ideasByName} agentId={agentId} />;
    },
  } as any;
}

const REHYPE_PLUGINS = [rehypeIdeaMentions];

/**
 * Shared markdown renderer. Used by both the session transcript and the
 * idea canvas so one pipeline controls how agent-authored content looks
 * everywhere in the app.
 *
 * - `variant="session"` enables the code-block copy button.
 * - `[[X]]` renders as a clickable chip; `![[X]]` as an inline card.
 *   Name → idea resolution comes from `ideasByName`; missing names get
 *   a broken-link style so users catch typos.
 */
export function RichMarkdown({
  body,
  variant = "idea",
  ideasByName,
  agentId,
}: {
  body: string;
  variant?: RichMarkdownVariant;
  ideasByName?: Map<string, Idea>;
  agentId?: string;
}) {
  const components = useMemo(
    () => buildComponents(variant, ideasByName, agentId),
    [variant, ideasByName, agentId],
  );
  return (
    <Markdown rehypePlugins={REHYPE_PLUGINS} components={components}>
      {body}
    </Markdown>
  );
}

/** Build a lowercase-name → Idea lookup from a list of ideas. */
export function buildIdeasByName(ideas: Idea[] | undefined): Map<string, Idea> {
  const out = new Map<string, Idea>();
  for (const idea of ideas ?? []) {
    out.set(idea.name.toLowerCase(), idea);
  }
  return out;
}
