import { describe, expect, it } from "vitest";
import { processRawSessionMessages } from "@/components/session/useMessageProcessor";
import { gatewayLabel } from "@/components/session/types";

describe("session gateway metadata", () => {
  it("formats gateway-backed sessions with transport and peer", () => {
    expect(
      gatewayLabel({
        gateway_transport: "whatsapp-baileys",
        gateway_peer_id: "10712151793796@lid",
        gateway_sender_name: "Luca",
        gateway_sender_transport_id: "10712151793796@lid",
      }),
    ).toBe("WhatsApp Baileys · Luca · 10712151793796@lid");
  });

  it("preserves gateway sender identity on user messages", () => {
    const messages = processRawSessionMessages([
      {
        id: 42,
        role: "user",
        content: "Are u deepseek flash",
        created_at: "2026-05-28T10:16:44Z",
        transport: "whatsapp-baileys",
        sender: {
          id: "sender-1",
          transport: "whatsapp-baileys",
          transport_id: "10712151793796@lid",
          display_name: "Luca",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].sender?.display_name).toBe("Luca");
    expect(messages[0].sender?.transport_id).toBe("10712151793796@lid");
    expect(messages[0].transport).toBe("whatsapp-baileys");
  });
});
