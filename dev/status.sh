#!/bin/bash

# Stable local dev server status script
# Shows LISTEN PIDs and health status for ports 5174 and 8010

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PID_FILE="$SCRIPT_DIR/pids/frontend.pid"
BACKEND_PID_FILE="$SCRIPT_DIR/pids/backend.pid"

echo "📊 Stable Local Dev Server Status"
echo "================================="

# Function to get LISTEN PID for a port
get_listen_pid() {
    local port=$1
    lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1
}

# Function to check service health
check_service() {
    local url=$1
    local service_name=$2
    local timeout=${3:-5}
    
    if curl -s -f --max-time "$timeout" "$url" >/dev/null 2>&1; then
        echo "✅ $service_name: responding"
        return 0
    else
        echo "❌ $service_name: not responding"
        return 1
    fi
}

echo ""
echo "🔌 Port Status:"
echo "-----------"

# Frontend port 5174
frontend_listen_pid=$(get_listen_pid 5174)
if [[ -n "$frontend_listen_pid" ]]; then
    echo "Frontend (5174): LISTEN PID $frontend_listen_pid"
    
    # Check if PID file matches
    if [[ -f "$FRONTEND_PID_FILE" ]]; then
        file_pid=$(cat "$FRONTEND_PID_FILE")
        if [[ "$file_pid" == "$frontend_listen_pid" ]]; then
            echo "                 PID file matches ✅"
        else
            echo "                 PID file has $file_pid (mismatch!) ⚠️"
        fi
    else
        echo "                 No PID file found ⚠️"
    fi
else
    echo "Frontend (5174): No LISTEN process ❌"
fi

# Backend port 8010
backend_listen_pid=$(get_listen_pid 8010)
if [[ -n "$backend_listen_pid" ]]; then
    echo "Backend (8010):  LISTEN PID $backend_listen_pid"
    
    # Check if PID file matches
    if [[ -f "$BACKEND_PID_FILE" ]]; then
        file_pid=$(cat "$BACKEND_PID_FILE")
        if [[ "$file_pid" == "$backend_listen_pid" ]]; then
            echo "                 PID file matches ✅"
        else
            echo "                 PID file has $file_pid (mismatch!) ⚠️"
        fi
    else
        echo "                 No PID file found ⚠️"
    fi
else
    echo "Backend (8010):  No LISTEN process ❌"
fi

echo ""
echo "🏥 Health Checks:"
echo "---------------"

# Check frontend
if check_service "http://127.0.0.1:5174/" "Frontend" 3; then
    # Get page title if possible
    title=$(curl -s http://127.0.0.1:5174/ | grep -o '<title>[^<]*</title>' | sed 's/<title>\(.*\)<\/title>/\1/' 2>/dev/null || echo "N/A")
    echo "   Page title: $title"
fi

# Check backend health endpoint
if check_service "http://127.0.0.1:8010/api/health" "Backend Health" 3; then
    # Get health details
    health_data=$(curl -s http://127.0.0.1:8010/api/health 2>/dev/null || echo "{}")
    echo "   Health: $health_data"
fi

# Check backend version endpoint
if check_service "http://127.0.0.1:8010/api/version" "Backend Version" 3; then
    # Get version details
    version_data=$(curl -s http://127.0.0.1:8010/api/version 2>/dev/null || echo "{}")
    echo "   Version: $version_data"
fi

echo ""
echo "📝 Process Details:"
echo "-----------------"

# Show detailed process info for LISTEN processes
if [[ -n "$frontend_listen_pid" ]]; then
    echo "Frontend process:"
    ps -p "$frontend_listen_pid" -o pid,ppid,command 2>/dev/null || echo "   Process details not available"
fi

if [[ -n "$backend_listen_pid" ]]; then
    echo "Backend process:"
    ps -p "$backend_listen_pid" -o pid,ppid,command 2>/dev/null || echo "   Process details not available"
fi

echo ""
echo "📂 Files:"
echo "-------"
echo "Frontend PID file: $([ -f "$FRONTEND_PID_FILE" ] && echo "exists ($(cat "$FRONTEND_PID_FILE"))" || echo "missing")"
echo "Backend PID file:  $([ -f "$BACKEND_PID_FILE" ] && echo "exists ($(cat "$BACKEND_PID_FILE"))" || echo "missing")"

# Show log files if they exist
if [[ -f "$SCRIPT_DIR/logs/frontend.log" ]]; then
    echo "Frontend log: $SCRIPT_DIR/logs/frontend.log ($(wc -l < "$SCRIPT_DIR/logs/frontend.log") lines)"
else
    echo "Frontend log: missing"
fi

if [[ -f "$SCRIPT_DIR/logs/backend.log" ]]; then
    echo "Backend log: $SCRIPT_DIR/logs/backend.log ($(wc -l < "$SCRIPT_DIR/logs/backend.log") lines)"
else
    echo "Backend log: missing"
fi

echo ""
echo "🎯 Summary:"
echo "---------"
if [[ -n "$frontend_listen_pid" && -n "$backend_listen_pid" ]]; then
    echo "✅ Both services are running"
    echo "   Frontend: http://127.0.0.1:5174"
    echo "   Backend:  http://127.0.0.1:8010"
elif [[ -n "$frontend_listen_pid" ]]; then
    echo "⚠️  Only frontend is running"
elif [[ -n "$backend_listen_pid" ]]; then
    echo "⚠️  Only backend is running"
else
    echo "❌ No services are running"
    echo "   Run './dev/up.sh' to start them"
fi
