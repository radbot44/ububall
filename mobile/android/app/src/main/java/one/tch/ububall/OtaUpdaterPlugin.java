package one.tch.ububall;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
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
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(name = "OtaUpdater")
public class OtaUpdaterPlugin extends Plugin {
    private static final String TAG = "UbuballOta";
    private static final String PREFS = "UbuballOta";
    private static final String DEFAULT_ORIGIN = "https://ububall.tch.one";
    private static final String KEY_BINARY_STAMP = "binary_stamp";
    private static final String KEY_ACTIVE_VERSION = "active_version";
    private static final String KEY_ACTIVE_PATH = "active_path";
    private static final String KEY_PREVIOUS_VERSION = "previous_version";
    private static final String KEY_PREVIOUS_PATH = "previous_path";
    private static final String KEY_PENDING_VERSION = "pending_version";
    private static final String KEY_PENDING_PATH = "pending_path";
    private static final String KEY_UNCONFIRMED_VERSION = "unconfirmed_version";
    private static final String KEY_BLOCKED_VERSION = "blocked_version";

    private static final int MAX_MANIFEST_BYTES = 256 * 1024;
    private static final int MAX_FILES = 200;
    private static final long MAX_FILE_BYTES = 10L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 32L * 1024L * 1024L;
    private static final long WATCHDOG_TIMEOUT_MS = 10_000L;

    private static final Pattern VERSION_RE = Pattern.compile("^[0-9a-f]{16,64}$");
    private static final Pattern SHA256_RE = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern REL_PATH_RE = Pattern.compile("^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$");

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean SYNCING = new AtomicBoolean(false);
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static Runnable watchdogRunnable = null;

    /**
     * Runs before BridgeActivity.onCreate() so Capacitor's Bridge loads the promoted OTA
     * bundle (or rolls back a failed one) on the very first WebView navigation.
     *
     * @return true if this launch is booting an unconfirmed OTA bundle that needs a watchdog.
     */
    public static boolean prepareOnLaunch(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences capPrefs = context.getSharedPreferences(
            com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,
            Activity.MODE_PRIVATE
        );

        String stamp = binaryStamp(context);
        String savedStamp = prefs.getString(KEY_BINARY_STAMP, "");
        if (!stamp.equals(savedStamp)) {
            Logger.info(TAG, "New binary detected (" + stamp + "); clearing cached OTA bundles.");
            deleteRecursively(otaRoot(context));
            prefs.edit().clear().putString(KEY_BINARY_STAMP, stamp).commit();
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").commit();
            return false;
        }

        // If the previous launch of an OTA bundle never called notifyBootOk(), roll back immediately.
        String unconfirmed = prefs.getString(KEY_UNCONFIRMED_VERSION, "");
        if (!unconfirmed.isEmpty()) {
            Logger.warn(TAG, "Rolling back unconfirmed OTA version " + unconfirmed);
            String prevPath = prefs.getString(KEY_PREVIOUS_PATH, "");
            String prevVersion = prefs.getString(KEY_PREVIOUS_VERSION, "");
            if (!isValidBundleDir(prevPath)) {
                prevPath = "";
                prevVersion = "";
            }
            prefs.edit()
                .putString(KEY_BLOCKED_VERSION, unconfirmed)
                .putString(KEY_ACTIVE_PATH, prevPath)
                .putString(KEY_ACTIVE_VERSION, prevVersion)
                .putString(KEY_UNCONFIRMED_VERSION, "")
                .putString(KEY_PENDING_PATH, "")
                .putString(KEY_PENDING_VERSION, "")
                .commit();
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, prevPath).commit();
            return false;
        }

