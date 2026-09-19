# Changelog

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
