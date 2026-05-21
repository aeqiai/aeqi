import { describe, expect, it } from "vitest";
import { routineNextLabel } from "@/components/events/lifecycle";

describe("events lifecycle helpers", () => {
  it("finds the next daily routine match", () => {
    expect(routineNextLabel("schedule:30 9 * * *", new Date("2026-05-21T07:05:00"))).toBe(
      "today 09:30",
    );
  });

  it("rolls weekday routines across weekends", () => {
    expect(routineNextLabel("schedule:0 9 * * 1-5", new Date("2026-05-22T10:00:00"))).toBe(
      "Mon 09:00",
    );
  });

  it("supports stepped minute routines", () => {
    expect(routineNextLabel("cron:*/15 * * * *", new Date("2026-05-21T10:07:00"))).toBe(
      "today 10:15",
    );
  });

  it("accepts leading zero cron fields", () => {
    expect(routineNextLabel("schedule:05 09 * * *", new Date("2026-05-21T07:05:00"))).toBe(
      "today 09:05",
    );
  });
});
