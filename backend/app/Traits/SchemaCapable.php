<?php

namespace App\Traits;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CR-X 5A: Runtime schema-capability awareness.
 *
 * Lets the product run safely against Ed's legacy `pull_requests` schema
 * without requiring a DB migration. Consumers ask whether a column exists
 * before selecting/writing it, and fail closed when an optional enrichment
 * column is absent.
 */
trait SchemaCapable
{
    /**
     * Check whether a column exists on a table.
     */
    protected function hasColumn(string $table, string $column): bool
    {
        try {
            return Schema::hasColumn($table, $column);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Check whether the optional PR enrichment columns exist.
     */
    protected function prHasSizeColumns(): bool
    {
        return $this->hasColumn('pull_requests', 'additions')
            && $this->hasColumn('pull_requests', 'deletions');
    }

    protected function prHasReviewColumns(): bool
    {
        return $this->hasColumn('pull_requests', 'first_review_at')
            && $this->hasColumn('pull_requests', 'unique_reviewer_count');
    }

    protected function prHasReopenColumn(): bool
    {
        return $this->hasColumn('pull_requests', 'pr_reopened_count');
    }

    protected function prHasAllEnrichmentColumns(): bool
    {
        return $this->prHasSizeColumns()
            && $this->prHasReviewColumns()
            && $this->prHasReopenColumn();
    }
}
