import { timeShort } from "@/lib/format";
import type { InboxItem } from "@/lib/api";
import type { Quest, Role, Trust } from "@/lib/types";

export function latestActivityLabel(
  activeTrust: Trust | null,
  inboxItems: ReadonlyArray<InboxItem>,
  quests: ReadonlyArray<Quest>,
) {
  const inboxTime = inboxItems
    .map((item) => item.awaiting_at || item.last_active)
    .filter(Boolean)
    .sort()
    .at(-1);
  const questTime = quests
    .map((quest) => quest.updated_at || quest.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const timestamp = inboxTime || questTime || activeTrust?.last_active;
  return timestamp ? timeShort(timestamp) : "Ready";
}

export function pickFeaturedRole(roles: ReadonlyArray<Role>, userId?: string): Role | null {
  if (roles.length === 0) return null;
  if (userId) {
    const own = roles.find((role) => role.occupant_kind === "human" && role.occupant_id === userId);
    if (own) return own;
  }
  const trustHeld = roles.find((role) => role.occupant_kind === "trust");
  if (trustHeld) return trustHeld;
  const founder = roles.find((role) => role.founder);
  if (founder) return founder;
  const director = roles.find(
    (role) => role.role_type === "director" && role.occupant_kind !== "vacant",
  );
  if (director) return director;
  const occupied = roles.find((role) => role.occupant_kind !== "vacant");
  return occupied ?? roles[0];
}
