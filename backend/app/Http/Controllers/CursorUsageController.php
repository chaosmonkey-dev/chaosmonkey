<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\CursorUsage;

class CursorUsageController extends Controller
{
    public function upload(Request $request)
    {
        // Handle file upload
        if ($request->hasFile('telemetry_file')) {
            $file = $request->file('telemetry_file');
            
            // Read and parse the file content
            $content = file_get_contents($file->getPathname());
            $data = json_decode($content, true);
            
            if (!$data) {
                return response()->json([
                    'error' => 'Invalid JSON file'
                ], 400);
            }
            
            // Create cursor usage record
            $cursorUsage = CursorUsage::create([
                'developer_id' => $data['developer_id'] ?? 'unknown',
                'file_name' => $file->getClientOriginalName(),
                'timestamp' => $data['timestamp'] ?? now(),
                'copilot_insertions' => $data['copilot_insertions'] ?? 0,
                'claude_insertions' => $data['claude_insertions'] ?? 0,
            ]);
            
            return response()->json([
                'message' => 'Telemetry file uploaded successfully',
                'data' => $cursorUsage
            ], 201);
        }

        // Handle direct data upload (original functionality)
        $request->validate([
            'developer_id' => 'required|string',
            'file_name' => 'required|string',
            'timestamp' => 'required|date',
            'copilot_insertions' => 'integer|min:0',
            'claude_insertions' => 'integer|min:0',
        ]);

        $cursorUsage = CursorUsage::create([
            'developer_id' => $request->developer_id,
            'file_name' => $request->file_name,
            'timestamp' => $request->timestamp,
            'copilot_insertions' => $request->copilot_insertions ?? 0,
            'claude_insertions' => $request->claude_insertions ?? 0,
        ]);

        return response()->json([
            'message' => 'Cursor usage data uploaded successfully',
            'data' => $cursorUsage
        ], 201);
    }
}
