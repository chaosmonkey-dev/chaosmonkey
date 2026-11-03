/**
 * ============================================================================
 * GIT CONTEXT CAPTURE - SIDE-CAR MODULE
 * ============================================================================
 * 
 * This module provides Git context (repo URL, branch name) for telemetry enrichment.
 * It accesses the built-in vscode.git extension API without modifying session tracking.
 * 
 * Safety guarantees:
 * - Returns nulls if Git extension is missing or inactive
 * - Does not throw exceptions that could break telemetry flow
 * - Does not modify any existing telemetry or session state
 * 
 * ============================================================================
 */

import * as vscode from 'vscode';

/**
 * Git context resolution status
 * 
 * - pending: Git not ready yet (transient, should retry)
 * - resolved_full: Both repo URL and branch captured
 * - resolved_partial: Some context captured (e.g., branch only, or repo only)
 * - failed: Terminal failure (no retry will help)
 */
export type GitContextStatus = 'pending' | 'resolved_full' | 'resolved_partial' | 'failed';

/**
 * Git context resolution reason taxonomy
 * 
 * Transient (should retry):
 * - no_repos_yet: Git extension loaded but no repos available yet
 * - git_not_ready: Git extension exists but not active/ready
 * - timeout: Request timed out (not used here, but could be used by caller)
 * 
 * Partial (stop retrying, partial success):
 * - no_remote: Repo exists, branch exists, but no remotes configured
 * - detached_head: Repo exists, remotes may exist, but HEAD is detached
 * 
 * Terminal (stop retrying, permanent failure):
 * - no_git_extension: vscode.git extension not installed
 * - exception: Unexpected error during capture
 * 
 * Success:
 * - full_context: Both repo URL and branch captured
 */
export type GitContextReason = 
  | 'no_repos_yet'
  | 'git_not_ready'
  | 'timeout'
  | 'no_remote'
  | 'detached_head'
  | 'no_git_extension'
  | 'exception'
  | 'full_context';

/**
 * Git context information captured from the active workspace
 */
export interface GitContext {
  /** Remote repository URL (from 'origin' or first available remote) */
  repoUrl: string | null;
  /** Current branch name (from HEAD) */
  branch: string | null;
}

/**
 * Extended Git context result with status information for retry logic
 */
export interface GitContextResult extends GitContext {
  /** Resolution status */
  status: GitContextStatus;
  /** Reason for the status (for logging and retry decisions) */
  reason: GitContextReason;
  /** Whether this is a transient failure that may resolve with retry */
  isTransient: boolean;
  /** Whether this is a terminal failure that won't resolve with retry */
  isTerminal: boolean;
  /** Human-readable message for logging */
  message: string;
}

/**
 * Git Extension API types (simplified from vscode.git.d.ts)
 */
interface GitExtensionAPI {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  onDidChange: vscode.Event<void>;
}

interface RepositoryState {
  HEAD: Branch | undefined;
  remotes: Remote[];
}

interface Branch {
  name?: string;
  commit?: string;
}

interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

/**
 * Capture Git context from the active workspace (legacy simple version)
 *
 * Strategy:
 * 1. Get the vscode.git extension
 * 2. Find the repository for the active editor's file (or fallback to first repo)
 * 3. Extract branch name from HEAD
 * 4. Extract remote URL (prefer 'origin', fallback to first remote)
 *
 * @returns GitContext with branch and repoUrl (nulls if unavailable)
 * @deprecated Use getGitDetailsExtended() for better error handling
 */
export async function getGitDetails(): Promise<GitContext> {
  const result = await getGitDetailsExtended();
  return { repoUrl: result.repoUrl, branch: result.branch };
}

/**
 * Sanitize a Git remote URL by stripping any embedded HTTP/HTTPS userinfo
 * (username and password/token) before the URL is emitted in telemetry.
 *
 * SSH-form remotes (e.g. `git@github.com:org/repo.git`) and other non-URL
 * forms contain no embedded credentials and are returned unchanged. Only
 * URLs parseable by the WHATWG URL parser have their `username`/`password`
 * cleared. The host, path, and query (repo identity) are preserved so repo
 * correlation is unaffected.
 *
 * This is the single chokepoint for credential-safe remote URL handling.
 *
 * @param url Raw remote URL from vscode.git (fetchUrl/pushUrl)
 * @returns Sanitized URL with no embedded userinfo, or the original on parse failure
 */
