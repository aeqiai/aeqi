import { describe, it, expect, vi } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContentCTA from "@/components/ContentCTA";

/**
 * Smoke tests that catch runtime rendering bugs before they reach production.
 *
 * The primary target is React error #185 ("Maximum update depth exceeded"),
 * which fires at render time when a component returns a fresh reference
 * (array/object) from a state-management selector on every call. StrictMode
 * amplifies these by double-invoking, so a clean render here is strong
 * evidence the component is loop-free.
 */
describe("ContentCTA smoke", () => {
  it("renders without throwing on a non-chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/agents"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("renders without throwing on a root-chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/sessions"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("renders without throwing on a child-agent chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/agents/child-2/sessions/abc"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  /**
   * The reliable way to surface "Maximum update depth exceeded" at test time
   * is to catch the `error` console call React emits before crashing. Spy on
   * it and fail the test if it fires.
   */
  it("does not log a React error during render", () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    try {
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/sessions"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      );
      const loopMsg = errors.find((e) => {
        const s = Array.isArray(e) ? e.join(" ") : String(e);
        return /Maximum update depth|Minified React error #185/.test(s);
      });
      expect(loopMsg).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
