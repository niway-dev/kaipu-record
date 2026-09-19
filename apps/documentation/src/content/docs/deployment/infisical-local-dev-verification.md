---
title: Infisical migration — evidence and verification matrix
description: Executed synthetic probes, source references, reproduction steps, and remaining validation gates for the Infisical audit.
---

# Infisical migration — evidence and verification matrix

> Reviewed 2026-09-18 against `feat/infisical-local-dev` at `fd32f0d`.
> This page records observed behavior, not passing remediation tests.

Read the [finding register](/deployment/infisical-local-dev-audit) first for impact
and the [remediation plan](/plans/2026-09-18-infisical-audit-remediation) for priorities.

## Evidence collected

| Check                                                                       | Result                                       | What it establishes                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Branch/base diff and caller inspection                                      | Seven commits / 11 changed files             | Exact migration scope; Console excluded                                               |
| `bash -n scripts/setup-dev.sh scripts/with-env.sh`                          | Exit 0                                       | Shell syntax only                                                                     |
| `infisical --version`, `run --help`, `export --help`                        | Exit 0; CLI 0.43.132                         | Available flags; export has one path and no recursive flag                            |
| Synthetic export failure probes                                             | Passed expected defect assertions            | First failure truncates; later failure leaves partial file                            |
| Synthetic export with umask 022                                             | File mode 0644                               | Script does not enforce owner-only permissions                                        |
| Synthetic wrapper CI probes                                                 | Passed for `true`, `false`, `0`              | All nonempty CI values bypass; child exit 23 preserved                                |
| Synthetic wrapper fetch failure                                             | Expected exit 9                              | Non-CI fetch failure prevents child launch                                            |
| Wrangler dev-var loader with synthetic fixtures                             | Passed expected assertions                   | Parent-only variable omitted; `.env` read; `.dev.vars` takes precedence               |
| Turbo desktop build dry-run                                                 | Exit 0                                       | No configured/inferred env; shared wrapper absent from task inputs; outputs `dist/**` |
| `git check-ignore` for API/web `.env` and API `.dev.vars`/`.env.production` | Exit 0; all matched                          | Ordinary Git adds ignore these paths                                                  |
| `bun pm untrusted` on this laptop                                           | Exit 0; zero untrusted dependencies reported | Current install status only, not fresh-install assurance                              |
| CLI upstream `formatSecretsForShell` at v0.43.132                           | Source inspected                             | Infisical assignments overwrite inherited same-name variables                         |

Synthetic execution used temporary directories, a fake CLI, and invented values.
The existing app `.env` files and real login session were not used. The host was
macOS; local Bun was 1.4.2 and Turbo reported 2.8.3, whereas workflows pin Bun
1.3.4. Dependency-loader probes reflect the installed dependency implementation,
not a separately reinstalled clean branch.

## Reproduce the highest-risk mechanisms

Start with the reviewed source and installed dependencies. These probes never
fetch real secrets or connect to a database. Use an approved temporary directory
for your environment. The Python snippets create and remove only their fixtures.

### 1. Partial exports and plaintext file mode

Run at repository root:

```bash
python3 - <<'PY'
import json, os, pathlib, subprocess, tempfile

root = pathlib.Path.cwd()
command = json.loads((root / 'apps/server-hono/package.json').read_text())['scripts']['env:pull']
with tempfile.TemporaryDirectory() as directory:
    temp = pathlib.Path(directory)
    fake = temp / 'infisical'
    fake.write_text('#!/bin/sh\ncase "$*" in\n*--path=/database*) exit 9 ;;\n*) printf "AUDIT_ONLY=root\\n" ;;\nesac\n')
    fake.chmod(0o700)
    env = {'PATH': f'{temp}:/usr/bin:/bin', 'HOME': str(temp)}
    previous = os.umask(0o022)
    try:
        result = subprocess.run(['/bin/sh', '-c', command], cwd=temp, env=env)
    finally:
        os.umask(previous)
    assert result.returncode == 9
    assert (temp / '.env').read_text() == 'AUDIT_ONLY=root\n'
    assert (temp / '.env').stat().st_mode & 0o777 == 0o644
    fake.write_text('#!/bin/sh\nexit 9\n')
    result = subprocess.run(['/bin/sh', '-c', command], cwd=temp, env=env)
    assert result.returncode == 9 and (temp / '.env').read_text() == ''
    print('Confirmed: partial output, mode 0644, and truncation on first failure')
PY
```

Expected at the reviewed SHA: all assertions pass, confirming defects. After a
fix, replace these assertions with preservation of the previous complete file,
mode 0600, temporary-file cleanup, and no launch on failure.

### 2. CI source selection

```bash
python3 - <<'PY'
import pathlib, subprocess, tempfile

wrapper = str(pathlib.Path('scripts/with-env.sh').resolve())
with tempfile.TemporaryDirectory() as directory:
    fake = pathlib.Path(directory) / 'infisical'
    fake.write_text('#!/bin/sh\nexit 9\n')
    fake.chmod(0o700)
    env = {'PATH': f'{directory}:/usr/bin:/bin', 'HOME': directory}
    for value in ('true', 'false', '0'):
        result = subprocess.run(['/bin/bash', wrapper, '/bin/sh', '-c', 'exit 23'],
                                env={**env, 'CI': value})
        assert result.returncode == 23
    result = subprocess.run(['/bin/bash', wrapper, '/bin/sh', '-c', 'exit 23'], env=env)
    assert result.returncode == 9
    print('Confirmed: every nonempty CI bypasses; normal mode stops on fetch failure')
PY
```

