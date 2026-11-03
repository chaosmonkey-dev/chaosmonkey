<?php

namespace Tests\Feature;

use App\Models\Metric;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MetricTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_metric()
    {
        $metricData = [
            'total_pull_requests' => 15,
            'merged_pull_requests' => 12,
            'cursor_usage_detected' => 8,
            'merge_rate' => 0.8,
        ];

        $metric = Metric::create($metricData);

        $this->assertDatabaseHas('metrics', $metricData);
        $this->assertEquals(15, $metric->total_pull_requests);
        $this->assertEquals(12, $metric->merged_pull_requests);
        $this->assertEquals(8, $metric->cursor_usage_detected);
        $this->assertEquals(0.8, $metric->merge_rate);
    }

    public function test_can_retrieve_metrics()
    {
        // Create multiple metrics
        Metric::create([
            'total_pull_requests' => 10,
            'merged_pull_requests' => 8,
            'cursor_usage_detected' => 5,
            'merge_rate' => 0.8,
        ]);

        Metric::create([
            'total_pull_requests' => 20,
            'merged_pull_requests' => 15,
            'cursor_usage_detected' => 12,
            'merge_rate' => 0.75,
        ]);

        $metrics = Metric::all();
        
        $this->assertCount(2, $metrics);
        $this->assertEquals(10, $metrics[0]->total_pull_requests);
        $this->assertEquals(20, $metrics[1]->total_pull_requests);
    }

    public function test_metric_has_correct_data_types()
    {
        $metric = Metric::create([
            'total_pull_requests' => '25', // String that should be cast to integer
            'merged_pull_requests' => '20',
            'cursor_usage_detected' => '15',
            'merge_rate' => '0.85', // String that should be cast to float
        ]);

        $this->assertIsInt($metric->total_pull_requests);
        $this->assertIsInt($metric->merged_pull_requests);
        $this->assertIsInt($metric->cursor_usage_detected);
        $this->assertIsFloat($metric->merge_rate);
    }

    public function test_can_update_metric()
    {
        $metric = Metric::create([
            'total_pull_requests' => 10,
            'merged_pull_requests' => 8,
            'cursor_usage_detected' => 5,
            'merge_rate' => 0.8,
        ]);

        $metric->update([
            'total_pull_requests' => 25,
            'merge_rate' => 0.9,
        ]);

        $this->assertEquals(25, $metric->fresh()->total_pull_requests);
        $this->assertEquals(0.9, $metric->fresh()->merge_rate);
    }
}
