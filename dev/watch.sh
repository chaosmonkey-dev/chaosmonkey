#!/bin/bash

# Optional watchdog script for stable local dev servers
# Checks every 5 seconds and restarts only the failed service
# Does NOT run git pull, npm install, composer install, or cache clears

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCH_LOG="$SCRIPT_DIR/logs/watch.log"

# Ensure log directory exists
mkdir -p "$SCRIPT_DIR/logs"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$WATCH_LOG"
}

# Function to check service health
check_service() {
    local url=$1
    local service_name=$2
    local timeout=${3:-1}
    
    if curl -s -f --max-time "$timeout" "$url" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to restart frontend
restart_frontend() {
    log "🔄 Restarting frontend..."
    
    # Kill existing frontend processes
    "$SCRIPT_DIR/down.sh" 2>/dev/null || true
    
    # Wait a moment
    sleep 2
    
    # Start only frontend
    cd "$(dirname "$SCRIPT_DIR")/frontend"
    npm run dev > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
    echo $! > "$SCRIPT_DIR/pids/frontend.pid"
    
    # Wait for frontend to be ready
    local count=0
    while [[ $count -lt 10 ]]; do
        if check_service "http://127.0.0.1:5174/" "Frontend" 1; then
            log "✅ Frontend restarted successfully"
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    log "❌ Frontend restart failed"
    return 1
}

# Function to restart backend
restart_backend() {
    log "🔄 Restarting backend..."
    
    # Kill existing backend processes
    "$SCRIPT_DIR/down.sh" 2>/dev/null || true
    
    # Wait a moment
    sleep 2
    
    # Start only backend
    cd "$(dirname "$SCRIPT_DIR")/backend"
    php artisan serve --host=127.0.0.1 --port=8010 > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
    echo $! > "$SCRIPT_DIR/pids/backend.pid"
    
    # Wait for backend to be ready
    local count=0
    while [[ $count -lt 10 ]]; do
        if check_service "http://127.0.0.1:8010/api/health" "Backend" 1; then
            log "✅ Backend restarted successfully"
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    log "❌ Backend restart failed"
    return 1
}

# Main watchdog loop
log "🐕 Watchdog started - monitoring every 5 seconds"

while true; do
    frontend_ok=true
    backend_ok=true
    
    # Check frontend
    if ! check_service "http://127.0.0.1:5174/" "Frontend" 1; then
        frontend_ok=false
        log "⚠️  Frontend health check failed"
    fi
    
    # Check backend health endpoint (NOT /api/metrics)
    if ! check_service "http://127.0.0.1:8010/api/health" "Backend" 1; then
        backend_ok=false
        log "⚠️  Backend health check failed"
    fi
    
    # Restart failed services
    if [[ "$frontend_ok" == false ]]; then
        restart_frontend
    fi
    
    if [[ "$backend_ok" == false ]]; then
        restart_backend
    fi
    
    # Sleep before next check
    sleep 5
done
