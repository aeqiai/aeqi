import { afterEach, describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StartPage from "@/pages/StartPage";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderStartPage() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <StartPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("StartPage MVP surface", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Home as a global product surface instead of a trust dashboard", () => {
    renderStartPage();

    expect(screen.getByRole("heading", { level: 1, name: "aeqi" })).toBeInTheDocument();
    expect(screen.getByText("Start something that can work without you.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /launch trust/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /view blueprint/i })).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Operating context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your TRUSTs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My sessions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active TRUST")).not.toBeInTheDocument();
  });

  it("keeps the global rows focused on launch, economy, referrals, and learning", () => {
    renderStartPage();

    const startRow = screen.getByRole("region", { name: "Start with aeqi" });
    expect(within(startRow).getByRole("heading", { name: "Launch a TRUST" })).toBeInTheDocument();
    expect(within(startRow).getByRole("link", { name: /view blueprint/i })).toHaveAttribute(
      "href",
      "/blueprints",
    );
    expect(within(startRow).getByText("Public market surface")).toBeInTheDocument();
    expect(
      within(startRow).getByRole("heading", { name: "Invite the first operators" }),
    ).toBeInTheDocument();
    expect(within(startRow).getByRole("link", { name: /invite someone/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
    expect(screen.queryByRole("link", { name: /read update/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "First Company" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Learn aeqi" })).toBeInTheDocument();
  });

  it("routes the primary launch action to launch", () => {
    renderStartPage();

    fireEvent.click(screen.getAllByRole("link", { name: /launch trust/i })[0]);

    expect(screen.getByTestId("location")).toHaveTextContent("/launch");
  });
});
