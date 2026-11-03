import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { sanitizeRepoUrl } from './gitContext';

/**
 * Regression tests for Git remote URL credential sanitization.
 *
 * Security contract: no embedded HTTP/HTTPS userinfo (username, password,
 * personal access token, or OAuth token) may leave the developer machine
 * in a telemetry payload. Repo identity (host/path) must be preserved.
 */
describe('sanitizeRepoUrl', () => {
  it('strips username:password from HTTPS remote URLs', () => {
    const raw = 'https://alice:s3cr3t@github.com/org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.ok(sanitized !== null);
    assert.ok(!sanitized!.includes('alice'), 'username must be stripped');
    assert.ok(!sanitized!.includes('s3cr3t'), 'password must be stripped');
    assert.ok(sanitized!.includes('github.com/org/repo.git'), 'repo identity must be preserved');
  });

  it('strips username:token from HTTPS remote URLs (PAT in password)', () => {
    const raw = 'https://ghp_1234567890abcdef1234567890abcdef12@github.com/org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.ok(sanitized !== null);
    assert.ok(!sanitized!.includes('ghp_'), 'personal access token must be stripped');
    assert.ok(sanitized!.includes('github.com/org/repo.git'), 'repo identity must be preserved');
  });

  it('strips username-only userinfo (no password)', () => {
    const raw = 'https://alice@github.com/org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.ok(sanitized !== null);
    assert.ok(!sanitized!.includes('alice'), 'username must be stripped');
    assert.ok(sanitized!.includes('github.com/org/repo.git'), 'repo identity must be preserved');
  });

  it('preserves SSH-form remotes unchanged (no embedded creds)', () => {
    const raw = 'git@github.com:org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.strictEqual(sanitized, raw, 'SSH remotes must be unchanged');
  });

  it('preserves plain HTTPS remotes with no userinfo', () => {
    const raw = 'https://github.com/org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.strictEqual(sanitized, raw, 'plain HTTPS remotes must be unchanged');
  });

  it('preserves GitLab HTTPS remotes with no userinfo', () => {
    const raw = 'https://gitlab.com/org/subgroup/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.strictEqual(sanitized, raw, 'plain GitLab remotes must be unchanged');
  });

  it('strips credentials from GitLab HTTPS remotes with userinfo', () => {
    const raw = 'https://deploy:glpat-xxxxxxxxxxxxxxxxxxxx@gitlab.com/org/repo.git';
    const sanitized = sanitizeRepoUrl(raw);
    assert.ok(sanitized !== null);
    assert.ok(!sanitized!.includes('deploy'), 'username must be stripped');
    assert.ok(!sanitized!.includes('glpat-'), 'token must be stripped');
    assert.ok(sanitized!.includes('gitlab.com/org/repo.git'), 'repo identity must be preserved');
  });

  it('returns null for null input', () => {
    assert.strictEqual(sanitizeRepoUrl(null), null);
  });

  it('returns null for empty string', () => {
    assert.strictEqual(sanitizeRepoUrl(''), null);
  });

  it('preserves query string and path on sanitized URLs', () => {
    const raw = 'https://user:pass@github.com/org/repo.git?foo=bar';
    const sanitized = sanitizeRepoUrl(raw);
    assert.ok(sanitized !== null);
    assert.ok(!sanitized!.includes('user'), 'username must be stripped');
    assert.ok(!sanitized!.includes('pass'), 'password must be stripped');
    assert.ok(sanitized!.includes('github.com/org/repo.git'), 'repo path must be preserved');
  });

  it('never contains a credential pattern after sanitization (fuzz-style check)', () => {
    const credPatterns = ['alice', 's3cr3t', 'ghp_', 'glpat-', 'deploy', 'password123'];
    const cases = [
      'https://alice:s3cr3t@github.com/org/repo.git',
      'https://ghp_token123@github.com/org/repo.git',
      'https://deploy:password123@gitlab.com/org/repo.git',
    ];
    for (const raw of cases) {
      const sanitized = sanitizeRepoUrl(raw);
      assert.ok(sanitized !== null, `sanitized must not be null for ${raw}`);
      for (const cred of credPatterns) {
        assert.ok(
          !sanitized!.includes(cred),
          `sanitized URL must not contain credential fragment "${cred}": got ${sanitized}`,
        );
      }
    }
  });
});
