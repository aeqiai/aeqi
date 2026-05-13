import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      /* Monolith guard. CLAUDE.md says "Components extracted to own files
       * (no 500-line monoliths)" but the rule was never enforced. 600 lines
       * (blank + comment lines stripped) is the soft ceiling; anything past
       * that signals the file should be split. Warning, not error — warnings
       * don't fail the gauntlet, so this doesn't break CI on existing
       * offenders (WelcomePage 1392, api.ts 1270, AgentQuestsTab 1146,
       * AdminPage 928, QuestCanvas 822, IdeaCanvas 794, EntityAgentsTab 791,
       * Button.stories.tsx 717, IdeasListView 693, etc.). Each warning is a
       * deferred TODO; new code that pushes a file over 600 lines surfaces
       * the moment it lands. */
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    /* Storybook files are intentionally long — one file per primitive,
     * one story per variant. Permanent exemption keeps the catalogue
     * idiomatic without polluting the named-files list. */
    files: ["**/*.stories.tsx"],
    rules: {
      "max-lines": "off",
    },
  },
  {
    /* Known monolith files awaiting extraction. CLAUDE.md says "no 500-line
     * monoliths" — these predate the rule. Each is on the TODO list to
     * split into smaller per-concern components; the override exempts them
     * from `max-lines` until they're extracted. Don't add to this list —
     * any new file >600 lines is a regression. Drop entries as files are
     * refactored. Locked 2026-05-13 with line counts captured at that date:
     *
     *   - src/lib/api.ts                              1049
     *   - src/pages/AdminPage.tsx                      874
     *   - src/components/AgentQuestsTab.tsx          (>600, was 1146 raw)
     *   - src/components/EntityAgentsTab.tsx         (>600, was 791 raw)
     *
     * Extracted (drop log):
     *   - 2026-05-13 src/components/IdeaCanvas.tsx — toolbar + decision-panel
     *     → components/ideas/{IdeaCanvasToolbar,IdeaCanvasDecisionPanel}.tsx
     *   - 2026-05-13 src/components/QuestCanvas.tsx — toolbar + linked-idea picker
     *     → components/quests/{QuestToolbar,LinkedIdeaPicker}.tsx
     *   - 2026-05-13 src/components/composer/Composer.tsx — footer + kbd ribbon
     *     → components/composer/{ComposerFooter,ComposerKbdRibbon}.tsx
     *   - 2026-05-13 src/components/ideas/IdeasListView.tsx — toolbar + chips
     *     → components/ideas/{IdeasListToolbar,IdeasListFilterChips}.tsx
     *   - 2026-05-13 src/pages/BlueprintsPage.tsx — category section, filter,
     *     toolbar radio popover + constants → pages/blueprints/{constants,
     *     BlueprintCategorySection,BlueprintsFilterPopover,ToolbarRadioPopover}
     *   - 2026-05-13 Button.stories.tsx + future *.stories.tsx — permanent
     *     `**\/*.stories.tsx` glob exemption.
     *   - 2026-05-13 src/pages/WelcomePage.tsx — 4 icons + 5 sub-views +
     *     webauthn helpers + types → pages/welcome/{types,webauthn,icons,
     *     SecretLogin,DoorView,CheckEmailView,views}.tsx
     */
    files: [
      "src/lib/api.ts",
      "src/pages/AdminPage.tsx",
      "src/components/AgentQuestsTab.tsx",
      "src/components/EntityAgentsTab.tsx",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  {
    /* scripts/ is Node code (postinstall + hygiene check); the React/TS rule
     * set isn't right for it, and Node globals like process/console are
     * legitimate. Lint scripts/ separately if needed. */
    ignores: ["dist/**", "node_modules/**", "scripts/**"],
  },
);
