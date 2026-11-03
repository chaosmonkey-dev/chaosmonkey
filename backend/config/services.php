<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // CR-X P0-0: GitHub OAuth configuration.
    //
    // env() is correct INSIDE config files — Laravel caches the resolved
    // values when config:cache runs.  Runtime controllers/services must
    // consume these via config('services.github.*'), NOT direct env()
    // calls, because direct env() returns null when the config cache is
    // active (the Sep 11 Gloo incident root cause).
    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('GITHUB_OAUTH_REDIRECT', env('APP_URL', 'http://localhost') . '/api/github/oauth/callback'),
    ],

    // GitHub App (per-pilot dedicated app) configuration.
    // Same config-cache rule as 'github' above: runtime code must consume
    // these via config('services.github_app.*'), never direct env().
    'github_app' => [
        'id' => env('GITHUB_APP_ID'),
        'private_key' => env('GITHUB_APP_PRIVATE_KEY'),
        'webhook_secret' => env('GITHUB_APP_WEBHOOK_SECRET'),
        'installation_id' => env('GITHUB_APP_INSTALLATION_ID'),
    ],

    // CR-X P0-0: Pilot single-tenant configuration.
    //
    // These values are consumed by PilotAwareTokenHelper at runtime via
    // config('services.pilot.*').  Direct env() in the trait would return
    // null under config:cache, breaking pilot-mode OAuth status lookups
    // and pilot-org assignment during the callback flow.
    'pilot' => [
        'single_tenant_org_slug' => env('PILOT_SINGLE_TENANT_ORG_SLUG'),
        'single_tenant_org_name' => env('PILOT_SINGLE_TENANT_ORG_NAME'),
        'support_github_logins' => env('PILOT_SUPPORT_GITHUB_LOGINS', ''),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
