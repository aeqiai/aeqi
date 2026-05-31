import { Link } from "react-router-dom";
import { BriefcaseBusiness } from "lucide-react";
import type { ReactNode } from "react";
import AgentAvatar from "@/components/AgentAvatar";
import UserAvatar from "@/components/UserAvatar";
import { entityPathFromId } from "@/lib/entityPath";
import { useDaemonStore } from "@/store/daemon";
import type { Message, ResolvedAuthor } from "./types";

export interface AvatarResolution {
  href: string | undefined;
  name: string;
  photoUrl?: string | null;
  shape: "circle" | "rounded-square";
  authorLabel: string | null;
  kind: "agent" | "user" | "position" | "external";
}

export function resolveAvatar(
  author: ResolvedAuthor,
  ctx: {
    companyId: string | undefined;
    entitiesList: ReturnType<typeof useDaemonStore.getState>["entities"];
    agentAvatarById: Map<string, string | undefined>;
    currentUserId: string;
    currentUserName: string;
    currentUserAvatarUrl: string;
    userEmail: string;
  },
): AvatarResolution | null {
  const {
    companyId,
    entitiesList,
    agentAvatarById,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    userEmail,
  } = ctx;
  if (author.kind === "system") return null;

  if (author.kind === "agent") {
    const href = companyId
      ? entityPathFromId(entitiesList, companyId, "agents", encodeURIComponent(author.id))
      : undefined;
    return {
      href,
      name: author.name,
      photoUrl: agentAvatarById.get(author.id),
      shape: "rounded-square",
      authorLabel: author.name,
      kind: "agent",
    };
  }
  if (author.kind === "position") {
    const href = companyId
      ? entityPathFromId(entitiesList, companyId, "roles", encodeURIComponent(author.id))
      : undefined;
    return {
      href,
      name: author.title,
      photoUrl: "",
      shape: "rounded-square",
      authorLabel: author.title,
      kind: "position",
    };
  }

  const isCurrentUser = !!(author.id && currentUserId && author.id === currentUserId);
  return {
    href: isCurrentUser ? "/account" : undefined,
    name: isCurrentUser
      ? currentUserName || author.name || userEmail || "You"
      : author.name || "User",
    photoUrl: isCurrentUser ? currentUserAvatarUrl || "" : "",
    shape: "circle",
    authorLabel: isCurrentUser ? "You" : author.name || "User",
    kind: "user",
  };
}

export function AvatarCell({ avatar }: { avatar: AvatarResolution }) {
  const { href, name, photoUrl, shape } = avatar;
  const photoBorderRadius = shape === "circle" ? "999px" : "var(--radius-sm)";

  if (avatar.kind === "external" && !photoUrl) return null;

  if (avatar.kind === "agent") {
    const node = <AgentAvatar name={name} src={photoUrl ?? undefined} />;
    return href ? <AvatarLink href={href} name={name} node={node} /> : node;
  }

  if (avatar.kind === "user") {
    const node = <UserAvatar name={name} size={20} src={photoUrl} />;
    return href ? <AvatarLink href={href} name={name} node={node} /> : node;
  }

  if (photoUrl) {
    const img = (
      <img
        src={photoUrl}
        alt={name}
        width={20}
        height={20}
        style={{
          width: 20,
          height: 20,
          borderRadius: photoBorderRadius,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
    return href ? <AvatarLink href={href} name={name} node={img} /> : img;
  }

  const node = (
    <span className="asv-msg-role-avatar" aria-hidden>
      <BriefcaseBusiness size={12} strokeWidth={1.8} />
    </span>
  );
  return href ? <AvatarLink href={href} name={name} node={node} /> : node;
}

export function senderAvatarUrl(msg: Message): string | null {
  const direct = msg.sender?.avatar_url;
  if (typeof direct === "string" && direct.trim()) return direct;
  const metadata = msg.sender?.metadata;
  if (!metadata) return null;
  const candidates = [
    metadata.avatar_url,
    metadata.profile_image_url,
    metadata.profile_picture_url,
    metadata.photo_url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

export function isExternalSender(msg: Message): boolean {
  const transport = msg.sender?.transport ?? msg.transport;
  return (
    !!transport && !["agent", "internal", "quest", "session", "user", "web"].includes(transport)
  );
}

function AvatarLink({ href, name, node }: { href: string; name: string; node: ReactNode }) {
  return (
    <Link
      to={href}
      className="block-avatar-link"
      aria-label={name}
      title={name}
      onClick={(e) => e.stopPropagation()}
    >
      {node}
    </Link>
  );
}
