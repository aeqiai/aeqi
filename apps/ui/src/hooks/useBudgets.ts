import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Budget, BudgetAllowance, BudgetPolicy } from "@/lib/api";

// ── List + tree ───────────────────────────────────────────────────────────────

export interface BudgetsListState {
  /** `null` while loading, `[]` when loaded empty / unauthorised. */
  budgets: Budget[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Read every budget in the company. Polls on `companyId` change. Use
 * `useBudgetTree` instead when you need the parent→child edges.
 */
export function useBudgets(companyId: string | undefined): BudgetsListState {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!companyId) {
      setBudgets([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listBudgets(companyId)
      .then((res) => {
        if (cancelled) return;
        setBudgets(res.budgets ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBudgets([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, tick]);

  return { budgets, loading, error, refresh: () => setTick((t) => t + 1) };
}

// ── Single-budget detail (budget + current allowance + policy) ────────────────

export interface BudgetDetailState {
  budget: Budget | null;
  allowance: BudgetAllowance | null;
  policy: BudgetPolicy | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBudgetDetail(budgetId: string | undefined): BudgetDetailState {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [allowance, setAllowance] = useState<BudgetAllowance | null>(null);
  const [policy, setPolicy] = useState<BudgetPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!budgetId) {
      setBudget(null);
      setAllowance(null);
      setPolicy(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBudget(budgetId)
      .then((res) => {
        if (cancelled) return;
        setBudget(res.budget ?? null);
        setAllowance(res.allowance ?? null);
        setPolicy(res.policy ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [budgetId, tick]);

  return {
    budget,
    allowance,
    policy,
    loading,
    error,
    refresh: () => setTick((t) => t + 1),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a micro-USD inference value for display.
 * 1_000_000 micro-USD = $1.
 */
export function formatMicroUsd(v: number): string {
  const dollars = v / 1_000_000;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  if (v === 0) return "$0";
  return `$${dollars.toFixed(4)}`;
}

/**
 * Format a USDC base-unit value for display. USDC = 6 decimals, so
 * 1_000_000 base units = $1.
 */
export function formatUsdcBase(v: number): string {
  const dollars = v / 1_000_000;
  return `$${dollars.toFixed(2)}`;
}
