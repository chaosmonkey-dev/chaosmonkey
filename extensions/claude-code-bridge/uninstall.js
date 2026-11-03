#!/usr/bin/env node
'use strict';

/**
 * ChaosMonkey Claude Code Terminal Bridge — Uninstaller
 * Version: 0.4.2-cc-bridge
 *
 * Removes:
 *   1. ChaosMonkey hook commands from ~/.claude/settings.json (preserving ALL other hooks/settings)
 *   2. Config and state files from ~/.chaosmonkey-cc-bridge/
 *
 * Does NOT remove:
 *   - ~/.claude/settings.json itself
 *   - Any non-ChaosMonkey hooks or settings
 *   - Claude Code itself
 *
 * If an entry contains multiple hook commands (CM + unrelated), removes only
 * the CM commands and preserves the unrelated commands. Does NOT delete the
 * entire mixed entry.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = path.join(os.homedir(), '.chaosmonkey-cc-bridge');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const LOG_PATH = path.join(STATE_DIR, 'bridge.log');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const BRIDGE_SCRIPT = path.resolve(__dirname, 'bridge.js');

const HOOK_MARKER = 'chaosmonkey-cc-bridge';

function log(msg) {
  process.stdout.write(msg + '\n');
}

// Check if a hook command belongs to ChaosMonkey bridge
function isCmHookCommand(command) {
  if (!command || typeof command !== 'string') return false;
  return command.includes(BRIDGE_SCRIPT) || command.includes(HOOK_MARKER);
}

// Remove only CM commands from a hooks array, preserving all others
function removeCmCommandsFromHooks(hooksArray) {
  if (!Array.isArray(hooksArray)) return 0;
  let removed = 0;
  const filtered = hooksArray.filter((h) => {
    if (isCmHookCommand(h.command)) {
      removed++;
      return false; // remove CM command
    }
    return true; // keep everything else
  });
  hooksArray.length = 0;
  hooksArray.push(...filtered);
  return removed;
}

function removeCmHooksFromSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    log('  No ~/.claude/settings.json found — nothing to remove.');
    return;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  } catch (e) {
    log(`  WARNING: could not parse settings.json: ${e.message}`);
    log(`  Leaving file unchanged.`);
    return;
  }

  if (!settings.hooks) {
    log('  No hooks section in settings.json — nothing to remove.');
    return;
  }

  let totalRemoved = 0;
  for (const hookName of Object.keys(settings.hooks)) {
    for (const entry of settings.hooks[hookName]) {
      if (entry && Array.isArray(entry.hooks)) {
        // Remove only CM commands from this entry, preserving unrelated commands
        totalRemoved += removeCmCommandsFromHooks(entry.hooks);
      }
      // Unknown-format entries (no hooks array) are untouched
    }
    // Remove entries that are now empty (had only CM commands removed)
    // BUT preserve entries that do not have an array `hooks` property (unknown formats)
    const beforeLen = settings.hooks[hookName].length;
    settings.hooks[hookName] = settings.hooks[hookName].filter((entry) => {
      if (!entry) return false; // drop null/undefined entries
      if (Array.isArray(entry.hooks)) {
        // Standard entry: keep only if it still has commands after CM removal
        return entry.hooks.length > 0;
      }
      // Unknown-format entry (no hooks array): preserve EXACTLY
      return true;
    });
    // Clean up empty hook arrays
    if (settings.hooks[hookName].length === 0) {
      delete settings.hooks[hookName];
    }
  }

  if (totalRemoved > 0) {
    const backupPath = CLAUDE_SETTINGS_PATH + '.backup-uninstall-' + Date.now();
    fs.copyFileSync(CLAUDE_SETTINGS_PATH, backupPath);
    fs.chmodSync(backupPath, 0o600);
    // Atomic write via temp file
    const tmpPath = CLAUDE_SETTINGS_PATH + '.tmp-' + process.pid;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
    fs.renameSync(tmpPath, CLAUDE_SETTINGS_PATH);
    log(`  Removed ${totalRemoved} ChaosMonkey hook command(s) from settings.json`);
    log(`  Backup saved`);
  } else {
    log('  No ChaosMonkey hooks found in settings.json.');
  }
}

function removeStateFiles() {
  const files = [CONFIG_PATH, STATE_PATH, LOG_PATH];
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
  // These contain auth_token and must not remain after uninstall.
  try {
    if (fs.existsSync(STATE_DIR)) {
      const entries = fs.readdirSync(STATE_DIR);
      for (const entry of entries) {
        if (entry.startsWith('config.json.backup-')) {
          fs.unlinkSync(path.join(STATE_DIR, entry));
          removed++;
        }
      }
    }
  } catch (e) {
    log(`  WARNING: could not remove config backup: ${e.message}`);
  }

  // Remove state directory if empty
  try {
    if (fs.existsSync(STATE_DIR) && fs.readdirSync(STATE_DIR).length === 0) {
      fs.rmdirSync(STATE_DIR);
      log(`  Removed empty directory ${STATE_DIR}`);
    }
  } catch {}
  if (removed > 0) log(`  Removed ${removed} state file(s) from ${STATE_DIR}`);
}

function main() {
  log('========================================');
  log('ChaosMonkey Claude Code Terminal Bridge');
  log('Uninstaller');
  log('========================================\n');

  log('Removing ChaosMonkey hooks from Claude Code settings...');
  removeCmHooksFromSettings();

  log('\nRemoving bridge state files...');
  removeStateFiles();

  log('\n========================================');
  log('UNINSTALL COMPLETE');
  log('========================================');
  log('\nChaosMonkey telemetry hooks have been removed.');
  log('Your other Claude Code settings and hooks are preserved.');
  log('No further telemetry will be collected.\n');
}

// Export functions for testing (when required, not run as main)
module.exports = {
  isCmHookCommand,
  removeCmCommandsFromHooks,
};

// Run main only when invoked directly (not when required by tests)
if (require.main === module) {
  main();
}