/**
 * Minimal Node.js-compatible mock of the vscode module for extension unit tests.
 */
const vscode = {
  version: '0.4.0-test',
  env: {
    appName: 'ChaosMonkey Telemetry Test',
    uriScheme: 'vscode',
  },
  window: {
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
  },
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: () => Promise.resolve(),
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
  },
};

export = vscode;
