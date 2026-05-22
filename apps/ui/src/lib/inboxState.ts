export type InboxSignalKey = "review" | "unread" | "open";

export interface InboxSignal {
  key: InboxSignalKey;
  label: string;
  rowStatus?: "active";
  awaiting: boolean;
  detailState?: "review" | "unread";
}

export function getInboxSignal(input: { awaiting?: boolean; unread?: boolean }): InboxSignal {
  if (input.awaiting) {
    return {
      key: "review",
      label: "Awaiting reply",
      awaiting: true,
      detailState: "review",
    };
  }

  if (input.unread) {
    return {
      key: "unread",
      label: "Unread",
      rowStatus: "active",
      awaiting: false,
      detailState: "unread",
    };
  }

  return {
    key: "open",
    label: "Open",
    awaiting: false,
  };
}

export function visibleInboxSignalLabel(signal: InboxSignal): string | null {
  return signal.key === "open" ? null : signal.label;
}
