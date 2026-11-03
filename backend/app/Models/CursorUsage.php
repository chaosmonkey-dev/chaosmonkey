<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CursorUsage extends Model
{
    protected $table = 'cursor_usage';
    
    protected $fillable = [
        'user_id',
        'repo',
        'ide_name',
        'created_at',
        'updated_at',
        'cursor_insertions',
        'windsurf_insertions',
        'vscode_insertions',
        'jetbrains_insertions',
        'session_duration',
        'keystrokes_per_minute',
        'files_edited',
        'commits_per_session',
        'time_to_first_commit',
        'project_name',
        'branch'
    ];

    protected $casts = [
        'timestamp' => 'datetime',
        'session_duration' => 'integer',
        'keystrokes_per_minute' => 'integer',
        'files_edited' => 'integer',
        'commits_per_session' => 'integer',
        'time_to_first_commit' => 'integer',
        'copilot_insertions' => 'integer',
        'claude_insertions' => 'integer',
        'cursor_insertions' => 'integer',
        'windsurf_insertions' => 'integer',
        'vscode_insertions' => 'integer',
        'jetbrains_insertions' => 'integer'
    ];
}
