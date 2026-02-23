# Bug Report — Location Tracker (Android App v6.0 + Server)

**Date:** 2026-02-23
**Total bugs found:** 42 (Android App) + 8 (Server)

---

## Server-Side Bugs (Fixed)

### Previously fixed (commit c03a664):
1. WebSocket duplicate connection handling — old connections now properly replaced
2. Missing `location` type handler in WebSocket — locations via WS now saved to DB
3. `isWsOpen()` helper added — prevents sends on closed sockets
4. Device `is_connected` status in API — uses WebSocket state + ping recency
5. Keepalive logging for device connections
6. Proper cleanup on disconnect — only removes current connection, not replacements
7. `onError` cleanup — clears stale entries on WebSocket errors
8. `broadcastToWebClients` — checks readyState before sending
9. File cache endpoint — validates connection before requesting files
10. Location acknowledgment — sends `location_ack` back to devices

### Fixed in this commit:
| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| S1 | **HIGH** | No authentication on WebSocket device connections — anyone could impersonate a device | Added token verification via query param or Authorization header |
| S2 | **HIGH** | No WebSocket message size limit — potential OOM from huge messages | Added `maxPayload: 50MB` to WebSocketServer |
| S3 | **HIGH** | `/api/devices/:token` fetches ALL locations without limit — performance bomb on large datasets | Added `.limit(5000)` to query |
| S4 | **MEDIUM** | Error message leaks internal info (`err.message` returned to client) in delete endpoint | Replaced with generic error message |
| S5 | **MEDIUM** | `broadcastToWebClients` doesn't clean dead connections from `webClients` Set | Added cleanup of non-OPEN connections |
| S6 | **MEDIUM** | `deviceCommands` Map never cleaned up — memory leak over time | Added periodic cleanup of entries older than 5 minutes |
| S7 | **MEDIUM** | No GPS validation on WebSocket location data (unlike HTTP endpoint) | Added `validateGPSPoint()` check |
| S8 | **LOW** | Default admin credentials (`admin`/`admin`) and secret token with no warning | Added startup warnings when defaults are in use |

---

## Android App Bugs (Reference — requires client-side fixes)

### CRITICAL (5 bugs)

**Bug #1: `locationRequest` field never assigned — FusedLocationProvider updates never start**
- **File:** `LocationService.txt:62,112,134,330`
- The field `locationRequest` is declared but never assigned. `createLocationRequest()` builds and **returns** a `LocationRequest` object, but `onCreate()` calls it without capturing the return value. When `requestLocationUpdates()` is called, `locationRequest` is `null`, so the core GPS tracking via FusedLocationProviderClient never starts.
- **Fix:** Change `createLocationRequest();` to `locationRequest = createLocationRequest();`

**Bug #2: `getBestLastKnownLocation()` always returns null — async race condition**
- **File:** `LocationService.txt:639-659`
- `getLastLocation()` returns a `Task<Location>` that completes asynchronously, but the method returns `result[0]` immediately before the callback fires.
- **Fix:** Use callback-based approach or `Tasks.await()` on background thread.

**Bug #3: Duplicate `LocationData` class causes compilation ambiguity**
- **Files:** `LocationData.txt` (3 fields) vs `LocationService.txt:84-100` (6 fields, inner class)
- Two classes named `LocationData` in the same package. The standalone class is never used.
- **Fix:** Remove standalone `LocationData.txt`.

**Bug #4: BootReceiver calls `startService()` unconditionally before intent check — crash on API 26+**
- **File:** `BootReceiver.txt:14-18`
- Calls `context.startService()` (not `startForegroundService()`) before any intent validation. On Android 8+, this throws `IllegalStateException` when the app is in the background.
- **Fix:** Use `startForegroundService()` on API 26+ and move the call after intent validation.

