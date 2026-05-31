import { describe, expect, it } from "vitest";
import { buildAuthSwitchHref, getRedirectAfterAuth } from "@/lib/redirectAfterAuth";

describe("getRedirectAfterAuth", () => {
  it("keeps same-origin internal next paths", () => {
    expect(getRedirectAfterAuth(new URLSearchParams("next=/templates"))).toBe("/templates");
  });

  it("rejects unsafe next targets", () => {
    expect(getRedirectAfterAuth(new URLSearchParams("next=https://evil.test"), "/")).toBe("/");
    expect(getRedirectAfterAuth(new URLSearchParams("next=//evil.test"), "/")).toBe("/");
  });
});

describe("buildAuthSwitchHref", () => {
  it("preserves safe next when switching between auth modes", () => {
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("next=/templates"))).toBe(
      "/signup?next=%2Ftemplates",
    );
  });

  it("preserves invite only when switching into signup", () => {
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("invite=founder"))).toBe(
      "/signup?invite=founder",
    );
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("invite_code=founder"))).toBe(
      "/signup?invite=founder",
    );
    expect(buildAuthSwitchHref("/login", new URLSearchParams("invite=founder"))).toBe("/login");
  });

  it("preserves invitation tokens across auth switches", () => {
    expect(buildAuthSwitchHref("/signup", new URLSearchParams("invitation=token-1"))).toBe(
      "/signup?invitation=token-1",
    );
    expect(buildAuthSwitchHref("/login", new URLSearchParams("invitation_token=token-1"))).toBe(
      "/login?invitation=token-1",
    );
  });
});
