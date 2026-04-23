import { create } from "@storybook/theming/create";

export default create({
  base: "light",
  brandTitle: "aeqi component library",
  brandUrl: "https://aeqi.ai",
  brandTarget: "_blank",

  // Monochromatic palette
  colorPrimary: "#000000",
  colorSecondary: "#000000",

  // UI
  appBg: "#f4f4f5",
  appContentBg: "#ffffff",
  appBorderColor: "rgba(0, 0, 0, 0.06)",
  appBorderRadius: 8,

  // Text
  textColor: "rgba(0, 0, 0, 0.85)",
  textMutedColor: "rgba(0, 0, 0, 0.4)",
  textInverseColor: "#ffffff",

  // Toolbar
  barTextColor: "rgba(0, 0, 0, 0.5)",
  barSelectedColor: "#000000",
  barBg: "#f4f4f5",

  // Form
  inputBg: "#ffffff",
  inputBorder: "rgba(0, 0, 0, 0.06)",
  inputTextColor: "rgba(0, 0, 0, 0.85)",
  inputBorderRadius: 6,

  // Typography
  fontBase: '"Inter", -apple-system, sans-serif',
  fontCode: '"JetBrains Mono", monospace',
});
