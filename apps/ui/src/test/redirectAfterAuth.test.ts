import { describe, expect, it } from "vitest";
import { buildAuthSwitchHref, getRedirectAfterAuth } from "@/lib/redirectAfterAuth";

describe("getRedirectAfterAuth", () => {
  it("keeps same-origin internal next paths", () => {
    expect(getRedirectAfterAuth(new URLSearchParams("next=/blueprints"))).toBe("/blueprints");
  });

  it("rejects unsafe next targets", () => {
    expect(getRedirectAfterAuth(new URLSearchParams("next=https://evil.test"), "/")).toBe("/");
    expect(getRedirectAfterAuth(new URLSearchParams("next=//evil.test"), "/")).toBe("/");
  });
});

describe("buildAuthSwitchHref", () => {
  it("preserves safe next when switching between auth modes", () => {
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("next=/blueprints"))).toBe(
      "/signup?next=%2Fblueprints",
    );
  });

  it("preserves invite only when switching into signup", () => {
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("invite=founder"))).toBe(
      "/signup?invite=founder",
    );
    expect(buildAuthSwitchHref("/login", new URLSearchParams("invite=founder"))).toBe("/login");
  });
});
