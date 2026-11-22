package one.tch.ububall;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import org.junit.Test;

public class OtaBootStateTest {
    private static final String STAMP = "2:1000";
    private final Set<String> dirs = new HashSet<>();
    private final Predicate<String> valid = dirs::contains;

    private Map<String, String> prefs(String... kv) {
        Map<String, String> map = new HashMap<>();
        map.put(OtaBootState.KEY_BINARY_STAMP, STAMP);
        for (int i = 0; i < kv.length; i += 2) map.put(kv[i], kv[i + 1]);
        return map;
    }

    private static void apply(Map<String, String> prefs, OtaBootState.Decision d) {
        if (d.clearAll) prefs.clear();
        prefs.putAll(d.updates);
    }

    @Test
    public void newBinaryClearsEverythingAndServesApkAssets() {
        Map<String, String> p = prefs(OtaBootState.KEY_ACTIVE_PATH, "/ota/bundle-a", OtaBootState.KEY_BINARY_STAMP, "1:1");
        dirs.add("/ota/bundle-a");
        OtaBootState.Decision d = OtaBootState.onLaunch(p, STAMP, valid);
        assertTrue(d.clearAll);
        assertEquals("", d.serverPath);
        assertEquals(STAMP, d.updates.get(OtaBootState.KEY_BINARY_STAMP));
    }

    @Test
    public void pendingBundlePromotesSurvivesOneInterruptedLaunchAndConfirms() {
        dirs.add("/ota/bundle-a");
        dirs.add("/ota/bundle-b");
        Map<String, String> p = prefs(
            OtaBootState.KEY_ACTIVE_PATH, "/ota/bundle-a", OtaBootState.KEY_ACTIVE_VERSION, "a",
            OtaBootState.KEY_PENDING_PATH, "/ota/bundle-b", OtaBootState.KEY_PENDING_VERSION, "b");
        OtaBootState.Decision first = OtaBootState.onLaunch(p, STAMP, valid);
        apply(p, first); // attempt 1, killed before confirming
        assertEquals(OtaBootState.Action.BOOT_UNCONFIRMED, first.action);
        assertEquals("/ota/bundle-b", first.serverPath);
        assertEquals("b", p.get(OtaBootState.KEY_UNCONFIRMED_VERSION));
        assertEquals("1", p.get(OtaBootState.KEY_BOOT_ATTEMPTS));
        assertEquals("/ota/bundle-a", p.get(OtaBootState.KEY_PREVIOUS_PATH));
        assertEquals("", p.get(OtaBootState.KEY_PENDING_VERSION));

        OtaBootState.Decision second = OtaBootState.onLaunch(p, STAMP, valid);
        apply(p, second);
        assertEquals(OtaBootState.Action.BOOT_UNCONFIRMED, second.action);
        assertEquals("/ota/bundle-b", second.serverPath);
        assertEquals("2", p.get(OtaBootState.KEY_BOOT_ATTEMPTS));

        apply(p, new OtaBootState.Decision(OtaBootState.Action.NONE, false, OtaBootState.onBootConfirmed(p), ""));
        assertEquals("", p.get(OtaBootState.KEY_UNCONFIRMED_VERSION));
        assertEquals("", p.getOrDefault(OtaBootState.KEY_BLOCKED_VERSION, ""));
        assertEquals(OtaBootState.Action.NONE, OtaBootState.onWatchdogExpired(p, valid).action);
        assertTrue(OtaBootState.onBootConfirmed(p).isEmpty());

        OtaBootState.Decision third = OtaBootState.onLaunch(p, STAMP, valid);
        assertEquals(OtaBootState.Action.NONE, third.action);
        assertEquals("/ota/bundle-b", third.serverPath);
    }

