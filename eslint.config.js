import globals from "globals";
import pluginJs from "@eslint/js";
import pluginTs from "@typescript-eslint/eslint-plugin";
import parserTs from "@typescript-eslint/parser";
import pluginPrettier from "eslint-plugin-prettier";
import configPrettier from "eslint-config-prettier";

export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["dist/", "node_modules/"],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json"
      },
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    plugins: {
      "@typescript-eslint": pluginTs,
      prettier: pluginPrettier
    },
    rules: {
      ...pluginJs.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prettier/prettier": "error"
    }
  },
  configPrettier
];
