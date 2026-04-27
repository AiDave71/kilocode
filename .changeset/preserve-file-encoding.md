---
"@kilocode/cli": minor
---

Preserve the original text encoding when reading and editing files. The read, edit, write, and apply_patch tools now detect each file's encoding and write it back unchanged, so non-UTF-8 source trees no longer get corrupted when the agent touches them.

Supported:

- UTF-8
- UTF-16 with BOM
- Legacy Latin and CJK encodings (Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR, Windows-1251, KOI8-R, ISO-8859 family, and others)

Not supported:

- UTF-16 without BOM
- UTF-32
