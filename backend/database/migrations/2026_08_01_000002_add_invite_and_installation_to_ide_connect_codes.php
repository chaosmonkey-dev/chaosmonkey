<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add invite_id and installation_id to ide_connect_codes for invite-backed identity.
 *
 * SQLite-safe: ALTER TABLE ADD COLUMN supports nullable columns without rebuild.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ide_connect_codes', function (Blueprint $table) {
            $table->foreignId('invite_id')->nullable()->after('user_id')->constrained('invites')->nullOnDelete();
            $table->string('installation_id', 64)->nullable()->after('invite_id');
        });
    }

    public function down(): void
    {
        Schema::table('ide_connect_codes', function (Blueprint $table) {
            $table->dropColumn('installation_id');
            $table->dropForeign(['invite_id']);
            $table->dropColumn('invite_id');
        });
    }
};
