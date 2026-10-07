# Changelog

## [0.11.0](https://github.com/niway-dev/kaipu-record/compare/desktop-v0.10.0...desktop-v0.11.0) (2026-10-07)


### Features

* **desktop:** live recording controls — mute mic, system audio and camera mid-take (NIW2-152) ([400c80e](https://github.com/niway-dev/kaipu-record/commit/400c80e4ff0dcb98338b411aea70a02b63b517d7))

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
