# Local macOS build — signing + notarization (Developer ID)

Runbook to produce a **signed and notarized** `.app`/`.dmg` that installs without the
Gatekeeper warning, distributed **outside the Mac App Store** (direct DMG download).

> Strategy: validate locally first; only then move to CI (GitHub Actions).

---

## 0. Fixed project values

| Field                        | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `appId` (CFBundleIdentifier) | `com.niway.kaipu-record`                                    |
| Product name (display)       | `Kaipu Recorder`                                            |
| Team ID                      | `K9TKC5GG76`                                                |
| Signing identity             | `Developer ID Application: Cristian Sotomayor (K9TKC5GG76)` |
| Certificate type             | **Developer ID Application** (NOT Apple Distribution / MAS) |
| Notarization                 | App Store Connect **API Key** (`.p8`), notarytool method    |
| Key ID                       | `QWXC4HC43K`                                                |

> The signature will read `Cristian Sotomayor (K9TKC5GG76)` because the Apple account is
> **Individual**, not Organization. This is **expected**, not a bug. For direct download the
> user almost never sees the signer's name.

---

## 1. Prerequisites (one time)

1. **Active Apple Developer account** (paid).
2. **Developer ID Application certificate + private key** installed in the Mac **Keychain**.
   Verify:
   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   It must list the identity `... Cristian Sotomayor (K9TKC5GG76)`.
3. **Xcode + Command Line Tools** (notarytool needs Xcode 13+):
   ```bash
   xcode-select -p   # must point to a valid Xcode
   ```
4. **Credentials in a folder WITHOUT spaces**, outside the repo. A space in the path breaks
   the build, so do **not** keep them in folders like `apple important`:
   ```bash
   mkdir -p ~/.secrets/kaipu
   mv "<path>/kaipu-record-signing-Certificates.p12" ~/.secrets/kaipu/
   mv "<path>/kaipu-AuthKey_QWXC4HC43K.p8"            ~/.secrets/kaipu/
   ```

---

## 2. Configure `.env.signing` (one time)

electron-builder reads `process.env` but does **not** load `.env*` files on its own — that's
why `scripts/build-mac-local.sh` injects them. The file is **gitignored** (never committed);
the tracked template is `.env.signing.example`.

```bash
cp .env.signing.example .env.signing   # if it doesn't exist yet
```

Fill it in (absolute paths, no spaces):

```dotenv
# --- Signing ---
CSC_LINK=/Users/<user>/.secrets/kaipu/kaipu-record-signing-Certificates.p12
CSC_KEY_PASSWORD=<password you set when EXPORTING the .p12>

# --- Notarization (App Store Connect API Key — Team Key) ---
APPLE_API_KEY=/Users/<user>/.secrets/kaipu/kaipu-AuthKey_QWXC4HC43K.p8
APPLE_API_KEY_ID=QWXC4HC43K
APPLE_API_ISSUER=<Issuer ID UUID>   # App Store Connect → Users and Access → Integrations
```

> `CSC_KEY_PASSWORD` is the `.p12` password (the one you chose when exporting it), **not** your
> Mac password nor your Apple ID password.
>
> It is a **Team Key** (created under _Integrations_), so `APPLE_API_ISSUER` is **required**.
> If you ever use an _Individual Key_ (Xcode 26+), you must **omit** the issuer or Apple returns
> `401 Unauthorized`.

---

## 3. Build

```bash
cd apps/kaipu-record
npm run build:mac
```

That runs `scripts/build-mac-local.sh`, which:

```
load .env.signing → npm run build (electron-vite + typecheck)
                  → electron-builder --mac --publish never
                  → sign (CSC_LINK) → notarize (APPLE_API_*) → staple → DMG/ZIP
```

**Fast iteration (sign only, no waiting on Apple):** comment out the 3 `APPLE_API_*` lines in
`.env.signing`. Without those vars the `notarize` block doesn't fire → a signed build in
seconds. Once signing is OK, restore them and run once end-to-end to validate notarization +
staple.

**Artifacts** (in `apps/kaipu-record/dist/`):

- `.app` → `dist/mac-arm64/Kaipu Recorder.app` (on Apple Silicon; arm64 build by default)
- `.dmg` → `dist/kaipu-record-<version>-<arch>.dmg` (the `${arch}` avoids arm64/x64 collision)

---

## 4. Verify the result

