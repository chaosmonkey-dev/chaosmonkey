<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PullRequest extends Model
{
    protected $fillable = [
        'repo_name',
        'pr_number',
        'developer_id',
        'merged_at',
        'comments_count',
        'review_count',
        'first_review_at',
        'unique_reviewer_count',
        'pr_reopened_count',
        'cursor_usage_detected',
        'additions',
        'deletions',
        'changed_files',
        'review_comments',
        'user_login',
        'data_source',
        'team_name',
        'created_at',
        'updated_at'
    ];

    protected $casts = [
        'merged_at' => 'datetime',
        'first_review_at' => 'datetime',
        'cursor_usage_detected' => 'boolean'
    ];
}
