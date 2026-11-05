# Operations

## Data layout

Everything persistent lives in the `/data` volume:

```
/data/
  database.sqlite        # all application state — accounts, orgs, telemetry
  .env                   # persistent config, including APP_KEY
```

`/var/www/backend/.env` is a symlink to `/data/.env`. The `.env` file survives
container replacement and upgrades; values passed via `docker -e` /
compose `environment:` are applied to it on every boot.

## Backup

Stop-time-consistent backup (SQLite does not need a stopped DB, but this is
the simplest correct method):

```bash
docker exec chaosmonkey sqlite3 /data/database.sqlite ".backup /data/backup.sqlite"
docker cp chaosmonkey:/data/backup.sqlite ./chaosmonkey-backup-$(date +%F).sqlite
docker exec chaosmonkey rm /data/backup.sqlite
# also back up the persistent .env — it holds APP_KEY
docker cp chaosmonkey:/data/.env ./chaosmonkey-env-backup-$(date +%F)
```

Or back up the whole volume — this is the recommended method since it
captures both the database and `.env` (which contains `APP_KEY`):

```bash
docker run --rm -v chaosmonkey-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/chaosmonkey-data-$(date +%F).tgz -C /data .
```

> **APP_KEY persistence**: the container's `.env` lives on the `/data` volume
> (`/data/.env`, symlinked into the app). `APP_KEY` is generated once on first
> boot and survives container replacement and upgrades — it protects all
> encrypted data and session cookies. If `APP_KEY` is lost, encrypted data
> cannot be recovered and all sessions are invalidated. You may pin it
> explicitly with `docker -e APP_KEY=base64:...` (generate one via
> `php artisan key:generate --show`). Keep backups of `/data/.env` safe — it
> is a secret.

## Restore

```bash
docker stop chaosmonkey
docker run --rm -v chaosmonkey-data:/data -v "$PWD":/backup alpine \
  sh -c "cp /backup/chaosmonkey-backup-YYYY-MM-DD.sqlite /data/database.sqlite"
docker start chaosmonkey
```

Migrations run on startup and are additive — restoring an older database on a
newer image re-runs only the missing migrations.

## Upgrades

Pull the new pinned image, replace the container, keep the volume:

```bash
docker pull ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.1   # pin the new version
docker stop chaosmonkey && docker rm chaosmonkey
docker run -d --name chaosmonkey -p 127.0.0.1:8080:80 -v chaosmonkey-data:/data \
  ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.1
```

**Always back up before upgrading.**

## Remote hosting

The quickstart binds to loopback (`127.0.0.1:8080`) so a fresh install is only
reachable from the local machine. Exposing ChaosMonkey to your network or the
internet is a deliberate step:

1. Bind a non-loopback address — replace the port mapping with `-p 8080:80`
   (all interfaces) or `-p <host-ip>:8080:80` for a specific interface.
2. Terminate TLS in front of it — see
   [installation.md#https](installation.md#https). Do not serve ChaosMonkey to
   other users over plain HTTP.
3. Set `APP_URL`, `APP_FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, and
   `SESSION_SECURE_COOKIES=true` to your HTTPS origin.
4. Restrict access at the proxy or firewall layer if the instance should be
   team-internal. Anyone who can reach the app can attempt login and OAuth.

## Health checks

- HTTP: `GET http://host:8080/up` → `200 OK` (Laravel health route)
- Container: `docker exec chaosmonkey php /var/www/backend/artisan about`

## Logs

All app + nginx logs go to stdout/stderr:

```bash
docker logs -f chaosmonkey
```

## Telemetry retention

There is no automatic pruning. Telemetry events are kept until you delete
them — an authenticated admin can clear telemetry via `POST /api/clear-data`,
or operate directly on the SQLite file in `/data`. Plan your own retention
policy (e.g. scheduled export + clear) if you need bounded growth.

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 on /api | `docker logs chaosmonkey` — php-fpm or migration failure |
| Blank page | Browser console; `APP_FRONTEND_URL`/`CORS_ALLOWED_ORIGINS` mismatch |
| OAuth redirect fails | `GITHUB_OAUTH_REDIRECT` must match the GitHub app callback exactly |
| Permission denied on /data | `docker exec chaosmonkey chown -R www-data:www-data /data` |
| Locked database | SQLite + single container — don't run two containers on one volume |
