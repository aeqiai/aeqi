import type { ReactNode } from "react";
import { Cloud, CreditCard, MessageCircle, Send, ShoppingBag } from "lucide-react";

import { CardTrigger, Modal } from "./ui";

export default function TrustIntegrationCreateModal({
  connecting,
  onClose,
  onEtsy,
  onGateway,
  onGoogle,
  onStripe,
  open,
}: {
  connecting: string | null;
  onClose: () => void;
  onEtsy: () => void;
  onGateway: (kind: "telegram" | "whatsapp" | "whatsapp-baileys") => void;
  onGoogle: () => void;
  onStripe: () => void;
  open: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="New Integration">
      <div className="trust-apps-provider-list">
        <ProviderAction
          icon={<Cloud size={18} strokeWidth={1.5} />}
          title="Google Workspace"
          subtitle="Connect one Google account for workspace tools."
          action="Connect"
          loading={connecting === "modal-google"}
          onClick={onGoogle}
        />
        <ProviderAction
          icon={<ShoppingBag size={18} strokeWidth={1.5} />}
          title="Etsy Shop"
          subtitle="Connect shop, listings, orders, and draft product tools."
          action="Connect"
          loading={connecting === "modal-etsy"}
          onClick={onEtsy}
        />
        <ProviderAction
          icon={<CreditCard size={18} strokeWidth={1.5} />}
          title="Stripe"
          subtitle="Manage billing, checkout, and customer portal."
          action="Open"
          onClick={() => {
            onClose();
            onStripe();
          }}
        />
        <ProviderAction
          icon={<Send size={18} strokeWidth={1.5} />}
          title="Telegram"
          subtitle="Add a bot gateway for external sessions."
          action="Add"
          onClick={() => {
            onClose();
            onGateway("telegram");
          }}
        />
        <ProviderAction
          icon={<MessageCircle size={18} strokeWidth={1.5} />}
          title="WhatsApp"
          subtitle="Pair a WhatsApp gateway with QR."
          action="Add"
          onClick={() => {
            onClose();
            onGateway("whatsapp-baileys");
          }}
        />
      </div>
    </Modal>
  );
}

function ProviderAction({
  action,
  icon,
  loading,
  onClick,
  subtitle,
  title,
}: {
  action: string;
  icon: ReactNode;
  loading?: boolean;
  onClick: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <CardTrigger className="trust-apps-provider-row" onClick={onClick} disabled={loading}>
      <span className="trust-apps-provider-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-apps-provider-copy">
        <span className="trust-apps-provider-title">{title}</span>
        <span className="trust-apps-provider-subtitle">{subtitle}</span>
      </span>
      <span className="trust-apps-provider-action">{loading ? "Connecting" : action}</span>
    </CardTrigger>
  );
}
