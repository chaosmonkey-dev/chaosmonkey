#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Cursor Agent Bridge — Uninstaller
 * Version: 0.4.2-cursor-bridge
 *
 * Removes:
 *   1. ChaosMonkey hook commands from ~/.cursor/hooks.json
 *      (preserving ALL other hooks and settings)
 *   2. Config, state, queue, and log files from ~/.chaosmonkey-cursor-bridge/
 *
 * Does NOT remove:
 *   - ~/.cursor/hooks.json itself
 *   - Any non-ChaosMonkey hooks or settings
 *   - Project-level .cursor/hooks.json files (never touched by this bridge)
 *   - ~/.claude/settings.json
 *   - Cursor itself
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cursor-bridge');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const QUEUE_PATH = path.join(STATE_DIR, 'queue.json');
const LOG_PATH = path.join(STATE_DIR, 'bridge.log');
const RUNTIME_DIR = path.join(STATE_DIR, 'runtime');
const CURSOR_HOOKS_PATH = path.join(os.homedir(), '.cursor', 'hooks.json');
const BRIDGE_SCRIPT = path.resolve(__dirname, 'bridge.js');

const HOOK_MARKER = 'chaosmonkey-cursor-bridge';

function log(msg) {
  process.stdout.write(msg + '\n');
}

function isCmHookCommand(command) {
  if (!command || typeof command !== 'string') return false;
  return command.includes(RUNTIME_DIR) || command.includes(BRIDGE_SCRIPT) || command.includes(HOOK_MARKER);
}

function removeCmHooksFromConfig() {
  if (!fs.existsSync(CURSOR_HOOKS_PATH)) {
    log('  No ~/.cursor/hooks.json found — nothing to remove.');
    return;
  }

  let hooksConfig;
  try {
    hooksConfig = JSON.parse(fs.readFileSync(CURSOR_HOOKS_PATH, 'utf8'));
  } catch (e) {
    log(`  WARNING: could not parse hooks.json: ${e.message}`);
    log(`  Leaving file unchanged.`);
    return;
  }

  if (!hooksConfig.hooks || typeof hooksConfig.hooks !== 'object') {
    log('  No hooks section in hooks.json — nothing to remove.');
    return;
  }

  let totalRemoved = 0;
  for (const hookName of Object.keys(hooksConfig.hooks)) {
    if (!Array.isArray(hooksConfig.hooks[hookName])) continue;
    const before = hooksConfig.hooks[hookName].length;
    hooksConfig.hooks[hookName] = hooksConfig.hooks[hookName].filter((entry) => {
      if (!entry) return false;
      if (typeof entry === 'object' && typeof entry.command === 'string') {
        return !isCmHookCommand(entry.command);
      }
      return true; // unknown-format entries preserved exactly
    });
    totalRemoved += before - hooksConfig.hooks[hookName].length;
    if (hooksConfig.hooks[hookName].length === 0) {
      delete hooksConfig.hooks[hookName];
    }
  }

  if (totalRemoved > 0) {
    const backupPath = CURSOR_HOOKS_PATH + '.backup-uninstall-' + Date.now();
    fs.copyFileSync(CURSOR_HOOKS_PATH, backupPath);
    fs.chmodSync(backupPath, 0o600);
    const tmpPath = CURSOR_HOOKS_PATH + '.tmp-' + process.pid;
    fs.writeFileSync(tmpPath, JSON.stringify(hooksConfig, null, 2));
    fs.renameSync(tmpPath, CURSOR_HOOKS_PATH);
    log(`  Removed ${totalRemoved} ChaosMonkey hook command(s) from hooks.json`);
    log(`  Backup saved`);
  } else {
    log('  No ChaosMonkey hooks found in hooks.json.');
  }
}

function removeStateFiles() {
  const files = [CONFIG_PATH, STATE_PATH, QUEUE_PATH, LOG_PATH];
  let removed = 0;
  for (const f of files) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        removed++;
      }
    } catch (e) {
      log(`  WARNING: could not remove ${f}: ${e.message}`);
    }
  }

  // Remove credential-bearing backup files (config.json.backup-*)
  try {
    if (fs.existsSync(STATE_DIR)) {
      for (const entry of fs.readdirSync(STATE_DIR)) {
        if (entry.startsWith('config.json.backup-')) {
          fs.unlinkSync(path.join(STATE_DIR, entry));
          removed++;
        }
      }
    }
  } catch (e) {
    log(`  WARNING: could not remove config backups: ${e.message}`);
  }

  // Remove the durable runtime and any stale staging/prev directories —
  // ChaosMonkey-owned only; nothing else lives under STATE_DIR.
  try {
    if (fs.existsSync(STATE_DIR)) {
      for (const entry of fs.readdirSync(STATE_DIR)) {
        if (entry === 'runtime' || entry.startsWith('runtime.staging-') || entry.startsWith('runtime.prev-')) {
          fs.rmSync(path.join(STATE_DIR, entry), { recursive: true, force: true });
          removed++;
        }
      }
    }
  } catch (e) {
    log(`  WARNING: could not remove runtime: ${e.message}`);
  }

  try {
    if (fs.existsSync(STATE_DIR) && fs.readdirSync(STATE_DIR).length === 0) {
      fs.rmdirSync(STATE_DIR);
      log(`  Removed empty directory ${STATE_DIR}`);
    }
  } catch {}
  if (removed > 0) log(`  Removed ${removed} state file(s)`);
}

function main() {
  log('========================================');
  log('ChaosMonkey Cursor Agent Bridge');
  log('Uninstaller');
  log('========================================\n');

  log('Removing ChaosMonkey hooks from ~/.cursor/hooks.json...');
  removeCmHooksFromConfig();

  log('\nRemoving bridge state files...');
  removeStateFiles();

  log('\n========================================');
  log('UNINSTALL COMPLETE');
  log('========================================');
  log('\nChaosMonkey Cursor agent telemetry hooks have been removed.');
  log('Your other Cursor hooks and settings are preserved.');
  log('No further telemetry will be collected.\n');
}

module.exports = {
  isCmHookCommand,
};

if (require.main === module) {
  main();
}
