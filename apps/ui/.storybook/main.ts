import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/components/ui/**/*.stories.tsx", "../src/components/ui/**/*.mdx"],
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-backgrounds",
    "@storybook/addon-controls",
    "@storybook/addon-docs",
    "@storybook/addon-highlight",
    "@storybook/addon-measure",
    "@storybook/addon-outline",
    "@storybook/addon-toolbars",
    "@storybook/addon-viewport",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
