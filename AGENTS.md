# Agent instructions

## Verification

For code changes, default to `pnpm test`, `pnpm check`, and `pnpm lint`.
Use focused verification for clearly bounded changes when appropriate. Changes involving
server-side fetching, deployment behavior, or live upstream integration should also verify
the relevant runtime path without turning live Hacker News requests into routine CI traffic.

## Repository policy

- `main` is the accepted integration branch and pull request target.
- The user controls final merges.
- Keep routine automated tests deterministic and local. Tests that contact Hacker News or another live upstream must be explicitly opt-in and should minimize request volume.
- For production-only or upstream-network failures, compare local and deployed behavior when practical and record enough response/status context to distinguish network, HTTP, unexpected-response, and parse failures.
