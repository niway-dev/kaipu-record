# kaipu-record

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

> **macOS firmado + notarizado (descarga directa):** `build:mac` produce un `.app`/`.dmg`
> firmado con Developer ID y notarizado. Requiere configurar `.env.signing` una sola vez —
> ver el runbook [`docs/macos-build-signing.md`](docs/macos-build-signing.md).
