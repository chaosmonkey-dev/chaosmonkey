#!/usr/bin/env node

/**
 * ChaosMonkey Telemetry Simulator
 * 
 * Generates realistic telemetry events for testing the ingestion pipeline.
 * Simulates multiple IDEs, developers, repositories, and event types.
 * 
 * Usage:
 *   node telemetry-simulator.js [options]
 *   
 * Options:
 *   --url http://127.0.0.1:8010/api/telemetry  Backend endpoint
 *   --count 100                                 Number of events to send
 *   --sessions 10                               Number of sessions to simulate
 *   --ides cursor,windsurf,vscode              IDEs to simulate
 *   --delay 1000                               Delay between batches (ms)
 *   --batch-size 20                             Events per batch
 *   --verbose                                   Verbose logging
 *   --dry-run                                   Print events without sending
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    baseUrl: process.argv.includes('--url') 
        ? process.argv[process.argv.indexOf('--url') + 1] 
        : 'http://127.0.0.1:8010',
    
    eventCount: parseInt(process.argv[process.argv.indexOf('--count') + 1] || '100'),
    sessionCount: parseInt(process.argv[process.argv.indexOf('--sessions') + 1] || '10'),
    
    ides: process.argv.includes('--ides')
        ? process.argv[process.argv.indexOf('--ides') + 1].split(',')
        : ['cursor', 'windsurf', 'vscode'],
    
    delay: parseInt(process.argv[process.argv.indexOf('--delay') + 1] || '1000'),
    batchSize: parseInt(process.argv[process.argv.indexOf('--batch-size') + 1] || '20'),
    verbose: process.argv.includes('--verbose'),
    dryRun: process.argv.includes('--dry-run')
};

// Data generators
const developers = [
    'alice@example.com',
    'bob@example.com', 
    'charlie@example.com',
    'diana@example.com',
    'eve@example.com'
];

const repositories = [
    'github.com/company/frontend',
    'github.com/company/backend',
    'github.com/company/mobile',
    'github.com/company/api',
    'github.com/company/docs'
];

const branches = ['main', 'develop', 'feature/auth', 'bugfix/login', 'hotfix/critical'];

const fileExtensions = ['.ts', '.js', '.vue', '.php', '.py', '.go', '.rs', '.java'];

// Utility functions
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
}

function generateFilePath() {
    const dirs = ['src', 'components', 'utils', 'services', 'controllers', 'models', 'lib'];
    const dir = randomChoice(dirs);
    const file = `file${randomInt(1, 100)}${randomChoice(fileExtensions)}`;
    return `${dir}/${file}`;
}

function generateTimestamp(offsetHours = 0) {
    const now = new Date();
    now.setHours(now.getHours() - offsetHours);
    return now.toISOString();
}

// Event generators
function generateFileEditEvent(sessionId, source) {
    return {
        event_type: 'file_edit',
        count: randomInt(1, 50),
        timestamp: generateTimestamp(randomInt(0, 24)),
        metadata: {
            session_id: sessionId,
            source: source,
            extension_version: '0.3.1',
            file_path: generateFilePath(),
            language: randomChoice(['typescript', 'javascript', 'php', 'python', 'go']),
            lines_added: randomInt(1, 100),
            lines_removed: randomInt(0, 50),
            git_repo_url: randomChoice(repositories),
            git_branch: randomChoice(branches),
            developer_email: randomChoice(developers)
        }
    };
}

function generateAiAcceptEvent(sessionId, source) {
    return {
        event_type: 'ai_accept',
        count: randomInt(1, 10),
        timestamp: generateTimestamp(randomInt(0, 24)),
        metadata: {
            session_id: sessionId,
            source: source,
            extension_version: '0.3.1',
            ai_provider: randomChoice(['github-copilot', 'claude', 'cursor-ai']),
            suggestion_type: randomChoice(['completion', 'edit', 'refactor']),
            confidence_score: randomFloat(0.6, 1.0),
            git_repo_url: randomChoice(repositories),
            git_branch: randomChoice(branches),
            developer_email: randomChoice(developers)
        }
    };
}

function generateCommitEvent(sessionId, source) {
    return {
        event_type: 'commit',
        count: randomInt(1, 5),
        timestamp: generateTimestamp(randomInt(0, 24)),
        metadata: {
            session_id: sessionId,
            source: source,
            extension_version: '0.3.1',
            commit_hash: Math.random().toString(36).substring(2, 12),
            commit_message: randomChoice([
                'feat: add new feature',
                'fix: resolve bug', 
                'refactor: improve code',
                'docs: update documentation',
                'test: add tests'
            ]),
            files_changed: randomInt(1, 10),
            git_repo_url: randomChoice(repositories),
            git_branch: randomChoice(branches),
            developer_email: randomChoice(developers)
        }
    };
}

function generateSessionEvent(sessionId, source, sessionDuration) {
    const qualityFactors = [];
    const qualityScore = randomFloat(0.3, 1.0);
    
    if (qualityScore > 0.8) qualityFactors.push('high_activity', 'low_idle');
    if (qualityScore > 0.6) qualityFactors.push('consistent_coding');
    if (qualityScore < 0.5) qualityFactors.push('high_idle', 'low_activity');
    
    return {
        event_type: 'session',
        count: 1,
        duration_ms: sessionDuration,
        timestamp: generateTimestamp(randomInt(0, 24)),
        metadata: {
            session_id: sessionId,
            source: source,
            extension_version: '0.3.1',
            segment_type: 'session',
            end_reason: randomChoice(['idle', 'shutdown']),
            session_quality_band: qualityScore > 0.7 ? 'high' : qualityScore > 0.4 ? 'medium' : 'low',
            session_quality_score: qualityScore,
            session_quality_factors: qualityFactors,
            files_touched: randomInt(1, 20),
            ai_burst_count: randomInt(0, 15),
            commits_count: randomInt(0, 5),
            git_repo_url: randomChoice(repositories),
            git_branch: randomChoice(branches),
            developer_email: randomChoice(developers),
            flow_profile: randomChoice(['coding-heavy', 'debug-heavy', 'idle-heavy', 'mixed'])
        }
    };
}

// Main simulation logic
async function simulateTelemetry() {
    console.log('🚀 ChaosMonkey Telemetry Simulator');
    console.log(`Target: ${config.baseUrl}/api/telemetry`);
    console.log(`Events: ${config.eventCount}, Sessions: ${config.sessionCount}`);
    console.log(`IDEs: ${config.ides.join(', ')}`);
    console.log(`Batch size: ${config.batchSize}, Delay: ${config.delay}ms`);
    
    if (config.dryRun) {
        console.log('🧪 DRY RUN MODE - No events will be sent');
    }
    
    console.log('---');

    const sessions = [];
    const events = [];
    
    // Generate sessions and their events
    for (let i = 0; i < config.sessionCount; i++) {
        const sessionId = generateSessionId();
        const source = randomChoice(config.ides);
        const sessionDuration = randomInt(300000, 7200000); // 5 minutes to 2 hours
        
        sessions.push({ sessionId, source, sessionDuration });
        
        // Generate session event
        events.push(generateSessionEvent(sessionId, source, sessionDuration));
        
        // Generate random events for this session
        const eventCount = randomInt(3, 15);
        for (let j = 0; j < eventCount && events.length < config.eventCount; j++) {
            const eventType = randomChoice(['file_edit', 'ai_accept', 'commit']);
            
            switch (eventType) {
                case 'file_edit':
                    events.push(generateFileEditEvent(sessionId, source));
                    break;
                case 'ai_accept':
                    events.push(generateAiAcceptEvent(sessionId, source));
                    break;
                case 'commit':
                    events.push(generateCommitEvent(sessionId, source));
                    break;
            }
        }
    }
    
    // Trim to exact event count
    events.splice(config.eventCount);
    
    console.log(`Generated ${events.length} events across ${sessions.length} sessions`);
    
    if (config.dryRun) {
        console.log('\n📋 Sample events:');
        events.slice(0, 3).forEach((event, i) => {
            console.log(`${i + 1}.`, JSON.stringify(event, null, 2));
        });
        return;
    }
    
    // Send events in batches
    const batches = [];
    for (let i = 0; i < events.length; i += config.batchSize) {
        batches.push(events.slice(i, i + config.batchSize));
    }
    
    console.log(`\n📤 Sending ${batches.length} batches...`);
    
    let totalSent = 0;
    let totalErrors = 0;
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const source = randomChoice(config.ides);
        
        const payload = {
            source: source,
            events: batch
        };
        
        try {
            const response = await fetch(`${config.baseUrl}/api/telemetry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': `sim-${Date.now()}-${i}`
                },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                const result = await response.json();
                totalSent += batch.length;
                
                console.log(`✅ Batch ${i + 1}/${batches.length}: ${batch.length} events sent (record_id: ${result.record_id || 'N/A'})`);
                
                if (config.verbose) {
                    console.log(`   Response:`, result);
                }
            } else {
                totalErrors += batch.length;
                const errorText = await response.text();
                console.error(`❌ Batch ${i + 1}/${batches.length}: HTTP ${response.status}`);
                console.error(`   Error: ${errorText}`);
            }
            
        } catch (error) {
            totalErrors += batch.length;
            console.error(`❌ Batch ${i + 1}/${batches.length}: Network error`);
            console.error(`   Error: ${error.message}`);
        }
        
        // Delay between batches
        if (i < batches.length - 1 && config.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, config.delay));
        }
    }
    
    console.log('\n📊 Summary:');
    console.log(`Total events attempted: ${events.length}`);
    console.log(`Successfully sent: ${totalSent}`);
    console.log(`Errors: ${totalErrors}`);
    console.log(`Success rate: ${((totalSent / events.length) * 100).toFixed(1)}%`);
    
    if (totalErrors > 0) {
        console.log('\n⚠️  Some events failed to send. Check the backend logs for details.');
    }
}

// Command line help
function showHelp() {
    console.log(`
ChaosMonkey Telemetry Simulator

Usage: node telemetry-simulator.js [options]

Options:
  --url <url>           Backend endpoint (default: http://127.0.0.1:8010)
  --count <number>      Number of events to generate (default: 100)
  --sessions <number>   Number of sessions to simulate (default: 10)
  --ides <csv>          IDEs to simulate (default: cursor,windsurf,vscode)
  --delay <ms>          Delay between batches in ms (default: 1000)
  --batch-size <number> Events per batch (default: 20)
  --verbose             Show detailed responses
  --dry-run             Print events without sending
  --help                Show this help message

Examples:
  node telemetry-simulator.js --count 500 --sessions 20
  node telemetry-simulator.js --url http://localhost:9010 --ides cursor,windsurf
  node telemetry-simulator.js --dry-run --verbose
`);
}

// Run simulation
if (process.argv.includes('--help')) {
    showHelp();
    process.exit(0);
}

simulateTelemetry().catch(error => {
    console.error('💥 Simulator failed:', error);
    process.exit(1);
});