export function sanitizeRepoUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    // Only HTTP(S) URLs can carry embedded userinfo; clear it unconditionally.
    // SSH/SCP-style remotes are not parseable by URL() and fall through to the catch.
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    // Not an http(s) URL (e.g. `git@host:org/repo.git`) — no embedded creds.
    return url;
  }
}

/**
 * Capture Git context with extended status information
 * 
 * This function returns detailed status and reason information to support:
 * - Transient vs terminal failure classification
 * - Partial resolution (e.g., branch only, or repo only)
 * - Retry logic decisions
 * 
 * @returns GitContextResult with status, reason, and retry guidance
 */
export async function getGitDetailsExtended(): Promise<GitContextResult> {
  try {
    // Step A: Get the Git extension
    const gitExtension = vscode.extensions.getExtension<GitExtensionAPI>('vscode.git');
    
    if (!gitExtension) {
      console.log('[ChaosMonkey][GitContext] Git Extension Active: false (extension not found)');
      return {
        repoUrl: null,
        branch: null,
        status: 'failed',
        reason: 'no_git_extension',
        isTransient: false,
        isTerminal: true,
        message: 'Git extension not installed or disabled',
      };
    }

    // Step B: Activate the extension if needed and get API version 1
    if (!gitExtension.isActive) {
      try {
        await gitExtension.activate();
      } catch (activationErr) {
        console.log('[ChaosMonkey][GitContext] Git extension activation failed:', activationErr);
        return {
          repoUrl: null,
          branch: null,
          status: 'pending',
          reason: 'git_not_ready',
          isTransient: true,
          isTerminal: false,
          message: 'Git extension exists but failed to activate (may retry)',
        };
      }
    }

    const git = gitExtension.exports.getAPI(1);
    console.log('[ChaosMonkey][GitContext] Git Extension Active: true');

    if (!git.repositories || git.repositories.length === 0) {
      console.log('[ChaosMonkey][GitContext] Repo Found: false (no repositories yet)');
      return {
        repoUrl: null,
        branch: null,
        status: 'pending',
        reason: 'no_repos_yet',
        isTransient: true,
        isTerminal: false,
        message: 'Git extension active but no repositories loaded yet (may retry)',
      };
    }

    // Step C: Find the repository for the active editor's document
    let targetRepo: Repository | undefined;

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const documentUri = activeEditor.document.uri;
      
      // Find the repository that contains this file
      targetRepo = git.repositories.find(repo => {
        const repoRoot = repo.rootUri.fsPath;
        const filePath = documentUri.fsPath;
        return filePath.startsWith(repoRoot);
      });
    }

    // Fallback to first repository if no match found
    if (!targetRepo) {
      targetRepo = git.repositories[0];
    }

    console.log('[ChaosMonkey][GitContext] Repo Found: true');

    // Step D: Extract branch and remote URL
    const state = targetRepo.state;

    // Get branch name from HEAD
    const branch = state.HEAD?.name || null;
    const isDetachedHead = !branch && state.HEAD?.commit !== undefined;
    console.log(`[ChaosMonkey][GitContext] Branch: ${branch || (isDetachedHead ? '(detached HEAD)' : '(unknown)')}`);

    // Get remote URL (prefer 'origin', fallback to first remote)
    let repoUrl: string | null = null;
    const hasRemotes = state.remotes && state.remotes.length > 0;
    if (hasRemotes) {
      const originRemote = state.remotes.find(r => r.name === 'origin');
      const targetRemote = originRemote || state.remotes[0];
      // Sanitize before any downstream use/telemetry emission — strip embedded userinfo.
      repoUrl = sanitizeRepoUrl(targetRemote.fetchUrl || targetRemote.pushUrl || null);
    }

    // Classify the result based on what we captured
    // Case 1: Full context (both repo URL and branch)
    if (repoUrl !== null && branch !== null) {
      console.log('[ChaosMonkey][GitContext] Full context captured');
      return {
        repoUrl,
        branch,
        status: 'resolved_full',
        reason: 'full_context',
        isTransient: false,
        isTerminal: false,
        message: 'Full Git context captured (repo URL + branch)',
      };
    }

    // Case 2: Detached HEAD (have repo URL but no branch name)
    if (isDetachedHead) {
      console.log('[ChaosMonkey][GitContext] Partial: detached HEAD');
      return {
        repoUrl,
        branch: null,
        status: 'resolved_partial',
        reason: 'detached_head',
        isTransient: false,
        isTerminal: false,  // Not terminal - just partial success
        message: repoUrl 
          ? 'Partial context: detached HEAD (repo URL captured, no branch)'
          : 'Partial context: detached HEAD with no remotes',
      };
    }

    // Case 3: No remotes configured (have branch but no repo URL)
    if (!hasRemotes && branch !== null) {
      console.log('[ChaosMonkey][GitContext] Partial: no remotes configured');
      return {
        repoUrl: null,
        branch,
        status: 'resolved_partial',
        reason: 'no_remote',
        isTransient: false,
        isTerminal: false,  // Not terminal - just partial success
        message: 'Partial context: no remotes configured (branch captured, no repo URL)',
      };
    }

    // Case 4: No remotes AND no branch (local repo with no remotes, detached)
    if (!hasRemotes && branch === null) {
      console.log('[ChaosMonkey][GitContext] Partial: no remotes and no branch');
      return {
        repoUrl: null,
        branch: null,
        status: 'resolved_partial',
        reason: isDetachedHead ? 'detached_head' : 'no_remote',
        isTransient: false,
        isTerminal: false,
        message: 'Partial context: local repository with no remotes or branch',
      };
    }

    // Case 5: Unexpected - have remotes but no URL extracted (malformed remote config)
    console.log('[ChaosMonkey][GitContext] Partial: remotes exist but no URL extracted');
    return {
      repoUrl: null,
      branch,
      status: 'resolved_partial',
      reason: 'no_remote',
      isTransient: false,
      isTerminal: false,
      message: 'Partial context: remotes configured but no valid URL found',
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`[ChaosMonkey][GitContext] Exception capturing Git context: ${errorMessage}`);
    return {
      repoUrl: null,
      branch: null,
      status: 'failed',
      reason: 'exception',
      isTransient: false,
      isTerminal: true,
      message: `Exception during Git capture: ${errorMessage}`,
    };
  }
}

