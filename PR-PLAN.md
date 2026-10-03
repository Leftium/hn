# PR Plan

Issue: #7

## Goal

Upgrade HN's installed Continuum workflow from 0.2.0 to the accepted 0.3.0-draft reference while preserving all HN-specific project and verification policy.

Use this PR as Pilot B for the Continuum 0.3 rollout: the first existing 0.2 installation upgraded after the successful pH clean-install pilot.

## Scope

- Update generic Continuum protocol text in `CONTINUUM.md` to the accepted 0.3 reference.
- Preserve the HN-specific project-policy section exactly in meaning.
- Replace only the managed Continuum block in `AGENTS.md`; preserve HN's verification section.
- Replace `templates/PR-PLAN.md` with the accepted 0.3 reference template.
- Replace `scripts/continuum-finalize-pr.sh` with the accepted 0.3 reference finalizer.
- Do not change HN application code, dependencies, deployment behavior, scraper logic, or unrelated formatting.

## Checkpoint A — protocol and discovery update

- Update `CONTINUUM.md` to 0.3 generic semantics while preserving HN policy.
- Update the managed `AGENTS.md` Continuum block while preserving unrelated instructions.
- Verify version and policy preservation.
- Commit and non-force-push the coherent checkpoint, then continue without yielding.

## Checkpoint B — plan/finalizer templates

- Update `templates/PR-PLAN.md` from the accepted 0.3 reference.
- Update `scripts/continuum-finalize-pr.sh` from the accepted 0.3 reference.
- Confirm the finalizer matches `Leftium/continuum/main` exactly.
- Confirm shell syntax and inspect for unrelated changes.
- Commit and non-force-push the coherent checkpoint, then continue without yielding.

## Checkpoint C — final verification

- Inspect the complete PR diff.
- Confirm HN-specific policy and `AGENTS.md` verification guidance are preserved.
- Confirm no HN application/dependency files changed.
- Record any 0.2→0.3 migration friction for `Leftium/continuum#9`.
- Release the write lease and mark Ready for independent review.

## Verify

- Continuum version is `0.3.0`.
- `templates/PR-PLAN.md` equals the accepted reference.
- `scripts/continuum-finalize-pr.sh` equals the accepted reference.
- HN-specific project/verification policy remains intact.
- Any repository CI/checks triggered by the PR pass.

The user controls final merge.
