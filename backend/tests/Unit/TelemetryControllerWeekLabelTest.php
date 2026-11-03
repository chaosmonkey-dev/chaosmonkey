<?php

namespace Tests\Unit;

use Tests\TestCase;
use App\Http\Controllers\TelemetryController;
use ReflectionClass;
use ReflectionMethod;

class TelemetryControllerWeekLabelTest extends TestCase
{
    private TelemetryController $controller;
    private ReflectionMethod $helper;

    protected function setUp(): void
    {
        parent::setUp();
        $this->controller = new TelemetryController();
        $reflection = new ReflectionClass($this->controller);
        $this->helper = $reflection->getMethod('sqliteWeekPeriodToIso');
        $this->helper->setAccessible(true);
    }

    /** @test */
    public function sqlite_2026_31_maps_to_iso_2026_32()
    {
        $this->assertSame('2026-32', $this->helper->invoke($this->controller, '2026-31', 'week'));
    }

    /** @test */
    public function sqlite_2026_30_maps_to_iso_2026_31()
    {
        $this->assertSame('2026-31', $this->helper->invoke($this->controller, '2026-30', 'week'));
    }

    /** @test */
    public function day_and_month_periods_pass_through_unchanged()
    {
        $this->assertSame('2026-08-03', $this->helper->invoke($this->controller, '2026-08-03', 'day'));
        $this->assertSame('2026-08', $this->helper->invoke($this->controller, '2026-08', 'month'));
    }

    /** @test */
    public function year_boundary_rolls_to_correct_iso_week_year()
    {
        // 2027-01-01 is Friday; SQLite week 00 for 2027 is Jan 1-3,
        // which belongs to the last ISO week of 2026.
        $this->assertSame('2026-53', $this->helper->invoke($this->controller, '2027-00', 'week'));

        // 2027-01-04 is Monday; SQLite week 01 for 2027 starts here,
        // which is ISO 2027-W01.
        $this->assertSame('2027-01', $this->helper->invoke($this->controller, '2027-01', 'week'));
    }

    /** @test */
    public function sqlite_year_start_week_00_uses_jan1_iso_label()
    {
        // 2026-01-01 is Thursday; week 00 is Jan 1-4 and is ISO 2026-W01.
        $this->assertSame('2026-01', $this->helper->invoke($this->controller, '2026-00', 'week'));
    }
}
