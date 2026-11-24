# ADR-0004: SQLite-first self-hosting architecture

**Status:** accepted · **Area:** `docker/`, `backend/config/database.php`, `backend/database/migrations/`

## Context

ChaosMonkey targets self-hosted installs by teams that should not need to
operate a database fleet to evaluate or run the product. The operational
footprint had to be minimal: a single container, no queues, no workers, no
external services.

## Decision

- **Single all-in-one image**: nginx (SPA + `/api` proxy) → PHP-FPM →
  Laravel → SQLite. One `docker run` is a complete install.
- **All state on one volume**: `/data` holds `database.sqlite` and `.env`.
  Backup = copy the volume; restore = mount it back. Upgrades run pending
  migrations on container start; migrations are additive and never drop
  data.
- **No queues or workers**: ingestion and GitHub sync are synchronous or
  artisan-invoked; nothing depends on Redis/Horizon/cron infrastructure.
- **MySQL is the documented escape hatch**, not the default: `DB_*` env vars
  switch drivers, and migrations are driver-aware.

## Reasoning

- `docker/` contains the nginx config and entrypoint that performs
  first-run init (`.env`, `APP_KEY`, database file, migrations) — the
  cold-start path is exercised on every new container boot.
- `docs/installation.md` and `docs/operations.md` describe the
  backup/upgrade contract around the `/data` volume.

## Consequences

- Installation is a five-minute operation; restoration does not require
  database administration.
- Limitation: SQLite is a single-writer store — very large orgs with high
  ingest concurrency should evaluate the documented MySQL path; the product
  does not auto-migrate between drivers.
- Backup procedures can assume file-level consistency at quiesce; live
  backup should still copy the file atomically (e.g. SQLite `.backup`) to
  avoid torn pages.
