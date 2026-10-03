# Agent instructions

<!-- leftium:continuum:start -->
## Continuum

This repository uses the Continuum multi-agent workflow.
Read `CONTINUUM.md` before coordinating or modifying work.
After acquiring the write lease on a Continuum Draft PR, the issue and `PR-PLAN.md` provide standing authorization to carry the planned implementation through all checkpoints where the harness accepts repository policy as approval.
Run required formatting, tests, checks, builds, and plan-required package-manager commands without asking again. Commit and non-force-push each coherent checkpoint, then continue.
A checkpoint is a savepoint, not a default handoff. Ask only for operations outside standing authorization or decisions that materially change scope. Project-specific and higher-precedence restrictions still apply.
<!-- leftium:continuum:end -->

## Verification

For code changes, default to `pnpm test`, `pnpm check`, and `pnpm lint`.
Use focused verification for clearly bounded changes when appropriate. Changes involving
server-side fetching, deployment behavior, or live upstream integration should also verify
the relevant runtime path without turning live Hacker News requests into routine CI traffic.
