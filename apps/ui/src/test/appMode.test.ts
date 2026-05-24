import { beforeEach, describe, expect, it } from "vitest";
import { getScopedEntity } from "@/lib/appMode";

const TRUST_ADDRESS = "F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq";
const TRUST_ID = "dc0eee7a-7e47-4ba0-8fc4-f9615fd72fb7";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("getScopedEntity", () => {
  beforeEach(() => {
    localStorage.clear();
    setPath("/");
  });

  it("resolves /trust/:trustAddress through cached entities to the canonical trust id", () => {
    localStorage.setItem(
      "aeqi_daemon_entities",
      JSON.stringify([
        {
          id: TRUST_ID,
          trust_address: TRUST_ADDRESS,
        },
      ]),
    );
    setPath(`/trust/${TRUST_ADDRESS}/quests`);

    expect(getScopedEntity()).toBe(TRUST_ID);
  });

  it("falls back to the route slug when the trust cache is unavailable", () => {
    setPath(`/trust/${TRUST_ADDRESS}/quests`);

    expect(getScopedEntity()).toBe(TRUST_ADDRESS);
  });

  it("returns the stored entity on non-trust routes", () => {
    localStorage.setItem("aeqi_entity", TRUST_ID);
    setPath("/inbox");

    expect(getScopedEntity()).toBe(TRUST_ID);
  });
});
