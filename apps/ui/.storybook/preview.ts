import type { Preview } from "@storybook/react";
import theme from "./theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "shell",
      values: [
        { name: "shell", value: "#f4f4f5" },
        { name: "card", value: "#ffffff" },
        { name: "inset-subtle", value: "#f8f8f9" },
        { name: "inset-strong", value: "#ededf0" },
        { name: "inverse", value: "#0a0a0b" },
      ],
    },
    options: {
      storySort: {
        method: "alphabetical",
        order: [
          "Get Started",
          ["Welcome", "Component Library", "Changelog"],
          "Foundations",
          ["Design Language"],
          "Primitives",
          ["Actions", "Inputs", "Containers", "Data Display", "Overlays", "Feedback"],
        ],
      },
    },
    docs: { theme },
  },
};

export default preview;
