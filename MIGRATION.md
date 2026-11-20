# Migrating to a Self-Hosted ChaosMonkey Instance

This guide describes how to move an existing ChaosMonkey deployment — including
all historical telemetry, GitHub evidence, users, and settings — onto your own
infrastructure using the published Docker image.

It is written for the infrastructure and security teams who will operate the
new instance. No access to ChaosMonkey internal documentation is required.

---

## 1. Prerequisites

### Linux VM

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB (history grows over time) |
| OS | Any Linux with Docker Engine 24+ | Ubuntu 22.04 LTS or later |

ChaosMonkey stores all application data in a single SQLite database file
(typically 50–200 MB for an established deployment). Most of the disk
recommendation is headroom for Docker, logs, and database growth.

### Software

- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`)
- A reverse proxy with TLS (nginx, Caddy, Traefik, or your platform standard)
- Outbound HTTPS access to `api.github.com` and `github.com` if you use the
  GitHub integration

### HTTPS hostname (required for GitHub integration)

You need a public HTTPS hostname such as `chaosmonkey.yourcompany.com` with a
valid TLS certificate. This is required for:

- GitHub webhook delivery (GitHub will not send webhooks to plain HTTP)
- OAuth redirect/callback URLs
- Secure browser sessions

The Docker container itself serves plain HTTP on port 80. Terminate TLS at
your reverse proxy and forward to the container.

---

## 2. Install the container

Use the published Compose file (`docker-compose.yml` in this repository) or
equivalent:

```yaml
services:
  chaosmonkey:
    image: ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.3
    ports:
      - "127.0.0.1:8080:80"
    volumes:
      - chaosmonkey-data:/data
    environment:
      APP_URL: https://chaosmonkey.yourcompany.com
      APP_FRONTEND_URL: https://chaosmonkey.yourcompany.com
    restart: unless-stopped

volumes:
  chaosmonkey-data:
