import type { ScopeValue } from "@/lib/types";
import { SCOPE_LABEL } from "../ideas/types";

export default function QuestScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{SCOPE_LABEL[scope]}</span>;
}
