#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  BRIDGE_VERSION,
  stateDir,
  codexHooksPath,
  validateEndpointHttps,
  httpRequest,
  ensureStateDir,
  readJsonFile,
  writeJsonAtomic,
  copyFileMode0600,
  mergeCodexHooks,
} = require('./lib');
const { sendTestEvent } = require('./bridge');

const BRIDGE_SCRIPT = path.join(__dirname, 'bridge.js');

function promptInput(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (process.stdout.isTTY) {
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let input = '';
      process.stdin.on('data', (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode(false);
          rl.close();
          process.stdout.write('\n');
          resolve(input.trim());
        } else if (c === '\u0003') {
          process.stdin.setRawMode(false);
          rl.close();
          process.exit(130);
        } else if (c === '\u007f' || c === '\b') {
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    args[key] = rest.join('=');
  }
  return args;
}

function resolveCodex(codexBin) {
  const candidate = codexBin || process.env.CODEX_BIN || 'codex';
  try {
    const output = execFileSync(candidate, ['--version'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    const version = output.slice(0, 128);
    return { codex_executable: candidate, codex_cli_version: version || null };
  } catch {
    return { codex_executable: codexBin || null, codex_cli_version: null };
  }
}

async function exchangeConnectCode(apiBaseUrl, connectCode, installationId) {
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/api/ide/connect/exchange`;
  const body = JSON.stringify({
    code: connectCode,
    installation_id: installationId,
    extension_version: BRIDGE_VERSION,
  });
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body, 10000);
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`connect_exchange_failed_${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  if (!res.body || !res.body.token) {
    throw new Error('connect_exchange_invalid_response');
  }
  return res.body;
}

function restoreFile(pathToRestore, backupPath) {
  if (backupPath && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, pathToRestore);
    fs.chmodSync(pathToRestore, 0o600);
  } else {
    try { fs.unlinkSync(pathToRestore); } catch {}
  }
}

function cleanupIfExists(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

async function install() {
  const args = parseArgs(process.argv.slice(2));
  console.log('ChaosMonkey Codex Telemetry Bridge Installer\n');

  const apiBaseUrl = args['api-base-url'] || await promptInput('ChaosMonkey API base URL: ');
  if (!validateEndpointHttps(apiBaseUrl)) {
    console.error('\nAPI base URL must be HTTPS (HTTP allowed only for localhost/127.0.0.1/::1).');
    process.exit(1);
  }

  const connectCode = args['connect-code'] || await promptHidden('Connect code: ');
  if (!connectCode) {
    console.error('\nConnect code is required.');
    process.exit(1);
  }

  const installationId = crypto.randomUUID();
  const priorConfig = readJsonFile(path.join(stateDir(), 'config.json'), null);
  let identity;
  try {
    identity = await exchangeConnectCode(apiBaseUrl, connectCode, installationId);
  } catch (error) {
    console.error(`\nCould not exchange connect code (${error.message}).`);
    process.exit(1);
  }

  const codex = resolveCodex(args['codex-bin']);
  const hookMerge = mergeCodexHooks(BRIDGE_SCRIPT);
  if (!hookMerge.success) {
    console.error('\nCould not register Codex hooks because the existing Codex hooks configuration is malformed. No hook changes were applied.');
    process.exit(1);
  }

  const dir = ensureStateDir();
  const configPath = path.join(dir, 'config.json');
  const configBackup = fs.existsSync(configPath) ? `${configPath}.backup-${Date.now()}` : null;
  if (configBackup) copyFileMode0600(configPath, configBackup);

  const config = {
    api_base_url: apiBaseUrl,
    auth_token: identity.token,
    installation_id: installationId,
    developer_id: identity.developer_id || null,
    team_id: identity.team_id || null,
    organization_id: identity.organization_id || null,
    identity_source: identity.identity_source || 'backend_claimed',
    identity_schema_version: 1,
    enabled: true,
    bridge_version: BRIDGE_VERSION,
    bridge_schema_version: 1,
    codex_executable: codex.codex_executable,
    codex_cli_version: codex.codex_cli_version,
    codex_hooks_path: hookMerge.hooksPath,
    codex_hooks_existed: priorConfig && typeof priorConfig.codex_hooks_existed === 'boolean'
      ? priorConfig.codex_hooks_existed
      : hookMerge.hadExisting,
    installed_at: new Date().toISOString(),
  };

  try {
    writeJsonAtomic(configPath, config, 0o600);
    fs.chmodSync(dir, 0o700);
    const testOk = await sendTestEvent();
    if (!testOk) throw new Error('telemetry_test_failed');
  } catch (error) {
    restoreFile(configPath, configBackup);
    if (hookMerge.hadExisting) {
      restoreFile(hookMerge.hooksPath, hookMerge.backupPath);
    } else {
      cleanupIfExists(hookMerge.hooksPath);
    }
    cleanupIfExists(configBackup);
    cleanupIfExists(hookMerge.backupPath);
    console.error(`\nInstallation failed and local changes were rolled back (${error.message}).`);
    process.exit(1);
  }

  cleanupIfExists(configBackup);
  cleanupIfExists(hookMerge.backupPath);

  console.log('\nChaosMonkey Codex bridge installed.');
  console.log(`Bridge state: ${dir}`);
  console.log(`Codex hooks: ${hookMerge.hooksPath}`);
  console.log('\nCodex hook trust is required. Start Codex, open /hooks, review the ChaosMonkey hook, and trust it.');
  console.log('The bridge never uses --dangerously-bypass-hook-trust and will not run until Codex trust is granted.');
}

if (require.main === module) {
  install().catch((error) => {
    console.error(`\nInstallation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  resolveCodex,
  exchangeConnectCode,
  restoreFile,
  install,
};
