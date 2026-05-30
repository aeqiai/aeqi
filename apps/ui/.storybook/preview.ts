import type { Preview } from "@storybook/react";
import theme from "./theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "shell",
      values: [
        { name: "shell", value: "#f4f2ec" },
        { name: "card", value: "#faf9f5" },
        { name: "elevated", value: "#fffefb" },
        { name: "inset-subtle", value: "#f6f5ef" },
        { name: "inset-strong", value: "#ecebe5" },
        { name: "inverse", value: "#0a0a0b" },
      ],
    },
    options: {
      storySort: {
        method: "alphabetical",
        order: [
          "Get Started",
          ["Welcome", "System Coherence", "Component Library"],
          "Foundations",
          [
            "Principles",
            "Color",
            "Typography",
            "Spacing",
            "Radii",
            "Elevation",
            "Motion",
            "Iconography",
            "Breakpoints",
            "Wordmark",
          ],
          "Primitives",
          [
            "Actions",
            "Inputs",
            "Containers",
            "Layout",
            "Data Display",
            "Toolbar",
            "Conversation",
            "Overlays",
            "Feedback",
          ],
          "Patterns",
          [
            "Layout",
            "Toolbar",
            "Product Surface Audit",
            "Product Surfaces",
            "Agent Card",
            "Quest Row",
            "Empty Dashboard",
          ],
        ],
      },
    },
    docs: { theme },
  },
};

export default preview;