```

```bash
docker compose up -d
docker compose exec chaosmonkey php artisan key:generate --force   # first run only
docker compose ps                                                  # expect "healthy"
```

Bind the container to `127.0.0.1` (as above) or your internal interface and let
the reverse proxy own the public port 443. Do not expose container port 80
directly to the internet.

### Persistent storage

All state lives in the `/data` volume:

```
/data/database.sqlite     # the entire application database
```

Mount `chaosmonkey-data` as a named volume (default) or a host directory. The
file must persist across container upgrades; everything else in the image is
disposable.

### Reverse proxy example (nginx)

```nginx
server {
    listen 443 ssl;
    server_name chaosmonkey.yourcompany.com;

    ssl_certificate     /etc/letsencrypt/live/chaosmonkey.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chaosmonkey.yourcompany.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Scheduled background tasks

Set up a recurring job for GitHub evidence synchronization, for example via
host cron:

```cron
*/30 * * * * docker compose exec -T chaosmonkey php artisan github:app-sync --days=2 --enrich-reviews >> /var/log/chaosmonkey-sync.log 2>&1
```

Run the full historical sync once after restore (see §6).

---

## 3. Migrate the database

### 3.1 Create a consistent backup on the source system

SQLite databases must be copied with the backup API, not with `cp` on a live
file:

```bash
sqlite3 /path/to/database.sqlite ".backup '/tmp/chaosmonkey-backup.sqlite'"
sqlite3 /tmp/chaosmonkey-backup.sqlite "PRAGMA integrity_check;"   # expect: ok
```

### 3.2 Transfer securely

Encrypt the backup before it leaves the source environment. Any of these is
acceptable — use whichever your security team prefers:

```bash
# GPG to a recipient controlled by your infra team
gpg --encrypt --recipient infra@yourcompany.com chaosmonkey-backup.sqlite

# or age
age -r age1...your-key chaosmonkey-backup.sqlite > chaosmonkey-backup.sqlite.age

# or place it on an encrypted volume / pre-signed object-store URL with TLS
```

The backup contains user accounts, developer telemetry, and — if OAuth was
used — stored GitHub OAuth tokens (see §5). Treat it as sensitive data.

### 3.3 Restore into the volume

```bash
# Decrypt on the destination VM
gpg --decrypt chaosmonkey-backup.sqlite.gpg > restored.sqlite

# Stop the app, replace the database, restart
docker compose stop chaosmonkey
docker run --rm -v chaosmonkey-data:/data -v "$PWD":/backup alpine \
    cp /backup/restored.sqlite /data/database.sqlite
docker compose up -d

# Verify inside the container
docker compose exec chaosmonkey sqlite3 /data/database.sqlite "PRAGMA integrity_check;"
docker compose exec chaosmonkey php artisan migrate:status
```

`integrity_check` must return `ok`. `migrate:status` must show no pending
migrations — if the backup came from a newer build, upgrade the image to the
same or newer version before starting traffic (migrations run automatically
on boot; the restore itself never needs a manual migration).

### 3.4 Reconcile record counts

Compare against the source system's counts before cutover:

```bash
docker compose exec chaosmonkey sqlite3 /data/database.sqlite "
  SELECT 'users', COUNT(*) FROM users UNION ALL
  SELECT 'organizations', COUNT(*) FROM organizations UNION ALL
  SELECT 'telemetry_events', COUNT(*) FROM telemetry_events UNION ALL
  SELECT 'pull_requests', COUNT(*) FROM pull_requests UNION ALL
  SELECT 'deployments', COUNT(*) FROM deployments;"
```

Counts on the restored instance must equal the source counts at backup time
(the source may grow further until cutover — see §6 for the final delta).

---

## 4. Configure integrations

All GitHub integration is optional — the dashboard works without it. Set the
variables in your Compose `environment:` block (or an `.env` file referenced
by Compose).

### 4.1 GitHub App (recommended for evidence ingestion)

Create **your own GitHub App** in your GitHub organization — do not reuse the
hosted service's app or its private key. Any historical GitHub evidence in
your database carries over regardless; the App is needed for *new* ingestion
and historical backfill.

Settings:

- **Webhook URL:** `https://chaosmonkey.yourcompany.com/api/github/app/webhook`
- **Webhook secret:** generate a strong secret; set `GITHUB_APP_WEBHOOK_SECRET`
- **Permissions:** contents (read), metadata (read), pull requests (read),
  deployments (read) — plus `issues` (read) if you use review-cycle enrichment
- **Subscribe to events:** pull request, pull request review, deployment,
  release
- **Install** the app on the organization and record the installation ID

Environment variables:

```
GITHUB_APP_ID=<your app id>
GITHUB_APP_INSTALLATION_ID=<your installation id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...entire PEM contents...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=<secret you configured>
```

Note `GITHUB_APP_PRIVATE_KEY` takes the full PEM as a single value — wrap in
quotes and keep newlines.

Verify the app is reachable and configured:

```bash
docker compose exec chaosmonkey php artisan github:app-sync --dry-run
```

This inventories the installation's repositories without writing anything.

### 4.2 Historical GitHub backfill

After the App is installed and the database restored, run one full historical
sync so the self-hosted instance has complete evidence:

```bash
docker compose exec chaosmonkey php artisan github:app-sync \
    --all --days=365 --enrich-reviews --include-deployments --include-releases
```

This is idempotent — safe to interrupt and re-run; existing rows are upserted,
not duplicated. Options:

- `--repo=owner/name` or `--repos=a,b` — sync a subset (validated against the
  installation's repositories)
- `--days=N` — historical window (default 90)
- `--from-repo=name` — resume after interruption
- `--dry-run` — inventory only

### 4.3 User OAuth sign-in (optional)

If users sign in with GitHub OAuth, create an OAuth App under your GitHub
organization (Settings → Developer settings → OAuth Apps):

- **Homepage URL:** `https://chaosmonkey.yourcompany.com`
- **Authorization callback URL:**
  `https://chaosmonkey.yourcompany.com/api/github/oauth/callback`

Then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Note: existing stored OAuth tokens in the migrated database remain valid for
API access, but new sign-ins flow through your OAuth app. Users may be asked
to re-authorize on first login — this is expected.

### 4.4 Telemetry clients (developer IDEs)

Each developer's ChaosMonkey integration (VS Code extension, Claude Code
bridge, etc.) must point at the new endpoint:

- **Endpoint:** `https://chaosmonkey.yourcompany.com/api/telemetry`
- **Token:** unchanged — ingest tokens live in the database and migrate with it

Update the endpoint in each client's configuration. Until a client is
repointed it will keep trying the old endpoint; no data is written to the new
instance from the old URL.

---

## 5. Credentials and secrets

| Item | Where it lives | What to do |
|---|---|---|
| `APP_KEY` | container env | Generate fresh (`php artisan key:generate`). Existing browser sessions are invalidated; that is the only effect. |
| Database file | `/data/database.sqlite` | Transfer encrypted. Contains users, telemetry, GitHub evidence, ingest tokens, and stored OAuth tokens. |
| GitHub OAuth user tokens | inside the database (`oauth_tokens`, stored plaintext) | They ride with the DB and remain valid, **but** rotating them is recommended: have users re-authorize after cutover, or revoke and reissue if your security policy requires it. Do not extract them into files, tickets, or chat. |
| Telemetry ingest bearer tokens | inside the database | Ride with the DB. Rotate per-client if required by policy. |
| `GITHUB_APP_PRIVATE_KEY` | env | **Your own app's key.** Never accept a private key handed over from the prior host; the prior host's key stays with the prior host. |
| `GITHUB_APP_WEBHOOK_SECRET` | env | You generate it. |
| `GITHUB_CLIENT_SECRET` | env | You generate it with your OAuth app. |
| Admin/dashboard tokens | inside the database (`api_tokens`, hashed) | Ride with the DB; verify you can log in before cutover. |

---

## 6. Cutover

Recommended sequence (the source/hosted service stays running until
acceptance is complete):

1. **Stand up the new instance** with an empty database; smoke-test the
   dashboard behind your hostname.
2. **Restore the full backup** (§3). Verify integrity and counts. Dashboard
   should render historical data.
3. **Configure the GitHub App** (§4.1) and run the historical backfill
   (§4.2). Verify PR/deployment counts reconcile.
4. **Final delta backup:** during a short coordinated window, take a second
   consistent backup, transfer, restore, and re-verify counts. This captures
   everything that arrived since step 2.
5. **Repoint webhooks:** update the GitHub App webhook URL to the new host
   (or install your new App — see §4.1 — and disable delivery on the old one
   to avoid duplicate ingestion).
6. **Repoint OAuth app** callback if used (§4.3).
7. **Repoint developer telemetry clients** (§4.4).
8. **Verify live ingestion:** confirm a new webhook event and a new telemetry
   event land on the new instance.
9. **Acceptance** (§7) — then keep the old instance idle but intact until you
   are satisfied.

**Webhook-gap recovery:** any events GitHub attempted to deliver while the
endpoint was unreachable or during the window are recoverable — re-run
`github:app-sync` for the affected period. This is why step 4's delta plus a
post-cutover `--days=3` sync covers the gap. True zero-loss requires the
delta-restore step; skipping it means events between step 2 and cutover are
missing unless re-fetched by app-sync.

**Duplicate prevention:** do not leave the old host's webhook active after
cutover. Deliveries to two ingestion points create duplicate evidence.

---

## 7. Validation checklist

Before declaring the migration complete, verify:

- [ ] `PRAGMA integrity_check` = `ok` on the restored database
- [ ] Record counts reconcile (users, orgs, telemetry events, PRs, deployments)
- [ ] `php artisan migrate:status` shows no pending migrations
- [ ] Dashboard loads and renders Performance Insights / Productivity by Tool
      without errors on the full historical dataset
- [ ] `/api/health` returns 200
- [ ] A test telemetry event lands (or dry-run a client against the endpoint)
- [ ] A GitHub webhook lands (redeliver a recent delivery from the App's
      delivery log)
- [ ] `github:app-sync --dry-run` inventories your installation's repositories
- [ ] Login/OAuth works for at least one user
- [ ] Browser remains responsive on the largest dashboards
- [ ] Old instance's webhook is disabled / endpoint repointed
- [ ] Backup job for `/data` is configured

---

## 8. Rollback

If acceptance fails:

1. Repoint the GitHub App webhook and developer telemetry clients back to the
   prior host's endpoint.
2. The prior host's database is untouched — it resumes serving immediately.
3. Events captured only on the new instance during the failed cutover can be
   re-ingested on the prior host by running its `github:app-sync` for the
   affected window, or replayed from client-side buffers for telemetry.
4. Do not delete the new instance's `/data` volume until the prior host has
   been confirmed whole — it is your audit trail of the attempt.

Rollback is safe because the source is never modified in place; every step
that could lose data (backup → transfer → restore → verify) is completed and
verified before anything is repointed.

---

## 9. Ongoing operations

### Backups

Your instance is now your responsibility. Back up `/data/database.sqlite`
daily at minimum:

```bash
sqlite3 /data/database.sqlite ".backup '/backups/cm-$(date +%F).sqlite'"
```

Store backups encrypted, off-VM, and test restores periodically.

### Upgrades

```bash
docker compose pull
docker compose up -d
```

Migrations run automatically on boot. Take a backup before every upgrade.

### Security responsibilities

You own: TLS renewal, VM patching, Docker image updates, backup
confidentiality, GitHub App secret custody, and access control to the host.
ChaosMonkey's image is Apache-2.0; there is no phone-home — telemetry goes
only to the endpoint you configure.

---

*If anything here fails at rehearsal scale, open an issue on the project
repository with the failing step, the verification output, and your image
digest — not the database itself.*
