# Changelog

## [0.14.1](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.14.0...desktop-v0.14.1) (2026-10-20)


### Bug Fixes

* **desktop:** keep keyboard focus on the frame overlay with several displays ([8186354](https://github.com/niway-dev/kaipu-record/commit/81863542f2120e32f95b5fe0df72ea0c43a2ab5d))
* **desktop:** keep keyboard focus on the frame overlay with several displays ([77eeede](https://github.com/niway-dev/kaipu-record/commit/77eeedec164250bf9e79e729b1f1312334dd889f))

## [0.14.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.13.0...desktop-v0.14.0) (2026-10-20)


### Features

* **desktop:** let users turn off diagnostics ([aab3100](https://github.com/niway-dev/kaipu-record/commit/aab3100205480bda97cf0341b1edc9733e99b2c0))
* **desktop:** let users turn off diagnostics ([6def54c](https://github.com/niway-dev/kaipu-record/commit/6def54c21af68332c46209e3fad5dd8cf8e2fe2c))
* **desktop:** NIW2-471 sign in through the browser ([6131126](https://github.com/niway-dev/kaipu-record/commit/6131126bcb8d40a44e322f2ac708e8d5507de0af))
* **desktop:** NIW2-471 sign in through the browser ([ad20b60](https://github.com/niway-dev/kaipu-record/commit/ad20b60c22e19a00d4443af200732f0800d4dda5))
* NIW2-219 Continue with Google and safe account linking ([12c6426](https://github.com/niway-dev/kaipu-record/commit/12c6426d3dd4ae95d60e91b779176444c6cc5def))
* NIW2-219 Google in Sign-in methods and the desktop hint ([911c1f2](https://github.com/niway-dev/kaipu-record/commit/911c1f2d24a5d7021e318f1a5810784af919e11b))
* NIW2-471 land desktop sign-in through the browser on main ([#333](https://github.com/niway-dev/kaipu-record/issues/333) + [#332](https://github.com/niway-dev/kaipu-record/issues/332)) ([9ae765b](https://github.com/niway-dev/kaipu-record/commit/9ae765b4de06e451ee94dd1f51f8a8d0ea67c486))
* **web-hono:** authenticated /account page (profile, sign-in methods, plan and storage) ([408d55b](https://github.com/niway-dev/kaipu-record/commit/408d55b765e49eb8ff8d745344a6aa74fadf2981))


### Bug Fixes

* **kaipu:** NIW2-232 unify plan information (Free 250 MB) ([5eddfd0](https://github.com/niway-dev/kaipu-record/commit/5eddfd0d917e7c50723ecdde557336a392aaf8ca))

## [0.13.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.12.0...desktop-v0.13.0) (2026-10-18)


### Features

* **desktop:** capture toast card and the main window hand-offs ([12c9a9e](https://github.com/niway-dev/kaipu-record/commit/12c9a9ea00e370448cf143b9653777482cfa65ca))
* **desktop:** capture toast contract — channels, payloads and bridges ([064e511](https://github.com/niway-dev/kaipu-record/commit/064e511d63a9bc06440934d7218f8da905b05117))
* **desktop:** capture toast window after a quiet capture ([983a0a0](https://github.com/niway-dev/kaipu-record/commit/983a0a009a42187b4ca153a4d61fe807234d0e49))
* **desktop:** closing the window on Windows hides it to the tray ([d863c52](https://github.com/niway-dev/kaipu-record/commit/d863c52bf0977f8a8fc5f5d72a972f082e46e749))
* **desktop:** Frame absorbs Area, draw a box on the dim sheet ([922597a](https://github.com/niway-dev/kaipu-record/commit/922597afc24fed697eb9def5ce387866dd602202))
* **desktop:** modes v2 contract, frame default and captureWindow shortcut ([910c791](https://github.com/niway-dev/kaipu-record/commit/910c791f137ce061f9dc9449236d0adbc6c330f2))
* **desktop:** overlay v2 with mode pill, action bar, Window picker and Screen card ([8967126](https://github.com/niway-dev/kaipu-record/commit/8967126b38b12a6e75132e15259f5ae6d71cd33a))
* **desktop:** page and tray Capture button with last-used mode chips ([ab41733](https://github.com/niway-dev/kaipu-record/commit/ab4173371f07f31808607ab47302490afaad40ae))
* **desktop:** per-platform shortcut defaults, Control+Alt on Windows ([94570ac](https://github.com/niway-dev/kaipu-record/commit/94570acd7d3f3be058f2941b927e68eea1b7d72a))
* **desktop:** providers capture by the overlay answer, drop the screencapture -i path ([c991a22](https://github.com/niway-dev/kaipu-record/commit/c991a22db0f0a587a10c1e352e3dc9478e59f8a9))
* **desktop:** quiet capture in main, policy decides save, copy or editor ([8c8404c](https://github.com/niway-dev/kaipu-record/commit/8c8404ca41f53cdd70fb7acd20224e8dd6ca5644))
* **desktop:** renderer skips the editor on quiet capture, settings note and IPC docs ([d5b16c9](https://github.com/niway-dev/kaipu-record/commit/d5b16c93618a029e02483d3d894118995dfe58d4))
* **desktop:** screenshot modes v2 — Frame absorbs Area, Window mode, in-overlay picker, quiet capture with a toast ([e7fd80d](https://github.com/niway-dev/kaipu-record/commit/e7fd80d5156c6cfbd8f51e4930f326c672e2b4f4))
* **desktop:** switch the overlay mode from any overlay, remember it on capture only ([762c36a](https://github.com/niway-dev/kaipu-record/commit/762c36a51cd66e6cc413049c52723c135d7266fa))
* **desktop:** window capture backends for macOS and Windows ([be5c131](https://github.com/niway-dev/kaipu-record/commit/be5c131ed9d3effb8083016509fa7c21223bf7ce))
* **desktop:** window lister for macOS (osascript JXA) and Windows (PowerShell) ([269053c](https://github.com/niway-dev/kaipu-record/commit/269053cbae8256547abdbe1844d289f38c504eae))
* **desktop:** Windows tray icon with a light glyph ([ca2da8f](https://github.com/niway-dev/kaipu-record/commit/ca2da8f9d1c9c102c228b97673e3fa3196b2a2f9))
* **desktop:** wire the window lister into the capture overlay ([2816598](https://github.com/niway-dev/kaipu-record/commit/2816598d6ab85a99a2776a00af9de2877f3eeaf2))


### Bug Fixes

* **desktop:** a second launch during a recording keeps the window hidden ([2dc5d11](https://github.com/niway-dev/kaipu-record/commit/2dc5d113424e24ac676c6a5a122e4d8cfb82b123))
* **desktop:** capture spanning windows whole and trust main's window list ([33b9168](https://github.com/niway-dev/kaipu-record/commit/33b91680b56c56f640c8a3396e2aef017c4d159c))
* **desktop:** Ctrl+Q quits on Windows; an aborted quit keeps close-to-tray ([9ec9fe2](https://github.com/niway-dev/kaipu-record/commit/9ec9fe2ff9b1c127fc42ffd7bf525032e07e50bc))
* **desktop:** dim the outside of the frame a little more (45 %) ([aa2dc35](https://github.com/niway-dev/kaipu-record/commit/aa2dc353bb48988cdf4c34883ae84c777e038193))
* **desktop:** disable Window mode behind WINDOW_MODE_ENABLED ([4397849](https://github.com/niway-dev/kaipu-record/commit/4397849a4d8805f9cf9924f2c26977335f562359))
* **desktop:** disable Window screenshot mode behind WINDOW_MODE_ENABLED ([4086486](https://github.com/niway-dev/kaipu-record/commit/4086486bca374af18faaf6ff58343e125830c9e9))
* **desktop:** drop the unused setWindows port method and currentMode string ([82bace7](https://github.com/niway-dev/kaipu-record/commit/82bace7ca3868a1d305469056eeecfccfd59ce4d))
* **desktop:** keep the inside of the frame untinted ([f196b2e](https://github.com/niway-dev/kaipu-record/commit/f196b2e1a014e20cd86d2ccb4cfd91896b743bcd))
* **desktop:** keep the toast out of the next shot and the focus on the previous app ([26a7c8a](https://github.com/niway-dev/kaipu-record/commit/26a7c8a58857a553b3acc95e1aaf92bcbbf93c43))
* **desktop:** one selection toolbar for modes and actions ([e455ae2](https://github.com/niway-dev/kaipu-record/commit/e455ae208356b0b06398d2c52d44782cfefee9ff))
* **desktop:** one selection toolbar for modes and actions; the inside of the frame is never tinted ([70e38ab](https://github.com/niway-dev/kaipu-record/commit/70e38abc7ffe5a6042815bf013d8e0218432be48))
* **desktop:** platform label from the bridge; Screen and Frame rows in the shortcuts doc ([d704cf6](https://github.com/niway-dev/kaipu-record/commit/d704cf6d798a1a0b18284c0fe18fd82b8e382829))
* **desktop:** retry a vanished window with -R when screencapture -l exits 1 ([f53a682](https://github.com/niway-dev/kaipu-record/commit/f53a68214a7703788b0dd9cd3feb706b8df7214a))
* **desktop:** show Windows key names and copy on Windows ([e85d353](https://github.com/niway-dev/kaipu-record/commit/e85d353b5ceff13281075f2da088677f988534f6))
* **desktop:** single instance, platform-aware shortcut labels, tray notification ([1197417](https://github.com/niway-dev/kaipu-record/commit/1197417f8f08058a65c2e396e65eacb0fbaf44cf))
* **desktop:** toast Save races, Save off the Continue list, toast timing ([cb22e64](https://github.com/niway-dev/kaipu-record/commit/cb22e648dab78122b0bee34a5089dc40ac9c0f94))
* **desktop:** Window mode keyboard follows the pointer; no mode flicker ([2f8b47e](https://github.com/niway-dev/kaipu-record/commit/2f8b47e9455ac65fdadc267a9667e790f5a94d88))
* **desktop:** Windows key names and copy, plus a platform parity table ([d031229](https://github.com/niway-dev/kaipu-record/commit/d031229a3fb191880cde8715f07e437a8814ab35))

## [0.12.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.11.0...desktop-v0.12.0) (2026-10-17)


### Features

* **desktop:** Area, Screen and Frame entry points with their shortcuts ([320f15b](https://github.com/niway-dev/kaipu-record/commit/320f15b9cd7066f4426227b6ebd552c74e6e47ba))
* **desktop:** capture geometry helpers for display crops and frames ([8e548a6](https://github.com/niway-dev/kaipu-record/commit/8e548a69ee7ef60083a24939727cb311263d06c6))
* **desktop:** capture overlay renderer with display chooser, frame box and area drag ([0c49043](https://github.com/niway-dev/kaipu-record/commit/0c49043eb1b32911daba60a37cd4a31970054536))
* **desktop:** capture overlay windows, one per display, behind the overlay port ([7b74d86](https://github.com/niway-dev/kaipu-record/commit/7b74d86a290ae7a5b4609db9ce75292cc374bf2a))
* **desktop:** Frame shortcut default avoids macOS Enter Full Screen ([cb384b5](https://github.com/niway-dev/kaipu-record/commit/cb384b5b7635a901602a0b558f5444fe848f558b))
* **desktop:** mode cards and tray rows only select the mode; the button and shortcuts capture ([3dc0fc2](https://github.com/niway-dev/kaipu-record/commit/3dc0fc23a92ea992843f1819ae0d81acce6a7a95))
* **desktop:** one current screenshot mode, remembered and shared by page, tray and shortcuts ([dbbbd83](https://github.com/niway-dev/kaipu-record/commit/dbbbd837eb460ea6aaafbcc52ab243ba6a816f05))
* **desktop:** one Frame at a time; click another display to move it there ([689ebc9](https://github.com/niway-dev/kaipu-record/commit/689ebc9e718d2af1183110f12592fbc47b98bb68))
* **desktop:** Screen and Frame screenshot modes on macOS through the overlay ([6e84db2](https://github.com/niway-dev/kaipu-record/commit/6e84db2c9c58220f407d237201de92517d2b6659))
* **desktop:** screenshot capture modes — Area, Screen and Frame on macOS and Windows ([3e928df](https://github.com/niway-dev/kaipu-record/commit/3e928df80829fd791d8c6be1c3986b0368884ecb))
* **desktop:** screenshot mode picker hero and tray rows from the design ([ce1166b](https://github.com/niway-dev/kaipu-record/commit/ce1166b74dba955259b376bb84e4698857b806c9))
* **desktop:** typed screenshot capture contract and per-platform providers ([e0b6ace](https://github.com/niway-dev/kaipu-record/commit/e0b6acea47d8963aa7437294a60ae781a0dec6c4))
* **desktop:** Windows screenshot backend through desktopCapturer with DPI-aware crops ([5a3b87f](https://github.com/niway-dev/kaipu-record/commit/5a3b87ff5fc245d2c8d28ec2d2cbf130c55f5f36))


### Bug Fixes

* **desktop:** address the review of the editor window preset ([fb57fb7](https://github.com/niway-dev/kaipu-record/commit/fb57fb71fa364f6a14239995c0e741cc416c02e9))
* **desktop:** answer unsupported captures before hiding the app ([59437d9](https://github.com/niway-dev/kaipu-record/commit/59437d952d060ee44db25c0d7f1c548c6b498eb4))
* **desktop:** any digit picks its display, hover race, first-click overlays ([e55735f](https://github.com/niway-dev/kaipu-record/commit/e55735fbcea2f50f0d86f17c01dee24f71253a23))
* **desktop:** cancel the overlay pick when a renderer crashes; full overlay query ([c265c4d](https://github.com/niway-dev/kaipu-record/commit/c265c4dd083426e34242e2e69c29d41cae72b3b5))
* **desktop:** capture handler releases its guard if hiding throws; empty thumbnails cancel; recording blocks every mode (test) ([bf03cfc](https://github.com/niway-dev/kaipu-record/commit/bf03cfcac34ee3eeb1a370b5842424e8b1c36921))
* **desktop:** editor home and New image fill the editor window; E2E follows the preset ([41b75fa](https://github.com/niway-dev/kaipu-record/commit/41b75fa59e590ed513c4957dc61032e38f6dd5c3))
* **desktop:** every /editor route shares the editor window preset ([900ab5e](https://github.com/niway-dev/kaipu-record/commit/900ab5ed7caf7c778cdf27c219bd013598a06119))
* **desktop:** every /editor route shares the editor window preset ([2283ae0](https://github.com/niway-dev/kaipu-record/commit/2283ae0e06f4052b4f3732ec4445f3086bb23bb2))
* **desktop:** keyboard focus follows the frame display ([c590bec](https://github.com/niway-dev/kaipu-record/commit/c590bec88c246a883f3a1a12be2cc83223700854))
* **desktop:** overlay query carries the initial frame display ([74be480](https://github.com/niway-dev/kaipu-record/commit/74be4806d966b89d342e763d9c7a45297f8be2e2))
* **desktop:** overlay watchdog, main-side Escape, answer before persisting the frame ([8ee8db4](https://github.com/niway-dev/kaipu-record/commit/8ee8db40369ef5d11b5314ce1d97476f22f655ff))
* **desktop:** seamless marching ants, real recording dim, no mode change while recording ([4e9fc53](https://github.com/niway-dev/kaipu-record/commit/4e9fc538a9333df851e559497e88f1847d7d1e84))
* **desktop:** settle after hiding the overlay; gone display cancels; provider throw reports failed ([67afd8d](https://github.com/niway-dev/kaipu-record/commit/67afd8d3a9f55c037bf76267734fd8459d95778a))
* **desktop:** settle before the no-overlay capture, answer cancelled on a provider throw ([23fb3c0](https://github.com/niway-dev/kaipu-record/commit/23fb3c08106ab42e1b91998d745507c0dd47358d))

## [0.11.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.10.0...desktop-v0.11.0) (2026-10-15)


### Features

* **desktop:** background exports with progress, Ready to share and Recording saved cards ([5678664](https://github.com/niway-dev/kaipu-record/commit/5678664bf509b461519102fad1e9b08d7f14f08e))
* **desktop:** background exports with progress, Ready to share and Recording saved cards ([d08b49d](https://github.com/niway-dev/kaipu-record/commit/d08b49da7d63ed3f3e88fe8a07c5230d61267a06))
* **desktop:** Balanced 1080p export by default, with an Export quality setting ([89b922e](https://github.com/niway-dev/kaipu-record/commit/89b922e0e97eb75ed6a29046f93bc40ad0b3f3aa))
* **desktop:** Balanced 1080p export by default, with an Export quality setting ([4532c28](https://github.com/niway-dev/kaipu-record/commit/4532c281b3d583ed2e6fd2fcb9b21ee2f4a9b002))
* **desktop:** derive the app icon from @kaipu/brand with a script ([13638d8](https://github.com/niway-dev/kaipu-record/commit/13638d8cb9e4e6ab54a7a558bb83786b0dd75ed2))
* **desktop:** destination preset picker in the export sheet ([5e84e73](https://github.com/niway-dev/kaipu-record/commit/5e84e73bc15893c558d3db187ebf9953bf7d5a52))
* **desktop:** destination preset picker in the export sheet ([6503c08](https://github.com/niway-dev/kaipu-record/commit/6503c081c0668ef234844dd94720226982898f80))
* **desktop:** drag exports out under their title, confirm close or quit mid-export ([749df1b](https://github.com/niway-dev/kaipu-record/commit/749df1bc8b4723297fd233d700c339af99e06c39))
* **desktop:** drag exports out under their title, confirm close or quit mid-export ([da466b6](https://github.com/niway-dev/kaipu-record/commit/da466b680bfd36462b842b1cc3ae3112d6f3652e))
* **desktop:** Editor home lists what you worked on last, with filters and pages ([8d63ae4](https://github.com/niway-dev/kaipu-record/commit/8d63ae466b8aba71dffc938d02e031457eb2b096))
* **desktop:** Editor home v2 — start from the clipboard, continue what you worked on ([36c7df4](https://github.com/niway-dev/kaipu-record/commit/36c7df4c598ecfa3c5faba30ab25c507d174413b))
* **desktop:** Editor home v2 — start from the clipboard, continue what you worked on ([d5fbf08](https://github.com/niway-dev/kaipu-record/commit/d5fbf0886435cf7e49a1758a145595c89df746a4))
* **desktop:** Editor workspace with URL-addressed video and image editors ([5e66bb2](https://github.com/niway-dev/kaipu-record/commit/5e66bb2f3b5c5d8a68856f33a61001687a647872))
* **desktop:** export presets pipeline with framing, bitrates, fps cap and fast start ([8dcea00](https://github.com/niway-dev/kaipu-record/commit/8dcea008ced918eb5ec273c8eaa2176e31fec503))
* **desktop:** export presets pipeline with framing, bitrates, fps cap and fast start ([f95ef77](https://github.com/niway-dev/kaipu-record/commit/f95ef77726425d83942f39c39e86f980a74d4837))
* **desktop:** export sheet redesign with grouped rows, size meter and heavy-file banner ([8385663](https://github.com/niway-dev/kaipu-record/commit/8385663bc38ba692c519f2bedc19b0eab36c3b13))
* **desktop:** export sheet redesign with grouped rows, size meter and heavy-file banner ([adb4ecb](https://github.com/niway-dev/kaipu-record/commit/adb4ecb886cffde90d363814bb600f900434a3fc))
* **desktop:** export sheet with GIF option in the video editor ([05aee52](https://github.com/niway-dev/kaipu-record/commit/05aee52ef6b0c28c809a331c02456d7aba77d09f))
* **desktop:** filter the library by tags and match tags in search ([b0ae103](https://github.com/niway-dev/kaipu-record/commit/b0ae103be98527f290c31a106603c349923ae304))
* **desktop:** GIF export pipeline (gifenc worker, range slicing, estimate) ([11e30d9](https://github.com/niway-dev/kaipu-record/commit/11e30d973790c0f45186e85f04aa0e86ede52fa3))
* **desktop:** label the button New image so New video can sit beside it later ([13c38ff](https://github.com/niway-dev/kaipu-record/commit/13c38fff6adc937d60f031fba26fdb4a86d272de))
* **desktop:** land quality tiers and quantizer encoding on main (NIW2-218) ([ee878a6](https://github.com/niway-dev/kaipu-record/commit/ee878a62105067b1176578a2e8646fc2b5c39ce6))
* **desktop:** Library filter counts follow the other filters (facets) ([755b89c](https://github.com/niway-dev/kaipu-record/commit/755b89c773b337c3f8eab630bfd4731b98d79cc7))
* **desktop:** Library filters in labeled groups, tags on their own scrolling row ([50ce7e4](https://github.com/niway-dev/kaipu-record/commit/50ce7e4d158e32dcc3b5de948469a4e9056bcfca))
* **desktop:** Library search, filters and summary stick while scrolling ([4c1350f](https://github.com/niway-dev/kaipu-record/commit/4c1350f750f0af14fe711b9c2a6ac877e2021e5a))
* **desktop:** live recording controls — mute mic, system audio and camera mid-take (NIW2-152) ([400c80e](https://github.com/niway-dev/kaipu-record/commit/400c80e4ff0dcb98338b411aea70a02b63b517d7))
* **desktop:** manage-tags button as a ghost icon next to the Tags label ([297acb8](https://github.com/niway-dev/kaipu-record/commit/297acb89a0d69d1bf6e9156028d6957814dd48cf))
* **desktop:** New in the Editor opens a pasted image in the image editor ([4cb96fb](https://github.com/niway-dev/kaipu-record/commit/4cb96fbab36b5b9657e7b026a4017a8226215e5f))
* **desktop:** put GIF export on hold behind a flag, the sheet offers MP4 only ([97e8d7e](https://github.com/niway-dev/kaipu-record/commit/97e8d7edb4de297181b77ba3a0f183a2087122c3))
* **desktop:** quality tiers encode AVC in quantizer mode at 24 fps ([afb7eb7](https://github.com/niway-dev/kaipu-record/commit/afb7eb7348edc81054a012d47ee37ac5f925d551))
* **desktop:** quality tiers encode AVC in quantizer mode at 24 fps (NIW2-218) ([09e0b52](https://github.com/niway-dev/kaipu-record/commit/09e0b522272064887e1c0cf0898731c8cdeec78a))
* **desktop:** quality tiers replace the size-capped Small-file rows ([d721380](https://github.com/niway-dev/kaipu-record/commit/d72138088d2eeede8087a52097f0292ddb8b73e0))
* **desktop:** recordingStat IPC for the export size check ([faa726c](https://github.com/niway-dev/kaipu-record/commit/faa726ca8f6ebe416309804b7ca40fc0ced7f4bb))
* **desktop:** recordingStat IPC for the export size check ([9140e44](https://github.com/niway-dev/kaipu-record/commit/9140e44ab90db1b8f10a92ca8f7b7b2439c66c06))
* **desktop:** remember the last export preset and record it on the sidecar ([caa4f75](https://github.com/niway-dev/kaipu-record/commit/caa4f75e8c77a148a1e72ea88faa0c4f16a15e78))
* **desktop:** remember the last export preset and record it on the sidecar ([e4ca1c9](https://github.com/niway-dev/kaipu-record/commit/e4ca1c974d27cdb77dd687ce06a7c2bb26e1f036))
* **desktop:** route every Edit through openInEditor ([ecccd74](https://github.com/niway-dev/kaipu-record/commit/ecccd74a4096960c7171916fdf6d0da4d6e4f78f))
* **desktop:** save GIF exports to the vault and show them in the library ([38617c2](https://github.com/niway-dev/kaipu-record/commit/38617c2545ea13a71edc107aa808a7f0a272ed07))
* **desktop:** Share a recording as an optimized file, reusing existing exports ([4f2c702](https://github.com/niway-dev/kaipu-record/commit/4f2c702a7e3bbdec7bb9b207464dec800077c061))
* **desktop:** Share a recording as an optimized file, reusing existing exports ([23b4a64](https://github.com/niway-dev/kaipu-record/commit/23b4a64ea8dec9f62595c2d7ced3c4d386d6579d))
* **desktop:** show GitHub Free and paid-plan fit side by side ([7095c86](https://github.com/niway-dev/kaipu-record/commit/7095c860cf70779d89091d56c1bd4ed5ee16c24d))
* **desktop:** Small-file size check with one smaller re-encode ([a7f8060](https://github.com/niway-dev/kaipu-record/commit/a7f8060c61e7a15d82233549d8931e2c1f8dc3fd))
* **desktop:** Small-file size check with one smaller re-encode ([20e95d8](https://github.com/niway-dev/kaipu-record/commit/20e95d8edcaf3f6ab3f1e5c08b2183b8e7a753c6))
* **desktop:** tag drawer over the Library with rename and delete across items ([0ca78f1](https://github.com/niway-dev/kaipu-record/commit/0ca78f1f5237268ed531773affc24e040a6e84ff))
* **desktop:** tag editor on the library detail page ([9cef0de](https://github.com/niway-dev/kaipu-record/commit/9cef0dea7db7f4b6798c4f013ca95e1393cf71b7))
* **desktop:** tag recordings from a Library side panel, and show tags on cards ([966472b](https://github.com/niway-dev/kaipu-record/commit/966472b9bc611666d996424dafde0056ce459ff6))
* **desktop:** tag store, sidecar fields and library IPC for recording tags (incomplete) ([d39cc09](https://github.com/niway-dev/kaipu-record/commit/d39cc099e8d0921195423d8b277ca4db31c1290f))
* **desktop:** tags as entities — colored tags, tag drawer and faceted Library filters (NIW2-154) ([1a21315](https://github.com/niway-dev/kaipu-record/commit/1a2131595c88ece99f7e87e5851b6adcba3b71c5))
* **desktop:** tags as entities with colors, create tag and a vault registry ([ce8c225](https://github.com/niway-dev/kaipu-record/commit/ce8c225106f7704ba83690c8081e428667ef9384))
* **desktop:** the Editor home shows each recording's export state ([4c9d9f6](https://github.com/niway-dev/kaipu-record/commit/4c9d9f6e484aac633a6a8a9f2c27043c78516dad))
* **kaipu-record:** export a capture as a zoomable PDF from the editor ([4348260](https://github.com/niway-dev/kaipu-record/commit/43482606dc7858730cab8752821d43b0d6d3f81f))
* **kaipu-record:** export-format seam with PNG and PDF exporters ([67edee2](https://github.com/niway-dev/kaipu-record/commit/67edee299f045d474d448847b594720aa9a8d6a9))
* **kaipu:** NIW2-217 export a short video as an animated GIF ([58a95f9](https://github.com/niway-dev/kaipu-record/commit/58a95f9c38f247339f93806295602448de916a89))
* **kaipu:** NIW2-218 background exports with progress and Ready to share cards ([e600364](https://github.com/niway-dev/kaipu-record/commit/e600364aabeb07d2fa15c654ae1fb38d394aabe1))
* **kaipu:** NIW2-218 quality tiers replace size-capped exports ([fe332fa](https://github.com/niway-dev/kaipu-record/commit/fe332fa7e6c20f0748af4a85da1151199583442f))
* **screenshots:** name the capture from the editor toolbar ([248ab02](https://github.com/niway-dev/kaipu-record/commit/248ab022d4d04bd77ff4ca7398482c2e14465a3a))
* **screenshots:** the editor toolbar drops its action labels only when the row cannot hold them ([309a64b](https://github.com/niway-dev/kaipu-record/commit/309a64b395a78c96d3db3cf3a96ac32de2e36f1f))


### Bug Fixes

* **desktop:** apply the macOS activation policy only on an actual transition ([78e20a2](https://github.com/niway-dev/kaipu-record/commit/78e20a2530cd0d7eaad647a55b561dee147836bc))
* **desktop:** capture panel joins full-screen Spaces only while open ([bafe872](https://github.com/niway-dev/kaipu-record/commit/bafe872e74fa2f6b43b29fd2828ff4d2fd81d602))
* **desktop:** capture panel opens over full-screen apps on the current Space ([3656863](https://github.com/niway-dev/kaipu-record/commit/3656863a22917df6870fe0e0667d1bb8e3b52bed))
* **desktop:** capture panel opens over full-screen apps on the current Space ([3541b79](https://github.com/niway-dev/kaipu-record/commit/3541b79450688ba01f07fc5349237d059b0f798e))
* **desktop:** capture worker refs for the GIF hook's unmount cleanup ([8480054](https://github.com/niway-dev/kaipu-record/commit/8480054e967a23e89a3e04e00ea6860804c39604))
* **desktop:** color menu swatches show every palette color ([d53968e](https://github.com/niway-dev/kaipu-record/commit/d53968e96b5d7e88edd5b2b2e15acfaa023a8835))
* **desktop:** export fps cap lands every source rate on the cap ([a0f9000](https://github.com/niway-dev/kaipu-record/commit/a0f90007836b46f733473d861b6f0c692b963d51))
* **desktop:** fingerprint the edit in its saved form ([ea08aad](https://github.com/niway-dev/kaipu-record/commit/ea08aad85e9b230d6bdca92ac984164e166351f9))
* **desktop:** fingerprint the edit in its saved form ([c219002](https://github.com/niway-dev/kaipu-record/commit/c219002b050c1c9c8630e0109cd5dbecda761cc3))
* **desktop:** keep New image off the image editor toolbar ([8620e02](https://github.com/niway-dev/kaipu-record/commit/8620e024937ac5aefa779f80005b2b732f75e7c7))
* **desktop:** pick an AAC config the encoder accepts; print caught errors in dev ([bb65b13](https://github.com/niway-dev/kaipu-record/commit/bb65b13dd980b5d3a899247c219893a80958a9b2))
* **desktop:** pick an AAC config the encoder accepts; print caught errors in dev ([4114912](https://github.com/niway-dev/kaipu-record/commit/4114912567d0b3295ad95d2f58719f5c7b2db8cc))
* **desktop:** show the brand icon in the Dock during dev runs (NIW2-181) ([137c085](https://github.com/niway-dev/kaipu-record/commit/137c085369a1a8e128ddb707773baa41e7d15333))
* **desktop:** tags only for existing items, and atomic sidecar writes ([8ca010e](https://github.com/niway-dev/kaipu-record/commit/8ca010e255d514964382bd3ada59c06a321398ce))
* **kaipu-record:** validate the PDF export IPC and name the file from the title field ([8fb07a2](https://github.com/niway-dev/kaipu-record/commit/8fb07a28df46e83333235c51d2100d718ae3b563))

## [0.10.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.9.0...desktop-v0.10.0) (2026-10-06)


### Features

* **brand:** @kaipu/brand, one logo system shared by desktop and web ([70d196e](https://github.com/niway-dev/kaipu-record/commit/70d196ee66474a61be0e59caa2a791413d1677ac))
* **brand:** the fox replaces the play arrow in the macOS menu bar ([eedd6ee](https://github.com/niway-dev/kaipu-record/commit/eedd6eeca8b23fcf248cdd79c7a307d29b913da1))
* **desktop:** each screen declares the window it wants, and gets it back ([2a51798](https://github.com/niway-dev/kaipu-record/commit/2a5179835bcc5e4b022b15a76384fd637c528b47))
* **desktop:** routes as constants, and a window preset for every screen ([e490ce1](https://github.com/niway-dev/kaipu-record/commit/e490ce1795077299e3219aca1b09f71c8954e998))
* **desktop:** ship the free tier without a watermark ([289f2ea](https://github.com/niway-dev/kaipu-record/commit/289f2eac92ac4b6ff7b025225dd22809a5414714))
* **desktop:** the fox lockup replaces the play-arrow mark ([951c6c5](https://github.com/niway-dev/kaipu-record/commit/951c6c516690395a4bb8a1b779d2ec15454de748))
* **desktop:** the mascot leads the onboarding, at a size that reads ([4a895a0](https://github.com/niway-dev/kaipu-record/commit/4a895a03096aebf1cc55c108d4670a24f0b2829e))
* **desktop:** the menu-bar icon follows the app's state ([4fd4d30](https://github.com/niway-dev/kaipu-record/commit/4fd4d3080a16e18c008a2e726dc5b297327dac2f))
* **desktop:** the menu-bar icon follows the selected capture mode ([7d58a76](https://github.com/niway-dev/kaipu-record/commit/7d58a762a13a10af93e8998c92df329db2bb70f5))
* **desktop:** the window grows from its centre when the editor needs room ([40ff863](https://github.com/niway-dev/kaipu-record/commit/40ff8635697d854da5b21e04830d3a9119a5b4f3))
* **desktop:** the window grows from its centre when the editor needs room ([eecc25e](https://github.com/niway-dev/kaipu-record/commit/eecc25e7c1705e5ac02bb6ee3b3d841d81a262c2))
* **editor:** mute as an edit — ranges and the whole video ([2d2a035](https://github.com/niway-dev/kaipu-record/commit/2d2a035b4524b0b99058f0edc11d10f3b75e54ee))
* **editor:** mute as an edit, the editor's width back to the timeline, one stable window ([e155f25](https://github.com/niway-dev/kaipu-record/commit/e155f25c73400876b80255e2effe8f66e4688eab))
* **editor:** the editing operations for muted ranges ([e06acbd](https://github.com/niway-dev/kaipu-record/commit/e06acbdae63e38c127949a512bbe7e269be5193a))
* **editor:** the mute inspector — select a range, delete it from the side panel ([88f2bac](https://github.com/niway-dev/kaipu-record/commit/88f2bac58fd8f6414e73c5959c4cbc993e536ea1))
* **editor:** the mute UI — a lane, two controls, and the keyboard delete ([ed0b8cb](https://github.com/niway-dev/kaipu-record/commit/ed0b8cbfb5fada20b731a40a52719f23d7f11204))
* **editor:** the preview hears the muted ranges ([336222d](https://github.com/niway-dev/kaipu-record/commit/336222dba18e0239b154b4f341ca8216ed6486d1))
* **experiment:** one StyleX button shared by web and the desktop renderer ([be6eed7](https://github.com/niway-dev/kaipu-record/commit/be6eed7b6264fce1caddd5b6b1f6bb7460ba4e32))
* **experiment:** the shared probe mounts on both main screens ([2f6bacb](https://github.com/niway-dev/kaipu-record/commit/2f6bacbe433b5d77f60227de81bf382a618bf657))
* free local recordings, Kaipu identity, and growth strategy ([d2c3345](https://github.com/niway-dev/kaipu-record/commit/d2c33458d74b1b43e9e1d5c910ae164ea5aee74d))
* **kaipu-record:** every Button in the app is the shared one ([690d30b](https://github.com/niway-dev/kaipu-record/commit/690d30bd33fe5abfdfc70d59db9599e082174837))
* **kaipu-record:** every Button in the app is the shared one ([645bfe1](https://github.com/niway-dev/kaipu-record/commit/645bfe1c08f868b363c01e927fe4cedbc3e4db8e))
* **kaipu-record:** StyleX atomics reach every build, not just the dev probe ([3189c9b](https://github.com/niway-dev/kaipu-record/commit/3189c9b150fe480ef6d1cc25cf7db058802554f3))
* **screenshots:** copy a capture to the clipboard automatically, plus three annotation fixes ([edd105d](https://github.com/niway-dev/kaipu-record/commit/edd105dc96036f98aecfa436d0725e140283acc6))
* **screenshots:** copy a fresh capture to the clipboard on open (per setting) ([5cfabaf](https://github.com/niway-dev/kaipu-record/commit/5cfabaf7aa1005ac26c61efc9114638a2627771a))
* **settings:** screenshotCopy preference (auto | manual), default auto ([7b85b94](https://github.com/niway-dev/kaipu-record/commit/7b85b9429e7b9dffca0f0e8cfcdea2e7aa0a203d))
* **styles:** StyleX stages 0-1 — the proven pipeline and typed literal tokens with a light theme ([2deb9ec](https://github.com/niway-dev/kaipu-record/commit/2deb9ecf75de9c8763d89e5acae4d3d94a0fc24e))
* **tokens:** stage 1 — literal typed tokens and the generated light theme ([90c733c](https://github.com/niway-dev/kaipu-record/commit/90c733c785cd41835f4eb2619bfe76c7c58e1304))
* **tokens:** typed StyleX token references, generated from the same source ([0554710](https://github.com/niway-dev/kaipu-record/commit/055471061567e41373440e6a2ac406d9e423ee64))
* **ui:** Badge and Card join the atoms, IconButton is deleted ([a127ac4](https://github.com/niway-dev/kaipu-record/commit/a127ac4afe3e5ac9bb14c9b3b70651ad315ca061))
* **ui:** Badge and Card join the atoms, IconButton is deleted ([229617f](https://github.com/niway-dev/kaipu-record/commit/229617f71e2365a65ddedbd7487b13c8d18b7417))
* **ui:** Input and SearchInput join the atoms, PageHeader is deleted ([423bed2](https://github.com/niway-dev/kaipu-record/commit/423bed2f3ef37fc481fcb41c5d8dc60fc02eefc4))
* **ui:** Input and SearchInput join the atoms, PageHeader is deleted ([5878124](https://github.com/niway-dev/kaipu-record/commit/5878124ea6e0cce83ff6e13d175a8ecc67db5ab9))
* **ui:** Popover joins the molecules, and the docs catch up with reality ([874d6f5](https://github.com/niway-dev/kaipu-record/commit/874d6f56c19198c3137873fac1d5869fb94622c6))
* **ui:** Popover joins the molecules, and the docs catch up with reality ([4ddffcb](https://github.com/niway-dev/kaipu-record/commit/4ddffcbe44bf8b2b6de70068ae17d3a58daead4c))
* **ui:** recording controls move to @kaipu/ui (stage 2b, part 1) ([f40917f](https://github.com/niway-dev/kaipu-record/commit/f40917f8cf50c422198c4d22060c57fb365966d7))
* **ui:** recording controls move to the shared library as presentational parts ([b22954b](https://github.com/niway-dev/kaipu-record/commit/b22954b4901389b473efaa72535a37991f137832))
* **ui:** Row and the toast stack move to the shared library ([9c0b664](https://github.com/niway-dev/kaipu-record/commit/9c0b66470df967943cc48ad6723a816c7750b91e))
* **ui:** Row and the toast stack move to the shared library ([82a1122](https://github.com/niway-dev/kaipu-record/commit/82a1122995567db26d10ccc47268134c692e2a64))
* **ui:** stage 2b part 2 — shared navigation rail and a real-components landing shot ([97c2212](https://github.com/niway-dev/kaipu-record/commit/97c2212c440993a6593a13e02066a908d384e844))
* **ui:** the Modal becomes the first molecule, and Toggle sheds Radix ([a2b6545](https://github.com/niway-dev/kaipu-record/commit/a2b6545cf2cfbee1e0fd00a92f690f4089b4aa75))
* **ui:** the Modal becomes the first molecule, and Toggle sheds Radix ([461d0c7](https://github.com/niway-dev/kaipu-record/commit/461d0c7b717cee5a70bd7e13409172d7ddd1b5fe))
* **ui:** the navigation rail moves to the shared library ([ab94e49](https://github.com/niway-dev/kaipu-record/commit/ab94e49e159bd5529c51a6f400171efb586ee08b))
* **ui:** the shared Button becomes an atom, with the boundary that makes it shareable ([0b6f4c4](https://github.com/niway-dev/kaipu-record/commit/0b6f4c4593d3b0a9ceb6fbc4c0a9ba2cf7202bc0))
* **web:** marketing home, Kai branding, and conversion audit ([08d4b52](https://github.com/niway-dev/kaipu-record/commit/08d4b526e0e4c0a6f7baa09d8c6910ed9532123c))


### Bug Fixes

* **annotations:** break a word too long for the text box instead of overflowing ([b28fb22](https://github.com/niway-dev/kaipu-record/commit/b28fb22a6fa7867e53a00dd42f79af10ffc13847))
* **annotations:** never drag the label whose inline editor is open ([c3b8f7f](https://github.com/niway-dev/kaipu-record/commit/c3b8f7f898a656884636e950839549a766bebdff))
* **desktop:** bundle @kaipu/domain into the main process ([b950417](https://github.com/niway-dev/kaipu-record/commit/b9504177a8d1a321326f7d02b8e0b9c8f344b707))
* **desktop:** hold a minimum window size while onboarding is up ([23a2f6a](https://github.com/niway-dev/kaipu-record/commit/23a2f6a434c5e7c89599b9acbd33e70ca683dda5))
* **desktop:** keep @shared/types free of workspace value imports ([364c0ee](https://github.com/niway-dev/kaipu-record/commit/364c0ee1fb924baeb47d506bec86ada2b918a4ee))
* **desktop:** resolve the window preset from the route, not from a page's mount ([2655fa3](https://github.com/niway-dev/kaipu-record/commit/2655fa30c6849f0c062e0bcfeab4b45824025154))
* **desktop:** the light theme reaches the shared components ([9372941](https://github.com/niway-dev/kaipu-record/commit/937294157f17de20d751eff598a4c62fa6b1df6c))
* **desktop:** the light theme reaches the shared components ([2620999](https://github.com/niway-dev/kaipu-record/commit/2620999edcbaeb3c4cc7dcc448c2878335de749b))
* **desktop:** the window is the user's; only the video editor changes it ([4cc57b9](https://github.com/niway-dev/kaipu-record/commit/4cc57b99f6565acaa2e8e99527b31271b60f53d2))
* **experiment:** desktop defines the prefixed tokens; a raw control button ([323ca70](https://github.com/niway-dev/kaipu-record/commit/323ca7044a358104f4aff319d5c99cc84aebc550))
* **experiment:** the probe clears the fixed nav, and dev matches the scanner ([13d9633](https://github.com/niway-dev/kaipu-record/commit/13d9633a52272ee40df6c485a24adc88a0af2cb8))
* **kaipu-record:** the E2E suite runs under node, so it runs at all ([62644ec](https://github.com/niway-dev/kaipu-record/commit/62644ec635f1eecb2fdcd2a34b2d4baa558c3c14))
* **kaipu-record:** the E2E suite runs under node, so it runs at all ([32df7e7](https://github.com/niway-dev/kaipu-record/commit/32df7e74c204132076016fa65c21efeb4288b2aa))
* **landing:** read the real keyboard shortcuts instead of typed glyphs ([5fcf402](https://github.com/niway-dev/kaipu-record/commit/5fcf4026945429a281d1ea48e05f7ef02b61176b))
* **landing:** read the real keyboard shortcuts instead of typed glyphs ([dac5772](https://github.com/niway-dev/kaipu-record/commit/dac577283635cf92704d9daffb810b64e2891a59))
* **screenshots:** hide the resize handles while a text label is being edited ([d056bd4](https://github.com/niway-dev/kaipu-record/commit/d056bd4cc73b340ef78cabed2ce6b5d086d30aff))


### Performance Improvements

* **desktop:** the capture panel opens without waiting for every window ([af63d48](https://github.com/niway-dev/kaipu-record/commit/af63d4851e5747fce2f0478dcc647e681e48d1e9))
* **desktop:** the capture panel opens without waiting for every window ([6f1f630](https://github.com/niway-dev/kaipu-record/commit/6f1f630b9c8f5e3c7ae5bff8605244f079dd795d))

## [0.9.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.8.0...desktop-v0.9.0) (2026-09-27)


### Features

* **annotations:** add the Custom size state, and document how text labels work ([7e1db0e](https://github.com/csdev19/kaipu-record-monorepo/commit/7e1db0ed92d5fd0ea43c746f3e86c3ce78946b85))
* **annotations:** let the box govern the text, with continuous corner scaling ([3bfdcc4](https://github.com/csdev19/kaipu-record-monorepo/commit/3bfdcc4397f2ee647e4f8d6e4074078755f122b1))
* **annotations:** the box governs the text, with one owner for its geometry ([93b9d83](https://github.com/csdev19/kaipu-record-monorepo/commit/93b9d8329f511b5dddcb0558e604f74acf6a0d27))
* **video-editor:** make text labels editable and multi-line ([5d59981](https://github.com/csdev19/kaipu-record-monorepo/commit/5d59981d6a51f9ce6761f3a3cf55207e6e0dcb47))
* **video-editor:** make text labels editable and multi-line ([2c33d5b](https://github.com/csdev19/kaipu-record-monorepo/commit/2c33d5b87c2d87a4f8706486e49009513da51d3a))


### Bug Fixes

* **annotations:** place the handles on the box that is actually drawn ([5952a3c](https://github.com/csdev19/kaipu-record-monorepo/commit/5952a3c1a26147f9ef97c6fd0a67e5aa2fa3f306))
* **annotations:** route every text measurement through the one owner, and enforce it ([0208f27](https://github.com/csdev19/kaipu-record-monorepo/commit/0208f27c539b68a9d58ebd35c0de577188e98b1e))
* **recording:** stop holding the microphone open just to read device labels ([fbb98b0](https://github.com/csdev19/kaipu-record-monorepo/commit/fbb98b0fd44df42130b21f8946bfdc03c3b32171))
* **recording:** stop holding the microphone open just to read device labels ([415f6ca](https://github.com/csdev19/kaipu-record-monorepo/commit/415f6ca6a9a05fde20ea8b162f15790c8aeed12d))
* **screenshots:** clear fontPx when a preset is picked, in the image editor too ([59ae254](https://github.com/csdev19/kaipu-record-monorepo/commit/59ae254b775664696fb49a134c49f6f3866b1823))
* **video-editor:** capture the pointer on the layer, so double-click still edits ([555136d](https://github.com/csdev19/kaipu-record-monorepo/commit/555136dd1980b59ecc10ab316c8946cdd6b0e903))
* **video-editor:** capture the pointer on the layer, so double-click still edits ([347c09a](https://github.com/csdev19/kaipu-record-monorepo/commit/347c09aee3fa91e3950bb5c915bb51a8dded0649))
* **video-editor:** hide the label while its inline editor is open ([16349b3](https://github.com/csdev19/kaipu-record-monorepo/commit/16349b309f28259363b97ed6d6626166bc9a874f))
* **video-editor:** hide the label while its inline editor is open ([ae7b515](https://github.com/csdev19/kaipu-record-monorepo/commit/ae7b5150b83a0a5a4fafbe1623ff6c74c9bd046e))
* **video-editor:** measure the text hit box the same way the label is drawn ([4a337db](https://github.com/csdev19/kaipu-record-monorepo/commit/4a337db43501c908715d3f1f995476fe8266dcae))
* **video-editor:** show every line when reopening a label ([859e008](https://github.com/csdev19/kaipu-record-monorepo/commit/859e00801839d161f9aa782cbc2973eee4524127))
* **video-editor:** size the preview from its container, not the viewport ([980ba3e](https://github.com/csdev19/kaipu-record-monorepo/commit/980ba3e94db79a17531f948c48c1be37717fc69c))
* **video-editor:** size the preview from its container, not the viewport ([45e882e](https://github.com/csdev19/kaipu-record-monorepo/commit/45e882e473f73b4dcbcf269614c0c1ba83d66233))

## [0.8.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.7.0...desktop-v0.8.0) (2026-09-25)


### Features

* **library:** edited/not-exported badge on cards and rows ([23db65b](https://github.com/csdev19/kaipu-record-monorepo/commit/23db65b491857ffe6ca88f5556fdd8d6fa9e885e))
* **library:** expose the edit session's savedAt on library items ([3082963](https://github.com/csdev19/kaipu-record-monorepo/commit/30829639a6efb73d585c38e3fed0bd7289da8952))
* **library:** lineage (source ↔ exports), edited/not-exported badge, editor save state ([8a7f996](https://github.com/csdev19/kaipu-record-monorepo/commit/8a7f9967b0128f59110a3a5f5b30614df721c561))
* **library:** pure lineage helpers and the edited/not-exported badge state ([9abc19d](https://github.com/csdev19/kaipu-record-monorepo/commit/9abc19d21e366123440b759448e2ce9cb5e499bf))
* **library:** Source link, Exports list and edit badge on the detail page ([6ad0a61](https://github.com/csdev19/kaipu-record-monorepo/commit/6ad0a6104b79d87cabe47eadf9383eb723b30822))
* **screenshots:** auto-save a fresh capture on open (per setting) with Discard ([d2dc78c](https://github.com/csdev19/kaipu-record-monorepo/commit/d2dc78c9ea6e66c0d73973ff363dac8647b34513))
* **screenshots:** save automatically or on click (Settings → Screenshots) ([7d18779](https://github.com/csdev19/kaipu-record-monorepo/commit/7d18779a5d45d1f392eaffb22b4b10f8b37bc5ee))
* **settings:** Screenshots gets its own page in the nav, under Recording ([e428999](https://github.com/csdev19/kaipu-record-monorepo/commit/e428999aabe7213a7675d42fd32f79045a4515f3))
* **settings:** Screenshots section with the save-mode preference ([2db1ddf](https://github.com/csdev19/kaipu-record-monorepo/commit/2db1ddf55979926d36da735a3068e5865e793af5))
* **settings:** screenshotSave preference (auto | manual), default auto ([ea05b1d](https://github.com/csdev19/kaipu-record-monorepo/commit/ea05b1d289cbccc6d37af80933d7559f5dad61ec))
* **updater:** surface the real update state and a button to check now ([1848679](https://github.com/csdev19/kaipu-record-monorepo/commit/1848679f2748dc1c2fb6a99cdb2070e0badedd43))
* **updater:** surface the real update state and a button to check now ([0a7bcf2](https://github.com/csdev19/kaipu-record-monorepo/commit/0a7bcf21500e404481c6f7ca3ea21bad491a87ca))
* **video-editor:** save-state chip driven by the session autosave ([c4ce341](https://github.com/csdev19/kaipu-record-monorepo/commit/c4ce34150cc0722d71dec5b126acb62a027927e1))
* **watermark:** move the mark to the bottom-left corner and quiet it down ([915b229](https://github.com/csdev19/kaipu-record-monorepo/commit/915b22957c2dd689cf5cbf6d2ab2c391f89c134a))
* **watermark:** move the mark to the bottom-right corner and quiet it down ([c1fd238](https://github.com/csdev19/kaipu-record-monorepo/commit/c1fd238464db9b483b2e46089b278c7a62ca5569))


### Bug Fixes

* **kaipu-record:** decide "exported" by a stamp, not by comparing clocks ([0227476](https://github.com/csdev19/kaipu-record-monorepo/commit/02274764ba28e392e5a99bf0ffe09f840fcc8be0))
* **kaipu-record:** decide "exported" by a stamp, not by comparing clocks ([0750c51](https://github.com/csdev19/kaipu-record-monorepo/commit/0750c51b5423c073dcf53004e37143021a08dcdb))
* **screenshots:** let the navigation blocker lift before Discard leaves the editor ([35fafd3](https://github.com/csdev19/kaipu-record-monorepo/commit/35fafd3dec426c958dfa791b5d7d6d687df4463d))
* **settings:** screenshot auto-save is a toggle, with copy that fits the row ([28af914](https://github.com/csdev19/kaipu-record-monorepo/commit/28af914891fb7dd932d0129fc32ef939b6c04522))
* **watermark:** put the mark on the right and lift it off the bottom edge ([a86f824](https://github.com/csdev19/kaipu-record-monorepo/commit/a86f82463c3f351a552f382f49bb2bae1dfbadaa))

## [0.7.0](https://github.com/csdev19/kaipu-record-monorepo/compare/desktop-v0.6.2...desktop-v0.7.0) (2026-09-23)


### Features

* **desktop:** Accessibility as a permissions row + language picker in onboarding ([77b2992](https://github.com/csdev19/kaipu-record-monorepo/commit/77b2992642e6913c358aaf2b2c8fc6e12a958a4b))
* **desktop:** Accessibility as a permissions row + language picker in onboarding ([3c411c9](https://github.com/csdev19/kaipu-record-monorepo/commit/3c411c9a708058b24d1ee89dc31c32d70cc034c4))
* **desktop:** first run opens in English; the welcome step picks the language ([675f126](https://github.com/csdev19/kaipu-record-monorepo/commit/675f1262d3ef8168273ac94f9d4c85b8d9f5f8ea))
* **kaipu-record:** add a cursor-track:check CLI ([738a110](https://github.com/csdev19/kaipu-record-monorepo/commit/738a110ca153fe9a4df5a8d1e73f34dd014486a5))
* **kaipu-record:** add a gated click hook for the cursor track ([3dd4c6a](https://github.com/csdev19/kaipu-record-monorepo/commit/3dd4c6a643b0e2a4f62fc12de577e0d4c5f28ac3))
* **kaipu-record:** add a pure cursor track inspector ([6ea1527](https://github.com/csdev19/kaipu-record-monorepo/commit/6ea15275a7d739a148a2b84b79b3ce9555ff0aa7))
* **kaipu-record:** add a single-selection model for the video editor ([a94ef37](https://github.com/csdev19/kaipu-record-monorepo/commit/a94ef37364966570aa0991f5cbedbb2cd97444a2))
* **kaipu-record:** add blur and cover inspectors ([509115f](https://github.com/csdev19/kaipu-record-monorepo/commit/509115f3cb72d8d25a1b9fcd38ad20af652125e8))
* **kaipu-record:** add blur and cover privacy regions to the editor ([8037c05](https://github.com/csdev19/kaipu-record-monorepo/commit/8037c058e72b14e97edeacfb42306fe16158ec34))
* **kaipu-record:** add export frame composition with fail-closed redactions ([9bfb6f6](https://github.com/csdev19/kaipu-record-monorepo/commit/9bfb6f6f0532d2611e0094edfd0f5dc5e815bf37))
* **kaipu-record:** add hold-to-compare to the preview chrome ([616649e](https://github.com/csdev19/kaipu-record-monorepo/commit/616649eb3f1bd854cf39a3dd93b5094732f51b61))
* **kaipu-record:** add privacy region geometry and editing hook ([b0e841f](https://github.com/csdev19/kaipu-record-monorepo/commit/b0e841f016bd20b48932d344d7c68691bc4893fb))
* **kaipu-record:** add pure zoom and redaction edit helpers ([cf04c78](https://github.com/csdev19/kaipu-record-monorepo/commit/cf04c78bd56d3e983905a8f3c2421fdf759840d1))
* **kaipu-record:** add region drawing and editing interactions ([7044ba0](https://github.com/csdev19/kaipu-record-monorepo/commit/7044ba01e85aad081f6fc587c56c78add99ec65e))
* **kaipu-record:** add source-time helpers for zoom and redaction ranges ([8e95c13](https://github.com/csdev19/kaipu-record-monorepo/commit/8e95c1336196c8f92048c9e6f6b84fe11a7eefdd))
* **kaipu-record:** add the 288px inspector column (Detection + Zoom) ([fa6f6f4](https://github.com/csdev19/kaipu-record-monorepo/commit/fa6f6f43b9ecf3797536022557586a1e6d80d871))
* **kaipu-record:** add the Activity and Zooms lanes and the inspector column ([ffcae08](https://github.com/csdev19/kaipu-record-monorepo/commit/ffcae08a9562677f332973375fb4d25e11af0d9e))
* **kaipu-record:** add the camera box with its scrim and level chip ([a5321e5](https://github.com/csdev19/kaipu-record-monorepo/commit/a5321e5c3461e3435ccb160cd7b1f5544084ffeb))
* **kaipu-record:** add the camera path memo hook ([611d14c](https://github.com/csdev19/kaipu-record-monorepo/commit/611d14ca71800c5ce9a2bac18258776084023e75))
* **kaipu-record:** add the camera path model ([6ca74b4](https://github.com/csdev19/kaipu-record-monorepo/commit/6ca74b43b6d6714a773845ba63c4c7e61b33f127))
* **kaipu-record:** add the Follow / Lock mode control to the zoom inspector ([675312c](https://github.com/csdev19/kaipu-record-monorepo/commit/675312cb3995a0f3b71f438d68871e66f7e4d2a0))
* **kaipu-record:** add the macOS Accessibility onboarding step and Settings row ([f3bb200](https://github.com/csdev19/kaipu-record-monorepo/commit/f3bb2007e902c8d909d9a2f73e9fbd32bdaa9860))
* **kaipu-record:** add the macOS Accessibility status/request IPC ([a5b9ee9](https://github.com/csdev19/kaipu-record-monorepo/commit/a5b9ee92810f7bc37c116a2adabc009d9ce76aed))
* **kaipu-record:** add the Privacy lane to the timeline ([6dfa427](https://github.com/csdev19/kaipu-record-monorepo/commit/6dfa427b00fb63998c76fe5c6a0e0bc1cd3b1d30))
* **kaipu-record:** add the read-only Activity lane ([a275378](https://github.com/csdev19/kaipu-record-monorepo/commit/a275378238c6778b8e67d81b1e528be860543c96))
* **kaipu-record:** add the redaction geometry and intensity math ([7f378b8](https://github.com/csdev19/kaipu-record-monorepo/commit/7f378b87ae4ef2d52ab1a58cf8f2572103647a7c))
* **kaipu-record:** add the shared cursor track format ([0f4c195](https://github.com/csdev19/kaipu-record-monorepo/commit/0f4c19596d53e0312b572d96b8a451e41058b71f))
* **kaipu-record:** add the timeline label column and a HistorySlider primitive ([b8d5a6c](https://github.com/csdev19/kaipu-record-monorepo/commit/b8d5a6c7dcc6edfc977d51812f75b94d1a25f535))
* **kaipu-record:** add the zoom detector, camera path and redaction math ([23bd7f4](https://github.com/csdev19/kaipu-record-monorepo/commit/23bd7f4828cc65f34ccd2004a6ed50eb5a960adf))
* **kaipu-record:** add the zoom model and detector ([a3130a3](https://github.com/csdev19/kaipu-record-monorepo/commit/a3130a3ec0c6e01f7646a330bacfc9300925ec7f))
* **kaipu-record:** add the Zooms lane and its edge-drag handlers ([5bdd7ce](https://github.com/csdev19/kaipu-record-monorepo/commit/5bdd7ce374b0b88c9256a3530559b67f91d4d6c4))
* **kaipu-record:** add zoom/redaction/sensitivity fields to the scene model ([ca4ca5d](https://github.com/csdev19/kaipu-record-monorepo/commit/ca4ca5d882e67f8981402837d5456b9de1003562))
* **kaipu-record:** annotation inspector and camera box body-drag ([31aec8c](https://github.com/csdev19/kaipu-record-monorepo/commit/31aec8c40110c6f74ffc3f5d4e5b5787e79b6fbe))
* **kaipu-record:** annotation inspector panels and the selection helpers ([4862af4](https://github.com/csdev19/kaipu-record-monorepo/commit/4862af4e64bb8991a82831ed64af67bd06c2c462))
* **kaipu-record:** burn zoom and privacy regions into the export ([ba80b1c](https://github.com/csdev19/kaipu-record-monorepo/commit/ba80b1c8317382dee4e1ed1da92d4c3ee8d2b974))
* **kaipu-record:** burn zoom, redactions and pinned overlays into the export ([23c0755](https://github.com/csdev19/kaipu-record-monorepo/commit/23c0755c39a96e9935fe0b499cb1bf4a74bb7d74))
* **kaipu-record:** capture a cursor position track with every screen recording ([c745472](https://github.com/csdev19/kaipu-record-monorepo/commit/c745472702615e0dfdfd402f6fe9bb22c731384a))
* **kaipu-record:** capture clicks for the cursor track, gated on Accessibility ([cf761e6](https://github.com/csdev19/kaipu-record-monorepo/commit/cf761e6a0898cd4a8da0b388ba703cf38381c695))
* **kaipu-record:** carry redactions and a zoom flag on the export plan ([e75d354](https://github.com/csdev19/kaipu-record-monorepo/commit/e75d3549420bd10458a630b9e09f383f95e960f4))
* **kaipu-record:** cursor-track inspector, check CLI, real fixture, and the tail-cut fix ([8eb6bcf](https://github.com/csdev19/kaipu-record-monorepo/commit/8eb6bcfbda43387c5f1bfc4778ad2bd10cb95d5c))
* **kaipu-record:** debounce-save the video edit session ([7b20c6f](https://github.com/csdev19/kaipu-record-monorepo/commit/7b20c6fd193483d91734d54400daaf8d60207e01))
* **kaipu-record:** drive the preview camera from a per-frame video clock ([e85f78f](https://github.com/csdev19/kaipu-record-monorepo/commit/e85f78fcb84efbe0223c2dd256c2ab6b273f093f))
* **kaipu-record:** load the cursor track and run initial zoom detection ([eaa9e5e](https://github.com/csdev19/kaipu-record-monorepo/commit/eaa9e5e48c54c67151977892922bdb937e37d50f))
* **kaipu-record:** map main-clock cursor samples onto video time ([822724f](https://github.com/csdev19/kaipu-record-monorepo/commit/822724f7499b1cadbd1ebc422c7c1a9969e228c7))
* **kaipu-record:** move the preview camera and add the camera box ([08b73d9](https://github.com/csdev19/kaipu-record-monorepo/commit/08b73d9e71a3be9ed3e55a7c50a463446facf41b))
* **kaipu-record:** note in the export dialog that the original keeps everything ([250275c](https://github.com/csdev19/kaipu-record-monorepo/commit/250275c8948496c6abcc6ea42da23956be719619))
* **kaipu-record:** open a cursor track session with every recording ([3d1707f](https://github.com/csdev19/kaipu-record-monorepo/commit/3d1707f25ee3c43c38ac613a55bd1a5214258d32))
* **kaipu-record:** parse and serialize zoom/redaction session fields ([5cb30d3](https://github.com/csdev19/kaipu-record-monorepo/commit/5cb30d3cde1a5be99c41777ab8c1d558ab579345))
* **kaipu-record:** persist the cursor track as a vault sidecar ([60512e1](https://github.com/csdev19/kaipu-record-monorepo/commit/60512e1db601cd9a9b3be365919e81f2f2e06fae))
* **kaipu-record:** polish the video editor — shortcuts, empty states, pill, soft-zoom hint ([d491b7d](https://github.com/csdev19/kaipu-record-monorepo/commit/d491b7d45b5e9026f7e5e0eb49f8f603ac701f72))
* **kaipu-record:** rebuild the camera path at most once per frame ([4bad59d](https://github.com/csdev19/kaipu-record-monorepo/commit/4bad59d4deab1ae5b0cb5737417562762add53a2))
* **kaipu-record:** render privacy regions in the preview underlay ([e769438](https://github.com/csdev19/kaipu-record-monorepo/commit/e76943832e2d94499bc3b2b1b7a6dbe523a3a0ba))
* **kaipu-record:** sample the pointer in main for screen recordings ([72d7937](https://github.com/csdev19/kaipu-record-monorepo/commit/72d79372baf3f25555dda338fd5960ea0cadd2d6))
* **kaipu-record:** scene v2, cursor-track loading and session autosave ([0125a5f](https://github.com/csdev19/kaipu-record-monorepo/commit/0125a5fb886dceae925c19977dcd554e8b4c1b0c))
* **kaipu-record:** the camera box body grabs the camera ([e2134c7](https://github.com/csdev19/kaipu-record-monorepo/commit/e2134c709a63b53d403437abf8222262e30f8927))
* **kaipu-record:** video editor v2 polish and the Accessibility onboarding step ([a955596](https://github.com/csdev19/kaipu-record-monorepo/commit/a95559697259d37ebf3b1b8057495b6499c69ef5))
* **kaipu-record:** wire Blur/Cover tools into the toolbar and editor page ([176f942](https://github.com/csdev19/kaipu-record-monorepo/commit/176f9425ab3bafe3a957662b08d35b4bedc25fdc))
* **kaipu-record:** wire the annotation inspector and the timeline-selection fixes ([38671d9](https://github.com/csdev19/kaipu-record-monorepo/commit/38671d99a9578f2398c89d2a3140bc60bce73845))
* **kaipu-record:** wire the click hook into the recording hub ([26cfad1](https://github.com/csdev19/kaipu-record-monorepo/commit/26cfad1abdf097044c0d897d166368c85d224037))
* **kaipu-record:** wire the cursor track IPC and main handlers ([2468bd1](https://github.com/csdev19/kaipu-record-monorepo/commit/2468bd10c12313ef9d04355ef25031ff4f649d6e))
* **kaipu-record:** wire the preview camera and its chrome into the editor ([4b6c01f](https://github.com/csdev19/kaipu-record-monorepo/commit/4b6c01f473c038e0cea2609ad2b0bb7e6a5a6202))
* **kaipu-record:** wire the Zoom tool, counts and inspector into the editor page ([c09ff03](https://github.com/csdev19/kaipu-record-monorepo/commit/c09ff03b6f6b7df11b1a141269904a9e202cce22))


### Bug Fixes

* **desktop:** scope the capacity-card translator type to its namespace ([75f6087](https://github.com/csdev19/kaipu-record-monorepo/commit/75f6087e65afe4eec45d23474c9b073c15a4774a))
* **desktop:** the onboarding Done step shows the real start-recording shortcut ([7ca4518](https://github.com/csdev19/kaipu-record-monorepo/commit/7ca45185b2e59df8f5d6cd949d932fe21eb31cc8))
* **kaipu-record:** generate export poster from the rendered output ([191c4f5](https://github.com/csdev19/kaipu-record-monorepo/commit/191c4f57db7430c3b28b35ce70247798a1c4e75c))
* **kaipu-record:** generate the export poster from the rendered output ([a5aa760](https://github.com/csdev19/kaipu-record-monorepo/commit/a5aa76090011d7df0cc2b77df003363d76c1fe4e))
* **kaipu-record:** move the Accessibility row to Settings → Permissions ([7fb24fc](https://github.com/csdev19/kaipu-record-monorepo/commit/7fb24fcc5769e319e2a636c1ba9c88ea89dcc864))
* **kaipu-record:** review findings — shortcut parity, dead popover code ([3dc2e2d](https://github.com/csdev19/kaipu-record-monorepo/commit/3dc2e2d6617d54920123b518bc9ca0c2b7072e79))
* **kaipu-record:** stop the cursor track tail cut from flooring duration ([fb04468](https://github.com/csdev19/kaipu-record-monorepo/commit/fb044684bee36279fb59ef9e1c1999154c2ed737))
* **kaipu-record:** three review findings in the editor polish pass ([7f05696](https://github.com/csdev19/kaipu-record-monorepo/commit/7f05696d3727618be99268aaf552b83a84ef4170))
* **web:** one header per public page, and English as the default locale ([d955a26](https://github.com/csdev19/kaipu-record-monorepo/commit/d955a26a6dff1ac078b2c3fe993df459f069c1c9))
* **web:** one header per public page, and English as the default locale ([4df313c](https://github.com/csdev19/kaipu-record-monorepo/commit/4df313c4c9b9a86ae1c437c1ec22919fa38455ba))

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
