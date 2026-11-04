# Operations

## Data layout

Everything persistent lives in the `/data` volume:

```
/data/
  database.sqlite        # all application state — accounts, orgs, telemetry
```

`/var/www/backend/.env` lives in the container; treat it as disposable — the
entrypoint regenerates it. If you want `.env` changes to survive container
replacement, set values via `docker -e` / compose `environment:` instead.

## Backup

Stop-time-consistent backup (SQLite does not need a stopped DB, but this is
the simplest correct method):

```bash
docker exec chaosmonkey sqlite3 /data/database.sqlite ".backup /data/backup.sqlite"
docker cp chaosmonkey:/data/backup.sqlite ./chaosmonkey-backup-$(date +%F).sqlite
docker exec chaosmonkey rm /data/backup.sqlite
```

Or back up the whole volume:

```bash
docker run --rm -v chaosmonkey-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/chaosmonkey-data-$(date +%F).tgz -C /data .
```

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

Rebuild the image, replace the container, keep the volume:

```bash
docker build -t chaosmonkey .
docker stop chaosmonkey && docker rm chaosmonkey
docker run -d --name chaosmonkey -p 8080:80 -v chaosmonkey-data:/data chaosmonkey
```

**Always back up before upgrading.**

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
