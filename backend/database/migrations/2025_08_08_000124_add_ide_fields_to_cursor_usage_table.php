<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('cursor_usage', function (Blueprint $table) {
            // Add IDE-specific fields
            $table->string('ide_name')->default('cursor')->after('developer_id');
            $table->integer('cursor_insertions')->default(0)->after('claude_insertions');
            $table->integer('windsurf_insertions')->default(0)->after('cursor_insertions');
            $table->integer('vscode_insertions')->default(0)->after('windsurf_insertions');
            $table->integer('jetbrains_insertions')->default(0)->after('vscode_insertions');
            
            // Add session and productivity fields
            $table->integer('session_duration')->default(0)->after('jetbrains_insertions'); // in seconds
            $table->integer('keystrokes_per_minute')->default(0)->after('session_duration');
            $table->integer('files_edited')->default(0)->after('keystrokes_per_minute');
            $table->integer('commits_per_session')->default(0)->after('files_edited');
            $table->integer('time_to_first_commit')->default(0)->after('commits_per_session'); // in minutes
            
            // Add project context
            $table->string('project_name')->nullable()->after('time_to_first_commit');
            $table->string('branch')->nullable()->after('project_name');
            
            // Add created_at and updated_at if they don't exist
            if (!Schema::hasColumn('cursor_usage', 'created_at')) {
                $table->timestamps();
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('cursor_usage', function (Blueprint $table) {
            $table->dropColumn([
                'ide_name',
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
            ]);
        });
    }
};
