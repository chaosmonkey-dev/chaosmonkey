<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class UserController extends Controller
{
    public function getSettings(Request $request)
    {
        try {
            // For MVP, use hardcoded user (Matt)
            $user = DB::table('users')->where('id', 4)->first();
            
            if (!$user) {
                return response()->json(['error' => 'User not found'], 404);
            }

            // Get settings from user data or defaults
            $notificationSettings = json_decode($user->notification_settings ?? '{}', true);
            $preferences = json_decode($user->preferences ?? '{}', true);

            return response()->json([
                'success' => true,
                'data' => [
                    'profile' => [
                        'firstName' => 'Matt', // Hardcoded for MVP
                        'lastName' => 'McClintock',
                        'email' => $user->email,
                        'bio' => $user->bio ?? null,
                        'github_username' => $user->github_id,
                        'github_avatar' => null,
                        'github_id' => $user->github_id
                    ],
                    'notifications' => [
                        'emailAlerts' => $notificationSettings['emailAlerts'] ?? true,
                        'weeklyReports' => $notificationSettings['weeklyReports'] ?? true,
                        'teamUpdates' => $notificationSettings['teamUpdates'] ?? false,
                    ],
                    'preferences' => [
                        'theme' => $preferences['theme'] ?? 'light',
                        'language' => $preferences['language'] ?? 'en',
                    ]
                ]
            ]);

        } catch (\Exception $e) {
            Log::error('Get settings failed', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to load settings'
            ], 500);
        }
    }

    public function updateProfile(Request $request)
    {
        try {
            // For MVP, use hardcoded user (Matt)
            $user = DB::table('users')->where('id', 4)->first();
            
            if (!$user) {
                return response()->json(['error' => 'User not found'], 404);
            }

            $validated = $request->validate([
                'firstName' => 'required|string|max:255',
                'lastName' => 'required|string|max:255',
                'email' => 'required|email|max:255',
                'bio' => 'nullable|string|max:1000',
                'github_username' => 'nullable|string|max:255',
                'github_avatar' => 'nullable|string|max:500',
                'github_id' => 'nullable|integer'
            ]);

            // For MVP, just log the update (no actual DB updates yet)
            Log::info('[UserController] Profile updated', [
                'user_id' => $user->id,
                'validated_data' => $validated
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Profile updated successfully',
                'profile' => $validated
            ]);

        } catch (\Exception $e) {
            Log::error('Profile update failed', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to update profile'
            ], 500);
        }
    }

    public function updateNotifications(Request $request)
    {
        try {
            // For MVP, use hardcoded user (Matt)
            $user = DB::table('users')->where('id', 4)->first();
            
            if (!$user) {
                return response()->json(['error' => 'User not found'], 404);
            }

            $validated = $request->validate([
                'emailAlerts' => 'required|boolean',
                'weeklyReports' => 'required|boolean',
                'teamUpdates' => 'required|boolean'
            ]);

            // For MVP, just log the update (no actual DB updates yet)
            Log::info('[UserController] Notifications updated', [
                'user_id' => $user->id,
                'notifications' => $validated
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Notifications updated successfully',
                'notifications' => $validated
            ]);

        } catch (\Exception $e) {
            Log::error('Notification settings update failed', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to save notification preferences'
            ], 500);
        }
    }

    public function updatePreferences(Request $request)
    {
        try {
            // For MVP, use hardcoded user (Matt)
            $user = DB::table('users')->where('id', 4)->first();
            
            if (!$user) {
                return response()->json(['error' => 'User not found'], 404);
            }

            $validated = $request->validate([
                'theme' => 'required|string|in:light,dark',
                'language' => 'required|string|in:en,es,fr,de,ja,zh'
            ]);

            // For MVP, just log the update (no actual DB updates yet)
            Log::info('[UserController] Preferences updated', [
                'user_id' => $user->id,
                'preferences' => $validated
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Preferences updated successfully',
                'preferences' => $validated
            ]);

        } catch (\Exception $e) {
            Log::error('Preferences update failed', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'error' => 'Failed to save preferences'
            ], 500);
        }
    }
}
