<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Metric extends Model
{
    use HasFactory;

    protected $fillable = [
        'total_pull_requests',
        'merged_pull_requests',
        'cursor_usage_detected',
        'merge_rate',
        'failed_deployment_count',
        'period_start',
        'period_end',
        'period_type',
        'repo_name',
    ];

    protected $casts = [
        'total_pull_requests' => 'integer',
        'merged_pull_requests' => 'integer',
        'cursor_usage_detected' => 'integer',
        'merge_rate' => 'float',
        'failed_deployment_count' => 'integer',
        'period_start' => 'date',
        'period_end' => 'date',
    ];
} 