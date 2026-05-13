import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  formatCurrency,
  formatDate,
  formatInteger,
  formatMediumDate,
  formatNumber,
  formatShortDate,
  formatShortTime,
  resolveLocale,
} from "@/lib/i18n";

describe("i18n formatting", () => {
  it("resolves supported English browser locales to the canonical app locale", () => {
    expect(resolveLocale(["en-GB"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(["en"])).toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default locale for unsupported or invalid locale candidates", () => {
    expect(resolveLocale(["fr-FR"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(["not a locale"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
  });

  it("formats dates through the shared locale boundary", () => {
    const iso = "2026-05-13T12:34:00.000Z";

    expect(formatShortDate(iso, { locale: "en-US" })).toBe("May 13");
    expect(formatMediumDate(iso, { locale: "en-US" })).toBe("May 13, 2026");
    expect(formatShortTime(iso, { locale: "en-US" })).toMatch(/\d{2}:\d{2} (AM|PM)/);
  });

  it("supports explicit date options when a surface needs a specialized format", () => {
    expect(
      formatDate(
        "2026-05-13T12:34:00.000Z",
        { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" },
        { locale: "en-US" },
      ),
    ).toBe("Wed, May 13");
  });

  it("returns fallbacks for missing or invalid values", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate("broken", { fallback: "" })).toBe("");
    expect(formatNumber(Number.NaN)).toBe("—");
  });

  it("formats numbers and integers consistently", () => {
    expect(formatInteger(1234567, { locale: "en-US" })).toBe("1,234,567");
    expect(formatNumber(1234.56, { maximumFractionDigits: 1 }, { locale: "en-US" })).toBe(
      "1,234.6",
    );
    expect(formatCurrency(49, "usd", { minimumFractionDigits: 0 }, { locale: "en-US" })).toBe(
      "$49",
    );
  });
});
