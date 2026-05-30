import { create } from "@storybook/theming/create";

export default create({
  base: "light",
  brandTitle: "aeqi component library",
  brandUrl: "https://aeqi.ai",
  brandTarget: "_blank",

  // Warm paper + ink palette
  colorPrimary: "#000000",
  colorSecondary: "#000000",

  // UI
  appBg: "#f4f2ec",
  appContentBg: "#faf9f5",
  appBorderColor: "rgba(0, 0, 0, 0.06)",
  appBorderRadius: 8,

  // Text
  textColor: "rgba(10, 10, 11, 0.9)",
  textMutedColor: "rgba(10, 10, 11, 0.48)",
  textInverseColor: "#ffffff",

  // Toolbar
  barTextColor: "rgba(10, 10, 11, 0.65)",
  barSelectedColor: "#000000",
  barBg: "#f4f2ec",

  // Form
  inputBg: "#fffefb",
  inputBorder: "rgba(0, 0, 0, 0.06)",
  inputTextColor: "rgba(10, 10, 11, 0.9)",
  inputBorderRadius: 6,

  // Typography
  fontBase: '"Inter", -apple-system, sans-serif',
  fontCode:
    'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)',
});
