<?php

/**
 * Local Developer Identity Resolution Configuration
 *
 * In Local Lab mode (APP_ENV=local), `local-developer` is a LOGICAL developer
 * identity that can expand to an explicit, verified set of raw telemetry
 * user_ids at query time. Raw telemetry rows are NEVER modified.
 *
 * All lists default to empty — on a fresh self-hosted install the logical
 * identity resolves to nothing unless you configure it. To consolidate your
 * own local telemetry under one developer selector, set `static_identities`
 * to your raw user_ids and `operator_email` to the invite email that should
 * resolve dynamically.
 */

return [

    /*
    | The logical developer ID the frontend uses to filter local telemetry.
    | Appears in /api/developers and is accepted as a user_id filter.
    */
    'logical_id' => env('LOCAL_DEVELOPER_ID', 'local-developer'),

    /*
    | Raw telemetry user_id values proven to belong to the local operator's
    | genuine editor telemetry (verified by repo attribution, users-table
    | linkage, or invite/api_token linkage). Empty by default.
    */
    'static_identities' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('LOCAL_DEVELOPER_IDENTITIES', ''))
    ))),

    /*
    | Invite email that resolves to the logical developer. Any `invite:<id>`
    | whose Invite row email matches resolves to `logical_id`. Empty = off.
    */
    'matt_email' => env('LOCAL_DEVELOPER_EMAIL', ''),

    /*
    | Synthetic demo persona IDs that must NEVER merge into the operator's
    | resolved identity set.
    */
    'sample_persona_ids' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('LOCAL_DEVELOPER_SAMPLE_PERSONAS', ''))
    ))),

    /*
    | Enabled by default in the testing environment so resolver regression
    | tests exercise the alias path. In production the environment gate
    | disables the alias path regardless of this flag.
    */
    'enabled_for_testing' => env('LOCAL_DEVELOPER_TESTING', true),
];