**Bug #5: `isConnected()` WebSocket check is broken**
- **File:** `StealthDataTransmitter.txt:52-54`
- Checks whether WebSocket object has a URL host, NOT whether the connection is actually open. Closed/failed connections still pass this check.
- **Fix:** Maintain a `volatile boolean connected` flag set in `onOpen()`/`onClosed()`/`onFailure()`.

### HIGH (10 bugs)

**Bug #6: Hardcoded secret token in plain text**
- **Files:** `NetworkClient.txt:139`, `StealthDataTransmitter.txt:271,362`, `build.gradle.kts:19`
- Token `"your_secret_key_123"` hardcoded in 3 Java files. `BuildConfig.API_KEY` exists but is not used.
- **Fix:** Use `BuildConfig.API_KEY` everywhere.

**Bug #7: Hardcoded server URL, `BuildConfig.SERVER_URL` unused**
- **Files:** `NetworkClient.txt:22`, `StealthDataTransmitter.txt:19`
- Server URL hardcoded in multiple files instead of using `BuildConfig.SERVER_URL`.

**Bug #8: Device ID inconsistency across components**
- **Files:** `DeviceIdManager.txt` (`"device_prefs"`), `BootReceiver.txt` (`"LocationTracker"`), `SecurePreferences.txt` (`"fallback_location_prefs"`)
- Three different SharedPreferences files store device IDs. After reboot, BootReceiver may generate a new ID, causing the server to see the device as two different devices.
- **Fix:** All components must use `DeviceIdManager.getDeviceId()` as single source of truth.

**Bug #9: WebSocket reconnection creates overlapping connections**
- **File:** `StealthDataTransmitter.txt:122-155`
- Both `onFailure` and `onClosed` schedule reconnections. `reconnectWebSocket()` calls `close()` which triggers `onClosed` again. Results in exponentially growing reconnection attempts.
- **Fix:** Use single reconnection mechanism with a flag to prevent overlap.

**Bug #10: No file size limit before download — OutOfMemoryError**
- **File:** `StealthDataTransmitter.txt:178-209`
- No check on `file.length()` before allocating byte array. A 500MB video triggers ~1GB allocation.
- **Fix:** Add size check (e.g., 10MB max) and reject/chunk large files.

**Bug #11: `WRITE_EXTERNAL_STORAGE maxSdkVersion=28` conflicts with runtime request for API 29-32**
- **Files:** `androidmanifest.txt:23-24`, `MainActivity.txt:218`
- Manifest restricts permission to API ≤28 but runtime code requests it for API 23-32.
- **Fix:** Either remove `maxSdkVersion` or update runtime code to match.

**Bug #12: `onPause()` calls `finishAndRemoveTask()` — destroys activity on any pause**
- **File:** `MainActivity.txt:480-491`
- After `auto_hide_setup` is set, ANY pause event (screen rotation, permission dialog, phone call) kills the activity.
- **Fix:** Use `onStop()` instead, or add more specific conditions.

**Bug #13: `startService()` instead of `startForegroundService()` for AntiDetectionService**
- **File:** `MainActivity.txt:468-471`
- `AntiDetectionService` calls `startForeground()`, but is started with `startService()`. Crashes on API 26+.
- **Fix:** Use `startForegroundService()` on API 26+.

**Bug #14: Placeholder signature hash triggers security lockdown in release**
- **File:** `AppIntegrityChecker.txt:15`
- `EXPECTED_SIGNATURE_HASH = "1234567890abcdef..."` — always fails verification in release builds.
- **Fix:** Replace with actual APK signature hash.

**Bug #15: SecurePreferences ALWAYS uses unencrypted fallback**
- **File:** `SecurePreferences.txt:20-28`
- Default constructor always passes `debugMode=true`, so encrypted preferences are never used.
- **Fix:** Use `BuildConfig.DEBUG` instead of hardcoded `true`.

### MEDIUM (17 bugs)

