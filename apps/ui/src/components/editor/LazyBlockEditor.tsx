import { Suspense, lazy } from "react";
import type { BlockEditorProps } from "./BlockEditor";
import { blockTreeToPlainText } from "./blockEditorContent";
import { Textarea } from "../ui";

/*
 * BlockEditor lives in its own chunk. The main bundle is already large
 * (Vite splits `react-vendor`, but app code keeps growing) — pulling
 * BlockNote + Tiptap + ProseMirror into a lazy chunk keeps the initial
 * boot path off them entirely. The wallet stack uses the same pattern;
 * see `WalletProvider` for the canonical reference.
 */
const BlockEditor = lazy(() => import("./BlockEditor"));

/**
 * Suspense fallback. While the editor chunk is loading we render a
 * read-only Textarea showing the plaintext content so a slow network
 * still presents *something* readable, not an empty loading frame. The textarea is
 * read-only — the user can't accidentally type into it and lose the
 * input on chunk arrival.
 */
function Fallback({
  initialContent,
  placeholder,
}: Pick<BlockEditorProps, "initialContent" | "placeholder">) {
  const text = blockTreeToPlainText(initialContent);
  return (
    <Textarea
      bare
      className="block-editor-fallback"
      value={text}
      readOnly
      placeholder={placeholder ?? "Type / for commands…"}
    />
  );
}

export default function LazyBlockEditor(props: BlockEditorProps) {
  return (
    <Suspense
      fallback={<Fallback initialContent={props.initialContent} placeholder={props.placeholder} />}
    >
      <BlockEditor {...props} />
    </Suspense>
  );
}
