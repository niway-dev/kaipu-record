# Changelog

## [0.5.0](https://github.com/niway-dev/kaipu-record/compare/api-v0.4.0...api-v0.5.0) (2026-10-20)


### Features

* **desktop:** NIW2-471 sign in through the browser ([6131126](https://github.com/niway-dev/kaipu-record/commit/6131126bcb8d40a44e322f2ac708e8d5507de0af))
* NIW2-219 Continue with Google and safe account linking ([12c6426](https://github.com/niway-dev/kaipu-record/commit/12c6426d3dd4ae95d60e91b779176444c6cc5def))
* NIW2-471 land desktop sign-in through the browser on main ([#333](https://github.com/niway-dev/kaipu-record/issues/333) + [#332](https://github.com/niway-dev/kaipu-record/issues/332)) ([9ae765b](https://github.com/niway-dev/kaipu-record/commit/9ae765b4de06e451ee94dd1f51f8a8d0ea67c486))
* **server-hono:** add the electron plugin for desktop sign-in through the browser ([53e49ac](https://github.com/niway-dev/kaipu-record/commit/53e49ac22f3adaf61f95a1372c7d022698604469))
* **server-hono:** NIW2-215 optional Google OAuth provider and explicit BETTER_AUTH_URL ([e1299a6](https://github.com/niway-dev/kaipu-record/commit/e1299a61e67cb7d186fde64fe38a2ed4fca0006f))
* **server-hono:** NIW2-215 optional Google provider and explicit BETTER_AUTH_URL ([da5572e](https://github.com/niway-dev/kaipu-record/commit/da5572e8fd11847e2d597ca64708ff83c8f3b1b4))
* **server-hono:** NIW2-219 safe Google account linking ([693b122](https://github.com/niway-dev/kaipu-record/commit/693b122621c9b8ee80e892eb1a600b5c889815cb))
* **web-hono:** Google and intent=sign-up on the desktop sign-in page ([f34fa01](https://github.com/niway-dev/kaipu-record/commit/f34fa01a985740bc7f8fe460d4f1df33cce528e3))


### Bug Fixes

* **api:** close ticket-window races and finish upload abuse remediation ([8ded5c2](https://github.com/niway-dev/kaipu-record/commit/8ded5c29c0e1206ccbdcbd152ecee4629fdeb255))
* **api:** close ticket-window races left by the NIW2-323 WIP [NIW2-323] ([4b86367](https://github.com/niway-dev/kaipu-record/commit/4b863672077777dad6c5323fc4e0b39a000e8394))
* **api:** close upload abuse paths [NIW2-323] ([3aa720c](https://github.com/niway-dev/kaipu-record/commit/3aa720c412139af538b3b78c97db3e52dc670aef))
* **auth:** adapt NIW2-219 Google linking to better-auth 1.7 ([d4ae12d](https://github.com/niway-dev/kaipu-record/commit/d4ae12d9788a42b858f847d61ca781e6b90702f4))
* **domain:** single plan table — Free verified 250 MB, Pro 15 GB ([3c5a8cd](https://github.com/niway-dev/kaipu-record/commit/3c5a8cd65a9d0401b12918e9194ce2194eadbae7))
* **kaipu:** NIW2-232 unify plan information (Free 250 MB) ([5eddfd0](https://github.com/niway-dev/kaipu-record/commit/5eddfd0d917e7c50723ecdde557336a392aaf8ca))

## [0.4.0](https://github.com/csdev19/kaipu-record-monorepo/compare/api-v0.3.0...api-v0.4.0) (2026-09-19)


### Features

* **email:** report why a transactional send failed ([63d386d](https://github.com/csdev19/kaipu-record-monorepo/commit/63d386db1b82446315319af3c320f8a55a8de8b9))
* **email:** report why a transactional send failed ([797cc0c](https://github.com/csdev19/kaipu-record-monorepo/commit/797cc0c35a9b2993e940920f95d3ad926b97a394))

## [0.3.0](https://github.com/csdev19/kaipu-record-monorepo/compare/api-v0.2.0...api-v0.3.0) (2026-09-19)


### Features

* **auth:** send verification and password reset emails via Resend ([3984a40](https://github.com/csdev19/kaipu-record-monorepo/commit/3984a40025ae6ebdf38866c5ef3e4d0d51720262))
* **console:** add the Kaipu Console app ([5463632](https://github.com/csdev19/kaipu-record-monorepo/commit/5463632e520cd5e2c075c825c94eaaa2d1ffd008))
* **email:** transactional email with Resend (verification + password reset) ([ecdc957](https://github.com/csdev19/kaipu-record-monorepo/commit/ecdc9571ef5e43377ce30371fe78defaaf6eee63))
* **secrets:** source local env from Infisical, drop dotenvx ([c6a81c1](https://github.com/csdev19/kaipu-record-monorepo/commit/c6a81c19eac4423b46605d614fd4e3cb4d183c45))
* **secrets:** source local env from Infisical, drop dotenvx ([e24c9d9](https://github.com/csdev19/kaipu-record-monorepo/commit/e24c9d9fd56b21a1cb117750e6aa147eac80f1ff))

## [0.2.0](https://github.com/csdev19/kaipu-record-monorepo/compare/api-v0.1.2...api-v0.2.0) (2026-09-15)


### Features

* add plan entitlements (free/pro), kept separate from auth ([adad8c7](https://github.com/csdev19/kaipu-record-monorepo/commit/adad8c76cf812ebe48faabb706cfc64f6854248b))
* cloud recordings — accounts + R2 presigned upload (backend) ([#53](https://github.com/csdev19/kaipu-record-monorepo/issues/53)) ([ed4b815](https://github.com/csdev19/kaipu-record-monorepo/commit/ed4b815a560713cfc92c42f2571cdf6a75ea3588))
* **cloud:** server quotas, revisions and restricted tickets (plan 01, Tasks 0-9) ([abb9a33](https://github.com/csdev19/kaipu-record-monorepo/commit/abb9a335100c6cd2328fdff2484e4a89d41731bf))
* **infra-db:** cloud asset repositories with atomic quota reservation and real-db concurrency tests ([54aeff8](https://github.com/csdev19/kaipu-record-monorepo/commit/54aeff89ab471521ce2cabb3721efdfa6f2c6004))
* plan entitlements (free/pro) + template cleanup ([e93cfb4](https://github.com/csdev19/kaipu-record-monorepo/commit/e93cfb4520f5c3eb58ce0b54a78be12838a439ba))
* **server-hono:** oRPC recording endpoints (auth-gated) + R2 env ([274848d](https://github.com/csdev19/kaipu-record-monorepo/commit/274848df6bf67f0e5e7a8c6ae8e3abb9cfa28d60))
* **server:** cloud assets contract and router with structured events ([a6db5b7](https://github.com/csdev19/kaipu-record-monorepo/commit/a6db5b7c4c75594d327e19c3608920dcbf055996))
* **server:** cloud assets router and GET /me/storage (plan 01, Task 10) ([399d1ff](https://github.com/csdev19/kaipu-record-monorepo/commit/399d1ff9ee642f3cdc3ccfef8e3745650861113c))
* **server:** plan command to grant and revoke a manual plan by email ([c957e7b](https://github.com/csdev19/kaipu-record-monorepo/commit/c957e7b4e7337073747eb81e4f0d40a651d7ad8f))
* **server:** plan command to grant and revoke pro, plus a commands reference ([1bf5a3e](https://github.com/csdev19/kaipu-record-monorepo/commit/1bf5a3e3e0f5558bbe6d8d5eb677f667a7f5db7d))


### Bug Fixes

* **auth:** fix 3 real bugs found by Task 12 manual verification ([7807c94](https://github.com/csdev19/kaipu-record-monorepo/commit/7807c94f8c6bdf2cc2db249499debac727725105))
* **auth:** Task 12 manual verification — 3 real bugs found and fixed ([0dc1a34](https://github.com/csdev19/kaipu-record-monorepo/commit/0dc1a340c0a73156f7942877591c10758ffabec4))
* **infra-db:** single-statement cloud accounting writes and locked reconcile ([443d990](https://github.com/csdev19/kaipu-record-monorepo/commit/443d99031c3af2fc5758fca0d74637f24228b488))
* **server-hono:** wire storage into confirm + translate domain errors ([cc0ef38](https://github.com/csdev19/kaipu-record-monorepo/commit/cc0ef3882513c866a9bfb374324c5d288c42dd92))
* **server:** compose cloud access into GET /me/entitlements ([82dc682](https://github.com/csdev19/kaipu-record-monorepo/commit/82dc6826c38a956813f0fba2f4ac70116a572a6a))