| # | Bug | File |
|---|-----|------|
| 16 | Duplicate permission request codes (both 1001) | `MainActivity.txt:57-59` |
| 17 | Backup location storage indices become sparse — data loss | `BackupLocationService.txt:103-146` |
| 18 | `SimpleDateFormat` used as static field — thread-safety | `FileManager.txt:18-19` |
| 19 | Audio buffer reused before previous send completes | `AudioRecorder.txt:89-103` |
| 20 | `isRecording` not volatile — thread visibility issue | `AudioRecorder.txt:21` |
| 21 | `switchCamera()` blocks main thread with `Thread.sleep(800)` | `StealthCameraService.txt:574-578` |
| 22 | `DataProtection` has encrypt but no decrypt method | `DataProtection.txt` |
| 23 | File scan limit inconsistency (500 vs 15000) | `FileManager.txt:68,80` |
| 24 | `testConnection()` leaks secret token in URL path | `StealthDataTransmitter.txt:362` |
| 25 | `compressImage()` leaks Bitmap memory — no `recycle()` | `StealthDataTransmitter.txt:242-251` |
| 26 | Duplicate dependencies in build.gradle.kts | `build.gradle.kts` |
| 27 | WatchdogService starts BackupLocationService when tracking disabled | `WatchdogService.txt:97-109` |
| 28 | `fis.read(buffer)` may not read entire file | `StealthDataTransmitter.txt:187`, `RemoteFileSystemService.txt:237` |
| 29 | HTTP logging at BODY level in production leaks sensitive data | `NetworkClient.txt:38-40` |
| 30 | Static `lastTrigger` unreliable across process restarts | `LocationProtector.txt:14` |
| 31 | `clearBrowserHistory()` tries to access other apps' directories — always fails | `FileManagementService.txt:201-215` |
| 32 | `clearAppCaches()` deletes own cache directory including map tiles | `FileManagementService.txt:217-227` |
| 41 | WebSocket never connects if initial HTTP test fails — no retry | `StealthDataTransmitter.txt:361-385` |

### LOW (10 bugs)

| # | Bug | File |
|---|-----|------|
| 33 | StealthCameraService notification channel no null check on NotificationManager | `StealthCameraService.txt:158-168` |
| 34 | `setupCamera()` no null/empty check on `jpegSizes` | `StealthCameraService.txt:223-224` |
| 35 | Notification ID `1` — potential conflict with other services | `StealthCameraService.txt:81` |
| 36 | Deprecated `getResources().getColor()` without theme | `MainActivity.txt:618-620` |
| 37 | Deprecated `LocationRequest.PRIORITY_HIGH_ACCURACY` | `LocationService.txt:406` |
| 38 | Deprecated `PackageManager.GET_SIGNATURES` | `AppIntegrityChecker.txt:35` |
| 39 | Deprecated `NetworkInfo.getActiveNetworkInfo()` | `LocationService.txt:366-370` |
| 40 | `searchInDirectory()` has no depth limit — stack overflow risk | `FileManagementService.txt:62-79` |
| 42 | `ACTION_MY_PACKAGE_REPLACED` checked in code but not in manifest | `BootReceiver.txt:38`, `androidmanifest.txt` |

---

## Protocol Mismatch (App ↔ Server)

| Feature | Status |
|---------|--------|
| Location via HTTP (`POST /api/location`) | Working |
| Location via WebSocket (`type: "location"`) | Server handler added (this fix), **app never sends** |
| Ping/Pong | Working |
| File list (`type: "file_list"`) | Working |
| File download (`type: "file_download"`) | Working |
| Image (`type: "image"`) | Working |
| Audio (`type: "audio"`) | Server broadcasts but has no specific handler |
| Command: `search_files` | Server sends, **app doesn't handle** |

---

## Priority Fix Order

The three most impactful bugs to fix first:

1. **Bug #1** — `locationRequest` never assigned → core GPS tracking is completely broken
2. **Bug #2** — `getBestLastKnownLocation()` always null → periodic updates broken
3. **Bug #4** — BootReceiver crash on Android 8+ → services never start after reboot

These three bugs together mean the app's primary location tracking function is largely non-operational.
