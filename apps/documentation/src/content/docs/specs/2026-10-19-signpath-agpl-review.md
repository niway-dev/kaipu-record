---
title: SignPath eligibility and AGPL licensing review
description: Independent review of Windows signing eligibility, Cloud monetization, privacy gaps, and proposed bilingual terms, pending owner and legal review.
---

# SignPath eligibility and AGPL licensing review

> **Draft for review — 2026-10-19.** This records an independent assessment, not
> accepted legal terms, a compliance certification, or an implemented signing
> integration. The proposed Spanish product copy below is intentionally retained
> in Spanish because that version of the terms prevails.

## One-minute summary

**A free AGPL desktop application with optional paid Cloud services is viable and
not inherently excluded by SignPath Foundation. The current changes do not yet
demonstrate that all signing conditions are met.** The largest concrete gap is
the installation-time diagnostics choice: a notice directing users to an in-app
toggle is not itself an installation option to disable collection.

| Proposed direction                                                    | Why                                                                               | ADR                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| Retain the open-source application and paid hosted-service model      | Charging for hosting is different from commercial dual licensing                  | None created; existing product direction |
| Separate software rights from hosted-service terms                    | The current revocable app-license wording is ambiguous despite its OSS carve-out  | None; proposed legal copy                |
| Complete installation-time privacy controls before claiming readiness | SignPath explicitly requires installation options to disable collection           | None; implementation remains pending     |
| Offer version-matched source for desktop releases and Cloud           | A public moving branch alone does not establish corresponding-source availability | None; compliance follow-up               |

**Open questions:** Which AGPL version grant is intended? What is actually inside
the shipped Windows installer? Which telemetry keys/providers are active in
production? Will SignPath accept the installation policy presentation? Are MFA,
reviewer permissions, signing roles, and approval controls configured?

**Out of scope:** changing runtime behavior, publishing binding legal text,
choosing a different license, applying to SignPath, or asserting compliance with
all Peruvian privacy/consumer law. No new architectural decision is adopted here.

## Evidence baseline and limits

