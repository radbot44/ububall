# .ubu file format

Status: working development profile implemented in ubu-file.js under owner authorization. This does not freeze the certificate protocol or alter the frozen DNA. No production keys, trusted mint configuration, ownership registry or cloud resources have been created.

## Encoding

- Extension: .ubu. Content: UTF-8 JSON, no BOM, encryption or compression. Maximum file size: 1024 bytes.
- Writers use JSON.stringify with the exact field order shown below, no whitespace or trailing newline. Readers reject noncanonical files by reconstructing the expected object in that order and comparing its UTF-8 bytes to the original. This also rejects duplicate keys, extra fields and alternative encodings without a second JSON parser. Decode UTF-8 with fatal error handling before parsing.
- Do not accept arbitrary objects, signature algorithms, inline public keys or key-fetch URLs.
- DNA is exactly 43 canonical unpadded base64url characters decoding to 32 bytes, as defined in dna.md. The file profile does not accept the demo input's hexadecimal alternative.
- This is a fixed application profile, not general-purpose canonical JSON or a general JOSE implementation. It requires no dependency beyond platform JSON and cryptography.

## Unsigned/custom

Exact field order and types:

```json
{"type":"ubu","dna":"<43-character DNA>"}
```

Only these two fields are permitted. Any person may generate or edit its DNA, including selecting finishes or Ubuquity. The importer validates the DNA and reports custom/unsigned status. It never invents a mint ID, issuance signature or registered ownership from this file. Its exact serialized size is 66 bytes.

## Mint-signed issuance certificate

Exact field order and types:

```json
{"type":"ubu-signed","mint":"<mint ID>","id":"<ubu ID>","serial":"000000000001","dna":"<43-character DNA>","issuedAt":1792700000,"key":"mint-1","signature":"<86-character signature>"}
```

Angle-bracket values are explanatory placeholders, not valid certificate data.

| Field | Rule |
| --- | --- |
| type | Exact string ubu-signed |
| mint | Permanent mint identity: canonical base64url of 16 random bytes, 22 characters |
| id | Permanent ubu identity: canonical base64url of 16 random bytes, 22 characters; mint checks uniqueness before registering |
| serial | Exactly twelve ASCII decimal digits, from 000000000001 through 999999999999; a string preserving leading zeros |
| dna | Complete frozen 256-bit DNA |
| issuedAt | Nonnegative safe-integer Unix time in seconds, assigned by the mint |
| key | Mint-scoped signing-key ID: 1-32 ASCII letters, digits, hyphen or underscore |
| signature | Ed25519 signature: canonical base64url of 64 bytes, 86 characters |

The mint ID is independent of the current domain and signing key. Moving from mint.ubu.tch.one to mint.uburoom.com does not change the issuer or invalidate old certificates. Key IDs are immutable and never reused for different public keys.

Certificate identity is the pair (mint, id). Duplicate-looking ubus need not have the same identity. Copying a certificate copies the same ubu identity; it does not create another minted ubu. The registry must associate that identity with these exact issuance fields and DNA.

Serials are permanent, sequential and unique within a mint, starting at 000000000001. They survive transfers, restarts, key rotations and domain changes. The registry must allocate the next number atomically with a durable issuance record, enforce unique (mint, serial), and make retries return the same issuance rather than allocate twice. Never reuse an allocated number, including after failed issuance; gaps are permitted. After 999999999999, refuse further issuance without wrapping or widening. Unsigned files have no official serial. Allocation is a registry requirement, not implemented by the file signer; it cannot enforce uniqueness or ordering offline.

## Mint batches

Owner-approved issuance policy: prepare a private inventory of random ubus in batches, defaulting to 1,000. Batch size is configurable for subsequent batches; changing it does not resize an existing batch or change any DNA.

- Generate DNA and allocate permanent IDs and sequential serials while preparing the batch. Persist progress so preparation can resume after interruption. Do not expose unfinished batches for allocation.
- Draw uniformly at random from the remaining inventory, without replacement. Serial numbers reflect creation order, not distribution order: the first default batch holds 000000000001–000000001000, the second 000000001001–000000002000.
- An authorized allocation atomically removes one available ubu and registers its owner. Retrying the same request returns the same allocation. Concurrent requests must never receive the same ubu.
- Sign the issuance certificate on allocation, with issuedAt recording issuance to the first owner. Persist its exact issuance fields so retries remain consistent. Prepared inventory is not yet a signed issuance certificate.
- Exhaust the current batch before allocating from the next one. Prepare the next batch in resumable chunks after exhaustion; requests may wait or receive a retry response while preparation completes.
- Keep unallocated DNA private. Batch allocation does not replace authentication, mint allowances or protection against repeated requests to hunt for traits.

This policy is approved. Persistent preparation, allocation and signing recovery are implemented; see [mint.md](mint.md). Cloudflare alarm scheduling, Discord OAuth and configurable lifetime allowances are implemented locally; see [worker.md](worker.md). Production credentials and deployment are not configured. Serial reservation is durable and numbers are never reused after a committed reservation, including after interrupted batch preparation.

