## Stage 53 — local plain-text document adapter

The first concrete local module is a dependency-free plain-text document analyzer
for the `document_understanding` capability. It reports UTF-8 byte and character
counts, line/paragraph/word counts, Markdown headings, and a bounded preview.

Scope and safety:
- Runtime target: `desktop_local`; no Cloudflare Worker or Android integration.
- Input is supplied as text; the adapter does not read paths or access the filesystem.
- It does not parse PDFs, Office files, images, or perform OCR.
- Input is limited to 64 KiB of UTF-8; filenames are metadata only and reject path separators/control characters.
- No third-party packages, model weights, network calls, or paid services are required.
- The module is not registered in the production runtime.

The catalog remains `planned` with `review_required` licensing. Registering an
adapter does not bypass readiness: the registry continues to block execution until
the capability is explicitly marked `available` and its license is approved.
A future integration must add a trusted local caller and tests for that runtime
before changing those gates.