The review inspected `main` at
[`aab3100205480bda97cf0341b1edc9733e99b2c0`](https://github.com/niway-dev/kaipu-record/tree/aab3100205480bda97cf0341b1edc9733e99b2c0).
GitHub confirmed that [PR #317](https://github.com/niway-dev/kaipu-record/pull/317)
and [PR #319](https://github.com/niway-dev/kaipu-record/pull/319) were merged on
2026-10-18. Paths below refer to that baseline, not an unverified future release.

The review read source, packaging configuration, release workflows, legal copy,
published policies, dependency metadata, and primary license/signing sources.
It did **not** run the installer, capture network traffic, inspect every file in
the packaged executable, audit every transitive dependency, or inspect private
SignPath/GitHub organization controls. Dependency checks below are a sample, not
an SBOM or a complete license audit. Legal conclusions remain proposals for
qualified review, particularly where Spanish terms control.

External pages are time-sensitive. The SignPath terms page calls its code of
conduct a **draft**; it is nevertheless the published eligibility source consulted.
The application page's fetched content did not expose the application form, so
this review does not claim to have checked every form question.

## Assessment of the five original claims

### 1. AGPL is compatible with SignPath — correct, subject to conditions

Under **Conditions for free OSS SignPath.io subscriptions → OSS License**,
[SignPath's terms](https://signpath.org/terms) say:

> The project must use an OSI-approved Open Source license without commercial dual-licensing for all components.

Under **No proprietary code**:

> The project may not contain any proprietary, non open-source component (especially code published by a maintainer or an affiliated person/organization).

System Libraries are an express exception. AGPLv3 is OSI-approved. Direct OSI
requests returned HTTP 403 during this review; the approval was cross-checked
against [SPDX's AGPL-3.0-only record](https://spdx.org/licenses/AGPL-3.0-only.html)
and its [machine-readable data](https://raw.githubusercontent.com/spdx/license-list-data/main/json/details/AGPL-3.0-only.json),
which reports `isOsiApproved: true`.

The ban on commercial dual licensing is **SignPath's condition**, not an AGPL
prohibition on a copyright holder offering alternative licenses. Selling Cloud
storage is not the same as selling an alternative proprietary license to the code.

### 2. The app-license clause conflicts with AGPL — qualified agreement

Both [`en.json:1172–1174`](https://github.com/niway-dev/kaipu-record/blob/aab31002/packages/i18n/messages/en.json#L1172-L1174)
and [`es.json:1172–1174`](https://github.com/niway-dev/kaipu-record/blob/aab31002/packages/i18n/messages/es.json#L1172-L1174)
grant a personal, revocable, non-transferable license to the app and service.
Applied as restrictions on the AGPL software, these conflict with:

- AGPL §2: rights are irrevocable while its conditions are met; running the
  unmodified program is expressly permitted.
- AGPL §§4–6: copying, modification, and redistribution are permitted subject to
  license conditions.
- AGPL §10: no further restrictions on the granted rights.

However, the same clause explicitly says that open-source components remain
governed by their licenses and that these terms do not restrict those rights.
**That carve-out cannot be ignored.** The wording does not by itself prove that
the app became proprietary or establish a concluded infringement. It does create
unnecessary ambiguity: it reads like a proprietary app with some OSS components,
rather than an AGPL project. Rewriting is recommended on that basis.

Sources: [`LICENSE`](https://github.com/niway-dev/kaipu-record/blob/aab31002/LICENSE),
especially lines 69, 81–107, and 164–168; bilingual replacement proposed below.

### 3. Paid Cloud is compatible if the signed app is open source — broadly correct, incomplete

The published conditions do not prohibit paid hosted services or require the
operator to be a nonprofit. But open-source code alone does not establish
eligibility: privacy, installation controls, roles, MFA, manual approvals,
metadata, verifiable builds, and reputation also matter.

SignPath refers to the **project and its components**, not just one executable.
If a future proprietary backend is closely integrated, do not assume that being
remote automatically excludes it from eligibility review. Here, the backend is
published as part of the open project. Describe the optional paid Cloud model
explicitly in the application rather than treating acceptance as guaranteed.

### 4. Only the diagnostics disclosure and an exactly named page remain — incomplete

**The missing toggle disclosure is confirmed.**
`legal.privacy.sections.diagnostics.body` at line 1252 of both message files
describes PostHog without saying how to disable it.

**A separate page with an exact title is not mandatory.** Under **Specify a code
signing policy**, SignPath requires:

> Use the term “Code signing policy” on your project’s home page and download/release pages (section header or link to a dedicated page).

The policy must include:

- “Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)”;
- team roles and their members (permission-group links are allowed);
- a privacy-policy link, with relevant third-party policies identified.

The alternative statement that the program sends nothing unless requested by the
user should **not** be used while automatic diagnostics or other automatic
connections make it inaccurate. Coordinate attribution with acceptance; do not
claim an active signing relationship prematurely.

**The larger omission is installation-time choice.** Under **Respect user privacy
and security**, SignPath says:

> Software that collects user data and transfers it to systems not specified by the user must a) describe this behavior in a privacy policy, b) display this policy during installation and c) include installation options to disable these functions.

`apps/kaipu-record/build/installer-privacy-notice.txt` directs the user to Settings
after installation. `apps/kaipu-record/electron-builder.yml` configures it as
`nsis.license`. Neither demonstrates an installation option to disable collection.
Also confirm whether the displayed summary plus URL is sufficient policy
presentation; the actual installer UI was not executed.

### 5. An unsigned EXE can be installed through SmartScreen — correct with qualifications

Windows does not require every desktop executable to be signed. When the usual
warning permits an override, the user can choose **More info → Run anyway**.
That is not a universal installation guarantee:

- corporate policy can prevent bypassing the warning;
- application-control rules or antivirus can independently block execution;
- warning behavior depends on system configuration and reputation;
- a signature alone does not guarantee the absence of SmartScreen warnings.

Microsoft documents reputation checks for both downloaded files and digital
signatures, and policies that either allow continuation or prevent bypass:

- [Microsoft Defender SmartScreen overview](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)
- [Available Microsoft Defender SmartScreen settings](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/available-settings)

## Proposed bilingual software-license clause

### Resolve the license-version inconsistency first

`LICENSE:4–7` explicitly grants **version 3 or any later version**. The README and
package manifests including `packages/domain/package.json` and
`packages/application/package.json` say **AGPL-3.0-only**. Both are open source,
but they are different grants. This review does not silently choose between them
or assume previously granted rights can be withdrawn.

The draft below refers to accompanying notices until that inconsistency is
resolved. It replaces `legal.terms.sections.license`; it is **not approved copy**.

### Spanish product copy — Software, servicios alojados y marcas

> Kaipu Record es software libre y de código abierto. El software de Kaipu distribuido bajo la Licencia Pública General Affero de GNU, versión 3 (AGPLv3), se rige por dicha licencia y por los avisos de licencia que lo acompañan. Los componentes de terceros se rigen por sus respectivas licencias. Puedes usar, estudiar, copiar, modificar y redistribuir el software conforme a las licencias aplicables. Estos términos no sustituyen esas licencias ni limitan los derechos que conceden; en caso de conflicto respecto de esos derechos, prevalece la licencia de software aplicable.
>
> Estos términos y las Condiciones de Cloud regulan el acceso a los servicios alojados que opera Niway, incluidas las cuentas, el almacenamiento, las funciones de Cloud y los planes de pago. La licencia del software no concede almacenamiento, capacidad ni acceso gratuito a la infraestructura de Niway. La suspensión o terminación de una cuenta o servicio no revoca los derechos que conserves sobre el software conforme a su licencia.
>
> Los derechos sobre las marcas, nombres comerciales y logotipos de Kaipu y Niway corresponden a sus respectivos titulares. Las licencias del software no otorgan, por sí mismas, autorización para presentar una versión modificada o un servicio de terceros como oficial, patrocinado o aprobado por Niway. Esta reserva de derechos de marca no restringe los derechos sobre el código ni los usos permitidos por las licencias aplicables o por la ley.
>
> No accedas sin autorización a la infraestructura de Niway, a cuentas ajenas ni a datos de terceros. Esta prohibición no limita el estudio, la modificación o la ejecución del software conforme a sus licencias.

### English product copy — Software, hosted services and trademarks

> Kaipu Record is free and open-source software. Kaipu software distributed under the GNU Affero General Public License, version 3 (AGPLv3), is governed by that license and its accompanying licensing notices. Third-party components are governed by their respective licenses. You may use, study, copy, modify and redistribute the software in accordance with the applicable licenses. These terms do not replace those licenses or restrict the rights they grant; if there is a conflict concerning those rights, the applicable software license prevails.
>
> These terms and the Cloud terms govern access to the hosted services operated by Niway, including accounts, storage, Cloud features and paid plans. The software license does not grant storage, capacity or free access to Niway’s infrastructure. Suspension or termination of an account or service does not revoke the rights you retain in the software under its license.
>
> Rights in the Kaipu and Niway trademarks, trade names and logos belong to their respective holders. The software licenses do not, by themselves, authorize you to present a modified version or a third-party service as official, sponsored or endorsed by Niway. This reservation of trademark rights does not restrict rights in the code or uses permitted by the applicable licenses or by law.
>
> Do not access Niway’s infrastructure, other people’s accounts or third-party data without authorization. This prohibition does not restrict studying, modifying or running the software in accordance with its licenses.

### Related scope and age corrections to review

The general terms' introduction, feature-withdrawal, suspension, and amendment
clauses should not imply revocation of rights in existing AGPL copies. Trademark
rights can be reserved without declaring all distributed visual assets
proprietary; their copyright permissions still need to be clear.

Keep the 18+ requirement scoped to accounts, Cloud, and contracting, rather than
adding an age restriction to the rights granted over the AGPL program. If both
18 years and local majority are required, replace the ambiguous **or** with:

- Spanish product copy: “Debes tener al menos 18 años y haber alcanzado la mayoría de edad en tu lugar de residencia.”
- English product copy: “You must be at least 18 years old and have reached the age of majority where you live.”

`legal.terms.sections.general` confirms that Spanish prevails over English for
these terms. That does not authorize the terms to override the software license.

## Additional findings and approval risks

### Diagnostics and other outbound connections

1. **Diagnostics default to enabled in settings.**
   `apps/kaipu-record/src/shared/types/ipc.ts:316` sets
   `diagnosticsEnabled: true`. `src/main/index.ts:549` reads that setting when
   initializing analytics. Both PostHog clients require a build-time key, so
   source defaults do not prove that a particular released build sends telemetry.
   A keyed build can initialize before the user visits Settings.
2. **Turning diagnostics off may still flush pending events.**
   `src/main/services/analytics.service.ts` calls `shutdownMainAnalytics()`, which
   clears the client reference and awaits `_shutdown()` to flush and close it.
   The renderer's `features/analytics/analytics-client.ts` uses
   `opt_out_capturing()`. No packet capture established residual SDK behavior.
   “When off, nothing is sent” is more absolute than the verified evidence.
3. **Automatic updates are independent of diagnostics.**
   `src/main/updater/auto-updater.ts` checks on startup, every six hours, and on
   eligible focus changes. It sets `autoDownload` and `autoInstallOnAppQuit` to
   true. The configured feed is `https://updates.kaipu.app/updates/`. Connections
   expose at least the source IP to the endpoint. Describe their purpose and
   controls separately; disabling diagnostics is not a network-off mode.
4. **Remote version configuration is another conditional connection.**
   `src/renderer/src/features/version-gate/use-version-gate.ts` fetches when
   `VITE_VERSION_GATE_URL` is configured. Its production value was not inspected.
5. **Resend is implemented but not named in the provider list.**
   `apps/server-hono/src/lib/email.ts` wires `ResendEmailProvider` when its key
   exists. `packages/infra-email/src/providers/resend.provider.ts` sends recipient,
   subject, HTML/text, and sender/reply-to data. If active in production, name
   Resend and link its privacy policy rather than describing email providers only
   as a possible future addition. Production activation was not verified.

The privacy text already describes installation identifiers, technical events,
error messages, stack traces, and possible paths/file names. The reviewed config
disables session recording, automatic click capture, and automatic pageviews.
This is evidence of intended controls, not proof that every error payload is
free of sensitive data.

### Public policy deployment differs from the repository

On 2026-10-19, fetching [the public privacy policy](https://kaipu.app/legal/privacy-policy)
returned **Version 2026-09-14**, while the reviewed message files contain
**Version 2026-10-18** and the new sections. The cause (deployment, cache, or
another delivery issue) was not established. Treat this as a dated observation,
not a permanent statement about production. Re-fetch after deployment: a reviewer
sees the public URL, not a merged PR.

### Dependency and resource sample

The desktop package manifest and lockfile were inspected, and selected exact
versions were queried through `npm view <package>@<version> license`:

| Dependency          | Evidence observed                      | Limit                                                                  |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Electron 39.2.6     | MIT package metadata                   | Does not audit every bundled Chromium/native notice                    |
| Mediabunny 1.61.4   | MPL-2.0                                | OSS, not a proprietary component; retain applicable obligations        |
| gifenc 1.0.3        | MIT                                    | Sample only                                                            |
| uiohook-napi 1.5.5  | MIT package metadata                   | Inspect native upstream components separately                          |
| posthog-node 5.38.6 | MIT                                    | Sample only                                                            |
| posthog-js 1.395.0  | Metadata says `SEE LICENSE IN LICENSE` | Upstream LICENSE inspected; exact packaged notice still needs checking |

The [PostHog JS upstream LICENSE](https://github.com/PostHog/posthog-js/blob/main/LICENSE)
contains Apache-2.0 and MIT component notices. That moving upstream source is not
a substitute for checking the exact shipped package. Using a hosted analytics
service does not by itself make the SDK proprietary.

Visible desktop resources include icons and brand SVGs in
`apps/kaipu-record/resources`, `src/renderer/src/assets/brand`, and
`packages/brand/assets`. No explicit restrictive license was found in the reviewed
resources; authorship and provenance were not independently established.

**No obvious closed component was identified, but absence has not been certified.**
Audit the final package's transitive dependencies, native libraries, resources,
and notices. In particular, confirm inclusion of the AGPL and third-party notices
and a clear source offer. The `nsis.license` privacy notice is not a replacement
for the software license. No explicit packaging of the repository-root `LICENSE`
was found in the reviewed configuration; the binary must settle what is present.

### Premium functionality

No closed premium implementation was identified in the inspected desktop source.
Subscription models still contain `watermarkRemoval` in
`packages/domain/src/schemas/subscription.ts`; this does not prove that current
exports are gated or that any code is proprietary. A plan-gated function and a
closed-source function are different questions. A complete shipped-artifact
audit remains necessary.

### Remaining SignPath conditions

| Requirement from the published terms                          | Evidence and remaining verification                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Own project and repository control                            | Kaipu has a maintained source repo; ownership/authorized signing team must be established with SignPath                   |
| Already released in the relevant form                         | Public `desktop-v0.13.0` includes a Windows NSIS EXE; signature/install behavior was not inspected                        |
| Functionality documented                                      | README and website exist; ensure Windows claims match the released platform capabilities                                  |
| No malware, unwanted software, or prohibited hacking features | No such purpose identified in the reviewed code; not a malware/security certification                                     |
| MFA                                                           | Required for all team members on both repository access and SignPath; private settings not verified                       |
| Authors, reviewers, approvers                                 | Publish roles and members; roles do not necessarily require three different people                                        |
| Review contributions from non-committers                      | Collaborator-only PR access alone does not prove required reviews occurred                                                |
| Every signing request manually approved                       | Not implemented by the reviewed workflow; a draft GitHub release is not signing approval                                  |
| Verifiable build from source                                  | CI build exists, but SignPath provenance integration is pending                                                           |
| Product metadata enforced                                     | `productName: Kaipu Record` and package version exist; SignPath restrictions and actual PE attributes need validation     |
| Upstream binaries not signed as Kaipu's own                   | Unsigned OSS dependencies may be included in a signed installer; restrict the signing configuration to eligible artifacts |
| System changes announced                                      | Review installer shortcuts, updater behavior, and actual warnings; configuration does not demonstrate what the user sees  |
| Uninstallation                                                | NSIS configuration and the notice contemplate uninstalling; test the actual Windows install/uninstall path                |
| Public code signing policy                                    | No policy found in the reviewed website source; add required wording, roles, and privacy links                            |
| Investigate complaints and accept constraints                 | Operational commitment required; not demonstrated by source                                                               |
| Reputation and discretionary acceptance                       | SignPath requires verifiable reputation and reserves acceptance/rejection; technical compliance is not an entitlement     |

`apps/kaipu-record/scripts/sign-windows.cjs` has no SignPath implementation. Its
other vendor paths are unfinished, and absent signing configuration deliberately
produces an unsigned build. `.github/workflows/release-desktop.yml` builds on CI
and publishes artifacts, but does not implement the SignPath request/approval
flow. Confirm metadata restrictions and the handling of third-party binaries
before enabling signing.

## AGPL obligations for Cloud

### The backend is part of the published AGPL project

The conclusion is not based only on directory proximity:

- the README licenses the project under AGPL;
- `apps/server-hono` consumes `@kaipu/application` and `@kaipu/domain`, declared
  AGPL-3.0-only;
- `apps/documentation/src/content/docs/marketing/open-source.md` explicitly records
  opening the whole monorepo, including the server;
- no proprietary-backend exception was identified.

Some historical status statements in that document are stale; its explicit scope
decision is the relevant evidence here, not its old claim that the repo is private.

### Network source obligations: the precise rule

[AGPL §13](https://github.com/niway-dev/kaipu-record/blob/aab31002/LICENSE#L194-L198)
says:

> if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network [...] an opportunity to receive the Corresponding Source of your version [...] at no charge

Two qualifications matter:

1. The provision explicitly addresses **modified versions**. Running any AGPL
   program does not automatically force disclosure of all unrelated company code.
2. A holder of all rights in its own code is not in the same position as a
   licensee relying on permission for someone else's code. See the
   [FSF FAQ on developers and GPL obligations](https://www.gnu.org/licenses/gpl-faq.html#DeveloperViolate).
   Do not assume Niway controls every relevant right without reviewing provenance
   and contributions; the history's ownership claim alone is not a rights audit.

For the declared open-service model, provide a prominent source link to the
**version actually deployed**, including covered modifications and necessary
build/install material. A public repository is helpful but does not establish
that it matches production or that the offer is prominently accessible to all
interacting users. Consider users of shared Cloud content as well as signed-in
account holders when determining who interacts with the covered service.

### What source availability does and does not entail

Corresponding Source includes the covered work and material needed to build,
install, run, and modify it under AGPL §1. Provide documented example configuration
so someone can operate their copy with their own credentials.

It does not require publishing users' recordings, the production database,
passwords, tokens, signing private keys, Cloudflare accounts, or R2's internal
implementation merely because it is an external service. It does not grant free
access to Niway's storage or infrastructure. Independent services do not become
one covered work merely by sharing a repository or communicating over a network;
actual integration and license scope matter.

Charging for hosted storage and features is compatible with this model. A
competitor may also operate an AGPL-compliant copy on its own infrastructure and
charge for it. **AGPL requires applicable sharing; it does not prohibit competition.**
It does not automatically authorize presenting that competitor as an official
Niway service or using Niway's infrastructure without authorization.

Desktop binaries have a separate corresponding-source obligation under AGPL §6.
For downloads, §6(d) calls for equivalent source access with clear directions next
to the binary. Link source corresponding to each release rather than relying
solely on a moving `main` link.

## Ordered follow-up checklist

All items below are **pending proposals**, not completed remediation.

1. [ ] Resolve `AGPL-3.0-only` versus “v3 or later,” and verify relevant ownership;
       account for rights already granted rather than treating this as formatting.
2. [ ] Review the bilingual license clause and related terms' scope; keep account
       age requirements separate from AGPL software rights and clarify “18 and
       local majority.” Obtain Spanish legal review before publication.
3. [ ] Implement an effective installation-time diagnostics choice, persisted
       before the first possible send. Confirm SignPath's expectations for policy
       presentation in the installer.
4. [ ] Update and deploy the privacy policy: toggle, pending-event behavior,
       automatic updates/version checks, and Resend if active. Re-check the public
       URL, both languages, and displayed version after deployment.
5. [ ] Audit the final Windows package: transitive/native licenses, asset
       provenance, included license notices, actual outbound traffic, installation,
       system-change notices, and uninstallation.
6. [ ] Provide visible, version-matched source access for desktop downloads and
       Cloud, with build instructions and non-secret example configuration.
7. [ ] Publish the Code signing policy in the locations SignPath requires, with
       team roles/members, privacy links, and attribution coordinated with acceptance.
8. [ ] Configure MFA, reviews, manual signing approval, build provenance, enforced
       product metadata, and exclusion of upstream binaries from the project's own
       signatures. Integrate SignPath into the release pipeline.
9. [ ] Apply with an accurate description of the free AGPL app, optional paid
       Cloud, open backend, current release, and remaining verification evidence.

## How to review and reproduce the assessment

1. Read the baseline's `LICENSE`, both message files under `legal`, and the cited
   SignPath sections side by side. Distinguish express conditions from this
   document's recommendations and unresolved interpretation.
2. Inspect the settings default, both analytics clients, updater, version gate,
   installer notice, and signing hook at the baseline commit. Source inspection
   establishes implementation intent, not runtime network behavior.
3. In a clean Windows environment, test the eventual installer before first
   launch, with diagnostics enabled/disabled, and during opt-out with queued
   events. Capture destinations and payload categories, distinguishing update,
   authentication, explicit upload, and diagnostics traffic. Verify uninstall.
4. Inspect the built package's licenses and executable metadata. Check every
   artifact selected for signing against SignPath's own-binaries requirement.
5. Re-fetch the public policies and verify source offers against the exact
   deployed/released versions. Re-check SignPath terms before applying.

Automated formatting, type checks, or app tests do not validate legal conclusions,
private MFA settings, SignPath acceptance, or real installer behavior. Keep these
verification limits visible when turning the review into implementation work.
