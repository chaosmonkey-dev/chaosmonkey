<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PRReopenEvent extends Model
{
    protected $table = 'pr_reopen_events';
    
    protected $fillable = [
        'repo_name',
        'pr_number',
        'occurred_at',
        'event_id',
        'actor_login',
        'raw_event'
    ];

    protected $casts = [
        'occurred_at' => 'datetime',
        'raw_event' => 'array'
    ];
}
