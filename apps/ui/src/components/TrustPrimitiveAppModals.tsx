import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AtSign, Globe } from "lucide-react";

import { Button, Input, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { TrustEmailIdentitySummary } from "./TrustPrimitiveApps";

export function NewMailModal({
  domain,
  existing,
  onClose,
  onCreate,
  open,
}: {
  domain: string;
  existing: TrustEmailIdentitySummary[];
  onClose: () => void;
  onCreate: (localPart: string, label: string) => void;
  open: boolean;
}) {
  const [localPart, setLocalPart] = useState("");
  const [label, setLabel] = useState("");
  const normalized = sanitizeLocalPart(localPart);
  const exists = existing.some(
    (identity) => identity.local_part.toLowerCase() === normalized.toLowerCase(),
  );
  const canSubmit = normalized.length > 0 && !exists;

  useEffect(() => {
    if (!open) return;
    setLocalPart("");
    setLabel("");
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onCreate(normalized, label);
  }

  return (
    <Modal open={open} onClose={onClose} title="New Mailbox">
      <form className="trust-apps-modal-form" onSubmit={submit}>
        <Input
          label="Local part"
          value={localPart}
          onChange={(event) => setLocalPart(event.target.value)}
          placeholder="press"
          error={exists ? "That mailbox already exists." : undefined}
        />
        <Input
          label="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={normalized ? titleFromLocalPart(normalized) : "Press"}
        />
        <div className="trust-apps-address-preview">
          <AtSign size={14} strokeWidth={1.5} aria-hidden />
          <span>
            {normalized || "name"}@{domain}
          </span>
        </div>
        <div className="trust-apps-modal-actions">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSubmit}>
            Create Mailbox
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function NewWebsiteModal({
  onClose,
  onDomainAdded,
  open,
  primaryDomain,
  trustId,
}: {
  onClose: () => void;
  onDomainAdded: () => void;
  open: boolean;
  primaryDomain: string;
  trustId: string;
}) {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const normalizedDomain = domain.trim().toLowerCase();
  const canSubmit = normalizedDomain.length > 3 && normalizedDomain.includes(".");

  useEffect(() => {
    if (!open) return;
    setDomain("");
    setState("idle");
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || state === "saving") return;
    setState("saving");
    try {
      await api.addHostingDomain({
        domain: normalizedDomain,
        app_id: `website:${trustId}`,
        trust_id: trustId,
      });
      onDomainAdded();
      onClose();
    } catch {
      setState("failed");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Website">
      <form className="trust-apps-modal-form" onSubmit={handleSubmit}>
        <Input
          label="Domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="www.company.com"
          error={state === "failed" ? "Could not attach this domain." : undefined}
        />
        <div className="trust-apps-address-preview">
          <Globe size={14} strokeWidth={1.5} aria-hidden />
          <span>{primaryDomain}</span>
        </div>
        <div className="trust-apps-modal-actions">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canSubmit}
            loading={state === "saving"}
          >
            Add Website
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function sanitizeLocalPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

export function titleFromLocalPart(value: string): string {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
