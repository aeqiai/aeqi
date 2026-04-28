/**
 * Settings → Preferences tab. Email subscription toggles will land
 * once the backend persists per-user preferences. Until then, this
 * shows an honest empty state instead of placeholder checkboxes.
 */
export default function PreferencesPanel() {
  return (
    <div className="account-prefs-empty">
      <p className="account-field-desc">
        Email preferences are coming soon. For now, transactional emails (login codes, password
        resets) are always sent.
      </p>
    </div>
  );
}
