<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChaosMonkey - API Token Configuration</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
        .chaos-title {
            font-family: 'Bebas Neue', sans-serif;
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            color: #ff6b6b;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }
        .dashboard-logo {
            height: 6.5rem;
            width: auto;
        }
        @media (max-width: 576px) {
            .dashboard-logo {
                height: 3.5rem;
            }
        }
        @media (max-width: 768px) {
            .dashboard-logo {
                height: 2.5rem;
            }
        }
    </style>
</head>
<body class="bg-gray-900 min-h-screen py-8">
    <!-- SVG Glitch Effect -->
    <svg style="position: absolute; width: 0; height: 0;">
        <filter id="chaos-glitch">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="turbulence"/>
            <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="2" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
    </svg>
    <div class="max-w-4xl mx-auto px-4">
        <div class="bg-gray-800 rounded-lg shadow-2xl p-8 border border-gray-700">
            <!-- Header with Logo and Title -->
            <div class="flex flex-col items-center space-y-4 mb-8">
                <img src="/CM-icon.png" alt="ChaosMonkey.dev Logo" class="dashboard-logo mb-3">
                <h1 class="text-4xl font-bold text-white chaos-title">CHAOSMONKEY</h1>
            </div>
            
            <div class="mb-8">
                <p class="text-gray-300 mb-6 text-lg">Use this API token to configure your Windsurf extension to send telemetry data to ChaosMonkey.</p>
                
                <div class="bg-gray-700 border border-gray-600 rounded-lg p-6">
                    <h2 class="text-xl font-semibold text-white mb-4 flex items-center">
                        <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a8 8 0 100 8 8 0 018 0zM10 2v2a8 8 0 100-8 8 0 012 0zm0 8a8 8 0 100 8 8 0 018 0z"/>
                        </svg>
                        Instructions for Windsurf Extension
                    </h2>
                    
                    <ol class="list-decimal list-inside space-y-3 text-gray-300 text-lg">
                        <li class="flex items-start">
                            <span class="inline-block w-6 text-center">1.</span>
                            <span>Copy the API token below</span>
                        </li>
                        <li class="flex items-start">
                            <span class="inline-block w-6 text-center">2.</span>
                            <span>In Windsurf, open Settings → Extensions → ChaosMonkey</span>
                        </li>
                        <li class="flex items-start">
                            <span class="inline-block w-6 text-center">3.</span>
                            <span>Paste the token in the "API Token" field</span>
                        </li>
                        <li class="flex items-start">
                            <span class="inline-block w-6 text-center">4.</span>
                            <span>Save the configuration</span>
                        </li>
                        <li class="flex items-start">
                            <span class="inline-block w-6 text-center">5.</span>
                            <span>The extension will now send telemetry data successfully</span>
                        </li>
                    </ol>
                </div>
            </div>
            
            <div class="bg-gray-800 border border-gray-600 rounded-lg p-6">
                <h3 class="text-xl font-semibold text-white mb-4 flex items-center">
                    <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 8 8 0 018 0zM10 2v2a8 8 0 100-8 8 0 012 0zm0 8a8 8 0 100 8 8 0 018 0z"/>
                    </svg>
                    Your API Token
                </h3>
                <div id="token-container" class="flex items-center space-x-3">
                    <span id="token-text" class="font-mono text-sm bg-gray-900 text-green-400 px-4 py-3 rounded border border-gray-600">Loading...</span>
                    <button onclick="copyToken()" class="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-md font-semibold transition-colors flex items-center">
                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 00-2-2h2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v6a2 2 0 002-2z"/>
                        </svg>
                        Copy Token
                    </button>
                </div>
                <p id="copy-feedback" class="mt-3 text-sm text-green-400 hidden flex items-center">
                    <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010-1.414L10.586 1.707a1 1 0 00-1.414-1.414l-5.293-5.293a1 1 0 111.414 0l5.293 5.293a1 1 0 001.414 1.414z" clip-rule="evenodd"/>
                    </svg>
                    Token copied to clipboard!
                </p>
            </div>
            
            <div class="mt-8 text-center">
                <button onclick="generateNewToken()" class="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-md font-semibold transition-colors flex items-center">
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v3a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2-2z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14v1a1 1 0 011-1H9a1 1 0 00-1-1v1a1 1 0 011 1h2a1 1 0 011 1z"/>
                    </svg>
                    Generate New Token
                </button>
            </div>
            
            <div class="mt-8 pt-6 border-t border-gray-700">
                <div class="text-center text-gray-400 text-sm">
                    <p class="mb-2">ChaosMonkey Engineering Dashboard</p>
                    <a href="/" class="text-blue-400 hover:text-blue-300 transition-colors">← Back to Dashboard</a>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        async function fetchToken() {
            try {
                const response = await fetch('/api/api-token/generate');
                const data = await response.json();
                
                if (data.token) {
                    document.getElementById('token-text').textContent = data.token;
                    document.getElementById('token-text').classList.remove('text-green-400');
                    document.getElementById('token-text').classList.add('text-gray-800');
                }
            } catch (error) {
                document.getElementById('token-text').textContent = 'Error loading token';
                console.error('Failed to fetch token:', error);
            }
        }
        
        async function copyToken() {
            const tokenText = document.getElementById('token-text').textContent;
            
            try {
                await navigator.clipboard.writeText(tokenText);
                
                // Show feedback
                const feedback = document.getElementById('copy-feedback');
                feedback.classList.remove('hidden');
                
                // Hide feedback after 2 seconds
                setTimeout(() => {
                    feedback.classList.add('hidden');
                }, 2000);
            } catch (error) {
                console.error('Failed to copy token:', error);
                alert('Failed to copy token. Please copy it manually.');
            }
        }
        
        async function generateNewToken() {
            document.getElementById('token-text').textContent = 'Generating...';
            await fetchToken();
        }
        
        // Fetch token on page load
        fetchToken();
    </script>
</body>
</html>
