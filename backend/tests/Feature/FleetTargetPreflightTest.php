<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * Regression coverage for the 2026-10-21 false SSH-outage incident.
 *
 * An EOD fleet audit substituted unverified IPs for Codezzi and Stacks,
 * timed out, and briefly misclassified healthy pilots as degraded.
 * The preflight script must classify a DNS↔registry discrepancy as
 * TARGET UNVERIFIED — never as an outage — and must refuse to "pass"
 * when the registry itself cannot be parsed.
 */
class FleetTargetPreflightTest extends TestCase
{
    private string $script;
    private string $tmpDir;
    private string $stateFile;
    private string $digStub;

    protected function setUp(): void
    {
        parent::setUp();
        $this->script = dirname(__DIR__, 3) . '/scripts/check-fleet-targets.sh';
        $this->tmpDir = sys_get_temp_dir() . '/fleet-preflight-' . bin2hex(random_bytes(4));
        mkdir($this->tmpDir);
        $this->stateFile = $this->tmpDir . '/FLEET-STATE.md';
        $this->digStub = $this->tmpDir . '/dig';
    }

    protected function tearDown(): void
    {
        foreach (glob($this->tmpDir . '/*') ?: [] as $f) {
            unlink($f);
        }
        if (is_dir($this->tmpDir)) {
            rmdir($this->tmpDir);
        }
        parent::tearDown();
    }

    /** @param array<string,string|null> $answers host => IP, or null = no A record */
    private function writeDigStub(array $answers): void
    {
        $cases = '';
        foreach ($answers as $host => $ip) {
            if ($ip !== null) {
                $cases .= "    '$host') echo '$ip' ;;\n";
            }
        }
        file_put_contents(
            $this->digStub,
            "#!/bin/bash\n# args: +short <host> A\ncase \"\$2\" in\n{$cases}esac\n"
        );
        chmod($this->digStub, 0755);
    }

    /** @param array<string,string> $rows host => recorded IP */
    private function writeRegistry(array $rows): void
    {
        $body = '';
        foreach ($rows as $host => $ip) {
            $body .= "| **X** | `{$host}` `i-0001` ({$ip}) | b | d | e | f | g | h | i | j |\n";
        }
        file_put_contents($this->stateFile, "# Fleet\n\n{$body}");
    }

    /** @return array{0:int,1:string} */
    private function runPreflight(): array
    {
        $cmd = sprintf(
            'FLEET_STATE_FILE=%s FLEET_DIG=%s bash %s 2>&1',
            escapeshellarg($this->stateFile),
            escapeshellarg($this->digStub),
            escapeshellarg($this->script)
        );
        exec($cmd, $out, $code);
        return [$code, implode("\n", $out)];
    }

    public function test_matching_registry_and_dns_verifies_targets(): void
    {
        $this->writeRegistry([
            'codezzi.chaosmonkey.dev' => '3.147.10.63',
            'stacks.chaosmonkey.dev' => '16.58.39.168',
        ]);
        $this->writeDigStub([
            'codezzi.chaosmonkey.dev' => '3.147.10.63',
            'stacks.chaosmonkey.dev' => '16.58.39.168',
        ]);

        [$code, $out] = $this->runPreflight();

        $this->assertSame(0, $code);
        $this->assertStringContainsString('VERIFIED', $out);
        $this->assertStringContainsString('ALL TARGETS VERIFIED', $out);
    }

    public function test_dns_mismatch_marks_target_unverified_not_outage(): void
    {
        // The incident shape: registry IP and DNS disagree — an SSH
        // timeout against either address must not be read as an outage.
        $this->writeRegistry(['stacks.chaosmonkey.dev' => '16.58.39.168']);
        $this->writeDigStub(['stacks.chaosmonkey.dev' => '3.144.175.225']);

        [$code, $out] = $this->runPreflight();

        $this->assertSame(1, $code);
        $this->assertStringContainsString('MISMATCH', $out);
        $this->assertStringContainsString('TARGET UNVERIFIED', $out);
        $this->assertStringContainsString('do not interpret SSH failure', $out);
    }

    public function test_unresolvable_hostname_is_unverified(): void
    {
        $this->writeRegistry(['gone.chaosmonkey.dev' => '10.0.0.9']);
        $this->writeDigStub([]);

        [$code, $out] = $this->runPreflight();

        $this->assertSame(1, $code);
        $this->assertStringContainsString('UNRESOLVED', $out);
        $this->assertStringContainsString('TARGET UNVERIFIED', $out);
    }

    public function test_unparseable_registry_fails_closed(): void
    {
        file_put_contents($this->stateFile, "# Fleet\n\n(no parseable rows)\n");
        $this->writeDigStub([]);

        [$code, $out] = $this->runPreflight();

        $this->assertSame(1, $code);
        $this->assertStringContainsString('no hostname/IP rows parsed', $out);
    }

    public function test_live_registry_parses_expected_rows(): void
    {
        // Guards the parser against a FLEET-STATE.md format drift: if the
        // real registry stops yielding hostname/IP rows the preflight
        // would fail closed and audits would silently lose the check.
        $state = file_get_contents(dirname(__DIR__, 3) . '/docs/ops/FLEET-STATE.md');
        preg_match_all(
            '/`[a-z0-9-]+\.chaosmonkey\.dev`[^|]*\(\d+\.\d+\.\d+\.\d+\)/',
            $state,
            $m
        );
        $this->assertGreaterThanOrEqual(6, count($m[0]));
    }
}
