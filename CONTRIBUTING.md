# Contributing to ChaosMonkey

Thanks for your interest. Contributions of all sizes are welcome — bug reports,
docs, tests, and code.

## Getting started

1. Fork and clone the repository.
2. Run the development stack (see README → Development) or the Docker image.
3. Create a branch from `main`.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. By contributing, you certify that you wrote or have the right
to submit the work under the project's Apache-2.0 license.

Sign off every commit:

```bash
git commit -s
```

This adds `Signed-off-by: Your Name <you@example.com>` to the commit message.
PRs without sign-offs cannot be merged.

## Code conventions

- **Backend** — Laravel 12 / PHP 8.2+. Follow existing controller/service
  patterns; run `cd backend && ./vendor/bin/phpunit` before submitting.
- **Frontend** — Vue 3 composition API + TypeScript + Pinia + Tailwind. Run
  `npm run lint` and `npm run build`. Never assign to reactive state inside a
  Vue `computed()` getter — use methods, watchers, or event handlers.
- **Extensions/bridges** — dependency-free Node.js >= 18 where possible; each
  bridge has its own test suite (`npm test` inside the bridge directory).

## Tests

- New behavior should come with tests where the codebase already has them.
- Backend tests use PHPUnit; frontend tests use Vitest.
- Do not remove or weaken existing authorization or telemetry-attribution tests.

## Data and attribution rules

These invariants protect users of self-hosted installs:

- Telemetry from different tools must keep **separate attribution** — Cursor IDE,
  Cursor Agents Window, Claude Code, and Codex are distinct sources.
- Configured spend is an estimate; never present it as billing data.
- Telemetry-derived identity is not GitHub identity; don't conflate them in UI.
- Zero is measured data; only null/undefined is missing.
- Synthetic/demo data must be clearly labeled and never mixed into real
  aggregates.

## Pull requests

- Keep PRs focused; describe the *why* in the description.
- Update docs when behavior, configuration, or supported integrations change.
- Do not commit secrets, customer data, or credentials of any kind.
