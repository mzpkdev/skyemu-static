import { defineConfig } from "webanvil"

export default defineConfig({
  build: {
    mode: "node",
    entries: {
      "./index": "src/index.ts",
    },
    outDir: "dist",
    bundle: true,
    declaration: false,
    platform: "node",
    target: "node24",
  },
  format: {
    semi: false,
  },
  lint: {
    rules: {
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "typescript/consistent-type-definitions": ["error", "type"],
      "unicorn/prefer-node-protocol": "error",
      "unicorn/import-style": [
        "error",
        {
          styles: {
            "node:child_process": { default: false, named: false, namespace: true },
            "node:crypto": { default: false, named: false, namespace: true },
            "node:fs": { default: false, named: false, namespace: true },
            "node:path": { default: false, named: false, namespace: true },
            "node:url": { default: false, named: false, namespace: true },
          },
        },
      ],
    },
  },
})
