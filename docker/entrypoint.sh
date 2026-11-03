#!/bin/sh
# ChaosMonkey all-in-one container entrypoint.
# First run: writes .env, generates APP_KEY, creates + migrates SQLite.
# Later runs: migrates in place (upgrades never drop data).
set -e

APP_DIR=/var/www/backend
DATA_DIR=/data
DB_FILE="$DATA_DIR/database.sqlite"
ENV_FILE="$APP_DIR/.env"

mkdir -p "$DATA_DIR"

# ---------------------------------------------------------------------------
# .env — generated once from .env.example, then owned by the operator.
# CHAOSMONKEY_* / common env vars passed with `docker -e` are applied on every
# start so operators can configure without editing the file.
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
    cp "$APP_DIR/.env.example" "$ENV_FILE"
    echo "[entrypoint] Created $ENV_FILE from .env.example"
fi

set_env() {
    key="$1"; value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" 2>/dev/null \
          || sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

# Sensible container defaults
set_env APP_ENV "${APP_ENV:-production}"
set_env APP_DEBUG "${APP_DEBUG:-false}"
set_env DB_CONNECTION sqlite
set_env DB_DATABASE "$DB_FILE"
set_env SESSION_DRIVER file
set_env CACHE_DRIVER file
set_env QUEUE_CONNECTION sync
set_env LOG_CHANNEL stderr

# Operator-supplied configuration (docker -e VAR=value)
for var in APP_NAME APP_URL APP_FRONTEND_URL \
           GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_TOKEN GITHUB_OAUTH_REDIRECT \
           GITHUB_APP_ID GITHUB_APP_INSTALLATION_ID GITHUB_APP_PRIVATE_KEY \
           GITHUB_APP_WEBHOOK_SECRET \
           ATLASSIAN_CLIENT_ID ATLASSIAN_CLIENT_SECRET \
           CORS_ALLOWED_ORIGINS SESSION_DOMAIN SESSION_SECURE_COOKIES \
           DEMO_MODE TELEMETRY_ENABLED TELEMETRY_RETENTION_DAYS; do
    eval "val=\${$var:-}"
    if [ -n "$val" ]; then
        set_env "$var" "$val"
    fi
done

# APP_URL / frontend URL defaults for a plain local install
if ! grep -q '^APP_URL=http' "$ENV_FILE" || grep -q 'APP_URL=http://127.0.0.1:8010' "$ENV_FILE"; then
    set_env APP_URL "${APP_URL:-http://localhost:8080}"
fi
if grep -q 'APP_FRONTEND_URL=http://localhost:5174' "$ENV_FILE"; then
    set_env APP_FRONTEND_URL "${APP_FRONTEND_URL:-http://localhost:8080}"
fi
if grep -q 'CORS_ALLOWED_ORIGINS=http://localhost:5174' "$ENV_FILE"; then
    set_env CORS_ALLOWED_ORIGINS "${CORS_ALLOWED_ORIGINS:-${APP_FRONTEND_URL:-http://localhost:8080}}"
fi

# ---------------------------------------------------------------------------
# APP_KEY — generate once, persist in .env (encrypted data stays decryptable)
# ---------------------------------------------------------------------------
if ! grep -q '^APP_KEY=base64:' "$ENV_FILE"; then
    cd "$APP_DIR"
    php artisan key:generate --force --no-interaction
    echo "[entrypoint] Generated APP_KEY"
fi

# ---------------------------------------------------------------------------
# SQLite — create once, migrate on every start (safe: migrations are additive)
# ---------------------------------------------------------------------------
if [ ! -f "$DB_FILE" ]; then
    touch "$DB_FILE"
    echo "[entrypoint] Created SQLite database at $DB_FILE"
fi
chown www-data:www-data "$DB_FILE" "$DATA_DIR" 2>/dev/null || true
chmod 664 "$DB_FILE" 2>/dev/null || true

cd "$APP_DIR"
php artisan migrate --force --no-interaction
php artisan config:cache
php artisan route:cache 2>/dev/null || true

chown -R www-data:www-data "$APP_DIR/storage" "$APP_DIR/bootstrap/cache" 2>/dev/null || true

echo "[entrypoint] ChaosMonkey ready — serving on port 80"

php-fpm -D
exec nginx -g 'daemon off;'
