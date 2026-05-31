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

  it("renders Home as a global product surface instead of a company dashboard", () => {
    renderStartPage();

    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /launch company/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /view template/i })).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Operating context" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your Companies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My sessions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Active COMPANY")).not.toBeInTheDocument();
  });

  it("keeps the global rows focused on launch, markets, referrals, and learning", () => {
    renderStartPage();

    const startRow = screen.getByRole("region", { name: "Start with aeqi" });
    expect(within(startRow).getByRole("heading", { name: "First Company" })).toBeInTheDocument();
    expect(within(startRow).getByRole("heading", { name: "Launch a COMPANY" })).toBeInTheDocument();
    expect(within(startRow).getByRole("link", { name: /view template/i })).toHaveAttribute(
      "href",
      "/templates",
    );
    expect(within(startRow).getByRole("heading", { name: "Markets" })).toBeInTheDocument();
    expect(
      within(startRow).getByRole("heading", { name: "Invite the first operators" }),
    ).toBeInTheDocument();
    expect(within(startRow).getByRole("link", { name: /open referrals/i })).toHaveAttribute(
      "href",
      "/referrals",
    );
    expect(screen.queryByRole("link", { name: /read update/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Learn aeqi" })).toBeInTheDocument();
  });

  it("routes the primary launch action to launch", () => {
    renderStartPage();

    fireEvent.click(screen.getAllByRole("link", { name: /launch company/i })[0]);

    expect(screen.getByTestId("location")).toHaveTextContent("/launch");
  });
});
