import { beforeEach, describe, expect, it } from "vitest";
import { getScopedEntity } from "@/lib/appMode";

const COMPANY_ADDRESS = "F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq";
const COMPANY_ID = "dc0eee7a-7e47-4ba0-8fc4-f9615fd72fb7";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("getScopedEntity", () => {
  beforeEach(() => {
    localStorage.clear();
    setPath("/");
  });

  it("resolves /company/:companyAddress through cached entities to the canonical company id", () => {
    localStorage.setItem(
      "aeqi_daemon_entities",
      JSON.stringify([
        {
          id: COMPANY_ID,
          company_address: COMPANY_ADDRESS,
        },
      ]),
    );
    setPath(`/company/${COMPANY_ADDRESS}/quests`);

    expect(getScopedEntity()).toBe(COMPANY_ID);
  });

  it("falls back to the route slug when the company cache is unavailable", () => {
    setPath(`/company/${COMPANY_ADDRESS}/quests`);

    expect(getScopedEntity()).toBe(COMPANY_ADDRESS);
  });

  it("returns the stored entity on non-company routes", () => {
    localStorage.setItem("aeqi_entity", COMPANY_ID);
    setPath("/inbox");

    expect(getScopedEntity()).toBe(COMPANY_ID);
  });
});
