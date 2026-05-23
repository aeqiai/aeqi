import { ArrowRight, ShieldCheck } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import {
  Button,
  InspectorChips,
  InspectorField,
  InspectorHeader,
  InspectorPanel,
  InspectorSection,
} from "@/components/ui";
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
    <InspectorPanel className="trust-context-inspector" ariaLabel="Selected role">
      {selected ? (
        <>
          <InspectorHeader
            eyebrow="Selected role"
            title={roleLabel}
            subtitle={`${selected.trust.name} · held by ${holderLabel}`}
            media={<TrustAvatar name={selected.trust.name} src={selected.trust.avatar} size={42} />}
            actions={
              <Button
                type="button"
                variant="primary"
                size="sm"
                trailingIcon={<ArrowRight size={13} strokeWidth={1.8} />}
                trailingIconMode="forward"
                onClick={() => onEnter(selected)}
              >
                Enter
              </Button>
            }
          />
          <InspectorSection title="Identity">
            <InspectorField label="Holder">{holderLabel}</InspectorField>
            <InspectorField label="Trust">{selected.trust.name}</InspectorField>
            <InspectorField label="Connection">{relation}</InspectorField>
          </InspectorSection>
          <InspectorSection title="Path">
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
          </InspectorSection>
          <InspectorSection title="Authority">
            <InspectorChips className="trust-context-grants">
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
            </InspectorChips>
          </InspectorSection>
          <InspectorSection title="Route">
            <p className="trust-context-inspector-copy">
              {selected.status === "ambiguous"
                ? `${selected.routeCount} paths can reach this role.`
                : selected.route.length > 1
                  ? "This role is reached through another TRUST."
                  : selected.route[0]?.relation === "identity"
                    ? "This role is held by a TRUST connected to your account."
                    : "This role is held directly by your account."}
            </p>
          </InspectorSection>
        </>
      ) : (
        <div className="trust-context-empty trust-context-empty--inspector">
          <ShieldCheck size={20} strokeWidth={1.6} />
          <strong>No role selected</strong>
          <span>Select a role on the map to inspect its path.</span>
        </div>
      )}
    </InspectorPanel>
  );
}
