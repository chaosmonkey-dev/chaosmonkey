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
        Schema::table('oauth_tokens', function (Blueprint $table) {
            if (!Schema::hasColumn('oauth_tokens', 'oauth_state')) {
                $table->string('oauth_state', 80)->nullable()->after('access_token');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('oauth_tokens', function (Blueprint $table) {
                if (Schema::hasColumn('oauth_tokens', 'oauth_state')) {
                    $table->dropColumn('oauth_state');
                }
        });
    }
};
