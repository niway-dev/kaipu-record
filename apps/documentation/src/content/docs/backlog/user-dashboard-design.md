---
title: User dashboard design on kaipu.app
description: A visual redesign of the signed-in /dashboard (home, library, profile, settings, and proposed devices and billing slots) so it matches the new auth screens, and the Claude Design prompt to design it.
---

# User dashboard design

> **Status: 🔵 Proposed (2026-10-19).** Linear: NIW2-473 (related: NIW2-470, NIW2-220). The
> defaults below are recommendations; the owner has not answered the open questions yet. The
> Claude Design prompt is ready; no design or code exists for the redesign.

The signed-in dashboard works (NIW2-470, see [web dashboard](./web-dashboard)), but it still uses
the plain `@kaipu/web-ui` cards and a tab strip. The new sign-in and sign-up screens in Claude
Design (`Kaipu Web Auth.dc.html`) use the brand's full visual language: Geist and Instrument
Serif, the pink accent, Kai the fox, the dot grid and the radial glow. Someone who signs in on
that page lands on a dashboard that looks like a different product. This page records what the
dashboard really has, what is planned, and the prompt to design one "Kaipu Dashboard" file that
covers every page and state.

## What exists today (on `main`)

Routes live in `apps/web-hono/src/routes/_authenticated/dashboard/`, components in
`src/components/dashboard/` and `src/components/account/`.

| Page                    | Shipped content                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout                  | A horizontal sub-navigation: Home · Profile · Settings · Recordings (`dashboard-nav.tsx`), under the site header.                                                                                                                                                                                                                                   |
| `/dashboard`            | One-time "Your account is ready" card (per user per browser); "Hi, {name}" + "Signed in as {email}"; unverified-email notice with resend (2-minute cooldown) and refresh; a one-time "We removed an old password" banner; plan and storage summary (one line + bar, full states when unhealthy); Get started with the OS-detected desktop download. |
| `/dashboard/profile`    | Name (1–80 chars), email + Verified badge, verification notice; Sign-in methods from `listAccounts` (Email and password, Google, "Linked {date}"), Change password (signs out other devices), Connect / Disconnect Google (never the last method), Set a password for Google-only accounts; OAuth error alert.                                      |
| `/dashboard/settings`   | Plan and storage (full card: used, reserved, available, uploads in progress, per-video limit, every state); Language switcher; Danger zone (delete with 7-day grace and Restore; a disabled "Coming soon" button while the flag is off).                                                                                                            |
| `/dashboard/recordings` | The legacy recordings table (title, kind, duration, size, open, delete) on the old `recording` API. Loading, error and empty states.                                                                                                                                                                                                                |

### Data the UI can show

- **Plan and storage**: `GET /api/v1/me/entitlements` (`plan` `free`|`pro`, `status`,
  `currentPeriodEnd`) and `GET /api/v1/me/storage` (`capacityBytes`, `usedBytes`,
  `reservedBytes`, `availableBytes`, `pendingUploads`, `uploadsEnabled`, `cloudUploads`).
  `@kaipu/domain/capacity` turns them into a `CapacityView`: `loading`, `error`,
  `session-expired`, `not-available`, `beta-unavailable` (no cloud: email not verified), or
  `usage` with `staleSince` (a failed refetch keeps the last numbers) and `suspended` (the global
  upload switch is off). Over quota = used + reserved above capacity; almost full = 90% committed.
  A failure never renders as "0 B used".
- **Sign-in methods**: Better Auth `listAccounts` (`providerId`, `createdAt`).
- **Sessions** (not used yet): Better Auth `listSessions` returns `userAgent`, `ipAddress`,
  `createdAt`, `expiresAt` per session. Since [ADR 0025](/architecture/decisions/0025-desktop-signs-in-through-the-browser/)
  every desktop sign-in is its own session row, so a "Your devices" page can list and revoke
  them. In Better Auth 1.7 `/list-sessions` sits behind `freshSessionMiddleware`: a session older
  than `freshAge` (one day) gets a 403 and must sign in again.
