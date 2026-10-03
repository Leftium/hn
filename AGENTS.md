# Agent instructions

<!-- leftium:continuum:start -->
## Continuum

This repository uses the Continuum multi-agent workflow.
Read `CONTINUUM.md` before coordinating or modifying work.
For an active Continuum PR, its standing authorization covers routine in-scope, non-destructive repository actions where the harness permits repository policy to grant approval; project-specific and higher-precedence restrictions still apply.
<!-- leftium:continuum:end -->

## Verification

For code changes, default to `pnpm test`, `pnpm check`, and `pnpm lint`.
Use focused verification for clearly bounded changes when appropriate. Changes involving
server-side fetching, deployment behavior, or live upstream integration should also verify
the relevant runtime path without turning live Hacker News requests into routine CI traffic.
