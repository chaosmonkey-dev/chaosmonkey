<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up()
    {
        Schema::create('cursor_usages', function (Blueprint $table) {
            $table->id();
            $table->string('developer_id');
            $table->string('file_name');
            $table->timestamp('timestamp');
            $table->integer('copilot_insertions')->default(0);
            $table->integer('claude_insertions')->default(0);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cursor_usages');
    }
};
