<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Symfony\Component\Process\Exception\ProcessFailedException;

class ExtensionController extends Controller
{
    /**
     * Build and download the ChaosMonkey extension as VSIX.
     */
    public function downloadVSIX(Request $request): JsonResponse
    {
        try {
            // Get the current API base URL from the request
            $apiBaseUrl = $request->input('api_url', config('app.url'));
            
            // Build the extension
            $vsixPath = $this->buildExtension($apiBaseUrl);
            
            if (!$vsixPath || !file_exists($vsixPath)) {
                return response()->json(['error' => 'Failed to build extension'], 500);
            }
            
            // Get the filename
            $filename = basename($vsixPath);
            
            // Store the VSIX file temporarily for download
            $tempPath = 'extensions/' . $filename;
            Storage::disk('local')->put($tempPath, file_get_contents($vsixPath));
            
            return response()->json([
                'success' => true,
                'download_url' => url("/api/extension/download/{$filename}"),
                'filename' => $filename,
                'api_base_url' => $apiBaseUrl,
                'instructions' => $this->getInstallationInstructions($apiBaseUrl)
            ]);
            
        } catch (\Exception $e) {
            Log::error('Extension build failed: ' . $e->getMessage());
            return response()->json(['error' => 'Failed to build extension: ' . $e->getMessage()], 500);
        }
    }
    
