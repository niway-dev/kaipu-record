---
title: Audit 2026-10-15 — fix plans index
description: One implementation plan per root cause for every finding of the 2026-10-15 pre-deploy audit. Every finding maps to exactly one plan; the PR that ships a plan deletes it.
---

# Audit 2026-10-15 — fix plans

Source: the
[audit report](/audits/2026-10-15/report/) (78 findings, 68 distinct). Each plan closes one
root cause and lists the findings it retires. Batches follow the report's fix order: measure first,
then data loss, then the Library fan-out, the trim handle, recording failure paths, and render cost.

Plans are working documents: the PR that implements one links it and deletes it (git keeps it).
Each plan is executable by an engineer with zero context — files, code, tests and commits are
spelled out. Where a plan says "Reference" it means the analysis the plan was written from; those
analyses are not in the repo.

## Where the plans and their status are

Each plan is its own page in this folder, listed in the sidebar under Plans. What has shipped is
tracked in Linear (NIW2-381 to NIW2-422) and in the PR that deleted each plan, not in a table
here: a status table edited by every shipping PR was a merge-conflict magnet.
