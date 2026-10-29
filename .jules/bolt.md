## 2026-10-28 - Base64URL DNA Decoding & Padding Validation
**Learning:** Re-encoding decoded `Uint8Array` back to a string with `toCode` to validate canonical base64 padding added massive redundant overhead (~9x slowdown in `fromCode`). Checking the 171st character against `[AEIMQUYcgkosw048]` with regex guarantees canonical zero padding in O(1) time without re-encoding or allocation overhead.
**Action:** Validate 171-char base64url canonical padding directly with regex `^[A-Za-z0-9_-]{170}[AEIMQUYcgkosw048]$` before decoding bytes in a simple `for` loop.
