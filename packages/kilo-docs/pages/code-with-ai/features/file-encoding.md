# File Encoding Preservation

Kilo detects the text encoding of files before reading or editing them, so non-UTF-8 files are displayed correctly to the model and written back in their original encoding.

Previously every tool assumed UTF-8. Reading a Shift_JIS or Windows-1251 file would surface garbled text to the model, and editing it would corrupt the file on disk.

## How It Works

1. Files are read as raw bytes.
2. UTF-8 is tried first — if the bytes decode as valid UTF-8, the file is treated as UTF-8 (with the BOM tracked separately when present).
3. Otherwise, [jschardet](https://github.com/aadsm/jschardet) runs a statistical analysis to identify the encoding.
4. The detected encoding flows through `read_file`, `edit`, `write_to_file`, and `apply_patch`.
5. On write, [iconv-lite](https://github.com/ashtuchkin/iconv-lite) re-encodes to the original encoding and restores the BOM if one was present.
6. New files are created as UTF-8 without BOM. Detection only applies when reading or overwriting an existing file.

Binary detection now consults the detected encoding first, so UTF-16 files (which contain null bytes) and CJK-encoded files are no longer incorrectly rejected as binary.

## Supported Encodings

- UTF-8 (with or without BOM)
- UTF-16 LE/BE **with BOM**
- Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR
- Windows-1251, KOI8-R
- ISO-8859 family
- Other legacy encodings recognized by jschardet

## Not Supported

- UTF-16 without BOM (ambiguous with other byte-oriented encodings)
- UTF-32

{% callout type="info" %}
Detection is statistical. Very short files, or files whose byte distribution is ambiguous, may be detected as a different encoding than the one they were saved with.
{% /callout %}

## Reporting Issues

If Kilo reads a file as garbled text or writes it back in a different encoding, please open an issue at [github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues) and include:

- **A file that reproduces the issue.** Attach the actual file; don't paste its contents into the issue body, since that will change the encoding.
- **The exact name of the encoding** the file is saved in (for example `Shift_JIS`, `windows-1251`, `UTF-16 LE with BOM`).
- **A hash of the file** so we can verify it wasn't corrupted in transit. On macOS and Linux:
  ```bash
  shasum -a 256 path/to/file
  ```
  On Windows:
  ```powershell
  Get-FileHash path\to\file -Algorithm SHA256
  ```
- **The model and provider** you were using when the issue occurred (for example `anthropic/claude-sonnet-4.5` via Kilo Gateway, or `gpt-4o` via OpenAI).