This checks wrapper control flow, not actual provider precedence. That precedence
is independently established by the version-pinned upstream source below.

### 3. Worker bindings and legacy-file precedence

Run at repository root with the existing Wrangler dependency installed:

```bash
python3 - <<'PY'
import json, os, pathlib, subprocess, tempfile

wrangler = str(pathlib.Path('apps/server-hono/node_modules/wrangler').resolve())
code = '''const w = require(process.argv[1]);
const vars = w.unstable_getVarsForDev(process.argv[2], undefined, {}, undefined, true);
console.log(JSON.stringify({parent: vars.AUDIT_PARENT_ONLY ?? null, file: vars.AUDIT_ONLY ?? null}));'''
with tempfile.TemporaryDirectory() as directory:
    temp = pathlib.Path(directory)
    env = {'PATH': os.environ['PATH'], 'HOME': directory, 'AUDIT_PARENT_ONLY': 'synthetic'}
    (temp / '.env').write_text('AUDIT_ONLY=generated\n')
    def load():
        result = subprocess.run(['node', '-e', code, wrangler, str(temp / 'wrangler.jsonc')],
                                env=env, text=True, capture_output=True, check=True)
        return json.loads(result.stdout.strip().splitlines()[-1])
    assert load() == {'parent': None, 'file': 'generated'}
    (temp / '.dev.vars').write_text('AUDIT_ONLY=legacy\n')
    assert load() == {'parent': None, 'file': 'legacy'}
    print('Confirmed: host-only value omitted and legacy Worker file wins')
PY
```

The internal helper is intentionally version-sensitive. A dependency upgrade may
require updating the probe; the eventual regression test should check a real
local Worker binding rather than rely exclusively on an internal helper.

### 4. Turbo cache visibility

```bash
bunx turbo run build --filter=kaipu-record --dry=json
```

Inspect only `kaipu-record#build`: `environmentVariables.specified.env`,
`configured`, and `inferred` were empty; outputs were `dist/**` and inputs did not
include `scripts/with-env.sh`. A remote fetch inside the task cannot affect its
already-computed cache key. This is a structural finding, not an executed cache
hit/miss experiment with real configuration.

### 5. Provider precedence and CLI provenance

Inspect these version-pinned sources:

- [CLI v0.43.132 run.go](https://github.com/Infisical/cli/blob/v0.43.132/packages/cmd/run.go):
  `formatSecretsForShell` copies inherited values, then assigns fetched values;
  `--secret-overriding` concerns personal/shared secrets. The same file contains
  debug logging of injectable variables.
- Installed `apps/server-hono/node_modules/@infisical/cli/package.json` and
  `src/index.cjs`: `preinstall` downloads a platform binary from a GitHub release,
  independently of npm archive integrity, without a checksum comparison in the
  inspected installer.
- `scripts/setup-dev.sh` and server `package.json`: compare the stated global CLI
  policy to the retained workspace dependency and minimum version.

Do not test production precedence by running `plan grant`, `db:push`, or migrations.
Use a fake provider response and a non-mutating process, or a disposable dev-only
project with synthetic endpoint strings for an authenticated integration test.

## Remaining acceptance matrix

All rows below are **pending**, not claimed as executed by the audit.

| Test                                                              | Required result                                                      | Findings                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| Consumer key allowlist with unrelated secret sentinels            | Desktop/web never receive backend/deploy credentials                 | INF-01                    |
| Explicit operator target with conflicting ambient/provider values | Intended target preserved or conflict rejected before a write        | INF-02, INF-09            |
| Clean-checkout web + API startup                                  | Required values visible inside each Worker; auth/session proxy works | INF-03                    |
| Export interruption at every stage                                | Old complete file preserved; cleanup; no child launch                | INF-04                    |
| Two concurrent exports                                            | No mixed generation visible                                          | INF-04                    |
| Legacy `.dev.vars`, `.env.local`, mode file, and Bun env fixtures | Defined selection or actionable conflict error                       | INF-05                    |
| Fresh Bun 1.3.4 install and supported CLI minimum                 | Same functioning binary resolves in root and app commands            | INF-06, INF-12            |
| Each supported packaging entry point                              | Expected compiled endpoint and correct signing process scope         | INF-07                    |
| Change public remote config between cached builds                 | Rebuild with changed endpoint; correct restored outputs              | INF-08                    |
| Missing/invalid required values under CI/ambient source           | Fast validation failure, no accidental write                         | INF-09                    |
| Rotation rehearsal in disposable environments                     | Documented store-to-consumer propagation verified                    | INF-10                    |
| Wrapper-only PR                                                   | Relevant contract and app smoke tests run                            | INF-11                    |
| RBAC/import/provider-scope audit                                  | Dev identities cannot retrieve/use production authority              | INF-01, external controls |

## Verification limits

No authenticated Infisical integration, full app smoke test, signed desktop build,
database mutation, live release, credential rotation, fresh dependency install,
Linux/Windows exercise, or administrative-policy inspection was performed.
Success of the synthetic probes establishes the documented mechanisms, not the
health or security of the real production environment.
