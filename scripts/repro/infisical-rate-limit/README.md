# Infisical CLI rate limit under a normal dev workload

A reproduction for the Infisical team. With three local checkouts of one
repository (the main folder plus two git worktrees), restarting `bun dev` a few
times is enough to hit `429 Too Many Requests` from Infisical Cloud. While the
limit is active, every CLI call fails, and so do secret edits made at the same
time.

This used to be our everyday setup. Every `bun dev` fetched secrets through the
CLI when it started. It broke often enough that we moved to generating `.env`
files once with `bun env:pull` (commit `50b7f391`). The script below replays
the old start-up calls against a throwaway folder of fake secrets, so anyone
can run it on any project.

## What one `bun dev` start did

`turbo run dev` started four apps in parallel, with no retries:

| Consumer                                                    | Infisical calls                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 3 Cloudflare Workers (`console`, `server-hono`, `web-hono`) | `infisical export --path=<folder> --tags <app>`, once for each of 6 folders, in sequence. `export` has no `--recursive`. |
| Electron desktop app                                        | one `infisical run --tags kaipu-record -- electron-vite dev`                                                             |

That is **19 CLI calls per checkout per start**. A developer with three
checkouts who restarts dev after editing a value sends 57 calls in a few
seconds.

## Reproduce

Requirements: the Infisical CLI (tested with `0.43.138`), `infisical login`,
and a project you can create folders in.

```bash
cd <a directory with .infisical.json>   # or: export INFISICAL_PROJECT_ID=<id>
S=path/to/scripts/repro/infisical-rate-limit/repro.sh

bash $S setup        # creates /infisical-repro (6 subfolders, fake values)
bash $S flow 3 5     # 3 checkouts start dev at once, 5 times, 10 s apart
bash $S edit 90      # optional, in a second terminal: edits a value every 3 s
bash $S cleanup      # deletes /infisical-repro
```

`flow` prints a per-minute call count and every failure with its request ID.
`stress [workers] [seconds]` sends sustained parallel reads, if you want to find
the threshold instead of replaying the workflow. Set `INFISICAL_ENV` to use an
environment other than `dev`.

## Observed on 2026-10-20 (Infisical Cloud, US region)

All three runs used one user session on one machine.

**`flow 3 5`: three checkouts, five restarts.** 244 calls, 11 failures. The
fifth restart failed for every checkout: all nine Worker start-ups aborted at
their first export.

| Minute | Calls | Failed |
| ------ | ----- | ------ |
| 21:14  | 57    | 0      |
| 21:15  | 171   | 1      |
| 21:16  | 16    | 10     |

Sample request IDs: `req-us-XQ8caKRmCKtR7z` (21:15:14),
`req-us-PSwOguBX97KpC5`, `req-us-5A4uxvV3O5FEoc` (`infisical run`),
`req-us-UX4jEJFNTmVGbG`, `req-us-YjV6wNwXCuCwkK` (21:16:00–01). The first
said `Rate limit exceeded. Please try again in 15 seconds`; the 21:16 ones said
29–30 seconds.

**The same flow with two checkouts did not fail.** It sent 190 calls, at most
about 114 of them in one wall-clock minute.

**`stress 8 90` plus edits every 3 s.** 790 reads, 558 of them failed with 429.
The first failure came 11 s in, after 116 successful calls. While the limit was
active, `infisical secrets set` also failed: 6 of the edits succeeded and the
rest were rejected. Sample request IDs: `req-us-VrZSWu3Pc8GoB3`,
`req-us-392XE1gBB0W51L`, `req-us-LlvU92tJyFqb0q`. The `retry in` hint went as
high as 48 s.

## Questions for Infisical

1. What are the limit, the window and the scope (user, IP, project, or
   machine)? Our counts do not give a single number: the stress run was cut
   off after 116 calls, but the flow run got 171 calls through in one minute
   with a single failure.
2. Do web dashboard edits count against the same budget as CLI reads? The CLI
   `secrets set` calls clearly did.
3. Is `--recursive` support for `infisical export` planned? It would turn our
   six calls per consumer into one.
4. Could the CLI retry on 429 and honour the server's `retry in` value? Today a
   rate-limited `infisical run` makes the wrapped command fail to start.