    @Test
    public void repeatedlyUnconfirmedBundleIsBlockedAndPreviousRestored() {
        dirs.add("/ota/bundle-a");
        dirs.add("/ota/bundle-b");
        Map<String, String> p = prefs(
            OtaBootState.KEY_ACTIVE_PATH, "/ota/bundle-a", OtaBootState.KEY_ACTIVE_VERSION, "a",
            OtaBootState.KEY_PENDING_PATH, "/ota/bundle-b", OtaBootState.KEY_PENDING_VERSION, "b");
        apply(p, OtaBootState.onLaunch(p, STAMP, valid));
        apply(p, OtaBootState.onLaunch(p, STAMP, valid));
        OtaBootState.Decision d = OtaBootState.onLaunch(p, STAMP, valid);
        apply(p, d);
        assertEquals(OtaBootState.Action.ROLLBACK, d.action);
        assertEquals("/ota/bundle-a", d.serverPath);
        assertEquals("b", p.get(OtaBootState.KEY_BLOCKED_VERSION));
        assertEquals("a", p.get(OtaBootState.KEY_ACTIVE_VERSION));
        assertEquals("", p.get(OtaBootState.KEY_PREVIOUS_PATH));
        assertEquals("", p.get(OtaBootState.KEY_UNCONFIRMED_VERSION));
    }

    @Test
    public void watchdogRetriesOnceThenRollsBackToApkAssets() {
        dirs.add("/ota/bundle-b");
        Map<String, String> p = prefs(
            OtaBootState.KEY_PENDING_PATH, "/ota/bundle-b", OtaBootState.KEY_PENDING_VERSION, "b");
        apply(p, OtaBootState.onLaunch(p, STAMP, valid));
        OtaBootState.Decision retry = OtaBootState.onWatchdogExpired(p, valid);
        apply(p, retry);
        assertEquals(OtaBootState.Action.RETRY, retry.action);
        assertEquals("/ota/bundle-b", retry.serverPath);
        OtaBootState.Decision rollback = OtaBootState.onWatchdogExpired(p, valid);
        apply(p, rollback);
        assertEquals(OtaBootState.Action.ROLLBACK, rollback.action);
        assertEquals("", rollback.serverPath);
        assertEquals("b", p.get(OtaBootState.KEY_BLOCKED_VERSION));
    }

    @Test
    public void blockedOrMissingPendingBundleIsDiscarded() {
        dirs.add("/ota/bundle-b");
        Map<String, String> p = prefs(
            OtaBootState.KEY_PENDING_PATH, "/ota/bundle-b", OtaBootState.KEY_PENDING_VERSION, "b",
            OtaBootState.KEY_BLOCKED_VERSION, "b");
        OtaBootState.Decision d = OtaBootState.onLaunch(p, STAMP, valid);
        assertEquals(OtaBootState.Action.NONE, d.action);
        assertEquals("", d.serverPath);
        assertEquals("", d.updates.get(OtaBootState.KEY_PENDING_VERSION));
    }

    @Test
    public void missingActiveOrUnconfirmedBundleRecoversSafely() {
        Map<String, String> active = prefs(OtaBootState.KEY_ACTIVE_PATH, "/ota/gone", OtaBootState.KEY_ACTIVE_VERSION, "a");
        OtaBootState.Decision d = OtaBootState.onLaunch(active, STAMP, valid);
        assertEquals("", d.serverPath);
        assertEquals("", d.updates.get(OtaBootState.KEY_ACTIVE_VERSION));

        Map<String, String> unconfirmed = prefs(
            OtaBootState.KEY_ACTIVE_PATH, "/ota/gone", OtaBootState.KEY_UNCONFIRMED_VERSION, "b",
            OtaBootState.KEY_BOOT_ATTEMPTS, "1");
        assertEquals(OtaBootState.Action.ROLLBACK, OtaBootState.onLaunch(unconfirmed, STAMP, valid).action);
    }

    @Test
    public void issuedAtFloorUsesNewestOfStoredAndBuiltIn() {
        assertEquals(500L, OtaBootState.issuedAtFloor(prefs(), 500L));
        assertEquals(900L, OtaBootState.issuedAtFloor(prefs(OtaBootState.KEY_HIGHEST_ISSUED_AT, "900"), 500L));
        assertEquals(500L, OtaBootState.issuedAtFloor(prefs(OtaBootState.KEY_HIGHEST_ISSUED_AT, "junk"), 500L));
    }
}
