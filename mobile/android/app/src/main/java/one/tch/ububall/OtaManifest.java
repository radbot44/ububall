package one.tch.ububall;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Signature verification and strict parsing of {@code mobile-manifest.json}. Pure Java (plus
 * org.json) so the JVM unit tests cover it. Callers verify the signature over the exact downloaded
 * bytes before parsing; nothing in an unverified manifest is trusted.
 */
final class OtaManifest {
    static final int MAX_FILES = 200;
    static final long MAX_FILE_BYTES = 10L * 1024L * 1024L;
    static final long MAX_TOTAL_BYTES = 32L * 1024L * 1024L;

    private static final Pattern VERSION_RE = Pattern.compile("^[0-9a-f]{16,64}$");
    private static final Pattern SHA256_RE = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern REL_PATH_RE = Pattern.compile("^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$");

    static final class Entry {
        final String path;
        final String sha256;
        final long size;

        Entry(String path, String sha256, long size) {
            this.path = path;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    final int minNativeVersion;
    final long issuedAt;
    final String version;
    final List<Entry> files;

    private OtaManifest(int minNativeVersion, long issuedAt, String version, List<Entry> files) {
        this.minNativeVersion = minNativeVersion;
        this.issuedAt = issuedAt;
        this.version = version;
        this.files = Collections.unmodifiableList(files);
    }

    /**
     * Verifies a base64 DER ECDSA-SHA256 signature (as written by scripts/ota-manifest.cjs) with a
     * base64 X.509 SubjectPublicKeyInfo P-256 key. Any malformed input is a failed verification.
     */
    static boolean verifySignature(byte[] manifestBytes, byte[] signatureFile, String publicKeyBase64) {
        if (manifestBytes == null || signatureFile == null || publicKeyBase64 == null || publicKeyBase64.isEmpty()) return false;
        try {
            byte[] keyDer = Base64.getDecoder().decode(publicKeyBase64.trim());
            PublicKey key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(keyDer));
            byte[] sig = Base64.getDecoder().decode(new String(signatureFile, StandardCharsets.US_ASCII).trim());
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(key);
            verifier.update(manifestBytes);
            return verifier.verify(sig);
        } catch (Exception ignored) {
            return false;
        }
    }

    static OtaManifest parse(byte[] bytes) throws IOException {
        JSONObject manifest;
        try {
            manifest = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (JSONException ex) {
            throw new IOException("Manifest is not valid JSON");
        }
        if (manifest.optInt("schema", -1) != 1) throw new IOException("Unsupported manifest schema");
        int minNative = manifest.optInt("minNativeVersion", -1);
        if (minNative < 1) throw new IOException("Invalid minNativeVersion");
        long issuedAt = manifest.optLong("issuedAt", -1);
        if (issuedAt < 1) throw new IOException("Invalid issuedAt");
        String version = manifest.optString("version", "");
        if (!VERSION_RE.matcher(version).matches()) throw new IOException("Invalid manifest version");

        JSONObject filesObj = manifest.optJSONObject("files");
        if (filesObj == null || filesObj.length() == 0 || filesObj.length() > MAX_FILES) {
            throw new IOException("Invalid manifest files table");
        }
        if (!filesObj.has("index.html") || !filesObj.has("platform.js")) {
            throw new IOException("Manifest missing required entrypoints");
        }
        List<Entry> files = new ArrayList<>();
        long total = 0;
        Iterator<String> keys = filesObj.keys();
        while (keys.hasNext()) {
            String rel = keys.next();
            if (!REL_PATH_RE.matcher(rel).matches() || rel.contains("..")) throw new IOException("Invalid relative path: " + rel);
            JSONObject entry = filesObj.optJSONObject(rel);
            if (entry == null) throw new IOException("Malformed file entry: " + rel);
            String sha = entry.optString("sha256", "");
            long size = entry.optLong("size", -1);
            if (!SHA256_RE.matcher(sha).matches() || size < 0 || size > MAX_FILE_BYTES) {
                throw new IOException("Invalid hash or size for " + rel);
            }
            total += size;
            if (total > MAX_TOTAL_BYTES) throw new IOException("Manifest exceeds total size budget");
            files.add(new Entry(rel, sha, size));
        }
        return new OtaManifest(minNative, issuedAt, version, files);
    }
}
