#!/bin/bash

# Stable local dev server startup script
# Frontend on 127.0.0.1:5174, Backend on 127.0.0.1:8010

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRONTEND_PID_FILE="$SCRIPT_DIR/pids/frontend.pid"
BACKEND_PID_FILE="$SCRIPT_DIR/pids/backend.pid"
FRONTEND_LOG="$SCRIPT_DIR/logs/frontend.log"
BACKEND_LOG="$SCRIPT_DIR/logs/backend.log"

echo "🚀 Starting stable local dev servers..."
echo "Project root: $PROJECT_ROOT"

# Function to check if port is already in LISTEN state
check_port_listen() {
    local port=$1
    local listen_pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null || echo "")
    if [[ -n "$listen_pid" ]]; then
        echo "❌ Port $port is already in LISTEN state (PID: $listen_pid)"
        echo "   Run ./dev/down.sh first to clean up"
        exit 1
    fi
}

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local timeout=$2
    local service_name=$3
    
    echo "⏳ Waiting for $service_name..."
    local count=0
    while [[ $count -lt $timeout ]]; do
        if curl -s -f "$url" >/dev/null 2>&1; then
            echo "✅ $service_name is ready"
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    echo "❌ $service_name failed to start within ${timeout}s"
    return 1
}

# Check ports first
check_port_listen 5174
check_port_listen 8010

# CR-X AH-4: Port contract guard — fail loudly if VITE_API_PROXY_TARGET is :8011.
# 8011 is NOT a Local runtime surface. It exists only in an obsolete pre-commit hook.
# The canonical Local proxy target is :8010.
if [[ -n "$VITE_API_PROXY_TARGET" ]]; then
    if echo "$VITE_API_PROXY_TARGET" | grep -q "8011"; then
        echo "❌ FATAL: VITE_API_PROXY_TARGET=$VITE_API_PROXY_TARGET is forbidden."
        echo "   8011 is NOT a Local runtime surface. Use :8010 (the default)."
        echo "   The 8011 port exists only in an obsolete pre-commit hook."
        echo "   Unset VITE_API_PROXY_TARGET to use the default :8010 proxy target."
        exit 1
    fi
fi

# Kill any existing processes by PID files (cleanup)
if [[ -f "$FRONTEND_PID_FILE" ]]; then
    kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true
    rm -f "$FRONTEND_PID_FILE"
fi
if [[ -f "$BACKEND_PID_FILE" ]]; then
    kill "$(cat "$BACKEND_PID_FILE")" 2>/dev/null || true
    rm -f "$BACKEND_PID_FILE"
fi

# Start frontend
echo "📦 Starting frontend on 127.0.0.1:5174..."
cd "$PROJECT_ROOT/frontend"
npm run dev > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
echo "   Frontend PID: $FRONTEND_PID"

# Start backend
echo "🔧 Starting backend on 127.0.0.1:8010..."
cd "$PROJECT_ROOT/backend"
php -d max_execution_time=120 -S 127.0.0.1:8010 -t public > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$BACKEND_PID_FILE"
echo "   Backend PID: $BACKEND_PID"

# Wait for services to be ready
echo ""
echo "🔍 Checking service health..."

# Wait for frontend (max 10s)
if ! wait_for_service "http://127.0.0.1:5174/" 10 "Frontend"; then
    echo "❌ Frontend failed to start. Check $FRONTEND_LOG"
    exit 1
fi

# Wait for backend health endpoint (max 10s)
if ! wait_for_service "http://127.0.0.1:8010/api/health" 10 "Backend health"; then
    echo "❌ Backend failed to start. Check $BACKEND_LOG"
    exit 1
fi

# Show status
echo ""
echo "✅ All services started successfully!"
echo ""
echo "📊 Service Status:"
echo "   Frontend:  http://127.0.0.1:5174 (PID: $FRONTEND_PID)"
echo "   Backend:   http://127.0.0.1:8010 (PID: $BACKEND_PID)"
echo ""

# Show backend version
echo "🔍 Backend version info:"
curl -s "http://127.0.0.1:8010/api/version" | python3 -m json.tool 2>/dev/null || curl -s "http://127.0.0.1:8010/api/version"
echo ""

# Show port status
echo "🔌 Port status:"
echo "   5174: $(lsof -nP -iTCP:5174 -sTCP:LISTEN | wc -l | tr -d ' ') LISTEN process(es)"
echo "   8010: $(lsof -nP -iTCP:8010 -sTCP:LISTEN | wc -l | tr -d ' ') LISTEN process(es)"

echo ""
echo "🎯 Ready for development!"
echo "   Logs: frontend.log and backend.log in dev/logs/"
echo "   Stop: ./dev/down.sh"
echo "   Status: ./dev/status.sh"