        // Promote a verified pending bundle silently on this cold launch.
        String pendingVersion = prefs.getString(KEY_PENDING_VERSION, "");
        String pendingPath = prefs.getString(KEY_PENDING_PATH, "");
        if (!pendingVersion.isEmpty() && isValidBundleDir(pendingPath)) {
            String prevPath = prefs.getString(KEY_ACTIVE_PATH, "");
            String prevVersion = prefs.getString(KEY_ACTIVE_VERSION, "");
            Logger.info(TAG, "Promoting silent OTA bundle " + pendingVersion);
            prefs.edit()
                .putString(KEY_PREVIOUS_PATH, prevPath)
                .putString(KEY_PREVIOUS_VERSION, prevVersion)
                .putString(KEY_ACTIVE_PATH, pendingPath)
                .putString(KEY_ACTIVE_VERSION, pendingVersion)
                .putString(KEY_UNCONFIRMED_VERSION, pendingVersion)
                .putString(KEY_PENDING_PATH, "")
                .putString(KEY_PENDING_VERSION, "")
                .commit();
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, pendingPath).commit();
            return true;
        }

        // Verify the active bundle still exists on disk; otherwise revert cleanly to APK assets.
        String activePath = prefs.getString(KEY_ACTIVE_PATH, "");
        if (!activePath.isEmpty() && !isValidBundleDir(activePath)) {
            Logger.warn(TAG, "Active OTA directory missing; reverting to built-in APK assets.");
            prefs.edit()
                .putString(KEY_ACTIVE_PATH, "")
                .putString(KEY_ACTIVE_VERSION, "")
                .commit();
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").commit();
        } else if (!activePath.isEmpty()) {
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, activePath).commit();
        }
        return false;
    }

    public static void armBootWatchdog(Context context, Bridge bridge) {
        cancelWatchdog();
        final Context appCtx = context.getApplicationContext();
        watchdogRunnable = () -> {
            SharedPreferences prefs = appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String unconfirmed = prefs.getString(KEY_UNCONFIRMED_VERSION, "");
            if (unconfirmed.isEmpty()) return;
            Logger.warn(TAG, "OTA boot watchdog expired for " + unconfirmed + "; rolling back.");
            String prevPath = prefs.getString(KEY_PREVIOUS_PATH, "");
            String prevVersion = prefs.getString(KEY_PREVIOUS_VERSION, "");
            if (!isValidBundleDir(prevPath)) {
                prevPath = "";
                prevVersion = "";
            }
            prefs.edit()
                .putString(KEY_BLOCKED_VERSION, unconfirmed)
                .putString(KEY_ACTIVE_PATH, prevPath)
                .putString(KEY_ACTIVE_VERSION, prevVersion)
                .putString(KEY_UNCONFIRMED_VERSION, "")
                .commit();
            SharedPreferences capPrefs = appCtx.getSharedPreferences(
                com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,
                Activity.MODE_PRIVATE
            );
            capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, prevPath).commit();
            if (bridge != null) {
                if (prevPath.isEmpty()) bridge.setServerAssetPath("public");
                else bridge.setServerBasePath(prevPath);
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

    @PluginMethod
    public void notifyBootOk(PluginCall call) {
        cancelWatchdog();
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String unconfirmed = prefs.getString(KEY_UNCONFIRMED_VERSION, "");
        if (!unconfirmed.isEmpty()) {
            Logger.info(TAG, "Confirmed healthy boot of OTA bundle " + unconfirmed);
            prefs.edit().putString(KEY_UNCONFIRMED_VERSION, "").apply();
            pruneOldBundles(ctx, prefs);
        }
        call.resolve(buildStatus(ctx, prefs));
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        call.resolve(buildStatus(ctx, prefs));
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        String requestedOrigin = call.getString("origin", DEFAULT_ORIGIN);
        String origin = sanitizeOrigin(requestedOrigin);
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
                JSObject result = performSync(ctx, origin);
                call.resolve(result);
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
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String builtInVersion = readBuiltInVersion(ctx);
        String activeVersion = prefs.getString(KEY_ACTIVE_VERSION, "");
        String pendingVersion = prefs.getString(KEY_PENDING_VERSION, "");
        String blockedVersion = prefs.getString(KEY_BLOCKED_VERSION, "");
        String currentVersion = !pendingVersion.isEmpty()
            ? pendingVersion
            : (!activeVersion.isEmpty() ? activeVersion : builtInVersion);

        String manifestUrl = origin + "/mobile-manifest.json?t=" + System.currentTimeMillis();
        byte[] manifestBytes = downloadBytes(manifestUrl, MAX_MANIFEST_BYTES);
        JSONObject manifest = new JSONObject(new String(manifestBytes, StandardCharsets.UTF_8));

        if (manifest.optInt("schema", -1) != 1) {
            throw new IOException("Unsupported manifest schema");
        }
        int minNative = manifest.optInt("minNativeVersion", Integer.MAX_VALUE);
        if (minNative < 1 || minNative > BuildConfig.VERSION_CODE) {
            JSObject skipped = new JSObject();
            skipped.put("status", "incompatible-native");
            skipped.put("minNativeVersion", minNative);
            skipped.put("nativeVersionCode", BuildConfig.VERSION_CODE);
            return skipped;
        }
        String remoteVersion = manifest.optString("version", "");
        if (!VERSION_RE.matcher(remoteVersion).matches()) {
            throw new IOException("Invalid manifest version");
        }
        if (remoteVersion.equals(blockedVersion)) {
            JSObject blocked = new JSObject();
            blocked.put("status", "blocked");
            blocked.put("version", remoteVersion);
            return blocked;
        }
        if (remoteVersion.equals(currentVersion)) {
            JSObject upToDate = new JSObject();
            upToDate.put("status", "up-to-date");
            upToDate.put("version", currentVersion);
            return upToDate;
        }

        JSONObject filesObj = manifest.optJSONObject("files");
        if (filesObj == null || filesObj.length() == 0 || filesObj.length() > MAX_FILES) {
            throw new IOException("Invalid manifest files table");
        }
        if (!filesObj.has("index.html") || !filesObj.has("platform.js")) {
            throw new IOException("Manifest missing required entrypoints");
        }

        File root = otaRoot(ctx);
        if (!root.exists() && !root.mkdirs()) {
            throw new IOException("Could not create OTA root directory");
        }
        File stagingDir = new File(root, "staging-" + remoteVersion);
        deleteRecursively(stagingDir);
        if (!stagingDir.mkdirs()) {
            throw new IOException("Could not create OTA staging directory");
        }

        String stagingCanonical = stagingDir.getCanonicalPath();
        String activePath = prefs.getString(KEY_ACTIVE_PATH, "");
        String previousPath = prefs.getString(KEY_PREVIOUS_PATH, "");
        long totalBytes = 0;
        int downloaded = 0;
        int reused = 0;

        try {
            Iterator<String> keys = filesObj.keys();
            while (keys.hasNext()) {
                String relPath = keys.next();
                if (!REL_PATH_RE.matcher(relPath).matches() || relPath.contains("..")) {
                    throw new IOException("Invalid relative path: " + relPath);
                }
                JSONObject entry = filesObj.optJSONObject(relPath);
                if (entry == null) throw new IOException("Malformed file entry: " + relPath);
                String expectedSha = entry.optString("sha256", "");
                long expectedSize = entry.optLong("size", -1);
                if (!SHA256_RE.matcher(expectedSha).matches() || expectedSize < 0 || expectedSize > MAX_FILE_BYTES) {
                    throw new IOException("Invalid hash or size for " + relPath);
                }
                totalBytes += expectedSize;
                if (totalBytes > MAX_TOTAL_BYTES) {
                    throw new IOException("Manifest exceeds total size budget");
                }

                File dest = new File(stagingDir, relPath);
                File parent = dest.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Could not create parent dir for " + relPath);
                }
                String destCanonical = dest.getCanonicalPath();
                if (!destCanonical.startsWith(stagingCanonical + File.separator)) {
                    throw new IOException("Path escapes staging root: " + relPath);
                }

                if (tryReuseLocalFile(activePath, relPath, expectedSha, expectedSize, dest)
                    || tryReuseLocalFile(previousPath, relPath, expectedSha, expectedSize, dest)
                    || tryReuseApkAsset(ctx, relPath, expectedSha, expectedSize, dest)) {
                    reused++;
                } else {
                    String fileUrl = origin + "/" + relPath + "?v=" + expectedSha.substring(0, 12);
                    downloadAndVerify(fileUrl, dest, expectedSha, expectedSize);
                    downloaded++;
                }
            }

            // Persist the manifest itself inside the staged bundle for diagnostics/inspection.
            try (FileOutputStream fos = new FileOutputStream(new File(stagingDir, "mobile-manifest.json"))) {
                fos.write(manifestBytes);
            }

            File finalDir = new File(root, "bundle-" + remoteVersion);
            deleteRecursively(finalDir);
            if (!stagingDir.renameTo(finalDir)) {
                throw new IOException("Atomic bundle promotion rename failed");
            }

            prefs.edit()
                .putString(KEY_PENDING_VERSION, remoteVersion)
                .putString(KEY_PENDING_PATH, finalDir.getAbsolutePath())
                .commit();
            pruneOldBundles(ctx, prefs);

            Logger.info(TAG, "Staged silent OTA " + remoteVersion + " (downloaded=" + downloaded + ", reused=" + reused + ")");
            JSObject staged = new JSObject();
            staged.put("status", "staged");
            staged.put("version", remoteVersion);
            staged.put("downloaded", downloaded);
            staged.put("reused", reused);
            return staged;
        } catch (Exception ex) {
            deleteRecursively(stagingDir);
            throw ex;
        }
    }

    private static boolean tryReuseLocalFile(String baseDir, String relPath, String expectedSha, long expectedSize, File dest) {
        if (baseDir == null || baseDir.isEmpty()) return false;
        File src = new File(baseDir, relPath);
        if (!src.isFile() || src.length() != expectedSize) return false;
        try {
            String actual = copyAndHash(new FileInputStream(src), dest, expectedSize);
            if (expectedSha.equals(actual)) return true;
        } catch (IOException ignored) {}
        //noinspection ResultOfMethodCallIgnored
        dest.delete();
        return false;
    }

    private static boolean tryReuseApkAsset(Context ctx, String relPath, String expectedSha, long expectedSize, File dest) {
        try (InputStream in = ctx.getAssets().open("public/" + relPath)) {
            String actual = copyAndHash(in, dest, expectedSize);
            if (expectedSha.equals(actual)) return true;
        } catch (IOException ignored) {}
        //noinspection ResultOfMethodCallIgnored
        dest.delete();
        return false;
    }

    private static void downloadAndVerify(String urlStr, File dest, String expectedSha, long expectedSize) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(20_000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " for " + urlStr);
            String actual = copyAndHash(conn.getInputStream(), dest, expectedSize);
            if (!expectedSha.equals(actual)) {
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
                if (written > expectedSize) {
                    throw new IOException("File exceeded expected size");
                }
                md.update(buf, 0, n);
                out.write(buf, 0, n);
            }
        }
        if (written != expectedSize) {
            throw new IOException("Size mismatch: expected " + expectedSize + ", got " + written);
        }
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
            if (code != 200) throw new IOException("HTTP " + code + " for manifest");
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                int total = 0;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > maxBytes) throw new IOException("Manifest too large");
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

    private static String readBuiltInVersion(Context ctx) {
        try (InputStream in = ctx.getAssets().open("public/mobile-manifest.json");
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            JSONObject obj = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            return obj.optString("version", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    private static JSObject buildStatus(Context ctx, SharedPreferences prefs) {
        String activeVersion = prefs.getString(KEY_ACTIVE_VERSION, "");
        String builtInVersion = readBuiltInVersion(ctx);
        JSObject out = new JSObject();
        out.put("activeVersion", activeVersion.isEmpty() ? builtInVersion : activeVersion);
        out.put("builtInVersion", builtInVersion);
        out.put("pendingVersion", prefs.getString(KEY_PENDING_VERSION, ""));
        out.put("blockedVersion", prefs.getString(KEY_BLOCKED_VERSION, ""));
        out.put("isOta", !activeVersion.isEmpty());
        out.put("nativeVersionCode", BuildConfig.VERSION_CODE);
        return out;
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

    private static void pruneOldBundles(Context ctx, SharedPreferences prefs) {
        File root = otaRoot(ctx);
        File[] children = root.listFiles();
        if (children == null) return;
        Set<String> keep = new HashSet<>();
        for (String p : new String[] {
            prefs.getString(KEY_ACTIVE_PATH, ""),
            prefs.getString(KEY_PREVIOUS_PATH, ""),
            prefs.getString(KEY_PENDING_PATH, "")
        }) {
            if (!p.isEmpty()) keep.add(new File(p).getName());
        }
        for (File child : children) {
            if (!keep.contains(child.getName())) {
                deleteRecursively(child);
            }
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] items = f.listFiles();
            if (items != null) {
                for (File item : items) deleteRecursively(item);
            }
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