    /**
     * Serve the built VSIX file for download.
     */
    public function serveVSIX(string $filename)
    {
        $tempPath = storage_path('app/extensions/' . $filename);

        if (!file_exists($tempPath)) {
            abort(404, 'Extension file not found');
        }

        $fileContents = file_get_contents($tempPath);

        return response($fileContents, 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Content-Length' => strlen($fileContents)
        ]);
    }

    /**
     * Serve the canonical current extension VSIX (immutable release artifact).
     *
     * The VSIX is a source-controlled immutable artifact at
     * backend/resources/extensions/chaosmonkey-telemetry-0.4.1.vsix
     * (51,657 bytes, SHA-256 b66fc854...). Served as-is from resource_path
     * so a clean checkout + normal deployment deterministically provides
     * the exact canonical artifact — no manual pre-placement required.
     *
     * @return \Symfony\Component\HttpFoundation\BinaryFileResponse
     */
    public function downloadLatest()
    {
        $filename = 'chaosmonkey-telemetry-0.4.1.vsix';
        $vsixPath = resource_path('extensions/' . $filename);

        if (!file_exists($vsixPath)) {
            Log::error('[EXTENSION] Canonical VSIX not found: ' . $vsixPath);
            abort(500, 'Canonical extension artifact not configured.');
        }

        return response()->streamDownload(function () use ($vsixPath) {
            echo file_get_contents($vsixPath);
        }, $filename, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ]);
    }

    /**
     * CR-X P1-1: Serve the canonical Claude Code bridge tarball.
     *
     * The tarball is a source-controlled immutable artifact at
     * backend/resources/extensions/chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz
     * (16,419 bytes, SHA-256 dcb341fe...). Served as-is from resource_path
     * so a clean checkout + normal deployment deterministically provides
     * the exact canonical artifact — no manual pre-placement required.
     *
     * @return \Symfony\Component\HttpFoundation\BinaryFileResponse
     */
    public function downloadBridgeLatest()
    {
        $filename = 'chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz';
        $tgzPath = resource_path('extensions/' . $filename);

        if (!file_exists($tgzPath)) {
            Log::error('[EXTENSION] Canonical CC bridge not found: ' . $tgzPath);
            abort(500, 'Canonical Claude Code bridge artifact not configured.');
        }

        return response()->streamDownload(function () use ($tgzPath) {
            echo file_get_contents($tgzPath);
        }, $filename, [
            'Content-Type' => 'application/gzip',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ]);
    }

    /**
     * Serve the canonical Codex telemetry bridge tarball.
     *
     * The tarball is a source-controlled immutable artifact at
     * backend/resources/extensions/chaosmonkey-codex-bridge-0.4.1-codex-bridge.tgz
     * (SHA-256 43cfda1b...), produced by `npm pack` of
     * extensions/codex-bridge. Served as-is from resource_path so a
     * clean checkout + normal deployment deterministically provides the
     * exact canonical artifact — no manual pre-placement required.
     *
     * @return \Symfony\Component\HttpFoundation\BinaryFileResponse
     */
    public function downloadCodexBridgeLatest()
    {
        $filename = 'chaosmonkey-codex-bridge-0.4.1-codex-bridge.tgz';
        $tgzPath = resource_path('extensions/' . $filename);

        if (!file_exists($tgzPath)) {
            Log::error('[EXTENSION] Canonical Codex bridge not found: ' . $tgzPath);
            abort(500, 'Canonical Codex bridge artifact not configured.');
        }

        return response()->streamDownload(function () use ($tgzPath) {
            echo file_get_contents($tgzPath);
        }, $filename, [
            'Content-Type' => 'application/gzip',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ]);
    }

    /**
     * Authoritative Cursor Agent bridge capability manifest.
     *
     * One shared, default-disabled contract used by the capability
     * endpoint and the invite setup response. Returns the verified
     * manifest only when ALL of the following hold on THIS backend:
     *   1. The promoted download route is registered.
     *   2. The immutable artifact is present at the canonical path.
     *   3. Its SHA-256 matches the approved release manifest.
     *   4. The running TelemetryController carries the cursor-agent
     *      canonicalization contract (source-level check — the transform
     *      ships in the same promoted release as this route).
     * Returns null otherwise — fail closed, never advertise capability.
     *
     * @return array{version: string, filename: string, sha256: string}|null
     */
    public static function cursorAgentBridgeManifest(): ?array
    {
        $filename = 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz';
        $sha256 = '972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21';
        $tgzPath = resource_path('extensions/' . $filename);

        if (!\Illuminate\Support\Facades\Route::has('downloads.cursor-agent-bridge')
            || !file_exists($tgzPath)
            || hash_file('sha256', $tgzPath) !== $sha256) {
            return null;
        }

        $telemetrySource = app_path('Http/Controllers/TelemetryController.php');
        if (!file_exists($telemetrySource)
            || !str_contains(file_get_contents($telemetrySource), "'cursor-agent'")) {
            return null;
        }

        return [
            'version' => '0.4.2-cursor-bridge',
            'filename' => $filename,
            'sha256' => $sha256,
        ];
    }

    /**
     * Public capability advertisement for the Cursor Agent bridge.
     * Returns the verified manifest, or available=false on any pilot
     * whose backend does not fully carry the integration.
     */
    public function cursorAgentBridgeCapability(): JsonResponse
    {
        $manifest = self::cursorAgentBridgeManifest();

        return response()->json($manifest === null
            ? ['available' => false]
            : ['available' => true] + $manifest);
    }

    /**
     * Serve the canonical Cursor Agent bridge tarball.
     *
     * Source-controlled immutable artifact at
     * backend/resources/extensions/chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz
     * produced by `npm pack` of extensions/cursor-agent-bridge. Served as-is
     * from resource_path so a clean checkout + normal deployment
     * deterministically provides the exact canonical artifact.
     */
    public function downloadCursorAgentBridgeLatest()
    {
        $filename = 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz';
        $tgzPath = resource_path('extensions/' . $filename);

        if (!file_exists($tgzPath)) {
            Log::error('[EXTENSION] Canonical Cursor Agent bridge not found: ' . $tgzPath);
            abort(500, 'Canonical Cursor Agent bridge artifact not configured.');
        }

        return response()->streamDownload(function () use ($tgzPath) {
            echo file_get_contents($tgzPath);
        }, $filename, [
            'Content-Type' => 'application/gzip',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ]);
    }

    /**
     * Legacy source download endpoint.
     *
     * NOTE: This is retained for internal/backward compatibility only.
     * Customer-facing download authority is /api/extension/download/latest
     * (downloadLatest()). No current UI references this endpoint.
     */
    public function downloadSource()
    {
        $filename = 'chaosmonkey-telemetry-0.4.1.vsix';
        $vsixPath = storage_path('app/extensions/' . $filename);

        if (!file_exists($vsixPath)) {
            Log::error('VSIX not found: ' . $vsixPath);
            return response()->json(['error' => 'Extension package not found'], 404);
        }

        return response()->download($vsixPath, $filename, [
            'Content-Type' => 'application/octet-stream',
        ]);
    }
    
    /**
     * Add a directory to the zip archive recursively.
     */
    private function addDirectoryToZip(\ZipArchive $zip, string $dir, string $zipDir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        
        $files = scandir($dir);
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') {
                continue;
            }
            
            $filePath = $dir . '/' . $file;
            $zipPath = $zipDir . '/' . $file;
            
            if (is_dir($filePath)) {
                $this->addDirectoryToZip($zip, $filePath, $zipPath);
            } else {
                $zip->addFile($filePath, $zipPath);
            }
        }
    }
    
    /**
     * Build the extension with custom API URL.
     *
     * CR-X Pass 7: Uses the canonical extension source at
     * extensions/chaosmonkey-telemetry/ (version 0.4.1), not the legacy
     * ChaosMonkey-extension/ (0.3.7). Hardcoded developer-machine Node
     * paths have been removed in favor of system PATH resolution.
     */
    private function buildExtension(string $apiBaseUrl): ?string
    {
        $extensionPath = base_path('../extensions/chaosmonkey-telemetry');
        $buildPath = sys_get_temp_dir() . '/chaosmonkey_build_' . time();

        // Clean up any existing build directory
        if (is_dir($buildPath)) {
            $this->removeDirectory($buildPath);
        }

        // Create fresh build directory
        mkdir($buildPath, 0755, true);

        try {
            // Copy extension source to build directory
            $this->copyDirectory($extensionPath, $buildPath);

            // Update package.json with the custom API URL
            $packageJsonPath = $buildPath . '/package.json';
            if (file_exists($packageJsonPath)) {
                $packageJson = json_decode(file_get_contents($packageJsonPath), true);
                $packageJson['contributes']['configuration']['properties']['chaosmonkey35.apiBaseUrl']['default'] = $apiBaseUrl;
                file_put_contents($packageJsonPath, json_encode($packageJson, JSON_PRETTY_PRINT));
            }

            // Use system PATH for Node/npm resolution (no hardcoded paths)
            $envVars = [
                'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
            ];
            
            // Install dependencies (use system npm)
            $process = new Process(['npm', 'install'], $buildPath);
            $process->setTimeout(300); // 5 minutes timeout
            $process->setEnv($envVars);
            $process->run();

            if (!$process->isSuccessful()) {
                Log::error('npm install failed: ' . $process->getErrorOutput());
                throw new ProcessFailedException($process);
            }

            // Compile TypeScript
            $process = new Process(['npm', 'run', 'compile'], $buildPath);
            $process->setTimeout(120); // 2 minutes timeout
            $process->setEnv($envVars);
            $process->run();

            if (!$process->isSuccessful()) {
                Log::error('TypeScript compilation failed: ' . $process->getErrorOutput());
                throw new ProcessFailedException($process);
            }

            // Package VSIX
            $vsixFilename = 'chaosmonkey-extension-' . date('Y-m-d-H-i-s') . '.vsix';
            $process = new Process(['npx', 'vsce', 'package', '--out', $vsixFilename], $buildPath);
            $process->setTimeout(120); // 2 minutes timeout
            $process->setEnv($envVars);
            $process->run();
            
            if (!$process->isSuccessful()) {
                Log::error('VSIX packaging failed: ' . $process->getErrorOutput());
                throw new ProcessFailedException($process);
            }
            
            $vsixPath = $buildPath . '/' . $vsixFilename;
            
            // Copy VSIX to a permanent location
            $permanentPath = storage_path('app/extensions/' . $vsixFilename);
            if (!is_dir(dirname($permanentPath))) {
                mkdir(dirname($permanentPath), 0755, true);
            }
            copy($vsixPath, $permanentPath);
            
            // Clean up temporary build directory
            $this->removeDirectory($buildPath);
            
            return $permanentPath;
            
        } catch (\Exception $e) {
            Log::error('Extension build error: ' . $e->getMessage());
            // Clean up on error
            if (is_dir($buildPath)) {
                $this->removeDirectory($buildPath);
            }
            return null;
        }
    }
    
    /**
     * Remove a directory recursively.
     */
    private function removeDirectory(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        
        $files = array_diff(scandir($dir), ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            if (is_dir($path)) {
                $this->removeDirectory($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }
    
    /**
     * Copy a directory recursively.
     */
    private function copyDirectory(string $source, string $destination): void
    {
        if (!is_dir($source)) {
            return;
        }
        
        if (!file_exists($destination)) {
            mkdir($destination, 0755, true);
        }
        
        $files = scandir($source);
        foreach ($files as $file) {
            if ($file === '.' || $file === '..' || $file === 'build') {
                continue;
            }
            
            $sourcePath = $source . '/' . $file;
            $destPath = $destination . '/' . $file;
            
            if (is_dir($sourcePath)) {
                $this->copyDirectory($sourcePath, $destPath);
            } else {
                copy($sourcePath, $destPath);
            }
        }
    }
    
    /**
     * Get installation instructions for the extension.
     */
    private function getInstallationInstructions(string $apiBaseUrl): array
    {
        return [
            'vscode' => [
                'title' => 'VS Code Installation',
                'steps' => [
                    '1. Open VS Code',
                    '2. Go to Extensions view (Ctrl+Shift+X)',
                    '3. Click "⋯" menu and select "Install from VSIX..."',
                    '4. Select the downloaded VSIX file',
                    '5. Restart VS Code if prompted',
                    '6. Open Settings and search for "ChaosMonkey 3.5"',
                    '7. Set "Api Base Url" to: ' . $apiBaseUrl,
                    '8. Set "Auth Token" if required by your organization'
                ]
            ],
            'cursor' => [
                'title' => 'Cursor Installation',
                'steps' => [
                    '1. Open Cursor',
                    '2. Go to Extensions panel',
                    '3. Use "Install from VSIX" and select the downloaded file',
                    '4. Restart Cursor if prompted',
                    '5. Open Settings and search for "ChaosMonkey 3.5"',
                    '6. Set "Api Base Url" to: ' . $apiBaseUrl,
                    '7. Set "Auth Token" if required by your organization'
                ]
            ],
            'windsurf' => [
                'title' => 'Windsurf Installation',
                'steps' => [
                    '1. Open Windsurf',
                    '2. Go to Extensions/Plugins view',
                    '3. Install from VSIX and select the downloaded file',
                    '4. Restart Windsurf if prompted',
                    '5. Open Settings and search for "ChaosMonkey 3.5"',
                    '6. Set "Api Base Url" to: ' . $apiBaseUrl,
                    '7. Set "Auth Token" if required by your organization'
                ]
            ],
            'verification' => [
                'title' => 'Verify Installation',
                'steps' => [
                    '1. Open Command Palette (Ctrl+Shift+P)',
                    '2. Run "ChaosMonkey 3.5: Send Test Event"',
                    '3. Check Output panel for "ChaosMonkey 3.5" channel',
                    '4. Confirm test event was sent to: ' . $apiBaseUrl . '/api/telemetry'
                ]
            ]
        ];
    }
}
