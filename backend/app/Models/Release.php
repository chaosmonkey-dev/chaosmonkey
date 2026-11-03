<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Release extends Model
{
    protected $fillable = [
        'repo_name', 'release_id', 'tag_name', 'release_name',
        'published_at', 'author_login', 'metadata'
    ];

    protected $casts = [
        'published_at' => 'datetime',
        'metadata' => 'array',
    ];
}
