# Changelog

## [0.6.2](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.6.1...desktop-v0.6.2) (2026-09-19)


### Bug Fixes

* **kaipu-record:** keep the verification-email state across mounts ([52ae476](https://github.com/csdev19/kaipu-record-monorepo/commit/52ae47668a1fd12ae6cec043a405db5b17b24571))
* **kaipu-record:** keep the verification-email state across mounts ([eacc93d](https://github.com/csdev19/kaipu-record-monorepo/commit/eacc93d99aa60ee5cf4709e7c5e4df5d651598c3))

## [0.6.1](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.6.0...desktop-v0.6.1) (2026-09-19)


### Bug Fixes

* **desktop:** bump electron-builder to 26.16.1 for macOS 26.6 signing ([fef6783](https://github.com/csdev19/kaipu-record-monorepo/commit/fef678356bd67886ad1edc1ab5e48377d8997793))
* **desktop:** bump electron-builder to 26.16.1 for macOS 26.6 signing ([6afce27](https://github.com/csdev19/kaipu-record-monorepo/commit/6afce2768cb232284d7554d4b04eceff985475ef))

## [0.6.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.5.0...desktop-v0.6.0) (2026-09-19)


### Features

* **console:** add the Kaipu Console app ([5463632](https://github.com/csdev19/kaipu-record-monorepo/commit/5463632e520cd5e2c075c825c94eaaa2d1ffd008))
* **desktop:** forgot-password link and resend-verification action ([1e6484a](https://github.com/csdev19/kaipu-record-monorepo/commit/1e6484ae7aa7f6e025008dcb49aab878aac61387))
* **email:** transactional email with Resend (verification + password reset) ([ecdc957](https://github.com/csdev19/kaipu-record-monorepo/commit/ecdc9571ef5e43377ce30371fe78defaaf6eee63))
* **secrets:** source local env from Infisical, drop dotenvx ([c6a81c1](https://github.com/csdev19/kaipu-record-monorepo/commit/c6a81c19eac4423b46605d614fd4e3cb4d183c45))
* **secrets:** source local env from Infisical, drop dotenvx ([e24c9d9](https://github.com/csdev19/kaipu-record-monorepo/commit/e24c9d9fd56b21a1cb117750e6aa147eac80f1ff))


### Bug Fixes

* **kaipu-record:** add manual refresh for email-verification banner ([d18dbbd](https://github.com/csdev19/kaipu-record-monorepo/commit/d18dbbd80e2a01eef5bb4bf6ce4a672aa59c740c))
* **kaipu-record:** add manual refresh for email-verification banner ([c64f0ec](https://github.com/csdev19/kaipu-record-monorepo/commit/c64f0ec861b7e292d525bf1fabe7bbc206d9c561))
* **secrets:** do not couple builds to the Infisical CLI ([fd32f0d](https://github.com/csdev19/kaipu-record-monorepo/commit/fd32f0d0c2056a3e106c5cc3ea5d26d4d981f415))
* **secrets:** scope env per consumer instead of fetching everything ([700b193](https://github.com/csdev19/kaipu-record-monorepo/commit/700b193233e982b41abb91bcfd50d57e979fcafe))

## [0.5.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.4.0...desktop-v0.5.0) (2026-09-15)


### Features

* add plan entitlements (free/pro), kept separate from auth ([adad8c7](https://github.com/csdev19/kaipu-record-monorepo/commit/adad8c76cf812ebe48faabb706cfc64f6854248b))
* **auth:** add AccountPanel — sign-in/sign-up/sign-out UI ([780dbbd](https://github.com/csdev19/kaipu-record-monorepo/commit/780dbbdb3e6d5aa718820988dfd9dbdf81dcc2ec))
* **auth:** add auth-client — sign-in/sign-up/get-session/sign-out over bearer ([ce9613b](https://github.com/csdev19/kaipu-record-monorepo/commit/ce9613b1375d91bf40193ae7ac3486c730c45b56))
* **auth:** add auth-store — safeStorage persistence, sender-validated IPC, broadcast ([c7f0d90](https://github.com/csdev19/kaipu-record-monorepo/commit/c7f0d906f6670963ea009b95563c1c5d7936e6d6))
* **auth:** add shared AuthStatus/AuthCredentials/AuthError types ([b1cee06](https://github.com/csdev19/kaipu-record-monorepo/commit/b1cee06855cd8c04ddfc2b473e044b55116e6d1a))
* **auth:** add the Account section to Settings ([d474aa9](https://github.com/csdev19/kaipu-record-monorepo/commit/d474aa953332a22c9cbefebc7dc633fa2c7ba9ac))
* **auth:** add useAuthStatus renderer hook ([997e275](https://github.com/csdev19/kaipu-record-monorepo/commit/997e2753c50f2a707bacd8f293c56eae079f9e70))
* **auth:** declare the 5 auth IPC channels and KaipuElectronAPI methods ([111acd2](https://github.com/csdev19/kaipu-record-monorepo/commit/111acd2eb58fe40114578a2beea24378ad26c91c))
* **auth:** wire registerAuth into the main process, document MAIN_VITE_SERVER_URL ([0a27856](https://github.com/csdev19/kaipu-record-monorepo/commit/0a27856ed5374952312e4549580539e9d31c35d1))
* **desktop:** block cloud save modes until the email is verified ([b40fa51](https://github.com/csdev19/kaipu-record-monorepo/commit/b40fa51f36159934ad0db1f9362d417f70ed6ac0))
* **desktop:** block cloud save modes until the email is verified ([268fcc0](https://github.com/csdev19/kaipu-record-monorepo/commit/268fcc0ffed4286ff25afd55cae58b38ed4098d1))
* **desktop:** carry the account id in the stored session and expose it to main modules ([c222544](https://github.com/csdev19/kaipu-record-monorepo/commit/c222544c7155dbdf9904e1293aa1bb3c58076915))
* **desktop:** cloud catalog client and per-account cache ([77e2557](https://github.com/csdev19/kaipu-record-monorepo/commit/77e255797bc3bec2d09e06c2b1d7673c3ef2c600))
* **desktop:** combined library with location labels and the remove-local-download action ([9bb02f2](https://github.com/csdev19/kaipu-record-monorepo/commit/9bb02f2dcf5f0a1cb85288f76f3cf43c2e19ab56))
* **desktop:** compose local files and the cloud catalog into one library entry per asset ([0debf77](https://github.com/csdev19/kaipu-record-monorepo/commit/0debf7721aa7ea02fa97809f9a8c630f1b264771))
* **desktop:** edit session source metadata and the editing-state probe ([a11baf0](https://github.com/csdev19/kaipu-record-monorepo/commit/a11baf03e2649b7ce3db9ffff48301f5679035a7))
* **desktop:** library service with combined listing, catalog refresh and remove-local-copy IPC ([5f72a07](https://github.com/csdev19/kaipu-record-monorepo/commit/5f72a07a9e9e3329be97dda025d56f431d213c44))
* **desktop:** move sign-in and sign-up out of Settings into full-window pages ([41c7e23](https://github.com/csdev19/kaipu-record-monorepo/commit/41c7e23078b8d23f6a41c2bcbc7e08c49e074d78))
* **desktop:** move sign-in and sign-up out of Settings into full-window pages ([6dd5ec1](https://github.com/csdev19/kaipu-record-monorepo/commit/6dd5ec109ec6422b3b69dab96ec24143546403fb))
* **desktop:** record export provenance as derivedFromAssetId ([701bace](https://github.com/csdev19/kaipu-record-monorepo/commit/701bace525503c5f771a8c84cc380adaf62ada15))
* **desktop:** remove-local-copy operation and its safety policy ([dc84270](https://github.com/csdev19/kaipu-record-monorepo/commit/dc8427009d19c04dd323551b3f30861e693926f1))
* **desktop:** Settings storage and cloud section with save modes and capacity ([1d301e9](https://github.com/csdev19/kaipu-record-monorepo/commit/1d301e980a7d50a89f03a89df18f95a1a83bcd6f))
* **desktop:** show a "local env" chip in the status bar of dev builds ([dc468ee](https://github.com/csdev19/kaipu-record-monorepo/commit/dc468eed65d2d2dfa63b8758d4797ed676552bfb))
* **desktop:** show a "local env" chip in the status bar of dev builds ([68cfa30](https://github.com/csdev19/kaipu-record-monorepo/commit/68cfa30ad416ac54812fdf0dc1ce9aa45d03debb))
* **desktop:** sidecar v2 with lazily minted asset identity ([e1637cf](https://github.com/csdev19/kaipu-record-monorepo/commit/e1637cfdc180cc014d5328cc3f3b7351e9dd2394))
* **desktop:** skeleton on the Cloud page until auth status loads ([e3e7514](https://github.com/csdev19/kaipu-record-monorepo/commit/e3e75140e6154211ba0a8f484f177ef6196545a3))
* **desktop:** skeleton on the Cloud page until auth status loads ([ebdef6c](https://github.com/csdev19/kaipu-record-monorepo/commit/ebdef6c8c6bd2f5e63fb40823d4c8aa2d5fff410))
* **desktop:** sober Account row in Settings and action-named auth buttons ([004e4ae](https://github.com/csdev19/kaipu-record-monorepo/commit/004e4aee5eaae442f40e8ec77b22f499b04d3ade))
* **desktop:** sober Account row in Settings and action-named auth buttons ([9eadb97](https://github.com/csdev19/kaipu-record-monorepo/commit/9eadb97a3a344eaec2618b91e489fd8f0dfb63be))
* **desktop:** split Settings into pages and add a Cloud section with save modes and capacity ([5aa03d8](https://github.com/csdev19/kaipu-record-monorepo/commit/5aa03d87d6f2a923927142127524072f257aa010))
* **desktop:** split Settings into pages and give Cloud its own rail section ([edb9ae7](https://github.com/csdev19/kaipu-record-monorepo/commit/edb9ae7380e679d8b6a50fecb0e7d24029b17f8a))
* **desktop:** stable asset identity and the combined local + cloud library ([c705de1](https://github.com/csdev19/kaipu-record-monorepo/commit/c705de1cd097546c1903bda57906b8805e9e8bf4))
* **desktop:** stable asset identity on local recordings and the library item axes ([d0984a1](https://github.com/csdev19/kaipu-record-monorepo/commit/d0984a18ecad7a8ab5933deafc5be568ab76f196))
* **desktop:** streaming content hash cached in the sidecar ([b28071d](https://github.com/csdev19/kaipu-record-monorepo/commit/b28071db8f85ce912d88ff41173ae4557da2f8de))
* **legal:** terms, privacy, Cloud and cookies pages ([972100e](https://github.com/csdev19/kaipu-record-monorepo/commit/972100ee622c37d8da07b2f5f48ffd0886eceaf8))
* **legal:** terms, privacy, Cloud and cookies pages with sign-up links ([5f27325](https://github.com/csdev19/kaipu-record-monorepo/commit/5f2732508d33e3ccc794450cda408dcd85da42b8))
* plan entitlements (free/pro) + template cleanup ([e93cfb4](https://github.com/csdev19/kaipu-record-monorepo/commit/e93cfb4520f5c3eb58ce0b54a78be12838a439ba))
* **screenshots:** multi-line text annotations (Alt/Shift+Enter for a line break) ([#50](https://github.com/csdev19/kaipu-record-monorepo/issues/50)) ([c9018d4](https://github.com/csdev19/kaipu-record-monorepo/commit/c9018d4831865e64b7c27bfb630c4df381008210))
* **screenshots:** re-edit text labels in place (double-click) ([#52](https://github.com/csdev19/kaipu-record-monorepo/issues/52)) ([8c82385](https://github.com/csdev19/kaipu-record-monorepo/commit/8c823850dd7f64a82abf80a66f06a464b1daec98))
* **screenshots:** resizable text box with word-wrap (Excalidraw-style) ([#51](https://github.com/csdev19/kaipu-record-monorepo/issues/51)) ([4a387b6](https://github.com/csdev19/kaipu-record-monorepo/commit/4a387b6d12f7af77600bbe7143a8f1d4e58f2910))


### Bug Fixes

* **auth:** address scoped-review findings on Task 12's diff ([8abc0dd](https://github.com/csdev19/kaipu-record-monorepo/commit/8abc0dd97c3079e69c96e01a29f31ada7ac713e1))
* **auth:** catch a non-credential IPC rejection in runAttempt ([0f8777f](https://github.com/csdev19/kaipu-record-monorepo/commit/0f8777ffc5929445e535954a964a6e330af75d55))
* **auth:** clear a stale form error, fail loudly on a missing server URL ([c17f54b](https://github.com/csdev19/kaipu-record-monorepo/commit/c17f54b14962d59668bcb1315949ba1db9b62df4))
* **auth:** correct CSS token and add accessibility alert role to AccountPanel ([2538cf6](https://github.com/csdev19/kaipu-record-monorepo/commit/2538cf6cf39b4bc0fbe7ea6465c4e8f0b89d7f38))
* **auth:** final whole-branch review findings — 2 Critical + 3 Important ([7974d1d](https://github.com/csdev19/kaipu-record-monorepo/commit/7974d1daa601b93e04fa86369c3d98e6f0ed2cf2))
* **auth:** fix 3 real bugs found by Task 12 manual verification ([7807c94](https://github.com/csdev19/kaipu-record-monorepo/commit/7807c94f8c6bdf2cc2db249499debac727725105))
* **auth:** guard the initial getAuthStatus() call against a rejection ([2e627bc](https://github.com/csdev19/kaipu-record-monorepo/commit/2e627bcab64eaf1ac97ea6e5f3c50a29e46d5911))
* **auth:** match real i18n copy in account-panel tests, not the raw key fallback ([299f611](https://github.com/csdev19/kaipu-record-monorepo/commit/299f61168cb4175470fda30ad5de4d0083cbb242))
* **auth:** persist the identity with the token so `unknown` can name the account ([274be6e](https://github.com/csdev19/kaipu-record-monorepo/commit/274be6e932b0cab84952573bb33ed0aa329e674b))
* **auth:** remove fallback from registerAuth call to surface misconfiguration ([3a4c704](https://github.com/csdev19/kaipu-record-monorepo/commit/3a4c704f82b3e2b6b53aebdcc0e96fcbe430ee80))
* **auth:** report a too-short password as such instead of "email taken" ([d51f814](https://github.com/csdev19/kaipu-record-monorepo/commit/d51f814765fe06feaffa0903f77931ce55f4b14e))
* **auth:** resolve typecheck:web errors ([8625711](https://github.com/csdev19/kaipu-record-monorepo/commit/862571110ebd1fc5bfce52864a4d07147da2be6b))
* **auth:** resolve typecheck:web errors in errorCopyKey and use-auth-status tests ([c671553](https://github.com/csdev19/kaipu-record-monorepo/commit/c671553adf87966180f7bd5ead9198bc3f1e4ecd))
* **auth:** restore setup.ts and use [@renderer](https://github.com/renderer) imports in AccountPanel ([a8578d5](https://github.com/csdev19/kaipu-record-monorepo/commit/a8578d57ff7ac020f761fc12460edb72e14248db))
* **auth:** return credential failures across IPC instead of throwing them ([a365f9f](https://github.com/csdev19/kaipu-record-monorepo/commit/a365f9f3c8fa39e010017c9c99f532c921de1984))
* **auth:** Task 12 manual verification — 3 real bugs found and fixed ([0dc1a34](https://github.com/csdev19/kaipu-record-monorepo/commit/0dc1a340c0a73156f7942877591c10758ffabec4))
* **auth:** treat better-auth's 200 + null get-session body as "session gone" ([1d735e5](https://github.com/csdev19/kaipu-record-monorepo/commit/1d735e5514cc548b916e322f51d8030f3586d687))
* **auth:** type callCredentialEndpoint's body param as AuthCredentials | SignUpInput ([a1b4552](https://github.com/csdev19/kaipu-record-monorepo/commit/a1b45527a3cacf7c0f28f277bacc23a4a1f3891b))
* **desktop:** announce the vault error banner to screen readers ([4290ed2](https://github.com/csdev19/kaipu-record-monorepo/commit/4290ed2c3f83dff95f91bf55d09c2d9eb94ed835))
* **desktop:** bound the re-hash retry when a file keeps changing ([2fbe42d](https://github.com/csdev19/kaipu-record-monorepo/commit/2fbe42d479253e6087ee9f1c63cee7ce507acc83))
* **desktop:** default entitlements fields and cap catalog pagination ([89ea8f1](https://github.com/csdev19/kaipu-record-monorepo/commit/89ea8f142f2a8f164568107dc358cfc8d028ac58))
* **desktop:** keep the duration guard on the video editor source ([34eddb1](https://github.com/csdev19/kaipu-record-monorepo/commit/34eddb1f5c9f7803289f1dc1612b2282bb959484))
* **desktop:** refresh the cloud catalog on mount and trust legacy edit sessions ([343d287](https://github.com/csdev19/kaipu-record-monorepo/commit/343d287a2b57ef7b82356e323fa7d97ae702c38b))
* **desktop:** report an unprovable local hash as hash-unknown when removing a local copy ([caad050](https://github.com/csdev19/kaipu-record-monorepo/commit/caad050d215d4a298c113f2715731a265b505ed2))
* **desktop:** say the email is unverified when cloud access is missing ([f15fe04](https://github.com/csdev19/kaipu-record-monorepo/commit/f15fe045ebc0544a8652a957ffba2035bf5ef053))
* **desktop:** serialize catalog cache writes and skip no-op ones ([7b14c9f](https://github.com/csdev19/kaipu-record-monorepo/commit/7b14c9f955db6a57da07fbca1c3773acb4ceee5b))
* **desktop:** settings page gutter and slimmer settings nav ([ca97389](https://github.com/csdev19/kaipu-record-monorepo/commit/ca973895c4047dd9c7bc143ac9c0ad007ae7fe9d))
* **desktop:** show remove-local-download for a project-available item too ([6cb92b7](https://github.com/csdev19/kaipu-record-monorepo/commit/6cb92b72101841f76c7f3976ace7d8811d3e832f))
* **desktop:** side gutter on settings pages and a slimmer settings nav ([26a4603](https://github.com/csdev19/kaipu-record-monorepo/commit/26a4603dbcbb33a60ff8bb39788d2acd863485aa))
* **desktop:** tell the user to verify their email when cloud access is missing ([e0fd82c](https://github.com/csdev19/kaipu-record-monorepo/commit/e0fd82c65902897b0a680fd90d7bacfe9f71542c))
* **desktop:** validate the account id before clearing the catalog cache ([bc235f2](https://github.com/csdev19/kaipu-record-monorepo/commit/bc235f253dbef7b7a21a33bd86adb9313205d375))
* **screenshots:** scale text annotations by ratio so the SE handle works when wrapped ([b4fdc33](https://github.com/csdev19/kaipu-record-monorepo/commit/b4fdc33c3655caa6ebfe035c939c8f605a712241))
* **screenshots:** text annotation SE handle stops resizing once the label wraps ([943b67a](https://github.com/csdev19/kaipu-record-monorepo/commit/943b67ad46fc891e5ffea289407502e2283bd9a8))

## [0.4.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.3.0...desktop-v0.4.0) (2026-07-10)


### Features

* **desktop:** light/dark theme setting applied in every window (design tokens PR3) ([#42](https://github.com/csdev19/kaipu-record-monorepo/issues/42)) ([5c5ffd3](https://github.com/csdev19/kaipu-record-monorepo/commit/5c5ffd374c67396fc66225e6afbb735a2b2c583d))
* **library:** self-heal imported/interrupted recordings + localize edited title ([#44](https://github.com/csdev19/kaipu-record-monorepo/issues/44)) ([48089ee](https://github.com/csdev19/kaipu-record-monorepo/commit/48089ee60dabcf3af113e34f2f195a5662efa389))
* **tokens:** shared @kaipu/tokens design-tokens package (PR1 — dark, zero visual change) ([#38](https://github.com/csdev19/kaipu-record-monorepo/issues/38)) ([081d4e3](https://github.com/csdev19/kaipu-record-monorepo/commit/081d4e38070dbe2d80f6853d0308cf41636f837a))


### Bug Fixes

* **editor:** edited videos now get a poster thumbnail ([#43](https://github.com/csdev19/kaipu-record-monorepo/issues/43)) ([00be53b](https://github.com/csdev19/kaipu-record-monorepo/commit/00be53b7fa491ec1d73fdaf0d7d2ee2148d7ba87))
* **library:** recover from post-record detail race instead of "File not found" ([#46](https://github.com/csdev19/kaipu-record-monorepo/issues/46)) ([911e982](https://github.com/csdev19/kaipu-record-monorepo/commit/911e982e36d5e1cae6ff9d884e2d719560710174))

## [0.3.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.2.0...desktop-v0.3.0) (2026-07-07)


### Features

* **i18n:** Stage 2 — propagate translations to every page & feature (es/en) ([#32](https://github.com/csdev19/kaipu-record-monorepo/issues/32)) ([2423794](https://github.com/csdev19/kaipu-record-monorepo/commit/24237940c94023684610d460871e590b4b8cec9a))
* **i18n:** web + desktop i18n foundation (Stage 1 — wire) ([#31](https://github.com/csdev19/kaipu-record-monorepo/issues/31)) ([5598122](https://github.com/csdev19/kaipu-record-monorepo/commit/559812250f7ad0e690195553b20de9e975f96928))