```bash
APP="dist/mac-arm64/Kaipu Recorder.app"

# Identity present
security find-identity -v -p codesigning

# Valid signature + hardened runtime enabled
codesign -dv --verbose=4 "$APP"

# Gatekeeper: should say "accepted" / "source=Notarized Developer ID"
spctl -a -vvv --type exec "$APP"

# Notarization ticket stapled
xcrun stapler validate "$APP"
```

In the electron-builder logs you should see:
`signing ... identity=Developer ID Application: Cristian Sotomayor (K9TKC5GG76)`,
then `Notarization complete`, then the staple.

---

## 5. Where each thing lives

| File                                   | Role                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| `electron-builder.yml` (`mac:`)        | `hardenedRuntime`, `notarize: true`, entitlements, usage descriptions |
| `build/entitlements.mac.plist`         | app entitlements (allow-jit + audio-input + camera)                   |
| `build/entitlements.mac.inherit.plist` | entitlements inherited by helpers/renderer                            |
| `scripts/build-mac-local.sh`           | wrapper: injects `.env.signing` and runs the build                    |
| `.env.signing`                         | local secrets (**gitignored**)                                        |
| `.env.signing.example`                 | tracked template                                                      |

---

## 6. Troubleshooting / gotchas

1. **`configuration.mac.notarize should be a boolean`** → in `electron-builder@26` the
   `notarize` schema is a **boolean**, not the `{teamId}` object. Use `notarize: true` and pass
   the credentials via env (`APPLE_API_*`); the API key already identifies the team. (The error
   usually comes with `configuration.mac should be a null`, which is just the cascade effect.)
2. **`401 Unauthorized` when notarizing** → `APPLE_API_ISSUER` is missing (required for Team
   Keys), or you're using an Individual Key with an issuer set (remove it in that case).
3. **The notarized `.app` crashes on launch / library-validation error** → enable the commented
   optional keys in `build/entitlements.mac.plist`
   (`allow-unsigned-executable-memory`, `disable-library-validation`), one at a time.
4. **The build fails because of a path with spaces** → move the credentials to `~/.secrets/kaipu/`
   (section 1.4) and update the paths in `.env.signing`.
5. **Screen-recording permission** → on macOS it's granted at runtime via
   System Settings → Privacy (TCC); it has no Info.plist key, but the app must be
   signed/notarized to request it reliably.
6. **`.cer` / `.csr` are not used in the build** → only the `.p12` (signing) and the `.p8`
   (notarization). The `.cer`/`.certSigningRequest` already did their job when generating the `.p12`.

---

## 7. CI (GitHub Actions) — `release-desktop.yml`

The `.github/workflows/release-desktop.yml` workflow reproduces this build on a macOS runner and
attaches the signed+notarized DMGs (arm64 + x64) to a **GitHub Release** (draft).

- **Trigger:** push a `v*.*.*` tag (e.g. `v1.0.1`), or a manual `workflow_dispatch`.
- **Credentials:** the `.p8` is decoded from base64 into `$RUNNER_TEMP`; the `.p12` is passed as
  base64 directly in `CSC_LINK` (electron-builder accepts it). They never touch the repo.
- **Required secrets** — in the **`production` Environment** (Settings → Environments →
  production), which is why the job declares `environment: production`:

  | Secret             | Value                                                                          |
  | ------------------ | ------------------------------------------------------------------------------ |
  | `CSC_LINK`         | **base64** of the `.p12` (`base64 -i …/kaipu-record-signing-Certificates.p12`) |
  | `CSC_KEY_PASSWORD` | the `.p12` password                                                            |
  | `APPLE_API_KEY`    | **base64** of the `.p8` (`base64 -i …/kaipu-AuthKey_QWXC4HC43K.p8`)            |
  | `APPLE_API_KEY_ID` | `QWXC4HC43K`                                                                   |
  | `APPLE_API_ISSUER` | Issuer UUID                                                                    |

  > ⚠️ `CSC_LINK` and `APPLE_API_KEY` must hold the **base64 of the files**, not the local
  > paths from `.env.signing` (those paths don't exist on the runner).

- **Draft release:** the workflow creates the release as a draft so a human can review it / write
  notes before sharing. Flip to `draft: false` in the workflow once the pipeline is trusted.

> **Auto-update (pending):** the repo is private, so electron-updater can't download from its
> releases without auth. We still need to pick a public host (a public releases-only repo or
> Cloudflare R2/S3) and wire `electron-updater` into the main process. Pairs with forced-update (#8).
