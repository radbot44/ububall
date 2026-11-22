package one.tch.ububall;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Base64;
import org.junit.Test;

public class OtaManifestTest {
    private static byte[] resource(String name) throws IOException {
        try (InputStream in = OtaManifestTest.class.getResourceAsStream("/ota/" + name)) {
            if (in == null) throw new IOException("missing fixture " + name);
            return in.readAllBytes();
        }
    }

    private static String testKey() throws IOException {
        return new String(resource("test-public-key.txt"), StandardCharsets.US_ASCII).trim();
    }

    /** Fixture signed by Node's crypto.sign (scripts/ota-manifest.cjs format) with a test-only key. */
    @Test
    public void acceptsNodeSignedManifest() throws Exception {
        assertTrue(OtaManifest.verifySignature(resource("manifest.json"), resource("manifest.sig"), testKey()));
        OtaManifest m = OtaManifest.parse(resource("manifest.json"));
        assertEquals("0123456789abcdef", m.version);
        assertEquals(1, m.minNativeVersion);
        assertEquals(1795000000000L, m.issuedAt);
        assertEquals(3, m.files.size());
    }

    @Test
    public void rejectsTamperedManifestWrongKeyAndGarbage() throws Exception {
        byte[] manifest = resource("manifest.json");
        byte[] tampered = Arrays.copyOf(manifest, manifest.length);
        tampered[20] ^= 1;
        assertFalse(OtaManifest.verifySignature(tampered, resource("manifest.sig"), testKey()));

        KeyPairGenerator gen = KeyPairGenerator.getInstance("EC");
        gen.initialize(new ECGenParameterSpec("secp256r1"));
        String otherKey = Base64.getEncoder().encodeToString(gen.generateKeyPair().getPublic().getEncoded());
        assertFalse(OtaManifest.verifySignature(manifest, resource("manifest.sig"), otherKey));

        assertFalse(OtaManifest.verifySignature(manifest, "not base64!".getBytes(StandardCharsets.US_ASCII), testKey()));
        assertFalse(OtaManifest.verifySignature(manifest, resource("manifest.sig"), ""));
        assertFalse(OtaManifest.verifySignature(manifest, null, testKey()));
    }

    private static void assertRejected(String json) {
        try {
            OtaManifest.parse(json.getBytes(StandardCharsets.UTF_8));
            fail("expected rejection: " + json);
        } catch (IOException expected) {
            // ok
        }
    }

    private static final String SHA = "0000000000000000000000000000000000000000000000000000000000000000";

    private static String manifest(String files) {
        return "{\"schema\":1,\"minNativeVersion\":1,\"issuedAt\":5,\"version\":\"0123456789abcdef\",\"files\":{" + files + "}}";
    }

    private static String entry(String path, long size) {
        return "\"" + path + "\":{\"sha256\":\"" + SHA + "\",\"size\":" + size + "}";
    }

    @Test
    public void parseRejectsUnsafeOrMalformedManifests() {
        String ok = entry("index.html", 1) + "," + entry("platform.js", 1);
        assertRejected("not json");
        assertRejected(manifest(ok).replace("\"schema\":1", "\"schema\":2"));
        assertRejected(manifest(ok).replace("\"issuedAt\":5", "\"issuedAt\":0"));
        assertRejected(manifest(ok).replace("\"minNativeVersion\":1", "\"minNativeVersion\":0"));
        assertRejected(manifest(ok).replace("0123456789abcdef", "XYZ"));
        assertRejected(manifest(entry("index.html", 1)));
        assertRejected(manifest(ok + "," + entry("../evil.js", 1)));
        assertRejected(manifest(ok + "," + entry("/abs.js", 1)));
        assertRejected(manifest(ok + "," + entry("big.bin", OtaManifest.MAX_FILE_BYTES + 1)));
        StringBuilder many = new StringBuilder(ok);
        for (int i = 0; i < 4; i++) many.append(",").append(entry("f" + i + ".bin", OtaManifest.MAX_FILE_BYTES));
        assertRejected(manifest(many.toString()));
    }
}
