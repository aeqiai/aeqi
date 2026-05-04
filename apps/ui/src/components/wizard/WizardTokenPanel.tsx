import { type ChangeEvent } from "react";
import { Input } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardTokenPanel.module.css";

export interface TokenState {
  name: string;
  symbol: string;
  maxSupply: string;
}

interface WizardTokenPanelProps {
  state: TokenState;
  onChange: (next: TokenState) => void;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Token panel — name, symbol, max supply.
 *
 * Only renders when the blueprint has a Token module.
 * Personal-OS blueprint has no Token module — hidden for personal entities.
 */
export function WizardTokenPanel({ state, onChange, expanded, onToggle }: WizardTokenPanelProps) {
  const summary = state.symbol
    ? `${state.symbol} · ${Number(state.maxSupply).toLocaleString()}`
    : "Not configured";

  function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...state, name: e.target.value });
  }

  function handleSymbolChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...state, symbol: e.target.value.toUpperCase().slice(0, 5) });
  }

  function handleSupplyChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    onChange({ ...state, maxSupply: raw });
  }

  return (
    <WizardPanel
      id="wizard-token"
      title="Token"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.fields}>
        <Input
          label="Token name"
          value={state.name}
          onChange={handleNameChange}
          placeholder="e.g. Atlas Token"
        />
        <Input
          label="Symbol"
          value={state.symbol}
          onChange={handleSymbolChange}
          placeholder="ATL"
          hint="Up to 5 characters, auto-uppercased."
        />
        <Input
          label="Max supply"
          value={state.maxSupply}
          onChange={handleSupplyChange}
          placeholder="100000000"
          hint="Total tokens that can ever exist."
        />
      </div>
    </WizardPanel>
  );
}