## Exact signing bytes

Construct this object in this order, excluding signature:

```javascript
const certificate = { type: 'ubu-signed', mint, id, serial, dna, issuedAt, key };
const signingBytes = new TextEncoder().encode(
  'ubumint:issuance\n' + JSON.stringify(certificate)
);
```

Sign signingBytes directly with platform Ed25519 (pure Ed25519, not prehashed Ed25519ph). Encode its 64-byte result as canonical unpadded base64url and append signature as the final JSON field. Do not separately hash, encrypt or sign only the DNA. The prefix separates this signature's purpose from other mint operations.

Verification reconstructs the identical signingBytes after validating the schema. It uses only the public key already trusted for (mint, key), with Ed25519 fixed by this profile. Never trust a key merely because it is embedded in a file, supplied alongside it or hosted at an issuer URL named by it.

The signed file contains the readable DNA once and the signature once. It is not an encrypted duplicate. For 22-character mint/id values, a 12-digit serial, a 10-digit issuance time and key mint-1, it is 297 bytes; key/time lengths can change the total.

## Import results and host policy

1. Reject oversized, invalid UTF-8, invalid JSON, unknown type, wrong field types, unknown fields, invalid lengths or noncanonical encoding.
2. For type ubu, return custom/unsigned DNA only if the host permits custom ubus. Signed-only hosts reject it.
3. For type ubu-signed, require the complete certificate, a trusted mint/key and successful signature verification. Return verified issuance only after all checks succeed.
4. A signed-form failure is an explicit rejection, never a retry as unsigned. A signature supplied to an unsigned-form file is an unknown-field error.
5. A deliberate custom export may copy DNA into a new unsigned object. It carries no certificate ID, signature or official status, even if its appearance matches an official ubu.

## Ownership and online checks

The issuance certificate has no current-owner field and does not expire on transfer. It proves issuance, not current ownership or permission to trade.

The registry stores the current owner's Discord ID and an ownership revision for (mint, id). Viewing a file requires no Discord login; claiming, displaying it as owned, transferring or trading requires the appropriate authenticated identity and current registry authorization. Registry outages must not grant ownership from a stale file. Whether read-only owned displays can cache short-lived confirmations is separate policy work.

The mint site can accept a certificate or an identity lookup and report issuance status and the allowed ownership information. An online response may supersede an offline result after key revocation or other registry changes. Public key distribution, rotation/revocation handling, ownership receipts and registry APIs are the next design work; public registry lookup must not be assumed to expose Discord identities without a privacy decision.

No ownership signature or OAuth token is stored in this certificate. If independent owner signing is later selected, it belongs in the ownership protocol, not a reinterpretation of DNA or the immutable issuance signature.

## Sources

- [Ed25519 and its signature encoding](https://www.rfc-editor.org/rfc/rfc8032.html).

## Implementation

ubu-file.js is shared plain JavaScript using platform Web Crypto, with no dependencies:

- `unsigned(dnaCode)` returns the canonical custom JSON string. Accepts canonical base64url DNA only.
- `sign({ mint, id, serial, dna, issuedAt, key }, privateKey)` returns a signed file using an existing Ed25519 CryptoKey. This is a low-level serializer/signer, not an endpoint or authorization decision. A future mint endpoint must generate DNA and allocate identity and serial itself before calling it.
- `read(textOrBytes, { allowUnsigned = true, resolveKey } = {})` validates before returning anything. The caller's trusted `resolveKey(mint, key)` supplies an Ed25519 public CryptoKey, or null for an untrusted pair. It must not use file-controlled URLs or keys to establish trust. The result is frozen: `{ type: 'unsigned', dna }` or `{ type: 'signed', dna, certificate }`. A signed result means verified issuance only, never current ownership.
- `MAX_BYTES` is 1024. Browser imports check file size before reading and pass raw bytes so malformed UTF-8 is rejected.

The designer exports custom files, accepts valid unsigned files and rejects signed files because no mint keys are configured. It contains no signing UI. Existing DNA favorites/history and all rendering remain unchanged.

Serial update, 2026-10-23: `node --test` passes ten checks with no failures or skips. Serial tampering invalidates the signature; tests cover leading zeros, both range endpoints, missing/numeric/zero/out-of-range/non-decimal values and prohibition of serial metadata on custom files. Signed examples are now 297 bytes. Serial allocation/concurrency and browser verification of the revised certificate have not been exercised; allocation awaits the registry implementation.

Verification, 2026-10-23: `node --test` passes nine checks with no failures or skips. They cover frozen DNA outputs, canonical files, exact signature framing, every signed-field alteration, wrong/untrusted keys, prohibited algorithm/key types, missing signatures, extra/duplicate fields, invalid UTF-8/BOM, invalid encodings and signed-only host policy. Tests generate temporary keys only in memory. Node's separate crypto verification API confirms the signing bytes. A loopback browser fixture also verified a Node-issued test certificate and rejected altered DNA. Browser custom import and untrusted signed-file rejection passed without changing the displayed DNA on failure. Production trust, revocation and ownership remain untested because they are not implemented.
