import { describe, expect, it } from "vitest";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";

describe("parseFrontmatter", () => {
  it("returns body untouched when no frontmatter is present", () => {
    const { body, data } = parseFrontmatter("# Heading\n\nbody");
    expect(body).toBe("# Heading\n\nbody");
    expect(data).toEqual({});
  });

  it("parses scalar fields and strips quotes", () => {
    const md = `---\ntitle: "My Idea"\nsummary: short and sharp\n---\nbody`;
    const { body, data } = parseFrontmatter(md);
    expect(body).toBe("body");
    expect(data.title).toBe("My Idea");
    expect(data.summary).toBe("short and sharp");
  });

  it("parses inline arrays", () => {
    const md = `---\ntags: [voice, "skill", evergreen]\n---\nbody`;
    const { data } = parseFrontmatter(md);
    expect(data.tags).toEqual(["voice", "skill", "evergreen"]);
  });

  it("parses block arrays", () => {
    const md = `---\ntags:\n  - voice\n  - skill\n---\nbody`;
    const { data } = parseFrontmatter(md);
    expect(data.tags).toEqual(["voice", "skill"]);
  });

  it("strips the frontmatter block from the body", () => {
    const md = `---\ntitle: x\n---\n# Heading\n\ncontent`;
    const { body } = parseFrontmatter(md);
    expect(body).toBe("# Heading\n\ncontent");
  });
});

describe("asStringArray", () => {
  it("returns [] for undefined", () => {
    expect(asStringArray(undefined)).toEqual([]);
  });

  it("passes arrays through", () => {
    expect(asStringArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("splits comma strings", () => {
    expect(asStringArray("a, b , c")).toEqual(["a", "b", "c"]);
  });
});
