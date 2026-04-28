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
    },
  },
  {
    /* scripts/ is Node code (postinstall + hygiene check); the React/TS rule
     * set isn't right for it, and Node globals like process/console are
     * legitimate. Lint scripts/ separately if needed. */
    ignores: ["dist/**", "node_modules/**", "scripts/**"],
  },
);
