import type { Preview } from "@storybook/react";
import theme from "./theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "surface", value: "rgba(0, 0, 0, 0.015)" },
        { name: "elevated", value: "rgba(0, 0, 0, 0.035)" },
      ],
    },
    docs: { theme },
  },
};

export default preview;
