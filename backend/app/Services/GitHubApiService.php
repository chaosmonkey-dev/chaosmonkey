<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class GitHubApiService
{
    /**
     * Make a GitHub API call with proper error handling
     */
    public function makeApiCall($token, $endpoint)
    {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, "https://api.github.com/$endpoint");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'codesight-app');
        curl_setopt($ch, CURLOPT_TIMEOUT, 10); // 10 second timeout
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5); // 5 second connection timeout
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: token $token",
            "Accept: application/vnd.github.v3+json"
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            Log::error('GitHub API call curl error', ['endpoint' => $endpoint, 'error' => $error]);
            return null;
        }

        if ($httpCode === 200) {
            $decoded = json_decode($response, true);
            Log::info('GitHub API call successful', ['endpoint' => $endpoint, 'response_count' => is_array($decoded) ? count($decoded) : 'single_item']);
            return $decoded;
        }

        Log::error('GitHub API call failed', [
            'endpoint' => $endpoint, 
            'status' => $httpCode, 
            'response' => $response,
            'token_preview' => substr($token, 0, 10) . '...'
        ]);
        return null;
    }
}
