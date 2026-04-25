/**
 * Settings → Preferences tab. Email subscription toggles. The
 * checkboxes are presentational placeholders today — the daemon
 * doesn't yet persist these — so they intentionally don't carry
 * state. Wire them up when the backend gets a preferences endpoint.
 */
export default function PreferencesPanel() {
  return (
    <>
      <p className="account-field-desc account-prefs-desc">
        Transactional emails (login codes, password resets) are always sent.
      </p>
      <label className="account-pref-label">
        <input type="checkbox" defaultChecked className="account-pref-checkbox" />
        Product updates -- new features and releases
      </label>
      <label className="account-pref-label">
        <input type="checkbox" defaultChecked className="account-pref-checkbox" />
        Marketing -- tips, case studies, promotions
      </label>
    </>
  );
}
