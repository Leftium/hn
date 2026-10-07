# PR Plan

Issue: #11

## Goal

Migrate `main` from repository-installed Continuum 0.3 to published stable Continuum 0.6.1 at `fab456f5cf6641f2e895d74d17156a98acdc76ef`.

The migration PR itself remains governed by Continuum 0.3 through review, plan finalization, and merge. The merge is the migration boundary; subsequent new implementation PRs bootstrap with external Continuum 0.6.1.

Note: `main` currently contains a stale root `PR-PLAN.md` left behind by merged SvelteKit 3 PR #10. This branch replaces that stale plan with the migration plan; finalization must remove the root plan entirely before merge.

## Scope

- Remove root `CONTINUUM.md`.
- Remove only the managed Continuum block from `AGENTS.md`; preserve the existing HN `Verification` policy.
- Before deleting `CONTINUUM.md`, preserve any HN-owned policy that exists there but is not already represented in `AGENTS.md`, including:
  - `main` as the accepted integration branch and PR target;
  - final merges remain user-controlled;
  - routine automated tests remain deterministic/local, with live Hacker News or other upstream traffic explicitly opt-in and request-minimized;
  - production-only/upstream-network failures should compare local and deployed behavior when practical and record enough status/response context to distinguish network, HTTP, unexpected-response, and parse failures.
- Consolidate that durable HN policy into project-owned `AGENTS.md` without copying generic Continuum 0.3 machinery.
- Remove `scripts/continuum-finalize-pr.sh`, `templates/PR-PLAN.md`, and other clearly vendor-managed 0.3-only Continuum support files/references.
- Remove stale operational references to deleted 0.3 files while leaving historical references intact.
- Do not rewrite historical issues, PR comments, leases, branches, tags, or merged PRs.
- Preserve the existing `continuum` GitHub label for discovery metadata.
- Do not install 0.6.1 files into the repository; new 0.6.1 PRs use the immutable external protocol pin.

## Verify

- Confirm installed 0.3 protocol/finalizer/template/managed-policy machinery and stale operational references are absent from the PR head, except intentional historical references.
- Confirm HN-owned project policy survives in `AGENTS.md` and no material project-specific rule is lost with `CONTINUUM.md`.
- Confirm the stale SvelteKit 3 root plan from PR #10 is not present in the final PR head; only this migration's temporary plan may exist before finalization.
- Run the repository checks appropriate for this workflow-only change and record results on the PR.
- Before merge, complete independent review, then remove only the temporary root `PR-PLAN.md` using the existing 0.3 cleanup-only finalization procedure or its authorized fallback if the helper has already been deleted.
