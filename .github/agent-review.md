- The desktop app's Electron boundary (`apps/kaipu-record`): the renderer reaches the main
  process only through the preload's `contextBridge` API. A change that widens it, or passes
  unchecked renderer input to the main process, is a security finding.
- `apps/kaipu-record/src/shared/**` never takes a value import from a workspace package, only
  type imports: that directory reaches the preload bundle, and a value import there opens the app
  to a black window with green builds and tests. A value import there is a correctness finding.
- Package import rules: `domain` never imports `application` or `infra-*`; `application` never
  imports `infra-*`; `infra-*` never imports `application`; `apps/mobile` imports only
  `@kaipu/domain`.
- The web app proxies auth and the API to the Elysia backend: it never runs Better Auth and does
  not depend on `@kaipu/infra-auth`. CORS on the server is only for mobile.
- No `postinstall` or other install scripts, and no hand-edited generated `.env` files (values
  come from Infisical).
- Documentation lives in `apps/documentation/src/content/docs/`, in English: a new feature gets a
  doc, and an ADR is append-only (status changes, history is not rewritten). A missing doc is a
  note.

Accepted decision records (ADRs) live in `apps/documentation/src/content/docs/architecture/decisions/`,
not in `docs/adr/`; the index is `apps/documentation/src/content/docs/architecture/decisions/index.mdx`.
A change that contradicts an accepted ADR without superseding it is a "note" with category `adr`.
