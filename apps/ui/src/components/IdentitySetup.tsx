/**
 * IdentitySetup — helpers for wiring an agent identity at creation time.
 *
 * Identity wiring = an idea (content) + an event (session:start injects
 * that idea). The API sequence is: storeIdea → createEvent with idea_ids.
 * If event creation fails after the idea is stored, we best-effort delete
 * the new idea before surfacing the error.
 *
 * The in-app editor surface lives in the Ideas tab — identity ideas are
 * just tagged `identity` and edited like any other idea.
 */

import { api } from "@/lib/api";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Wire identity: create the idea + the session:start event. */
async function wireIdentity(
  agentId: string,
  agentName: string,
  content: string,
): Promise<{ ideaId: string; eventId: string }> {
  const slug = slugify(agentName);
  const ideaName = `${slug}-identity`;

  const ideaResp = await api.storeIdea({
    name: ideaName,
    content,
    tags: ["identity"],
    agent_id: agentId,
    scope: "self",
  });
  const ideaId = ideaResp.id;

  try {
    const eventResp = await api.createEvent({
      name: "on_session_start_identity",
      pattern: "session:start",
      agent_id: agentId,
      idea_ids: [ideaId],
      scope: "self",
    });
    return { ideaId, eventId: eventResp.event.id };
  } catch (error) {
    try {
      await api.deleteIdea(ideaId);
    } catch {
      // Best-effort cleanup only — the original failure is what matters.
    }
    throw error;
  }
}

/** Called from NewAgentPage after agent creation. */
export async function wireIdentityForNewAgent(
  agentId: string,
  agentName: string,
  content: string,
): Promise<void> {
  await wireIdentity(agentId, agentName, content);
}
