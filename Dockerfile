# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the Vue 3 frontend
# ---------------------------------------------------------------------------
FROM node:26-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: composer dependencies (production only)
# ---------------------------------------------------------------------------
FROM php:8.2-cli-alpine AS vendor
RUN apk add --no-cache git unzip
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /build/backend
COPY backend/composer.json backend/composer.lock ./
RUN composer install \
      --no-dev \
      --no-interaction \
      --no-scripts \
      --prefer-dist \
      --optimize-autoloader

# ---------------------------------------------------------------------------
# Stage 3: runtime — PHP-FPM + nginx + SQLite (all-in-one)
# ---------------------------------------------------------------------------
FROM php:8.2-fpm-alpine AS app

RUN apk add --no-cache \
      nginx \
      sqlite \
      sqlite-dev \
      tzdata \
    && docker-php-ext-install pdo_sqlite opcache

# PHP configuration
RUN { \
      echo 'opcache.enable=1'; \
      echo 'opcache.memory_consumption=128'; \
      echo 'opcache.max_accelerated_files=10000'; \
      echo 'opcache.validate_timestamps=0'; \
      echo 'upload_max_filesize=16M'; \
      echo 'post_max_size=16M'; \
      echo 'memory_limit=256M'; \
    } > /usr/local/etc/php/conf.d/chaosmonkey.ini

WORKDIR /var/www

# Application code
COPY backend/ ./backend/
COPY --from=vendor /build/backend/vendor ./backend/vendor
COPY --from=frontend /build/frontend/dist ./frontend/dist

# nginx + entrypoint
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && mkdir -p /data /run/nginx \
    && chown -R www-data:www-data /var/www/backend/storage /var/www/backend/bootstrap/cache /data

# Persistent application data: SQLite database, uploaded files, APP_KEY-backed .env
VOLUME ["/data"]
EXPOSE 80

LABEL org.opencontainers.image.title="ChaosMonkey" \
      org.opencontainers.image.description="Self-hosted observability for AI-assisted software engineering" \
      org.opencontainers.image.source="https://github.com/chaosmonkey-dev/chaosmonkey" \
      org.opencontainers.image.licenses="Apache-2.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/up || exit 1

ENTRYPOINT ["/entrypoint.sh"]
