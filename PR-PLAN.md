# Goal

Migrate HN Reader from SvelteKit 2 to stable SvelteKit 3 without changing product behavior.

# Scope

- Apply the current official SvelteKit 3 package/config/import/API migrations.
- Preserve existing HN fetch behavior and deterministic tests.
- Keep unrelated refactors and product changes out of this PR.
- Leave lockfile regeneration, full verification, deployment/runtime smoke, and cleanup to the verification phase/T3.

# Implementation

1. Upgrade Kit/adapter/Svelte minimums and add any migration-required tooling.
2. Move SvelteKit configuration into `vite.config.ts`; remove `svelte.config.js`.
3. Migrate `tsconfig.json` to `$app/tsconfig`.
4. Migrate `$lib` to package `#lib` imports.
5. Migrate removed Kit APIs used by this repo: `$app/environment`, `$app/stores`, hook/param types, shallow routing, and route param matcher structure.
6. Keep live Hacker News traffic out of routine verification.

# Verify

T3/review phase should run `pnpm install`, `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`, `pnpm knip`, official migrator cross-check, focused browser/runtime smoke, and deployed verification where appropriate.
