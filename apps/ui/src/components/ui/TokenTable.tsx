import React from "react";
import { TokenValue } from "./TokenValue";

type Row = {
  token: string;
  usage: React.ReactNode;
  fallback?: string;
};

/**
 * Renders a token table with live values read from the DOM. Used by the
 * design-language MDX so token docs can never drift from `tokens.css`.
 * Change a token → this table updates on next paint.
 */
export function TokenTable({ rows }: { rows: Row[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Token</th>
          <th>Value</th>
          <th>Usage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.token}>
            <td>
              <code>{r.token}</code>
            </td>
            <td>
              <code>
                <TokenValue name={r.token} fallback={r.fallback} />
              </code>
            </td>
            <td>{r.usage}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Status-colors variant with a leading "Status" column and a swatch dot.
 */
export function StatusTokenTable({
  rows,
}: {
  rows: { status: string; token: string; usage: React.ReactNode; fallback?: string }[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Color</th>
          <th>Token</th>
          <th>Used for</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.token}>
            <td>{r.status}</td>
            <td>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: `var(${r.token})`,
                  marginRight: 8,
                  verticalAlign: "middle",
                }}
              />
              <code>
                <TokenValue name={r.token} fallback={r.fallback} />
              </code>
            </td>
            <td>
              <code>{r.token}</code>
            </td>
            <td>{r.usage}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
