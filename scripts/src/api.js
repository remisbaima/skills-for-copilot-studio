/**
 * api.js — Clean CJS library entrypoint for programmatic consumers.
 *
 * Exports YAML parsing, schema/Adaptive Card validation, connector metadata,
 * MSAL authentication helpers, connection URL builder, and capability metadata
 * without CLI side effects (no console.log, no process.exit, no NODE_PATH mutation).
 */

const yaml = require("js-yaml");
const { getCopilotStudioConnectionUrl } = require("@microsoft/agents-copilotstudio-client");
const {
  loadSchema,
  getDefinitions,
  getValidKindsFromOneOf,
  validateYaml,
  loadAdaptiveCardSchema,
  getAdaptiveCardDefinitions,
} = require("./schema-lookup");
const { listConnectorFiles, loadConnector } = require("./connector-lookup");
const sharedAuth = require("./shared-auth");

module.exports = {
  CAPABILITIES: sharedAuth.CAPABILITIES,
  yaml,
  loadSchema,
  getDefinitions,
  getValidKindsFromOneOf,
  validateYaml,
  loadAdaptiveCardSchema,
  getAdaptiveCardDefinitions,
  listConnectorFiles,
  loadConnector,
  getCopilotStudioConnectionUrl,
  ...sharedAuth,
};
