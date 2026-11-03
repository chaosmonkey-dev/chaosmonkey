<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Backward-compatible guard: skips columns that already exist (existing DBs
     * may have some or all of these from prior runs or manual schema changes).
     */
    public function up(): void
    {
        if (!Schema::hasTable('pull_requests')) {
            return;
        }

        $toAdd = [];
        if (!Schema::hasColumn('pull_requests', 'changed_files')) {
            $toAdd[] = fn(Blueprint $t) => $t->integer('changed_files')->default(0)->after('deletions');
        }
        if (!Schema::hasColumn('pull_requests', 'review_comments')) {
            $toAdd[] = fn(Blueprint $t) => $t->integer('review_comments')->default(0)->after('changed_files');
        }
        if (!Schema::hasColumn('pull_requests', 'user_login')) {
            $toAdd[] = fn(Blueprint $t) => $t->string('user_login')->nullable()->after('developer_id');
        }
        if (!Schema::hasColumn('pull_requests', 'data_source')) {
            $toAdd[] = fn(Blueprint $t) => $t->string('data_source')->default('demo')->after('user_login');
        }
        if (!Schema::hasColumn('pull_requests', 'team_name')) {
            $toAdd[] = fn(Blueprint $t) => $t->string('team_name')->nullable()->after('data_source');
        }

        if (empty($toAdd)) {
            return;
        }

        Schema::table('pull_requests', function (Blueprint $table) use ($toAdd) {
            foreach ($toAdd as $adder) {
                $adder($table);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (!Schema::hasTable('pull_requests')) {
            return;
        }
        $toDrop = array_filter(['changed_files', 'review_comments', 'user_login', 'data_source', 'team_name'], function ($col) {
            return Schema::hasColumn('pull_requests', $col);
        });
        if (empty($toDrop)) {
            return;
        }
        Schema::table('pull_requests', function (Blueprint $table) use ($toDrop) {
            $table->dropColumn($toDrop);
        });
    }
};
