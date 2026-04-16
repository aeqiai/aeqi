/** Wipe all user-scoped session data from localStorage.
 *  Called on every auth transition to prevent cross-user data leaks. */
export function clearSessionData() {
  localStorage.removeItem("aeqi_token");
  localStorage.removeItem("aeqi_pending_email");
  localStorage.removeItem("aeqi_root");
  localStorage.removeItem("aeqi_root_tagline");
  localStorage.removeItem("aeqi_root_avatar");
  localStorage.removeItem("aeqi_session_threads");
  localStorage.removeItem("aeqi_selected_agent");
  localStorage.removeItem("aeqi_user_name");
  localStorage.removeItem("aeqi:recent-prompts");
}
