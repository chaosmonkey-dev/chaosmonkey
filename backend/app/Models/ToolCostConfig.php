<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ToolCostConfig extends Model
{
    protected $fillable = [
        'organization_id', 'tool_id', 'tool_name',
        'seat_count', 'cost_per_seat_monthly', 'monthly_spend',
        'configured_at', 'configured_by'
    ];

    protected $casts = [
        'seat_count' => 'integer',
        'cost_per_seat_monthly' => 'decimal:2',
        'monthly_spend' => 'decimal:2',
        'configured_at' => 'datetime',
    ];
}
