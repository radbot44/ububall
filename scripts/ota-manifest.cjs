'use strict';
// Mobile OTA manifest: SHA-256 file table, native compatibility floor and ECDSA P-256 signature.
// The Android OtaUpdaterPlugin verifies the signature over the exact manifest bytes with the
// public key compiled into the APK (mobile/ota-public-key.pem) before trusting any entry.
const { createHash, createPrivateKey, createPublicKey, sign, verify } = require('node:crypto');
const { readdirSync, readFileSync, statSync, existsSync } = require('node:fs');
const { join, posix } = require('node:path');

const MANIFEST_NAME = 'mobile-manifest.json';
const SIGNATURE_NAME = 'mobile-manifest.sig';

/** Capacitor plugin names referenced as `plugins().Name` or `Plugins.Name` in web sources. */
function nativePluginsUsed(sources) {
  const used = new Set();
  for (const text of sources) {
    for (const match of text.matchAll(/\bplugins\(\)\??\.([A-Za-z_$][\w$]*)/g)) used.add(match[1]);
    for (const match of text.matchAll(/\bPlugins\??\.([A-Za-z_$][\w$]*)/g)) used.add(match[1]);
  }
  return used;
}

/**
 * Lowest released native versionCode whose plugin set covers `used`. Recorded plugin sets must be
 * cumulative so every later native version also qualifies.
 */
function minNativeVersion(used, compat) {
  const versions = Object.keys(compat?.nativeVersions || {}).map(Number).sort((a, b) => a - b);
  if (!versions.length || versions.some(v => !Number.isInteger(v) || v < 1)) throw new Error('native-compat.json needs integer nativeVersions keys >= 1.');
  if (versions[versions.length - 1] !== compat.versionCode) throw new Error('native-compat.json versionCode must be its highest nativeVersions entry.');
  let previous = new Set();
  for (const v of versions) {
    const set = new Set(compat.nativeVersions[String(v)]);
    for (const name of previous) if (!set.has(name)) throw new Error(`native-compat.json version ${v} drops plugin ${name}; plugin sets must be cumulative.`);
    previous = set;
  }
  for (const v of versions) {
    const set = new Set(compat.nativeVersions[String(v)]);
    if ([...used].every(name => set.has(name))) return v;
  }
  const missing = [...used].filter(name => !previous.has(name)).sort();
  throw new Error(`Web code uses native plugins no released APK provides: ${missing.join(', ')}. Add them under a new versionCode in mobile/native-compat.json.`);
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const rel = prefix ? posix.join(prefix, name) : name;
    if (!prefix && (name === MANIFEST_NAME || name === SIGNATURE_NAME)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Deterministic file table; `version` hashes content only, so rebuilding unchanged files is a no-op. */
function buildManifest(dir, { minNativeVersion: minNative, issuedAt }) {
  if (!Number.isInteger(minNative) || minNative < 1) throw new Error('minNativeVersion must be a positive integer.');
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 1) throw new Error('issuedAt must be a positive integer.');
  const files = {};
  const summary = [];
  for (const rel of listFiles(dir).sort()) {
    const bytes = readFileSync(join(dir, rel));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    files[rel] = { sha256, size: bytes.length };
    summary.push(`${rel}:${sha256}`);
  }
  const version = createHash('sha256').update(summary.join('\n')).digest('hex').slice(0, 16);
  const manifest = { schema: 1, minNativeVersion: minNative, issuedAt, version, files };
  return { manifest, bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') };
}

/** Base64 DER ECDSA-SHA256 signature (Java `SHA256withECDSA`). */
function signManifest(bytes, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('OTA signing key must be ECDSA P-256.');
  return sign('sha256', bytes, key).toString('base64');
}

function verifyManifest(bytes, signatureBase64, publicKeyPem) {
  try {
    return verify('sha256', bytes, createPublicKey(publicKeyPem), Buffer.from(String(signatureBase64).trim(), 'base64'));
  } catch {
    return false;
  }
}

/** Explicit UBUBALL_OTA_SIGNING_KEY wins (and must exist); otherwise the private settings folders. */
function signingKeyPath(env = process.env, home = require('node:os').homedir()) {
  if (env.UBUBALL_OTA_SIGNING_KEY) {
    if (!existsSync(env.UBUBALL_OTA_SIGNING_KEY)) throw new Error(`UBUBALL_OTA_SIGNING_KEY does not exist: ${env.UBUBALL_OTA_SIGNING_KEY}`);
    return env.UBUBALL_OTA_SIGNING_KEY;
  }
  const candidates = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'ubumint', 'ota-signing-key.pem') : '',
    home ? join(home, '.config', 'ubumint', 'ota-signing-key.pem') : ''
  ];
  return candidates.find(path => path && existsSync(path)) || '';
}

module.exports = { MANIFEST_NAME, SIGNATURE_NAME, nativePluginsUsed, minNativeVersion, buildManifest, signManifest, verifyManifest, signingKeyPath };
