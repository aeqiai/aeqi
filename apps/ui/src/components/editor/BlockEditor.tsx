import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { en } from "@blocknote/core/locales";
import type { Block, PartialBlock } from "@blocknote/core";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./blockEditor.theme.css";

/**
 * Reusable Notion-style block editor built on BlockNote (Tiptap +
 * ProseMirror). Drives the Idea body today; will drive the Quest
 * description body next.
 *
 * `initialContent` is forgiving — it accepts:
 *   • `null` → empty document
 *   • a serialized BlockNote JSON block tree → parsed and loaded
 *   • plaintext → wrapped as a single paragraph block
 *     (back-compat for ideas authored before BlockNote landed)
 *
 * `onChange` is debounced to ~400ms so we don't write on every keystroke.
 * The emitted string is the JSON-stringified block tree, ready to round
 * trip back through `initialContent` on next mount.
 */
export interface BlockEditorProps {
  initialContent: string | null;
  onChange: (jsonContent: string) => void;
  editable?: boolean;
  placeholder?: string;
  autofocus?: boolean;
}

const DEBOUNCE_MS = 400;

/**
 * Forgiving parser. BlockNote's own document type is `PartialBlock[]`;
 * we accept three shapes and normalize.
 */
function parseInitial(raw: string | null): PartialBlock[] | undefined {
  if (raw == null || raw === "") return undefined;
  // Try JSON first — the new shape.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as PartialBlock[];
    }
  } catch {
    /* fall through — plaintext path */
  }
  // Plaintext fallback. Split on blank lines into paragraph blocks so
  // multi-paragraph existing ideas don't collapse into one wall of text.
  const paragraphs = raw
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return [{ type: "paragraph", content: raw }];
  }
  return paragraphs.map((text) => ({ type: "paragraph", content: text }));
}

export default function BlockEditor({
  initialContent,
  onChange,
  editable = true,
  placeholder,
  autofocus = false,
}: BlockEditorProps) {
  const initial = useMemo(() => parseInitial(initialContent), [initialContent]);

  // Override only the empty-document placeholder. We deep-merge on top
  // of BlockNote's default `en` dictionary so every other label
  // (slash menu titles, drag-handle tooltips, etc.) keeps the
  // upstream copy.
  const dictionary = useMemo(() => {
    if (!placeholder) return undefined;
    return {
      ...en,
      placeholders: {
        ...en.placeholders,
        default: placeholder,
        emptyDocument: placeholder,
      },
    };
  }, [placeholder]);

  const editor = useCreateBlockNote({
    initialContent: initial,
    dictionary,
  });

  const debounceRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flushOnChange = useCallback((blocks: Block[]) => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      onChangeRef.current(JSON.stringify(blocks));
      debounceRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  // Wire BlockNote's onChange into our debounced emitter. The hook
  // returns the editor instance synchronously; subscribing here once
  // avoids re-binding on every render.
  useEffect(() => {
    if (!editor) return;
    return editor.onChange(() => {
      flushOnChange(editor.document);
    });
  }, [editor, flushOnChange]);

  // Flush on unmount so navigating away with an in-flight debounce
  // doesn't lose work.
  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        if (editor) {
          // Best-effort sync flush. The parent's save path may also
          // flush separately on unmount — both are idempotent because
          // the parent persists to a stable JSON shape.
          onChangeRef.current(JSON.stringify(editor.document));
        }
      }
    };
  }, [editor]);

  // Optional autofocus — defer past mount so the editor's ProseMirror
  // view is wired before we ask it to focus.
  useEffect(() => {
    if (!autofocus || !editor) return;
    requestAnimationFrame(() => {
      try {
        editor.focus();
      } catch {
        /* no-op — editor may not be ready */
      }
    });
  }, [autofocus, editor]);

  return (
    <div className="block-editor-root">
      <BlockNoteView editor={editor} editable={editable} theme="light" />
    </div>
  );
}
