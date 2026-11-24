# ADR-0005: GitHub App delivery evidence and provenance

**Status:** accepted · **Area:** `GitHubAppWebhookController`, `GitHubAppIngestionService`, `GitHubAppSync`, `pull_requests`/`deployments`/`releases`

## Context

Correlating sessions with delivery outcomes (PRs, reviews, deployments)
requires org-level GitHub evidence. Two integration shapes were available:
per-user OAuth tokens, and a GitHub App installation. The evidence also had
to survive webhook gaps, retries, and backfills without corrupting counts.

## Decision

- **GitHub App is the org-evidence plane.** An installed App receives
  `pull_request`, `deployment`, and `deployment_status` events at
  `POST /api/github/app/webhook`, signature-verified with the configured
  webhook secret.
- **Rows are keyed by repository + object identity, not by installation.**
  `pull_requests`/`deployments`/`releases` carry `repo_name`, object numbers,
  and `data_source` (`'github_app'`) — they do not depend on App or
  installation IDs, so evidence persists across App ownership changes.
- **Writes are idempotent upserts.** Webhooks, deliveries replays, and
  `php artisan github:app-sync` converge on the same rows — safe to re-run.
- **`github:app-sync` is the gap-recovery mechanism** for missed windows:
  `--days=N --enrich-reviews --include-deployments` backfills from the API
  using the same upsert path.
- **OAuth remains the per-user identity plane** (login consent, optional
  admin engineering-data connection) — deliberately separate from App
  evidence (see `docs/architecture.md` and `integrations.md`).
- **Org-level evidence is not workflow attribution.** PRs/deployments are
  org/repo facts; the PI layer must not attribute them to sessions,
  workflows, or developers without an authoritative join (ADR-0001).

## Reasoning

- `GitHubAppWebhookController` verifies signatures and delegates to
  `GitHubAppIngestionService`, which performs keyed upserts.
- `GitHubAppSync` (`backend/app/Console/Commands/GitHubAppSync.php`)
  implements the API-side sync with the same idempotent semantics — it was
  exercised live during pilot operations as the documented gap-recovery
  path.

## Consequences

- Missed webhook windows are recoverable without data loss.
- Delivery metrics inherit GitHub-side semantics (e.g. a deployment reflects
  GitHub's deployment model, not necessarily your CD system).
- Limitation: evidence coverage is bounded by App permissions and
  `repository_selection`; private repos the App cannot see produce
  `null`/unavailable states, not zeros.
