<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive schema task for GitHub App delivery evidence.
 *
 * Two column groups, all guarded by hasColumn so it is safe on any database
 * regardless of which legacy pull_requests path created the table:
 *
 * 1. Review-metric columns (canonical since the fresh-create migration and
 *    the disabled pending/ migration, but absent on older pilot DBs):
 *    first_review_at, unique_reviewer_count, pr_reopened_count,
 *    additions, deletions
 *
 * 2. Lineage columns consumed by GitHubAppIngestionService (the deferred
 *    "DB TASK" referenced in code — this file is that task):
 *    head_sha, merge_sha, commit_shas, base_ref, head_ref,
 *    author_login, fetched_at, evidence_source
 *
 * No drops, no rebuilds, no data changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        $add = [];
        foreach (self::columns() as $name => $def) {
            if (!Schema::hasColumn('pull_requests', $name)) {
                $add[] = $def;
            }
        }

        if ($add) {
            Schema::table('pull_requests', function (Blueprint $table) use ($add) {
                foreach ($add as $def) {
                    $def($table);
                }
            });
        }

        try {
            Schema::table('pull_requests', function (Blueprint $table) {
                $table->index('first_review_at');
                $table->index(['repo_name', 'first_review_at']);
            });
        } catch (\Throwable $e) {
            // Indexes already exist — harmless.
        }
    }

    public function down(): void
    {
        $drop = [];
        foreach (array_keys(self::columns()) as $name) {
            if (Schema::hasColumn('pull_requests', $name)) {
                $drop[] = $name;
            }
        }
        if ($drop) {
            Schema::table('pull_requests', function (Blueprint $table) use ($drop) {
                $table->dropColumn($drop);
            });
        }
    }

    private static function columns(): array
    {
        return [
            'first_review_at' => fn (Blueprint $t) => $t->timestamp('first_review_at')->nullable(),
            'unique_reviewer_count' => fn (Blueprint $t) => $t->integer('unique_reviewer_count')->default(0),
            'pr_reopened_count' => fn (Blueprint $t) => $t->integer('pr_reopened_count')->default(0),
            'additions' => fn (Blueprint $t) => $t->integer('additions')->default(0),
            'deletions' => fn (Blueprint $t) => $t->integer('deletions')->default(0),
            'head_sha' => fn (Blueprint $t) => $t->string('head_sha')->nullable(),
            'merge_sha' => fn (Blueprint $t) => $t->string('merge_sha')->nullable(),
            'commit_shas' => fn (Blueprint $t) => $t->text('commit_shas')->nullable(),
            'base_ref' => fn (Blueprint $t) => $t->string('base_ref')->nullable(),
            'head_ref' => fn (Blueprint $t) => $t->string('head_ref')->nullable(),
            'author_login' => fn (Blueprint $t) => $t->string('author_login')->nullable(),
            'fetched_at' => fn (Blueprint $t) => $t->timestamp('fetched_at')->nullable(),
            'evidence_source' => fn (Blueprint $t) => $t->string('evidence_source')->nullable(),
        ];
    }
};
