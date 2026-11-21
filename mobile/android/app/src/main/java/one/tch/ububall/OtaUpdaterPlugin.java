package one.tch.ububall;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * Silent delta OTA updates for the bundled web app.
 *
 * Trust: release builds only fetch from {@link #DEFAULT_ORIGIN} and only accept a manifest whose
 * ECDSA P-256 signature verifies against the public key compiled into the APK
 * ({@code BuildConfig.OTA_PUBLIC_KEY}, from mobile/ota-public-key.pem). Every file is then checked
 * against the manifest's SHA-256 and size. Manifests older than the newest one accepted (or the
 * APK's own) are rejected as replays.
 *
 * Scheduling: release builds check natively after start-up and on resume, so a bundle whose web
 * code stops asking for updates can never strand the app. The web app may also nudge a check.
 *
 * Boot health and rollback live in {@link OtaBootState}; all disk work runs on one executor.
 */
@CapacitorPlugin(name = "OtaUpdater")
public class OtaUpdaterPlugin extends Plugin {
    private static final String TAG = "UbuballOta";
    private static final String PREFS = "UbuballOta";
    private static final String DEFAULT_ORIGIN = "https://ububall.tch.one";

    private static final int MAX_MANIFEST_BYTES = 256 * 1024;
    private static final int MAX_SIGNATURE_BYTES = 4 * 1024;
    private static final long WATCHDOG_TIMEOUT_MS = 15_000L;
    private static final long AUTO_CHECK_FIRST_DELAY_MS = 20_000L;
    private static final long AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000L;

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean SYNCING = new AtomicBoolean(false);
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static Runnable watchdogRunnable = null;
    private static long nextAutoCheckAt = 0;

    /**
     * Runs before BridgeActivity.onCreate() so Capacitor's Bridge loads the promoted OTA bundle
     * (or a restored one) on the very first WebView navigation.
     *
     * @return true if this launch boots an unconfirmed OTA bundle that needs a watchdog.
     */
    public static boolean prepareOnLaunch(Context context) {
        SharedPreferences prefs = prefs(context);
        OtaBootState.Decision decision = OtaBootState.onLaunch(snapshot(prefs), binaryStamp(context), OtaUpdaterPlugin::isValidBundleDir);
        if (decision.clearAll) {
            Logger.info(TAG, "New binary detected; clearing cached OTA bundles.");
            deleteRecursively(otaRoot(context));
            prefs.edit().clear().commit();
        }
        if (decision.action == OtaBootState.Action.ROLLBACK) {
            Logger.warn(TAG, "Unconfirmed OTA bundle failed to start; restored " + (decision.serverPath.isEmpty() ? "APK assets" : decision.serverPath));
        } else if (decision.action == OtaBootState.Action.BOOT_UNCONFIRMED) {
            Logger.info(TAG, "Booting unconfirmed OTA bundle " + decision.serverPath);
        }
        apply(context, prefs, decision);
        return decision.action == OtaBootState.Action.BOOT_UNCONFIRMED;
    }

    public static void armBootWatchdog(Context context, Bridge bridge) {
        cancelWatchdog();
        final Context appCtx = context.getApplicationContext();
        watchdogRunnable = () -> {
            watchdogRunnable = null;
            SharedPreferences prefs = prefs(appCtx);
            OtaBootState.Decision decision = OtaBootState.onWatchdogExpired(snapshot(prefs), OtaUpdaterPlugin::isValidBundleDir);
            if (decision.action == OtaBootState.Action.NONE) return;
            apply(appCtx, prefs, decision);
            if (bridge == null) return;
            if (decision.action == OtaBootState.Action.RETRY) {
                Logger.warn(TAG, "OTA boot watchdog expired; reloading for another attempt.");
                bridge.reload();
                armBootWatchdog(appCtx, bridge);
            } else {
                Logger.warn(TAG, "OTA boot watchdog expired again; rolling back.");
                if (decision.serverPath.isEmpty()) bridge.setServerAssetPath("public");
                else bridge.setServerBasePath(decision.serverPath);
            }
        };
        MAIN_HANDLER.postDelayed(watchdogRunnable, WATCHDOG_TIMEOUT_MS);
    }

    private static void cancelWatchdog() {
        if (watchdogRunnable != null) {
            MAIN_HANDLER.removeCallbacks(watchdogRunnable);
            watchdogRunnable = null;
        }
    }

    @Override
    public void load() {
        if (BuildConfig.DEBUG) return; // Debug builds update only when the web app asks (local origins).
        nextAutoCheckAt = SystemClock.elapsedRealtime() + AUTO_CHECK_FIRST_DELAY_MS;
        MAIN_HANDLER.postDelayed(this::autoCheck, AUTO_CHECK_FIRST_DELAY_MS);
    }

    @Override
    protected void handleOnResume() {
        if (!BuildConfig.DEBUG) autoCheck();
    }

    private void autoCheck() {
        long now = SystemClock.elapsedRealtime();
        if (now < nextAutoCheckAt || !SYNCING.compareAndSet(false, true)) return;
        nextAutoCheckAt = now + AUTO_CHECK_INTERVAL_MS;
        final Context ctx = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                JSObject result = performSync(ctx, DEFAULT_ORIGIN);
                Logger.info(TAG, "Automatic OTA check: " + result.optString("status"));
            } catch (Exception ex) {
                Logger.warn(TAG, "Automatic OTA check failed: " + ex.getMessage());
            } finally {
                SYNCING.set(false);
            }
        });
    }

    @PluginMethod
    public void notifyBootOk(PluginCall call) {
        cancelWatchdog();
        final Context ctx = getContext().getApplicationContext();
        // Runs on the OTA executor so cleanup can never delete a bundle a sync is staging.
        EXECUTOR.execute(() -> {
            SharedPreferences prefs = prefs(ctx);
            Map<String, String> updates = OtaBootState.onBootConfirmed(snapshot(prefs));
            if (!updates.isEmpty()) {
                Logger.info(TAG, "Confirmed healthy boot of OTA bundle " + prefs.getString(OtaBootState.KEY_UNCONFIRMED_VERSION, ""));
                write(prefs, updates);
                pruneOldBundles(ctx, prefs);
            }
            call.resolve(buildStatus(ctx, prefs));
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        call.resolve(buildStatus(ctx, prefs(ctx)));
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        String origin = sanitizeOrigin(call.getString("origin", DEFAULT_ORIGIN));
        if (origin == null) {
            call.reject("Disallowed OTA origin");
            return;
        }
        if (!SYNCING.compareAndSet(false, true)) {
            JSObject busy = new JSObject();
            busy.put("status", "busy");
            call.resolve(busy);
            return;
        }
        final Context ctx = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                call.resolve(performSync(ctx, origin));
            } catch (Exception ex) {
                Logger.warn(TAG, "OTA update check failed: " + ex.getMessage());
                JSObject err = new JSObject();
                err.put("status", "error");
                err.put("message", ex.getMessage() != null ? ex.getMessage() : "OTA sync error");
                call.resolve(err);
            } finally {
                SYNCING.set(false);
            }
        });
    }

    private static JSObject performSync(Context ctx, String origin) throws Exception {
        SharedPreferences prefs = prefs(ctx);
        JSONObject builtIn = readBuiltInManifest(ctx);
        String builtInVersion = builtIn.optString("version", "");
        String activeVersion = prefs.getString(OtaBootState.KEY_ACTIVE_VERSION, "");
        String pendingVersion = prefs.getString(OtaBootState.KEY_PENDING_VERSION, "");
        String blockedVersion = prefs.getString(OtaBootState.KEY_BLOCKED_VERSION, "");
        String currentVersion = !pendingVersion.isEmpty()
            ? pendingVersion
            : (!activeVersion.isEmpty() ? activeVersion : builtInVersion);

        long stamp = System.currentTimeMillis();
        byte[] manifestBytes = downloadBytes(origin + "/mobile-manifest.json?t=" + stamp, MAX_MANIFEST_BYTES);
        // Unsigned manifests are accepted only from a debug build's local development origin.
        boolean requireSignature = !BuildConfig.DEBUG || DEFAULT_ORIGIN.equals(origin);
        if (requireSignature) {
            byte[] signature = downloadBytes(origin + "/mobile-manifest.sig?t=" + stamp, MAX_SIGNATURE_BYTES);
            if (!OtaManifest.verifySignature(manifestBytes, signature, BuildConfig.OTA_PUBLIC_KEY)) {
                throw new IOException("Manifest signature is invalid");
            }
        }
        OtaManifest manifest = OtaManifest.parse(manifestBytes);

        if (manifest.minNativeVersion > BuildConfig.VERSION_CODE) {
            JSObject skipped = new JSObject();
            skipped.put("status", "incompatible-native");
            skipped.put("minNativeVersion", manifest.minNativeVersion);
            skipped.put("nativeVersionCode", BuildConfig.VERSION_CODE);
            return skipped;
        }
        if (manifest.version.equals(blockedVersion)) {
            JSObject blocked = new JSObject();
            blocked.put("status", "blocked");
            blocked.put("version", manifest.version);
            return blocked;
        }
        if (manifest.version.equals(currentVersion)) {
            JSObject upToDate = new JSObject();
            upToDate.put("status", "up-to-date");
            upToDate.put("version", currentVersion);
            return upToDate;
        }
        long floor = OtaBootState.issuedAtFloor(snapshot(prefs), builtIn.optLong("issuedAt", 0));
        if (requireSignature && manifest.issuedAt < floor) {
            JSObject stale = new JSObject();
            stale.put("status", "stale");
            stale.put("version", manifest.version);
            return stale;
        }

        File root = otaRoot(ctx);
        if (!root.exists() && !root.mkdirs()) throw new IOException("Could not create OTA root directory");
        File stagingDir = new File(root, "staging-" + manifest.version);
        deleteRecursively(stagingDir);
        if (!stagingDir.mkdirs()) throw new IOException("Could not create OTA staging directory");

        String stagingCanonical = stagingDir.getCanonicalPath();
        String activePath = prefs.getString(OtaBootState.KEY_ACTIVE_PATH, "");
        String previousPath = prefs.getString(OtaBootState.KEY_PREVIOUS_PATH, "");
        int downloaded = 0;
        int reused = 0;

        try {
            for (OtaManifest.Entry entry : manifest.files) {
                File dest = new File(stagingDir, entry.path);
                File parent = dest.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Could not create parent dir for " + entry.path);
                }
                if (!dest.getCanonicalPath().startsWith(stagingCanonical + File.separator)) {
                    throw new IOException("Path escapes staging root: " + entry.path);
                }
                if (tryReuseLocalFile(activePath, entry, dest)
                    || tryReuseLocalFile(previousPath, entry, dest)
                    || tryReuseApkAsset(ctx, entry, dest)) {
                    reused++;
                } else {
                    String fileUrl = origin + "/" + entry.path + "?v=" + entry.sha256.substring(0, 12);
                    downloadAndVerify(fileUrl, dest, entry);
                    downloaded++;
                }
            }

            // Keep the verified manifest inside the bundle for diagnostics.
            try (FileOutputStream fos = new FileOutputStream(new File(stagingDir, "mobile-manifest.json"))) {
                fos.write(manifestBytes);
            }

            File finalDir = new File(root, "bundle-" + manifest.version);
            deleteRecursively(finalDir);
            if (!stagingDir.renameTo(finalDir)) throw new IOException("Atomic bundle promotion rename failed");

            Map<String, String> updates = new HashMap<>();
            updates.put(OtaBootState.KEY_PENDING_VERSION, manifest.version);
            updates.put(OtaBootState.KEY_PENDING_PATH, finalDir.getAbsolutePath());
            if (requireSignature) updates.put(OtaBootState.KEY_HIGHEST_ISSUED_AT, String.valueOf(Math.max(floor, manifest.issuedAt)));
            write(prefs, updates);
            pruneOldBundles(ctx, prefs);

            Logger.info(TAG, "Staged silent OTA " + manifest.version + " (downloaded=" + downloaded + ", reused=" + reused + ")");
            JSObject staged = new JSObject();
            staged.put("status", "staged");
            staged.put("version", manifest.version);
            staged.put("downloaded", downloaded);
            staged.put("reused", reused);
            return staged;
        } catch (Exception ex) {
            deleteRecursively(stagingDir);
            throw ex;
        }
    }

    private static boolean tryReuseLocalFile(String baseDir, OtaManifest.Entry entry, File dest) {
        if (baseDir == null || baseDir.isEmpty()) return false;
        File src = new File(baseDir, entry.path);
        if (!src.isFile() || src.length() != entry.size) return false;
        try {
            if (entry.sha256.equals(copyAndHash(new FileInputStream(src), dest, entry.size))) return true;
        } catch (IOException ignored) {}
        //noinspection ResultOfMethodCallIgnored
        dest.delete();
        return false;
    }

    private static boolean tryReuseApkAsset(Context ctx, OtaManifest.Entry entry, File dest) {
        try (InputStream in = ctx.getAssets().open("public/" + entry.path)) {
            if (entry.sha256.equals(copyAndHash(in, dest, entry.size))) return true;
        } catch (IOException ignored) {}
        //noinspection ResultOfMethodCallIgnored
        dest.delete();
        return false;
    }

    private static void downloadAndVerify(String urlStr, File dest, OtaManifest.Entry entry) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(20_000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " for " + urlStr);
            String actual = copyAndHash(conn.getInputStream(), dest, entry.size);
            if (!entry.sha256.equals(actual)) {
                //noinspection ResultOfMethodCallIgnored
                dest.delete();
                throw new IOException("SHA-256 mismatch for " + urlStr);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String copyAndHash(InputStream in, File dest, long expectedSize) throws IOException {
        MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IOException("SHA-256 unavailable", e);
        }
        long written = 0;
        byte[] buf = new byte[16384];
        try (InputStream input = in; FileOutputStream out = new FileOutputStream(dest)) {
            int n;
            while ((n = input.read(buf)) != -1) {
                written += n;
                if (written > expectedSize) throw new IOException("File exceeded expected size");
                md.update(buf, 0, n);
                out.write(buf, 0, n);
            }
        }
        if (written != expectedSize) throw new IOException("Size mismatch: expected " + expectedSize + ", got " + written);
        return toHex(md.digest());
    }

    private static byte[] downloadBytes(String urlStr, int maxBytes) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(15_000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " for " + urlStr.replaceAll("\\?.*$", ""));
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                int total = 0;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > maxBytes) throw new IOException("Response too large");
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String sanitizeOrigin(String raw) {
        if (raw == null) return DEFAULT_ORIGIN;
        String clean = raw.trim().replaceAll("/+$", "");
        if (DEFAULT_ORIGIN.equals(clean)) return clean;
        if (BuildConfig.DEBUG && (
            clean.matches("^http://127\\.0\\.0\\.1:\\d{1,5}$")
            || clean.matches("^http://10\\.0\\.2\\.2:\\d{1,5}$")
            || clean.matches("^http://localhost:\\d{1,5}$")
        )) {
            return clean;
        }
        return null;
    }

    private static JSONObject readBuiltInManifest(Context ctx) {
        try (InputStream in = ctx.getAssets().open("public/mobile-manifest.json");
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static JSObject buildStatus(Context ctx, SharedPreferences prefs) {
        String activeVersion = prefs.getString(OtaBootState.KEY_ACTIVE_VERSION, "");
        String builtInVersion = readBuiltInManifest(ctx).optString("version", "");
        JSObject out = new JSObject();
        out.put("activeVersion", activeVersion.isEmpty() ? builtInVersion : activeVersion);
        out.put("builtInVersion", builtInVersion);
        out.put("pendingVersion", prefs.getString(OtaBootState.KEY_PENDING_VERSION, ""));
        out.put("blockedVersion", prefs.getString(OtaBootState.KEY_BLOCKED_VERSION, ""));
        out.put("isOta", !activeVersion.isEmpty());
        out.put("nativeVersionCode", BuildConfig.VERSION_CODE);
        out.put("nativeAutoCheck", !BuildConfig.DEBUG);
        return out;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static Map<String, String> snapshot(SharedPreferences prefs) {
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (entry.getValue() instanceof String) out.put(entry.getKey(), (String) entry.getValue());
        }
        return out;
    }

    private static void write(SharedPreferences prefs, Map<String, String> updates) {
        SharedPreferences.Editor editor = prefs.edit();
        for (Map.Entry<String, String> entry : updates.entrySet()) editor.putString(entry.getKey(), entry.getValue());
        editor.commit();
    }

    private static void apply(Context ctx, SharedPreferences prefs, OtaBootState.Decision decision) {
        write(prefs, decision.updates);
        ctx.getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE)
            .edit()
            .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, decision.serverPath)
            .commit();
    }

    private static String binaryStamp(Context ctx) {
        long updated = 0;
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            updated = info.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException ignored) {}
        return BuildConfig.VERSION_CODE + ":" + updated;
    }

    private static File otaRoot(Context ctx) {
        return new File(ctx.getFilesDir(), "ota");
    }

    private static boolean isValidBundleDir(String path) {
        if (path == null || path.isEmpty()) return false;
        File dir = new File(path);
        return dir.isDirectory() && new File(dir, "index.html").isFile() && new File(dir, "platform.js").isFile();
    }

    /** Must run on {@link #EXECUTOR}: it deletes every directory not referenced by the preferences. */
    private static void pruneOldBundles(Context ctx, SharedPreferences prefs) {
        File[] children = otaRoot(ctx).listFiles();
        if (children == null) return;
        Set<String> keep = OtaBootState.keepDirectoryNames(snapshot(prefs));
        for (File child : children) {
            if (!keep.contains(child.getName())) deleteRecursively(child);
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] items = f.listFiles();
            if (items != null) for (File item : items) deleteRecursively(item);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.US, "%02x", b & 0xff));
        return sb.toString();
    }
}
