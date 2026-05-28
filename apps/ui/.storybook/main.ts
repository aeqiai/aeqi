import type { StorybookConfig } from "@storybook/react-vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

const reactEntry = nodeRequire.resolve("react", { paths: [uiRoot] });
const reactJsxRuntimeEntry = nodeRequire.resolve("react/jsx-runtime", { paths: [uiRoot] });
const reactJsxDevRuntimeEntry = nodeRequire.resolve("react/jsx-dev-runtime", { paths: [uiRoot] });
const reactDomEntry = nodeRequire.resolve("react-dom", { paths: [uiRoot] });

function resolveUiRuntimePackage(source: string) {
  if (source.includes("node_modules/@types/react/jsx-dev-runtime")) {
    return reactJsxDevRuntimeEntry;
  }
  if (source.includes("node_modules/@types/react/jsx-runtime")) {
    return reactJsxRuntimeEntry;
  }
  if (source.includes("node_modules/@types/react-dom")) {
    return reactDomEntry;
  }
  if (source.includes("node_modules/@types/react")) {
    return reactEntry;
  }
  if (
    source === "react" ||
    source.startsWith("react/") ||
    source === "react-dom" ||
    source.startsWith("react-dom/")
  ) {
    return nodeRequire.resolve(source, { paths: [uiRoot] });
  }
  return null;
}

const config: StorybookConfig = {
  stories: [
    "../src/components/ui/**/*.stories.tsx",
    "../src/components/ui/**/*.mdx",
    "../src/components/composer/**/*.stories.tsx",
    "../src/components/sessions/**/*.stories.tsx",
  ],
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
  viteFinal(baseConfig) {
    const plugins = Array.isArray(baseConfig.plugins)
      ? baseConfig.plugins.filter((plugin) => {
          if (!plugin || Array.isArray(plugin)) return true;
          return !String(plugin.name).includes("tsconfig");
        })
      : baseConfig.plugins;

    return mergeConfig(
      { ...baseConfig, plugins },
      {
        plugins: [
          {
            name: "aeqi-storybook-react-runtime",
            enforce: "pre",
            resolveId(source) {
              return resolveUiRuntimePackage(source);
            },
          },
        ],
        resolve: {
          alias: [
            { find: "@", replacement: path.join(uiRoot, "src") },
            {
              find: "@aeqi/web-shared",
              replacement: path.join(uiRoot, "../../packages/web-shared/src"),
            },
            { find: /^react$/, replacement: path.join(uiRoot, "node_modules/react") },
            {
              find: /^react\/(.+)$/,
              replacement: path.join(uiRoot, "node_modules/react/$1"),
            },
            { find: /^react-dom$/, replacement: path.join(uiRoot, "node_modules/react-dom") },
            {
              find: /^react-dom\/(.+)$/,
              replacement: path.join(uiRoot, "node_modules/react-dom/$1"),
            },
          ],
        },
      },
    );
  },
};

export default config;