// ============================================================================
// COMMIT LISTENER - AUTOMATED COMMIT DETECTION
// ============================================================================

/**
 * Information about a detected commit
 */
export interface CommitInfo {
  /** The commit SHA hash */
  commitHash: string;
  /** Current branch name (null if detached HEAD) */
  branch: string | null;
  /** Remote repository URL */
  repoUrl: string | null;
  /** Repository name (extracted from path) */
  repoName: string;
}

/**
 * Register a listener for Git commits across all repositories
 * 
 * Strategy:
 * 1. Get Git API
 * 2. Watch all currently loaded repositories
 * 3. Subscribe to onDidOpenRepository for dynamically loaded repos
 * 4. Poll for repositories for 15 seconds (handles lazy loading race condition)
 * 5. Track HEAD.commit changes per repository
 * 6. Fire callback only when commit hash actually changes (not on initial load)
 * 
 * This handles the race condition where the extension activates before
 * the Git extension has finished loading repositories. The polling mechanism
 * ensures we catch repos that appear after activation but before events fire.
 * 
 * @param callback Function to call when a new commit is detected
 * @returns Array of disposables for cleanup
 */
export async function registerCommitListener(
  callback: (info: CommitInfo) => void
): Promise<vscode.Disposable[]> {
  const disposables: vscode.Disposable[] = [];
  
  // Track last known commit hash per repository path
  const lastCommitMap = new Map<string, string | undefined>();
  
  // Track which repos we're already watching to prevent double listeners
  const watchedRepos = new Set<string>();

  try {
    // Get the Git extension
    const gitExtension = vscode.extensions.getExtension<GitExtensionAPI>('vscode.git');
    
    if (!gitExtension) {
      console.log('[ChaosMonkey][CommitListener] Git Extension not found, skipping commit listener');
      return disposables;
    }

    // Activate the extension if needed
    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const git = gitExtension.exports.getAPI(1);

    /**
     * Helper: Watch a single repository for commits
     * This is called for initial repos, dynamically opened repos, and polled repos
     * Returns true if the repo was newly watched, false if already watching
     */
    function watchRepository(repo: Repository, source: string): boolean {
      const repoPath = repo.rootUri.path;
      const repoName = repoPath.split('/').pop() || 'unknown';
      
      // Prevent double-watching the same repo
      if (watchedRepos.has(repoPath)) {
        return false; // Already watching
      }
      
      watchedRepos.add(repoPath);
      
      // Initialize with current commit hash (so we don't fire on first load)
      const initialHash = repo.state.HEAD?.commit;
      lastCommitMap.set(repoPath, initialHash);
      
      console.log(`[ChaosMonkey][CommitListener] 👀 Watching repo (${source}): ${repoName}`);
      console.log(`[ChaosMonkey][CommitListener]    Initial hash: ${initialHash?.substring(0, 7) || 'none'}`);
      console.log(`[ChaosMonkey][CommitListener]    HEAD exists: ${!!repo.state.HEAD}`);
      console.log(`[ChaosMonkey][CommitListener]    onDidChange exists: ${typeof repo.onDidChange}`);

      // Subscribe to state changes
      const listener = repo.onDidChange(() => {
        try {
          const currentHash = repo.state.HEAD?.commit;
          const lastHash = lastCommitMap.get(repoPath);
          const currentBranch = repo.state.HEAD?.name;

          // DEBUG: Log EVERY state change event
          console.log(`[ChaosMonkey][CommitListener] 🔔 STATE CHANGE EVENT in ${repoName}:`, {
            currentHash: currentHash?.substring(0, 7) || 'none',
            lastHash: lastHash?.substring(0, 7) || 'none',
            branch: currentBranch || 'detached',
            hashChanged: currentHash !== lastHash,
            lastHashDefined: lastHash !== undefined
          });

          // Only fire if:
          // 1. Current hash exists (we have a commit)
          // 2. Hash has changed from what we knew
          // 3. Last hash was defined (prevents firing on initial load)
          if (currentHash && currentHash !== lastHash && lastHash !== undefined) {
            // Update our tracking
            lastCommitMap.set(repoPath, currentHash);

            // Extract branch and remote URL
            const branch = repo.state.HEAD?.name || null;
            let repoUrl: string | null = null;

            if (repo.state.remotes && repo.state.remotes.length > 0) {
              const originRemote = repo.state.remotes.find(r => r.name === 'origin');
              const targetRemote = originRemote || repo.state.remotes[0];
              // Sanitize before emission — strip embedded userinfo/credentials.
              repoUrl = sanitizeRepoUrl(targetRemote.fetchUrl || targetRemote.pushUrl || null);
            }

            const commitInfo: CommitInfo = {
              commitHash: currentHash,
              branch,
              repoUrl,
              repoName
            };

            console.log(`[ChaosMonkey][CommitListener] 🟢 NEW COMMIT DETECTED!!! ${currentHash.substring(0, 7)} on ${branch || 'detached'}`);
            
            // Fire the callback
            callback(commitInfo);
          } else if (currentHash && currentHash !== lastHash) {
            // Hash changed but lastHash was undefined (initial state)
            // Just update tracking without firing
            lastCommitMap.set(repoPath, currentHash);
            console.log(`[ChaosMonkey][CommitListener] Initial commit hash recorded: ${currentHash.substring(0, 7)}`);
          } else {
            // DEBUG: Log why we didn't fire
            console.log(`[ChaosMonkey][CommitListener] ⏭️ Skipped (no hash change or initial state)`);
          }
        } catch (err) {
          console.error('[ChaosMonkey][CommitListener] Error in change handler:', err);
        }
      });

      disposables.push(listener);
      console.log(`[ChaosMonkey][CommitListener] ✅ Listener attached for ${repoName}. Total disposables: ${disposables.length}`);
      return true; // Newly watched
    }

    // =========================================================================
    // INITIAL SCAN: Watch all currently loaded repositories
    // =========================================================================
    const initialRepoCount = git.repositories?.length || 0;
    
    if (initialRepoCount > 0) {
      console.log(`[ChaosMonkey][CommitListener] Initial scan: ${initialRepoCount} repositories found`);
      for (const repo of git.repositories) {
        watchRepository(repo, 'initial');
      }
    } else {
      console.log('[ChaosMonkey][CommitListener] Initial scan: No repositories yet (polling + dynamic loading enabled)');
    }

    // =========================================================================
    // DYNAMIC SCAN: Watch for repositories opened after extension activation
    // =========================================================================
    const repoOpenListener = git.onDidOpenRepository((repo: Repository) => {
      const repoName = repo.rootUri.path.split('/').pop() || 'unknown';
      console.log(`[ChaosMonkey][CommitListener] 📂 Repository dynamically opened: ${repoName}`);
      watchRepository(repo, 'dynamic');
    });
    disposables.push(repoOpenListener);

    // Log when repos are closed and clean up tracking
    const repoCloseListener = git.onDidCloseRepository((repo: Repository) => {
      const repoPath = repo.rootUri.path;
      const repoName = repoPath.split('/').pop() || 'unknown';
      console.log(`[ChaosMonkey][CommitListener] 📁 Repository closed: ${repoName}`);
      // Clean up tracking
      watchedRepos.delete(repoPath);
      lastCommitMap.delete(repoPath);
    });
    disposables.push(repoCloseListener);

    // =========================================================================
    // POLLING: Handle race condition where repos appear after activation
    // but before onDidOpenRepository fires (lazy loading scenario)
    // =========================================================================
    const POLL_INTERVAL_MS = 1000;  // Check every 1 second
    const POLL_TIMEOUT_MS = 15000;  // Stop after 15 seconds
    const pollStartTime = Date.now();
    let pollCount = 0;

    const pollInterval = setInterval(() => {
      try {
        pollCount++;
        const elapsed = Date.now() - pollStartTime;

        // Check for timeout
        if (elapsed >= POLL_TIMEOUT_MS) {
          clearInterval(pollInterval);
          console.log(`[ChaosMonkey][CommitListener] 🛑 Polling stopped (timeout reached after ${pollCount} polls). Watching ${watchedRepos.size} repos.`);
          return;
        }

        // Check for new repositories
        const currentRepos = git.repositories || [];
        let newReposFound = 0;

        for (const repo of currentRepos) {
          const wasNew = watchRepository(repo, 'poll');
          if (wasNew) {
            const repoName = repo.rootUri.path.split('/').pop() || 'unknown';
            console.log(`[ChaosMonkey][CommitListener] 🔄 Polling found new repo: ${repoName}`);
            newReposFound++;
          }
        }

        // Log periodic status (every 5 polls = 5 seconds)
        if (pollCount % 5 === 0) {
          console.log(`[ChaosMonkey][CommitListener] 🔄 Polling tick #${pollCount}: ${currentRepos.length} repos available, ${watchedRepos.size} watched`);
        }
      } catch (err) {
        console.error('[ChaosMonkey][CommitListener] Polling error:', err);
      }
    }, POLL_INTERVAL_MS);

    // Create a disposable to clean up the polling interval
    const pollDisposable: vscode.Disposable = {
      dispose: () => {
        clearInterval(pollInterval);
        console.log('[ChaosMonkey][CommitListener] 🛑 Polling disposed (extension deactivating)');
      }
    };
    disposables.push(pollDisposable);

    console.log(`[ChaosMonkey][CommitListener] ✅ Git Commit Listener active. Initial: ${initialRepoCount} repos. Polling for ${POLL_TIMEOUT_MS / 1000}s. Dynamic loading enabled.`);

  } catch (err) {
    console.error('[ChaosMonkey][CommitListener] Failed to register commit listeners:', err);
  }

  return disposables;
}
