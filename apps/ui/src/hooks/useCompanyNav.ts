import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

/**
 * Navigate within the current company scope.
 * Replaces hardcoded navigate("/agents/...") with go("/agents/...").
 */
export function useCompanyNav() {
  const navigate = useNavigate();
  const { company } = useParams<{ company: string }>();
  const base = useMemo(() => (company ? `/${encodeURIComponent(company)}` : ""), [company]);

  const go = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      const full = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
      navigate(full, options);
    },
    [navigate, base],
  );

  const href = useCallback(
    (path: string) => {
      return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
    },
    [base],
  );

  return { go, href, company: company || "", base };
}
