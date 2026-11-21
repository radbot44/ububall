package one.tch.ububall;

import java.io.File;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Pure OTA boot and rollback state machine over the persisted preference values. It has no
 * Android dependencies so the JVM unit tests can exercise every transition.
 *
 * A promoted bundle is "unconfirmed" until the web app reports a healthy start. Each attempt to
 * boot it (cold launch, activity recreation or watchdog reload) counts; after
 * {@link #MAX_BOOT_ATTEMPTS} unconfirmed attempts the bundle is blocked and the previous one is
 * restored. One interrupted launch therefore never blocks a good update.
 */
final class OtaBootState {
    static final String KEY_BINARY_STAMP = "binary_stamp";
    static final String KEY_ACTIVE_VERSION = "active_version";
    static final String KEY_ACTIVE_PATH = "active_path";
    static final String KEY_PREVIOUS_VERSION = "previous_version";
    static final String KEY_PREVIOUS_PATH = "previous_path";
    static final String KEY_PENDING_VERSION = "pending_version";
    static final String KEY_PENDING_PATH = "pending_path";
    static final String KEY_UNCONFIRMED_VERSION = "unconfirmed_version";
    static final String KEY_BOOT_ATTEMPTS = "boot_attempts";
    static final String KEY_BLOCKED_VERSION = "blocked_version";
    static final String KEY_HIGHEST_ISSUED_AT = "highest_issued_at";

    static final int MAX_BOOT_ATTEMPTS = 2;

    enum Action {
        /** Serve {@link Decision#serverPath}; nothing to watch. */
        NONE,
        /** Serve an unconfirmed bundle and arm the boot watchdog. */
        BOOT_UNCONFIRMED,
        /** Watchdog expired with attempts left: reload the same bundle and re-arm. */
        RETRY,
        /** Unconfirmed bundle failed: serve the restored bundle ("" = APK assets). */
        ROLLBACK
    }

    static final class Decision {
        final Action action;
        /** Wipe all OTA preferences and bundles before applying {@link #updates}. */
        final boolean clearAll;
        final Map<String, String> updates;
        /** Bundle directory to serve; "" serves the APK's built-in assets. */
        final String serverPath;

        Decision(Action action, boolean clearAll, Map<String, String> updates, String serverPath) {
            this.action = action;
            this.clearAll = clearAll;
            this.updates = Collections.unmodifiableMap(updates);
            this.serverPath = serverPath;
        }
    }

    private OtaBootState() {}

    static Decision onLaunch(Map<String, String> prefs, String binaryStamp, Predicate<String> validBundle) {
        if (!binaryStamp.equals(get(prefs, KEY_BINARY_STAMP))) {
            Map<String, String> updates = new HashMap<>();
            updates.put(KEY_BINARY_STAMP, binaryStamp);
            return new Decision(Action.NONE, true, updates, "");
        }

        String unconfirmed = get(prefs, KEY_UNCONFIRMED_VERSION);
        if (!unconfirmed.isEmpty()) {
            String activePath = get(prefs, KEY_ACTIVE_PATH);
            int attempts = attempts(prefs);
            if (attempts >= MAX_BOOT_ATTEMPTS || !validBundle.test(activePath)) {
                return rollback(prefs, validBundle);
            }
            Map<String, String> updates = new HashMap<>();
            updates.put(KEY_BOOT_ATTEMPTS, String.valueOf(attempts + 1));
            return new Decision(Action.BOOT_UNCONFIRMED, false, updates, activePath);
        }

        String pendingVersion = get(prefs, KEY_PENDING_VERSION);
        String pendingPath = get(prefs, KEY_PENDING_PATH);
        if (!pendingVersion.isEmpty()) {
            if (validBundle.test(pendingPath) && !pendingVersion.equals(get(prefs, KEY_BLOCKED_VERSION))) {
                Map<String, String> updates = new HashMap<>();
                updates.put(KEY_PREVIOUS_PATH, get(prefs, KEY_ACTIVE_PATH));
                updates.put(KEY_PREVIOUS_VERSION, get(prefs, KEY_ACTIVE_VERSION));
                updates.put(KEY_ACTIVE_PATH, pendingPath);
                updates.put(KEY_ACTIVE_VERSION, pendingVersion);
                updates.put(KEY_UNCONFIRMED_VERSION, pendingVersion);
                updates.put(KEY_BOOT_ATTEMPTS, "1");
                updates.put(KEY_PENDING_PATH, "");
                updates.put(KEY_PENDING_VERSION, "");
                return new Decision(Action.BOOT_UNCONFIRMED, false, updates, pendingPath);
            }
            Map<String, String> updates = new HashMap<>();
            updates.put(KEY_PENDING_PATH, "");
            updates.put(KEY_PENDING_VERSION, "");
            return withActive(prefs, validBundle, updates);
        }

        return withActive(prefs, validBundle, new HashMap<>());
    }

    static Decision onWatchdogExpired(Map<String, String> prefs, Predicate<String> validBundle) {
        if (get(prefs, KEY_UNCONFIRMED_VERSION).isEmpty()) {
            return new Decision(Action.NONE, false, new HashMap<>(), get(prefs, KEY_ACTIVE_PATH));
        }
        int attempts = attempts(prefs);
        String activePath = get(prefs, KEY_ACTIVE_PATH);
        if (attempts >= MAX_BOOT_ATTEMPTS || !validBundle.test(activePath)) {
            return rollback(prefs, validBundle);
        }
        Map<String, String> updates = new HashMap<>();
        updates.put(KEY_BOOT_ATTEMPTS, String.valueOf(attempts + 1));
        return new Decision(Action.RETRY, false, updates, activePath);
    }

    /** Updates to persist when the web app reports a healthy start (empty if nothing to confirm). */
    static Map<String, String> onBootConfirmed(Map<String, String> prefs) {
        Map<String, String> updates = new HashMap<>();
        if (!get(prefs, KEY_UNCONFIRMED_VERSION).isEmpty()) {
            updates.put(KEY_UNCONFIRMED_VERSION, "");
            updates.put(KEY_BOOT_ATTEMPTS, "0");
        }
        return updates;
    }

    /** Bundle directory names that cleanup must keep. */
    static Set<String> keepDirectoryNames(Map<String, String> prefs) {
        Set<String> keep = new HashSet<>();
        for (String key : new String[] { KEY_ACTIVE_PATH, KEY_PREVIOUS_PATH, KEY_PENDING_PATH }) {
            String path = get(prefs, key);
            if (!path.isEmpty()) keep.add(new File(path).getName());
        }
        return keep;
    }

    /** Lowest manifest issue time still acceptable; older signed manifests are replays. */
    static long issuedAtFloor(Map<String, String> prefs, long builtInIssuedAt) {
        long stored = 0;
        try {
            stored = Long.parseLong(get(prefs, KEY_HIGHEST_ISSUED_AT));
        } catch (NumberFormatException ignored) {}
        return Math.max(stored, builtInIssuedAt);
    }

    private static Decision rollback(Map<String, String> prefs, Predicate<String> validBundle) {
        String prevPath = get(prefs, KEY_PREVIOUS_PATH);
        String prevVersion = get(prefs, KEY_PREVIOUS_VERSION);
        if (!validBundle.test(prevPath)) {
            prevPath = "";
            prevVersion = "";
        }
        Map<String, String> updates = new HashMap<>();
        updates.put(KEY_BLOCKED_VERSION, get(prefs, KEY_UNCONFIRMED_VERSION));
        updates.put(KEY_ACTIVE_PATH, prevPath);
        updates.put(KEY_ACTIVE_VERSION, prevVersion);
        updates.put(KEY_PREVIOUS_PATH, "");
        updates.put(KEY_PREVIOUS_VERSION, "");
        updates.put(KEY_UNCONFIRMED_VERSION, "");
        updates.put(KEY_BOOT_ATTEMPTS, "0");
        return new Decision(Action.ROLLBACK, false, updates, prevPath);
    }

    private static Decision withActive(Map<String, String> prefs, Predicate<String> validBundle, Map<String, String> updates) {
        String activePath = get(prefs, KEY_ACTIVE_PATH);
        if (!activePath.isEmpty() && !validBundle.test(activePath)) {
            updates.put(KEY_ACTIVE_PATH, "");
            updates.put(KEY_ACTIVE_VERSION, "");
            return new Decision(Action.NONE, false, updates, "");
        }
        return new Decision(Action.NONE, false, updates, activePath);
    }

    private static int attempts(Map<String, String> prefs) {
        try {
            return Math.max(0, Integer.parseInt(get(prefs, KEY_BOOT_ATTEMPTS)));
        } catch (NumberFormatException ignored) {
            return MAX_BOOT_ATTEMPTS;
        }
    }

    private static String get(Map<String, String> prefs, String key) {
        String value = prefs.get(key);
        return value == null ? "" : value;
    }
}
