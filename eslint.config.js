// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Vendored upstream files: never lint (or --fix) them — the drift guard pins their bytes.
    ignores: ["dist/*", "src/vendor/hermes-gateway/json-rpc-*.ts", "src/vendor/hermes-gateway/gateway-*.ts"],
  }
]);
