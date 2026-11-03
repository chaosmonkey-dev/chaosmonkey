/**
 * Persistent Extension Connection State — P0-G Part E
 *
 * Explicit auth states persisted in globalState:
 *   CONNECTED
 *   AUTH_REQUIRED
 *   AUTHORIZATION_DENIED
 *
 * Transient offline/network failure remains a transport condition, not
 * permanent auth state.
 */

import * as vscode from 'vscode';

export type ConnectionState = 'CONNECTED' | 'AUTH_REQUIRED' | 'AUTHORIZATION_DENIED';

const STATE_KEY = 'chaosmonkey.authState';
const LAST_RENEWAL_KEY = 'chaosmonkey.lastRenewalAttemptAt';

/**
 * Persistent auth state manager backed by globalState.
 */
export class AuthStateManager {
  private state: ConnectionState = 'AUTH_REQUIRED';
  private context: vscode.ExtensionContext;
  private statusBar: vscode.StatusBarItem | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.load();
  }

  /**
   * Load persisted auth state from globalState.
   */
  load(): void {
    const stored = this.context.globalState.get<string>(STATE_KEY);
    if (stored === 'CONNECTED' || stored === 'AUTH_REQUIRED' || stored === 'AUTHORIZATION_DENIED') {
      this.state = stored as ConnectionState;
    } else {
      // Default: if no stored state, will be determined by token presence
      this.state = 'AUTH_REQUIRED';
    }
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if currently connected.
   */
  isConnected(): boolean {
    return this.state === 'CONNECTED';
  }

  /**
   * Check if auth is required (401 received).
   */
  isAuthRequired(): boolean {
    return this.state === 'AUTH_REQUIRED';
  }

  /**
   * Check if authorization is denied (403 received).
   */
  isAuthorizationDenied(): boolean {
    return this.state === 'AUTHORIZATION_DENIED';
  }

  /**
   * Set the connection state and persist it.
   */
  setState(newState: ConnectionState): void {
    this.state = newState;
    this.context.globalState.update(STATE_KEY, newState);
    this.updateStatusBar();
  }

  /**
   * Record the last renewal attempt timestamp.
   */
  recordRenewalAttempt(): void {
    this.context.globalState.update(LAST_RENEWAL_KEY, Date.now());
  }

  /**
   * Get the last renewal attempt timestamp (0 if never).
   */
  getLastRenewalAttempt(): number {
    return this.context.globalState.get<number>(LAST_RENEWAL_KEY) ?? 0;
  }

  /**
   * Check if a renewal attempt is allowed (throttle to prevent storms).
   * Minimum interval: 5 minutes.
   */
  isRenewalAllowed(): boolean {
    const last = this.getLastRenewalAttempt();
    if (last === 0) {
      return true;
    }
    const elapsed = Date.now() - last;
    const MIN_RENEWAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    return elapsed >= MIN_RENEWAL_INTERVAL_MS;
  }

  /**
   * Set the status bar item to update.
   */
  setStatusBar(item: vscode.StatusBarItem): void {
    this.statusBar = item;
    this.updateStatusBar();
  }

  /**
   * Update the status bar to reflect current auth state.
   */
  updateStatusBar(): void {
    if (!this.statusBar) {
      return;
    }

    switch (this.state) {
      case 'CONNECTED':
        this.statusBar.text = '$(check) ChaosMonkey: Connected';
        this.statusBar.tooltip = 'ChaosMonkey is connected and delivering telemetry';
        this.statusBar.backgroundColor = undefined;
        this.statusBar.color = undefined;
        this.statusBar.command = undefined;
        break;
      case 'AUTH_REQUIRED':
        this.statusBar.text = '$(key) ChaosMonkey: Reconnect';
        this.statusBar.tooltip = 'Authentication required — click to reconnect';
        this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBar.color = undefined;
        this.statusBar.command = 'chaosmonkeyTelemetry.connect';
        break;
      case 'AUTHORIZATION_DENIED':
        this.statusBar.text = '$(error) ChaosMonkey: Access denied';
        this.statusBar.tooltip = 'Authorization denied — your account does not have access';
        this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBar.color = undefined;
        this.statusBar.command = 'chaosmonkeyTelemetry.connect';
        break;
    }

    this.statusBar.show();
  }
}
