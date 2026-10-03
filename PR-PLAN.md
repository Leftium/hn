# PR Plan

Issue: #3. Review finding: PR #6 review 5399720027.

## Goal and scope

Make UpstreamHttpError messages status-aware: 403/419 refusal, 429 rate limit,
5xx server error, and neutral wording for other statuses. Preserve the Result
contract, diagnostics, partial-page behavior, and request handling.

## Verify

Assert exact messages for refusal, rate limit, server errors, and another HTTP
status in the existing mocked-fetch regressions. Run pnpm test, pnpm check,
and focused formatting/ESLint checks. No additional live HN requests are needed
for this wording-only fix. Return Ready and remove this temporary plan after
review is otherwise clean.
