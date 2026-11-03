#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  stateDir,
  codexHooksPath,
  readJsonFile,
  removeCodexHooks,
} = require('./lib');

const BRIDGE_SCRIPT = path.join(__dirname, 'bridge.js');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyGeneratedHooksFile(filePath) {
  const settings = readJsonFile(filePath, null);
  if (!isObject(settings)) return false;
  const rootKeys = Object.keys(settings);
  if (rootKeys.some((key) => key !== 'hooks')) return false;
  if (!isObject(settings.hooks)) return false;
  return Object.keys(settings.hooks).length === 0;
}

function uninstall() {
  const dir = stateDir();
  const configPath = path.join(dir, 'config.json');
  const config = readJsonFile(configPath, null);
  const hooksPath = codexHooksPath();
  const result = removeCodexHooks(BRIDGE_SCRIPT);

  if (config && config.codex_hooks_existed === false && isEmptyGeneratedHooksFile(hooksPath)) {
    try { fs.unlinkSync(hooksPath); } catch {}
  }

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const codexDir = path.dirname(hooksPath);
  if (fs.existsSync(codexDir)) {
    for (const file of fs.readdirSync(codexDir)) {
      if (file.startsWith('hooks.json.backup-')) {
        try { fs.unlinkSync(path.join(codexDir, file)); } catch {}
      }
    }
  }

  console.log('ChaosMonkey Codex bridge uninstalled.');
  console.log(`Removed ChaosMonkey hook commands: ${result.removed}`);
  console.log('Unrelated Codex hooks and settings were left in place.');
}

if (require.main === module) {
  try {
    uninstall();
  } catch (error) {
    console.error(`Uninstall failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  isEmptyGeneratedHooksFile,
  uninstall,
};
