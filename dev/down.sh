#!/bin/bash

# Stable local dev server shutdown script
# Kills by PID files AND LISTEN processes on ports 5174 and 8010

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PID_FILE="$SCRIPT_DIR/pids/frontend.pid"
BACKEND_PID_FILE="$SCRIPT_DIR/pids/backend.pid"

echo "🛑 Stopping stable local dev servers..."

# Function to kill by PID file
kill_by_pid_file() {
    local pid_file=$1
    local service_name=$2
    
    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "🔫 Killing $service_name (PID: $pid) from PID file"
            kill "$pid"
            # Give it a moment to die
            sleep 1
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                echo "⚡ Force killing $service_name (PID: $pid)"
                kill -9 "$pid"
            fi
        else
            echo "⚠️  $service_name PID $pid from file is not running"
        fi
        rm -f "$pid_file"
    else
        echo "ℹ️  No $service_name PID file found"
    fi
}

# Function to kill LISTEN processes on a port
kill_listen_processes() {
    local port=$1
    local service_name=$2
    
    local listen_pids=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null || true)
    if [[ -n "$listen_pids" ]]; then
        echo "🔫 Killing LISTEN processes on port $port ($service_name)"
        for pid in $listen_pids; do
            echo "   Killing PID: $pid"
            kill "$pid" 2>/dev/null || true
            sleep 0.5
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                echo "   Force killing PID: $pid"
                kill -9 "$pid" 2>/dev/null || true
            fi
        done
    else
        echo "ℹ️  No LISTEN processes on port $port"
    fi
}

# Kill by PID files first
echo ""
echo "📋 Killing by PID files..."
kill_by_pid_file "$FRONTEND_PID_FILE" "Frontend"
kill_by_pid_file "$BACKEND_PID_FILE" "Backend"

# Also kill any LISTEN processes (catch-all)
echo ""
echo "🌐 Killing LISTEN processes..."
kill_listen_processes 5174 "Frontend"
kill_listen_processes 8010 "Backend"

# Wait a moment for processes to die
sleep 2

# Verify nothing is left
echo ""
echo "🔍 Verifying shutdown..."

frontend_listen=$(lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null || true)
backend_listen=$(lsof -nP -iTCP:8010 -sTCP:LISTEN -t 2>/dev/null || true)

if [[ -n "$frontend_listen" ]]; then
    echo "❌ Frontend still has LISTEN processes: $frontend_listen"
else
    echo "✅ Frontend: no LISTEN processes on 5174"
fi

if [[ -n "$backend_listen" ]]; then
    echo "❌ Backend still has LISTEN processes: $backend_listen"
else
    echo "✅ Backend: no LISTEN processes on 8010"
fi

# Clean up any remaining PID files
rm -f "$FRONTEND_PID_FILE" "$BACKEND_PID_FILE"

echo ""
echo "🎯 Shutdown complete!"
echo "   All services stopped and ports cleared"
