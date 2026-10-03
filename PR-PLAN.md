# PR Plan

Issue: #3

## Goal

Restore the affected Hacker News HTML-backed feeds, identify why production requests have been returning empty results for days, and make future upstream failures visible and diagnosable instead of silently becoming `stories: []`.

## Scope

- Investigate the current failure before choosing the transport/header fix.
  - Compare affected feeds locally and through the deployed/Vercel runtime.
  - Record status, content type, relevant headers such as `Retry-After`, response shape/fingerprint, and whether the body is normal HN HTML, a blocking/"Sorry" response, or changed markup.
  - Test the issue hypotheses: Vercel/datacenter egress blocking, request-header/User-Agent classification, parser drift, or another upstream/network failure.
- Add `wellcrafted` and change the scraped-feed boundary to return a typed `Result` with serializable error details.
  - Preserve distinct HTTP, network, parse, and unexpected-response classifications.
  - Do not rely on raw `Error` objects as the transported diagnostic.
  - Preserve successful earlier pages plus a warning/error detail if a later page fails, if the Result shape remains clear.
- Propagate scraper failure information through the page server load and render a compact user-facing diagnostic instead of an unexplained zero-story list.
- Add structured server diagnostics with enough context to diagnose future HN changes without logging full upstream pages.
- Fix the actual current production cause once identified.
  - A browser-like request may be compared diagnostically.
  - Do not implement escalating retries or anti-bot bypass behavior.
- Keep live HN checks opt-in and low-volume; routine tests must remain deterministic/local.

## Implementation notes

- Start from the existing `src/lib/fetch-hn.ts` behavior where non-2xx, thrown fetch errors, and zero parse matches currently collapse into loop termination.
- Verify the current Wellcrafted package API/version before coding; follow the issue's intended `Result<T, E>`, `defineErrors` / `InferErrors`, and `tryAsync` approach unless the installed current API requires a small equivalent adjustment.
- Treat a genuine empty list separately from a structurally recognizable HN page that unexpectedly produces zero parsed stories.
- Keep detailed upstream diagnostics server-side; UI messages should be actionable but compact.

## Verify

- Extend `src/lib/fetch-hn.test.ts` for:
  - HTTP 429 and other non-2xx responses;
  - thrown/network failures;
  - blocking/"Sorry" or otherwise unexpected responses;
  - recognizable HN HTML with zero parser matches;
  - later-page failure with any intended partial-result behavior;
  - existing ISO/legacy timestamps and pagination.
- Run `pnpm test`, `pnpm check`, and `pnpm lint`.
- Exercise affected feeds locally.
- Exercise the relevant deployed/preview runtime path and record the observed root cause and resulting behavior.
- If adding a live diagnostic command, keep it opt-in and verify it makes at most the intended bounded requests.
