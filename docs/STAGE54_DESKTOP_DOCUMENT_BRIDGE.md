## Stage 54 — desktop document host bridge

Adds a narrow contract between the local text analyzer and a trusted desktop
shell. The host owns the native file picker and returns the selected document's
display name and text; it must never accept arbitrary paths or fetch remote data.

Security and execution rules:
- The bridge is invoked only with exact consent: `granted: true`,
  `purpose: "document_read"`, and `source: "explicit_user_action"`.
- Host readiness is checked before opening the picker.
- The host receives a hard 64 KiB UTF-8 limit; returned content and display name
  are validated again by the in-process analyzer.
- Host errors are normalized; arbitrary host payload properties are rejected.
- No path, URI, filesystem API, network transport, model, or package dependency
  is introduced by this adapter.
- This is an interface contract and test fake, not a packaged desktop host.
  No production runtime registers it.

The capability remains `planned` with `review_required` licensing, so the
native capability registry continues to block execution. A future desktop shell
must implement the contract and obtain explicit license approval before use.
