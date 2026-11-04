# Installation

## Requirements

- **Docker** 20.10+ (recommended path), or
- **Manual**: PHP 8.2+ with `pdo_sqlite`, Node.js 20+, Composer 2

## Docker (recommended)

Pull the published image (multi-arch, amd64 + arm64):

```bash
docker pull ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.0
docker run -d --name chaosmonkey \
  -p 8080:80 \
  -v chaosmonkey-data:/data \
  ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.0
```

Or build from source:

```bash
git clone https://github.com/chaosmonkey-dev/chaosmonkey.git
cd chaosmonkey
docker build -t chaosmonkey .
docker run -d --name chaosmonkey \
  -p 8080:80 \
  -v chaosmonkey-data:/data \
  chaosmonkey
```

Pin an explicit version tag (`0.1.0`) rather than `latest` — releases are
immutable and upgrades are deliberate.

The container performs first-run initialization automatically: it writes
`.env`, generates `APP_KEY`, creates `/data/database.sqlite`, and runs
migrations. On later starts it runs pending migrations — upgrades are additive
and never drop data.

### Create the first administrator

```bash
docker exec -it chaosmonkey \
  php /var/www/backend/artisan chaosmonkey:create-admin you@example.com
```

The command prompts for a password (or generates a random one with
`--generate`). There are no default credentials — this is the only way to
create the first account. That admin can then create organizations, invites,
and connect codes from the UI.

### Docker Compose

```bash
docker compose up -d
docker compose exec chaosmonkey \
  php /var/www/backend/artisan chaosmonkey:create-admin you@example.com
```

## Configuration

Configuration is the backend `.env` inside the container
(`/var/www/backend/.env`), writable on first start and preserved across
restarts. You can also pass common settings with `docker -e` — the entrypoint
applies them on every boot:

| Variable | Default | Purpose |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | External URL of the instance |
| `APP_FRONTEND_URL` | `http://localhost:8080` | Used for CORS + OAuth redirects |
| `CORS_ALLOWED_ORIGINS` | `APP_FRONTEND_URL` | Comma-separated allowed origins |
| `SESSION_SECURE_COOKIES` | `false` | Set `true` behind HTTPS |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | unset | Optional GitHub OAuth |
| `GITHUB_APP_*` | unset | Optional GitHub App (see integrations) |
| `ATLASSIAN_CLIENT_ID` / `ATLASSIAN_CLIENT_SECRET` | unset | Optional |

## HTTPS

Terminate TLS in front of the container — nginx, Caddy, Traefik, or a cloud
load balancer. Then set:

```bash
docker run -d ... \
  -e APP_URL=https://chaosmonkey.example.com \
  -e APP_FRONTEND_URL=https://chaosmonkey.example.com \
  -e CORS_ALLOWED_ORIGINS=https://chaosmonkey.example.com \
  -e SESSION_SECURE_COOKIES=true \
  chaosmonkey
```

Laravel trusts loopback `X-Forwarded-*` headers, so a same-host reverse proxy
produces correct HTTPS URLs.

## Upgrades

```bash
docker build -t chaosmonkey .
docker stop chaosmonkey && docker rm chaosmonkey
docker run -d --name chaosmonkey -p 8080:80 -v chaosmonkey-data:/data chaosmonkey
```

The `/data` volume survives replacement; migrations run automatically. Always
back up before upgrading (see operations).

## Manual install (development)

See CONTRIBUTING.md — `composer install` + `php artisan serve` for the backend,
`npm install` + `npm run dev` for the frontend, or `dev/up.sh` for both.
