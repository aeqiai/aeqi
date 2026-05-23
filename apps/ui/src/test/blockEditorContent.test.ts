import { describe, expect, it } from "vitest";
import { parseBlockEditorInitialContent } from "@/components/editor/blockEditorContent";

describe("parseBlockEditorInitialContent", () => {
  it("parses legacy markdown into structured blocks", () => {
    const blocks = parseBlockEditorInitialContent(
      `# Launch plan\n\n- Ship the core flow\n- Verify the route\n\nThis is **important**.\n\n[Docs](https://example.com)`,
    );

    expect(blocks).toBeTruthy();
    expect(blocks?.map((block) => block.type)).toEqual([
      "heading",
      "bulletListItem",
      "bulletListItem",
      "paragraph",
      "paragraph",
    ]);
    expect((blocks?.[0] as { props?: { level?: number } } | undefined)?.props?.level).toBe(1);
  });

  it("keeps plain prose as paragraphs", () => {
    const blocks = parseBlockEditorInitialContent("One paragraph.\n\nTwo paragraphs.");

    expect(blocks?.map((block) => block.type)).toEqual(["paragraph", "paragraph"]);
  });
});
