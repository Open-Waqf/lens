# SLBK Vault Format Specification (v3)

This document defines the `.slbk` encrypted backup container used by Sahifah Lens.

## Goals

- Auditable plaintext header (without password)
- Streaming encryption/decryption for low-memory devices
- Backward compatibility with legacy SLBK readers in-app

## Header Layout (plaintext)

All multi-byte integers are **big-endian** for v3.

1. `[MAGIC]` 4 bytes: ASCII `SLBK` (`0x53 0x4c 0x42 0x4b`)
2. `[VERSION]` 2 bytes: `0x0003`
3. `[KDF]` 1 byte: `0x01` = PBKDF2-SHA-256
4. `[ITERATIONS]` 4 bytes: unsigned integer (minimum `100000`, default `600000`)
5. `[SALT_LEN]` 1 byte: `0x10`
6. `[SALT]` 16 bytes: random bytes from `crypto.getRandomValues()`
7. `[IV_LEN]` 1 byte: `0x0c`
8. `[IV]` 12 bytes: random bytes from `crypto.getRandomValues()` (metadata chunk IV)
9. `[META_LEN]` 8 bytes: encrypted metadata chunk length
10. `[META_CHUNK]` variable: AES-256-GCM ciphertext of JSON metadata
11. `[DOC_COUNT]` 4 bytes: informational document count from export time

## Data Frames (encrypted)

After the header and metadata:

- Repeating frame structure:
  - `[CHUNK_LEN]` 8 bytes: ciphertext length
  - `[CHUNK_IV]` 12 bytes: unique random IV for this chunk
  - `[CIPHERTEXT]` variable: AES-256-GCM encrypted payload bytes

The payload currently contains a streamed ZIP archive of:

- `metadata.json` (Dexie records)
- document/page binaries from storage

## Cryptography

- KDF: PBKDF2-SHA-256
- Key size: 256-bit AES key
- AEAD: AES-256-GCM (`tagLength = 128`)
- Salt: 16 bytes random per export
- IV: 12 bytes random per metadata chunk and per data frame

## Error Handling Requirements

- Invalid magic/version/header lengths => reject as corrupted/unsupported
- Wrong password => fail with user-facing `Incorrect password`
- Truncated/modified stream => fail with user-facing corruption error

## Compatibility Notes

- New exports are always v3 `.slbk`.
- Import compatibility matrix:
  - v3: supported
  - legacy v2: supported (read-only compatibility path)
  - version > v3: rejected with `Vault file version is not supported.`
- Parsers should fail closed on unknown versions and should not attempt implicit downgrade/fallback.
