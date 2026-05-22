import { ArrowRight, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import TrustRoleOptionCard from "@/components/trust/TrustRoleOptionCard";
import { relationLabel, roleTypeLabel, type RoleContextOption } from "@/lib/trustRoleContext";

interface TrustContextInspectorProps {
  selected: RoleContextOption | null;
  holderLabel: string;
  roleLabel: string;
  relation: string;
  userEmail?: string;
  onEnter: (context: RoleContextOption) => void;
}

export default function TrustContextInspector({
  selected,
  holderLabel,
  roleLabel,
  relation,
  userEmail,
  onEnter,
}: TrustContextInspectorProps) {
  return (
    <aside className="trust-context-inspector" aria-label="Selected role">
      {selected ? (
        <>
          <TrustRoleOptionCard
            trust={selected.trust}
            role={selected.role}
            roleContext={selected}
            selected
            activePath
            routeCount={selected.routeCount}
            className="trust-context-inspector-card"
            onClick={() => undefined}
          />
          <button type="button" className="trust-context-enter" onClick={() => onEnter(selected)}>
            Enter role
            <ArrowRight size={15} strokeWidth={1.8} />
          </button>
          <InspectorBlock title="Selection">
            <div className="trust-context-facts">
              <div>
                <span>Holder</span>
                <strong>{holderLabel}</strong>
              </div>
              <div>
                <span>Role</span>
                <strong>{roleLabel}</strong>
              </div>
              <div>
                <span>TRUST</span>
                <strong>{selected.trust.name}</strong>
              </div>
              <div>
                <span>Connection</span>
                <strong>{relation}</strong>
              </div>
            </div>
          </InspectorBlock>
          <InspectorBlock title="Path">
            <ol className="trust-context-route-steps">
              <li>
                <span>You</span>
                <small>{userEmail ?? "Operator"}</small>
              </li>
              {selected.route.map((segment, index) => (
                <li key={`${segment.trust.id}:${segment.role.id}:${segment.relation}`}>
                  <span>
                    {segment.trust.name} /{" "}
                    {segment.role.title || roleTypeLabel(segment.role.role_type)}
                  </span>
                  <small>
                    {index === selected.route.length - 1
                      ? "Selected role"
                      : relationLabel(segment.relation)}
                  </small>
                </li>
              ))}
            </ol>
          </InspectorBlock>
          <InspectorBlock title="Grants">
            <div className="trust-context-grants">
              {selected.role.grants.length > 0 ? (
                selected.role.grants.slice(0, 5).map((grant) => <span key={grant}>{grant}</span>)
              ) : (
                <>
                  <span>Quests</span>
                  <span>Agents</span>
                  <span>Events</span>
                  <span>Review</span>
                </>
              )}
            </div>
          </InspectorBlock>
          <InspectorBlock title="Route">
            <p className="trust-context-inspector-copy">
              {selected.status === "ambiguous"
                ? `${selected.routeCount} paths can reach this role.`
                : selected.route.length > 1
                  ? "This role is reached through another TRUST."
                  : selected.route[0]?.relation === "identity"
                    ? "This role is held by a TRUST connected to your account."
                    : "This role is held directly by your account."}
            </p>
          </InspectorBlock>
          <InspectorBlock title="Entry points">
            <div className="trust-context-entry-grid">
              {["Overview", "Roles", "Quests", "Ideas", "Events", "Assets", "Quorum"].map(
                (item) => (
                  <span key={item}>{item}</span>
                ),
              )}
            </div>
          </InspectorBlock>
        </>
      ) : (
        <div className="trust-context-empty trust-context-empty--inspector">
          <ShieldCheck size={20} strokeWidth={1.6} />
          <strong>No role selected</strong>
          <span>Select a role on the map to inspect its path.</span>
        </div>
      )}
    </aside>
  );
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="trust-context-inspector-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
