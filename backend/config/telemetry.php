<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Anonymous telemetry ingestion
    |--------------------------------------------------------------------------
    |
    | All shipped clients (0.4.x) authenticate with a bearer token resolved
    | through the shared token authority, and dashboard users ingest under
    | their session. Anonymous ingestion exists only for pre-0.4.0 local-
    | development clients and is DISABLED by default: on a network-reachable
    | install it would let any caller write events into any organization via
    | a forged organization_id or user_id.
    |
    | Migrated installations that still serve pre-0.4.0 clients may
    | re-enable it explicitly; in that mode, unauthenticated requests are
    | attributed by caller-supplied organization_id / user_id or the
    | 'chaosmonkey' fallback organization.
    |
    */

    'allow_anonymous_ingest' => env('TELEMETRY_ALLOW_ANONYMOUS_INGEST', false),

];