- **Recordings**: the legacy list only. The cloud assets library (NIW2-221, spec review) replaces
  it with thumbnails, kind, duration, size, date, an "In cloud" state, open, download and
  delete-cloud-copy.

### Planned, not shipped

- Cloud assets library and its rename to `/dashboard/library` (NIW2-221); the in-page player
  (NIW2-222).
- Sharing: access modes (NIW2-216, PR #265 design) and share by email (NIW2-223).
- Billing and checkout. `kaipu://billing/refresh` is reserved in the desktop deep-link router and
  does nothing yet. No payment provider is chosen; no prices exist.
- Plan values are in flux. `main` gives Free 1 GB and Pro 25 GB (`deriveEntitlements`).
  NIW2-232 (PR #273, open) changes them to the owner's decision: Free 250 MB (verified email),
  Pro 15 GB, with an owner-approved expansion to 1 GB. The design must show the server's numbers,
  never hard-code them.
- Account deletion server side (NIW2-214, PR #268): the danger zone stays behind a flag until it
  lands.

## Options considered

1. **Left sidebar on desktop, bottom tab bar or drawer on mobile (recommended).** Room for six
   destinations (Home, Library, Profile, Settings, and later Devices and Billing) without
   crowding, and it reads as "the app" rather than another marketing page. Against: more change
   from today's tab strip; the site header has to step back (logo + user menu only).
2. **Keep the top tab strip, restyled.** Smallest change. Against: six tabs plus "coming soon"
   ones overflow on mobile, and the strip under a marketing header keeps the "two products" feel.
3. **Single long page with anchored sections.** Simple. Against: the library is a full page with
   pagination; mixing it with forms makes both worse.

## Open questions (defaults if unanswered)

1. **Sidebar or top tabs?** Default: sidebar (option 1).
2. **Does Devices ship now?** It needs only Better Auth's own endpoints, but the one-day
   freshness rule means many visits will see "sign in again to see your devices". Default: design
   it now, build it as a follow-up ticket after the redesign; until then the slot shows "Coming
   soon".
3. **What does Home show before the cloud library exists?** Default: greeting, verification
   notice, storage summary and Get started, plus a "Recent in your library" block drawn in the
   design but hidden in code until NIW2-221 lands. No fake recent items.
4. **Does Recordings stay legacy until NIW2-221?** Default: yes. Keep the label "Recordings" and
   the table on the legacy API; the design shows the target "Library" grid so NIW2-221 can build
   it directly, and the rename happens with NIW2-221.
5. **Billing: placeholder or hidden?** Default: hidden in code. The design draws the slot only to
   reserve its place in the navigation, muted and labelled "Coming soon". The plan card's
   "Upgrade" action is not shown until a provider and prices exist.
6. **Profile and Settings split.** The web dashboard doc flags it as an assumption. Default: keep
   it (Profile = who you are and how you sign in; Settings = plan, language, account).

## Claims to verify before building

- **Plan names and capacities** depend on PR #273. Free 250 MB and Pro 15 GB are the owner's
  decision on that PR; `main` still says 1 GB and 25 GB. The prompt uses illustrative numbers
  only.
- **Desktop installed or not.** The web cannot see the installed app. The only signal is a
  session whose user agent is the desktop app. What user agent the desktop exchange records was
  not checked; if it is a generic runtime string, "installed" cannot be detected and Home always
  shows the download.
- **Windows beta download.** Get started offers "Windows (beta)" on `main`. The brand rule says not
  to market Windows as available until its release conditions are met; confirm the beta link
  stays.
- **Session revoke endpoints** (`revokeSession`, `revokeOtherSessions`) and their freshness
  requirements in Better Auth 1.7 were not checked; only `/list-sessions` was.
- The Web Auth design file's brand panel says "Your library on every Mac and PC". That is not
  true today (no Windows release, no cloud library); keep it out of the dashboard.

## Claude Design prompt

Paste this into the Kaipu project in Claude Design (the one with `Kaipu Web Auth.dc.html`). It
follows [brand identity](/marketing/brand-identity/) and the project's
`docs/landing-design-system.md`.

```text
Design "Kaipu Dashboard": the signed-in area of kaipu.app, the website of Kaipu
Record, a desktop screen recorder and screenshot tool for people who build
software. Someone who just signed in on the new auth screens (see "Kaipu Web
Auth.dc.html" in this project) lands here. It must look like the same product as
those screens. Recording never needs an account: the account is only for Kaipu
Cloud (a private copy of files and, later, share links). The dashboard must make
that clear without nagging.

## Output
One file, "Kaipu Dashboard.dc.html", built like "Kaipu Web Auth.dc.html": a
framed page preview (1200x760 desktop, 390x844 mobile phone frame) with a state
switcher above it (monospace pill buttons, active one in pink) and a row of short
design-note cards below it. The switcher has one button per state listed under
"Screens and states", plus toggles: Mobile, Dark/Light, ES (Spanish copy), and
Desktop app: unknown / signed in. Reuse that file's theme tokens and component
style (fields, buttons, pill tabs, notices).

## Brand (follow strictly)
- Name: Kaipu (site kaipu.app). Signature: "This. Captured." Promise:
  "Show it. Get back to work." Do not invent new taglines.
- Type: Geist 400–700 for UI and headings (tight tracking on headings), Geist Mono
  500–600 for data, labels, sizes and dates (uppercase labels, .14em tracking),
  Instrument Serif italic in pink text only for a short second voice in page
  headings and empty states, never in data or buttons.
- Colors, as tokens (dark / light):
  --bg #0b0b0d / #faf8f5, --bg2 #111114 / #f2efea, --card #141417 / #ffffff,
  --card2 #1e1e23 / #ece9e4, --field #18181c / #ffffff,
  --bd rgba(255,255,255,.08) / rgba(20,20,22,.09),
  --bd2 rgba(255,255,255,.15) / rgba(20,20,22,.17), --tx #f4f4f6 / #141416,
  --dim #a1a1aa / #4f4f57, --faint #6e6e77 / #76767f,
  --dot rgba(255,255,255,.05) / rgba(20,20,22,.07). Accent pink #F6055C for
  primary buttons and the active nav item; pink text uses --pinkTx #ff3a7c (dark)
  / #d8004d (light) for contrast. Errors #ef4444. Light theme is warm off-white,
  not pure white. Both themes are first-class.
- Effects: "glow where there is a moment, never where there is a task". Radial
  pink glow (opacity .08–.12) and the 22px dot grid only on the first-visit
  welcome, empty states and the "desktop not installed" card. Data cards, forms
  and tables stay flat: hairline borders, no glow. Primary buttons get the pink
  colored shadow (0 12px 28px -12px rgba(246,5,92,.9)).
- Kai the fox: flat black fox bust on pink with cream eyes. Use the project's
  assets: assets/kaipu-fox-icon.png (logo in the sidebar), assets/fox-wave.png
  (first visit), assets/fox-happy.png (email verified), assets/fox-cloud.png
  (storage / cloud empty), assets/fox-noresults.png (empty library),
  assets/fox-error.png or fox-oops.png (load errors), assets/fox-shield.png
  (devices / security), assets/fox-paused.png (uploads paused),
  assets/fox-capture.png (get the desktop app). At most one fox per screen, never
  as a chatbot or assistant, no constant animation (one gentle float on the
  first-visit welcome is fine).
- Voice: attentive, capable, warm, careful. Short sentences, specific words, no
  hype. Errors are never jokes. Always say local files are safe when cloud fails.
- Never show planned work as available. Planned items get a muted treatment:
  --faint text, a dashed border, a small mono "COMING SOON" tag, not clickable,
  no dates.

## Layout
- Desktop: a left sidebar (~240px) on --bg2 with the Kaipu fox logo + "Kaipu" at
  the top, then navigation: Home, Library (label "Recordings" in the legacy
  state, see below), Profile, Settings; a divider; Devices and Billing as muted
  "Coming soon" items. At the bottom: the user (initial avatar, name, email),
  theme toggle, language (EN/ES), Sign out. Active item: --card2 pill with a pink
  left marker or pink icon. Content column max ~880px, generous spacing.
- Each page opens with a heading: one sans bold phrase, optionally followed by a
  short pink serif italic phrase (e.g. "Hi, Ana." + "Good to see you."), and a
  one-line description in --dim.
- Mobile (390): a compact top bar (fox logo, page title, avatar menu) and a
  bottom tab bar with Home, Library, Profile, Settings; Devices and Billing live
  in the avatar menu as muted items. Cards stack full width with a 16px gutter.
  No horizontal scroll; the library becomes a list.
- Spanish strings run ~20–30% longer than English: buttons and nav labels must
  wrap or grow, never truncate. Show the ES toggle working on at least Home and
  Settings. Real Spanish examples: "Hola, Ana", "Plan y almacenamiento",
  "Reenviar correo de verificación", "Zona de peligro".

## Real data (use only these fields; values are illustrative)
- User: name (1–80 chars, may be empty: then greet with the part of the email
  before "@"), email, emailVerified.
- Plan: name Free or Pro, optional "until {date}" (currentPeriodEnd). Capacity,
  used, reserved ("In progress (reserved by uploads)"), available, uploads in
  progress count, per-video limit ("Up to 1 GB per video"). All numbers come from
  the server in decimal units (1 GB = 1,000,000,000 bytes). Use illustrative
  values such as "Plan Free · 250 MB", "162 MB used of 250 MB", and mark them as
  sample data in a design note: plan sizes are being finalised; never present a
  price, and never hard-code a capacity into copy.
- Sign-in methods: "Email and password" and/or "Google", each with "Linked {date}".
- Sessions (proposed Devices page): user agent (show as a friendly device line
  like "Kaipu Record · macOS" or "Chrome on macOS"), approximate IP, signed in
  {date}, expires {date}, and "This browser" on the current one.
- Library (target, NIW2-221): thumbnail (or a kind placeholder icon), title, kind
  (Recording / Screenshot / Export badge), duration m:ss for videos, size, date,
  "In cloud" badge. Legacy table today: title, kind, duration, size, open,
  delete.

## Screens and states (each one is a switcher button)

### Home (/dashboard)
1. Home · first visit: a welcome card with fox-wave, glow and dot grid: "Your
   account is ready" + "You're on the Free plan with 250 MB of cloud space." and
   a "Got it" button. Shown once; the rest of Home below it.
2. Home · regular: greeting ("Hi, Ana" + "Signed in as ana@…"), a compact
   "Plan and storage" card (plan line, two-segment bar: used solid pink, reserved
   pink 40%, "162 MB used of 250 MB", "Manage" link to Settings), and the desktop
   card. Optional "Recent in your library" row drawn as COMING SOON (muted, no
   fake items) until the cloud library exists.
3. Home · email not verified: a notice at the top: "Cloud is locked until you
   verify your email. Recording keeps working on this device." with "Resend
   verification email"; after sending, "Verification email sent. You can ask for
   another one in about 2 minutes." with the button disabled and a "Refresh"
   button. The storage card shows "Verify your email to use cloud" instead of a
   bar.
4. Home · desktop not signed in yet (default, also "unknown"): a "Get started"
   card with fox-capture: "Kaipu records on your computer. Install the desktop app
   and sign in with this account to upload recordings to your cloud space." One
   primary button for the detected OS ("Download for Mac (Apple Silicon)"), then
   "Other downloads: Mac (Intel) · Windows (beta)". Unknown OS (phone, tablet,
   Linux): three equal outline buttons.
5. Home · desktop signed in (proposed): the card shrinks to a confirmation row:
   "Kaipu Record is signed in on 1 device" with a link to Devices and a quiet
   "Download again" link. Note in a design card: this is only known from a
   desktop session, so it may stay "unknown".
6. Home · old password removed: a one-time banner "We removed an old password
   from your account" / "For your security, we removed the password set before
   your email was verified. Set a new one in Profile to use the desktop app." with
   "Set a password".

### Plan and storage module (Settings full card; Home compact card)
Design every state; none may show zeros or an empty bar for a failure:
7. Storage · loading: a pulsing bar skeleton, screen-reader text "Checking your
   cloud space…".
8. Storage · healthy: plan line ("Plan Free · 250 MB", Pro may add "· until
   {date}"), the bar, a three-column mono stat row Used / In progress (reserved
   by uploads) / Available, "1 upload in progress" when there is one, and the
   footnote "Up to 1 GB per video."
9. Storage · almost full (90%+ committed): bar near full, passive notice "Almost
   full" / "You've used most of your cloud space. Delete files you no longer need
   to make room."
10. Storage · over quota: bar clamped at 100% in red, notice "You're using more
    than your plan includes" / "New uploads are blocked. Your files stay
    available to view, download and delete."
11. Storage · stale: last numbers kept, a "Not up to date" tag, "Last checked 12
    min ago. This is the last known figure, not a confirmed one." and "Refresh".
12. Storage · error: no bar. fox-error, "Couldn't load your cloud space" / "Your
    files are safe. Try again in a moment." and "Retry".
13. Storage · uploads paused: numbers kept, notice with fox-paused "Uploads are
    paused right now" / "Nobody can upload at the moment. What is already in
    cloud stays safe."
14. Storage · session expired: "Your session expired" / "Sign in again to see
    your cloud space. Local files are not affected." and "Sign in again".
15. Storage · not available: "Cloud storage isn't available yet" / "Your plan
    includes cloud space, but this server doesn't offer uploads yet. Everything
    keeps working locally."

### Library (/dashboard/recordings today, /dashboard/library later)
16. Library · legacy (shipped): page "Recordings", a flat table (title, kind,
    duration, size, open, delete icons), plus its loading (three skeleton rows),
    error ("Failed to load recordings") and empty ("No recordings yet. Capture
    one from the desktop app and it will show up here.") variants.
17. Library · target (planned, label it "Design target – NIW2-221"): page
    "Library", kind filter chips (All / Recordings / Screenshots), a responsive
    thumbnail grid (list on mobile) with title, kind badge, duration, size in mono,
    date, "In cloud" badge; per item Open, Download, and "Delete cloud copy" in a
    menu; "Load more" at the end. Delete opens a dialog naming the file and its
    size: "If this file isn't on any of your devices, this deletes the last copy
    and it can't be recovered." plus "It will stop uploading automatically from
    your devices until you choose Upload again in the desktop app." No typed
    confirmation.
18. Library · empty (target): fox-noresults, glow, "Nothing in your cloud yet" +
    a serif line, "Cloud copies come from the Kaipu desktop app: Upload to cloud,
    or turn on automatic upload." and the download button.
19. Library · unverified: the verify-email notice above the empty list.
    Share actions (planned, NIW2-216/223) appear only as a muted "Share · Coming
    soon" item in the item menu.

### Profile (/dashboard/profile)
20. Profile · default: "Profile" card: Name field with "Save name" (disabled
    until changed; "Saving…", "Name updated", "Use between 1 and 80 characters."),
    Email with a "Verified" or "Not verified" badge. "Sign-in methods" card: rows
    "Email and password · Linked Oct 3, 2026" and "Google · Linked Oct 12, 2026",
    a "Change password" form (current, new, confirm; "Changing your password
    signs you out on your other devices."), and "Disconnect Google".
21. Profile · Google only: methods list shows only Google; "Disconnect Google"
    disabled with "Google is your only way to sign in. Set a password before
    disconnecting it."; a "Set a password" form ("Add a password to sign in to
    the Kaipu desktop app with your email.").
22. Profile · password only: "Connect Google" button with the Google mark.
23. Profile · errors: field-level errors in red under the field ("That is not
    your current password.", "The passwords do not match."), the OAuth error
    alert at the top after a failed Google round trip, and "For your security,
    sign in again to disconnect Google." (session not fresh).

### Settings (/dashboard/settings)
24. Settings · default: "Plan and storage" (full module), "Language" ("The
    language Kaipu uses on the web."; English / Español segmented control),
    "Danger zone" (red title; "Delete your account and the cloud files that
    belong to it. You have 7 days to change your mind." and a red "Delete
    account" button). No "Upgrade" button: billing is not available.
25. Settings · delete dialog: "Delete your account?" / "This will delete:" your
    profile; all your cloud recordings and screenshots, and their shared links;
    your sign-in methods. "3 cloud files and 1 upload in progress will be
    removed." "Files saved on your devices are not deleted." "Deletion happens
    after 7 days…" Type-your-email field, password field (hidden for Google-only
    accounts), Cancel and "Delete my account" (disabled until the email matches).
26. Settings · deletion scheduled: red notice "Deletion scheduled for October 26,
    2026" / "Your account and cloud files will be deleted then. Restore it before
    that date to keep everything." with "Restore".
27. Settings · deletion not available yet (today's default): the danger zone
    with a disabled "Coming soon" button.

### Devices (/dashboard/devices – proposed, not built)
28. Devices · list: fox-shield header, "Your devices" + "Where your account is
    signed in." One row per session: device line, approximate location from IP
    (optional, may be just the IP), "Signed in Oct 12", "Expires Nov 11", "This
    browser" tag on the current one, and "Sign out" per row; "Sign out of all
    other devices" at the bottom. Desktop sessions get the fox app icon, browsers
    a generic browser icon.
29. Devices · needs fresh sign-in: "For your security, sign in again to see your
    devices." with "Sign in again" (the list needs a sign-in from the last day).
30. Devices · only this browser: "Only this browser is signed in. Sign in from
    the Kaipu desktop app to see it here." with the download link.

### Billing (/dashboard/billing – planned)
31. Billing · placeholder: a muted page: "Billing" + "Paid plans are coming.
    Your Free plan keeps working." No prices, no plan comparison table, no
    checkout button.

## Accessibility
- WCAG 2.1 AA contrast in both themes (use --pinkTx for pink text). Visible focus
  ring: 3px rgba(246,5,92,.18) plus a pink border, as in the auth fields.
- The nav is a <nav> with the current page marked (aria-current). Storage bar
  has a text alternative ("162 MB used and 12 MB reserved of 250 MB"). Notices
  are passive status regions, not toasts; errors use role=alert next to the
  field they belong to. Touch targets at least 44px on mobile. Color is never the
  only signal (over quota also has text; badges have words).
- Respect reduced motion: no float, no pulse.

## Deliverables
- "Kaipu Dashboard.dc.html" with the switcher covering states 1–31, the Mobile,
  Dark/Light, ES and Desktop-app toggles, and 4–6 design-note cards below the
  frame explaining the key decisions (sidebar, no zeros on failure, what is
  coming soon, Devices depends on fresh sessions).
- Components visible in the file: sidebar item (active, idle, coming soon),
  page heading, card, notice (neutral, destructive), storage bar (healthy,
  almost full, over quota, stale), method row, session row, library item (grid
  and list), empty state, dialog.
- English copy by default (use the strings above verbatim where given); Spanish
  on the ES toggle.
```
