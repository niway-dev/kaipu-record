# Build local de macOS — firma + notarización (Developer ID)

Runbook para producir un `.app`/`.dmg` **firmado y notarizado** que se instale sin el
aviso de Gatekeeper, distribuido **fuera de la Mac App Store** (descarga directa del DMG).

> Estrategia: validar primero en **local**; recién después mover a CI (GitHub Actions).

---

## 0. Datos fijos del proyecto

| Dato | Valor |
|------|-------|
| `appId` (CFBundleIdentifier) | `com.niway.kaipu-record` |
| Product name (display) | `Kaipu Recorder` |
| Team ID | `K9TKC5GG76` |
| Signing identity | `Developer ID Application: Cristian Sotomayor (K9TKC5GG76)` |
| Tipo de certificado | **Developer ID Application** (NO Apple Distribution / NO MAS) |
| Notarización | App Store Connect **API Key** (`.p8`), método notarytool |
| Key ID | `QWXC4HC43K` |

> La firma dirá `Cristian Sotomayor (K9TKC5GG76)` porque la cuenta Apple es **Individual**,
> no Organization. Es **esperado**, no es un bug. Para descarga directa el usuario casi nunca
> ve el nombre del firmante.

---

## 1. Requisitos (una sola vez)

1. **Cuenta Apple Developer** activa (pagada).
2. **Certificado Developer ID Application + clave privada** instalados en el **Keychain** del Mac.
   Verificar:
   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   Debe listar la identidad `... Cristian Sotomayor (K9TKC5GG76)`.
3. **Xcode + Command Line Tools** (notarytool necesita Xcode 13+):
   ```bash
   xcode-select -p   # debe apuntar a un Xcode válido
   ```
4. **Credenciales en una carpeta SIN espacios**, fuera del repo. Un espacio en la ruta
   rompe el build, así que **no** dejarlas en carpetas tipo `apple important`:
   ```bash
   mkdir -p ~/.secrets/kaipu
   mv "<ruta>/kaipu-record-signing-Certificates.p12" ~/.secrets/kaipu/
   mv "<ruta>/kaipu-AuthKey_QWXC4HC43K.p8"            ~/.secrets/kaipu/
   ```

---

## 2. Configurar `.env.signing` (una sola vez)

electron-builder lee `process.env`, **no** carga archivos `.env*` por sí solo — por eso
`scripts/build-mac-local.sh` lo inyecta. El archivo está **gitignored** (nunca se commitea);
la plantilla versionada es `.env.signing.example`.

```bash
cp .env.signing.example .env.signing   # si aún no existe
```

Rellenar (rutas absolutas, sin espacios):

```dotenv
# --- Firma ---
CSC_LINK=/Users/<usuario>/.secrets/kaipu/kaipu-record-signing-Certificates.p12
CSC_KEY_PASSWORD=<contraseña que pusiste al EXPORTAR el .p12>

# --- Notarización (App Store Connect API Key — Team Key) ---
APPLE_API_KEY=/Users/<usuario>/.secrets/kaipu/kaipu-AuthKey_QWXC4HC43K.p8
APPLE_API_KEY_ID=QWXC4HC43K
APPLE_API_ISSUER=<UUID del Issuer ID>   # App Store Connect → Users and Access → Integrations
```

> `CSC_KEY_PASSWORD` es la contraseña del `.p12` (la que elegiste al exportarlo), **no** la
> de tu Mac ni la de tu Apple ID.
>
> Es una **Team Key** (creada en *Integrations*), por eso `APPLE_API_ISSUER` es **obligatorio**.
> Si algún día usaras una *Individual Key* (Xcode 26+), hay que **omitir** el issuer o Apple
> devuelve `401 Unauthorized`.

---

## 3. Buildear

```bash
cd apps/kaipu-record
npm run build:mac
```

Eso corre `scripts/build-mac-local.sh`, que:

```
carga .env.signing → npm run build (electron-vite + typecheck)
                   → electron-builder --mac --publish never
                   → firma (CSC_LINK) → notariza (APPLE_API_*) → staple → DMG/ZIP
```

**Iteración rápida (solo firma, sin esperar a Apple):** comentá las 3 líneas `APPLE_API_*`
en `.env.signing`. Sin esas vars el bloque `notarize` no se dispara → build firmado en
segundos. Cuando el firmado esté ok, reponelas y corré una vez completo para validar
notarización + staple end-to-end.

**Artefactos** (en `apps/kaipu-record/dist/`):
- `.app` → `dist/mac-arm64/Kaipu Recorder.app` (en Apple Silicon; build arm64 por defecto)
- `.dmg` → `dist/kaipu-record-<version>.dmg`

---

## 4. Verificar el resultado

```bash
APP="dist/mac-arm64/Kaipu Recorder.app"

# Identidad presente
security find-identity -v -p codesigning

# Firma válida + hardened runtime habilitado
codesign -dv --verbose=4 "$APP"

# Gatekeeper: debe decir "accepted" / "source=Notarized Developer ID"
spctl -a -vvv --type exec "$APP"

# Ticket de notarización pegado (stapled)
xcrun stapler validate "$APP"
```

En los logs de electron-builder esperás ver:
`signing ... identity=Developer ID Application: Cristian Sotomayor (K9TKC5GG76)`,
luego `Notarization complete`, luego el staple.

---

## 5. Dónde vive cada cosa

| Archivo | Rol |
|---------|-----|
| `electron-builder.yml` (`mac:`) | `hardenedRuntime`, `notarize:{teamId}`, entitlements, usage descriptions |
| `build/entitlements.mac.plist` | entitlements de la app (allow-jit + audio-input + camera) |
| `build/entitlements.mac.inherit.plist` | entitlements heredados por helpers/renderer |
| `scripts/build-mac-local.sh` | wrapper: inyecta `.env.signing` y corre el build |
| `.env.signing` | secretos locales (**gitignored**) |
| `.env.signing.example` | plantilla versionada |

---

## 6. Troubleshooting / gotchas

1. **`mac.notarize has an unknown property 'teamId'`** → la versión de electron-builder usa
   otro schema. Verificá `npx electron-builder --version` y la doc de notarización de **esa**
   versión. (Probado OK con `electron-builder@26`.)
2. **`401 Unauthorized` al notarizar** → falta `APPLE_API_ISSUER` (requerido para Team Keys),
   o estás usando una Individual Key con issuer puesto (en ese caso, quitarlo).
3. **El `.app` notarizado crashea al abrir / error de library validation** → activá en
   `build/entitlements.mac.plist` las claves opcionales comentadas
   (`allow-unsigned-executable-memory`, `disable-library-validation`), una a la vez.
4. **El build falla por una ruta con espacios** → mové las credenciales a `~/.secrets/kaipu/`
   (sección 1.4) y ajustá las rutas en `.env.signing`.
5. **Permiso de grabación de pantalla** → en macOS se concede en runtime vía
   System Settings → Privacy (TCC); no lleva clave en Info.plist, pero la app debe estar
   firmada/notarizada para pedirlo de forma confiable.
6. **`.cer` / `.csr` no se usan en el build** → solo el `.p12` (firma) y el `.p8`
   (notarización). El `.cer`/`.certSigningRequest` ya cumplieron su rol al generar el `.p12`.

---

## 7. Siguiente paso: CI (GitHub Actions)

Cuando el build local firme + notarice ok, mover a `.github/workflows/release.yml`:
runner macOS, decodificar `CSC_LINK` y `APPLE_API_KEY` desde **base64** (secrets → archivos
temporales en `$RUNNER_TEMP`), exportar las 5 vars apuntando a esas rutas, `npm run build` +
`electron-builder --mac --publish ...`, y subir el DMG/ZIP al release. Los 5 valores van como
**repository secrets**, nunca en el repo.
