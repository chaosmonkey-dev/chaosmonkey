<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Deployment extends Model
{
    protected $fillable = [
        'repo_name',
        'environment',
        'deployment_status',
        'deployed_at',
        'sha',
        'rollback_detected',
        'metadata'
    ];

    protected $casts = [
        'deployed_at' => 'datetime',
        'rollback_detected' => 'boolean',
        'metadata' => 'array'
    ];

    /**
     * Scope to get latest deployment per repo/environment
     */
    public function scopeLatest($query)
    {
        return $query->orderBy('deployed_at', 'desc');
    }

    /**
     * Scope to filter by environment
     */
    public function scopeEnvironment($query, $environment)
    {
        return $query->where('environment', $environment);
    }

    /**
     * Scope to filter by status
     */
    public function scopeStatus($query, $status)
    {
        return $query->where('deployment_status', $status);
    }
}
