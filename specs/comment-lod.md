# Spec: Selective Comment LOD (Level of Detail) Rendering

**Status:** Phases 1–4 complete; Phase 5 (production UX actions, dev-UI removal) pending
**Replaces:** current `collapsedIds` / `microCollapsedIds` / `autoGroupedIds` / `threadChildIds` system in `src/routes/i/[id]/+page.svelte`

## Motivation

Current implementation is buggy and unpredictable:

- Comments change order when grouped
- Multiple overlapping sets (`collapsedIds`, `microCollapsedIds`, `autoGroupedIds`, `threadChildIds`) create state-consistency bugs
- Micro-collapse operates at parent level while collapse operates at self level — confusing mental model
- Hard to compose bulk operations (e.g. "collapse all except this thread")

Goals:

1. Single source of truth for per-comment render state
2. Composable primitives for bulk manipulation
3. Strict rendering order stability (LOD never reorders)
4. Foundation for richer filtering UX (by author, depth, search, new-since-visit)

## Terminology

- **Tree**: post + comments form a tree
- **Post**: root node at level 0. Always rendered as the story header (not a comment row). It participates in selectors as a parent of top-level comments; any LOD entry in `lodState` for the post is ignored by the renderer.
- **Level**: distance from post. Post is level 0, its direct children are level 1, their replies level 2, etc.
- **LOD** (Level of Detail): how a comment renders
  - **L** (Large): multiline, full text — default
  - **M** (Medium): single line, ellipsis-truncated
  - **S** (Small): colored block only (level-indicating); consecutive S rows in render order (regardless of level) group horizontally into a strip
- **Render order**: strict depth-first pre-order traversal of the tree. LOD NEVER reorders.

## State model

```ts
// Single source of truth
let lodState = $state<Map<number, 'L' | 'M' | 'S'>>(new Map());
```

- Key: comment id (post id also valid)
- Missing key ⇒ default `'L'`
- Every comment has exactly one LOD at any time (no overlapping sets)
- No map-size optimization: entries are set regardless of whether the value matches the default. Keeps `setLOD` branch-free and the map is small enough (≤ comment count) that it's a non-issue. In practice the default-L state will only exist briefly after load before Phase 4 initialization applies M/S to most comments.

Derived helper:

```ts
function getLOD(id: number): 'L' | 'M' | 'S' {
	return lodState.get(id) ?? 'L';
}
```

## Tree index

A `$derived` index over `item.comments`, rebuilt when the item changes. Selectors and the default-state initializer read from this index; they never walk the raw tree.

```ts
interface TreeIndex {
	parentOf: Map<number, number>; // comment id → parent id (post id for top-level)
	childrenOf: Map<number, number[]>; // comment id (or post id) → visible child ids in tree order
	levelOf: Map<number, number>; // post id → 0, top-level → 1, etc.
	allIds: number[]; // every visible comment id in depth-first pre-order (excludes post)
}
```

"Visible" matches the current `isHiddenComment` filter: dead comments are included (they render as `[dead]`); deleted/hidden leaves are excluded. The index reflects exactly what the renderer draws.

## Primitives

### Low-level: `setLOD`

```ts
function setLOD(ids: Iterable<number>, level: 'L' | 'M' | 'S'): void;
```

- Applies `level` uniformly to all `ids`
- Always writes to the map (no default-value cleanup, no special cases)
- Reactive: triggers rerender
- Post id may be written freely; the renderer ignores the post's LOD entry (see [Post rendering](#post-rendering))

### High-level: `toggleLOD`

```ts
function toggleLOD(id: number, override?: 'L' | 'M' | 'S'): void;
```

- If `override` given: sets directly to `override`
- Else: cycles current → next in `L → M → S → L`
- Operates on a single id (bulk callers compose via `setLOD`)

## Target selectors (pure functions)

Return `number[]`. Callers wrap in `new Set(...)` when set operations are needed.

```ts
self(id); // [id]
ancestorsOf(id); // [parent, grandparent, ..., post]
parentOf(id); // [parent] or []
childrenOf(id); // direct children
descendantsOf(id); // all descendants (excl. self)
subtreeOf(id); // [id, ...descendants]
siblingsOf(id); // same-parent comments, excl. self
allComments(); // every comment in the tree (excl. post)
```

### Inverse / composition

Use native ES2024 `Set` prototype methods (`union`, `intersection`, `difference`, `symmetricDifference`):

```ts
const everything = new Set(allComments());
const subtree = new Set(subtreeOf(id));
setLOD(everything.difference(subtree), 'S'); // "collapse everything except this subtree"
```

Optional sugar:

```ts
function complementOf(ids: Iterable<number>, universe = allComments()): Set<number> {
	return new Set(universe).difference(new Set(ids));
}
```

No custom wrappers for `union`/`intersection` — use native Set methods directly.

## Rendering

Strict depth-first pre-order traversal of the original tree. LOD state affects only _how_ each node renders, never _whether_ or _where_.

Each comment renders as an independent row, indented by level. A comment's LOD is **independent of its ancestors' LOD** — an L child under an S parent still renders as a full row at its own level. This may occasionally produce visually orphaned comments (L child with no visible parent context) but is rare in practice and keeps the rendering model trivial: traverse, render each node per its own LOD, done.

### Row layout

**L rows — meta below body.** The metadata strip (level badge, author, time, OP/NEW badges, LOD toggle buttons) renders **below** the comment body. Rationale: after reading a multi-line comment the user's eye lands near the bottom of the row, so placing interaction controls there shortens travel distance to the most common action (toggling LOD).

**M rows — single line, meta first.** Because M is a single truncated line, the body cannot share vertical space with a separate meta row without doubling row height. Instead, M renders meta **first** on the line (level badge, author, time, badges), then the body, which flex-grows and ellipsis-truncates to fill remaining space. This matches familiar folded-comment conventions (author/time prefix + preview text) and lets the eye scan meta columns consistently across runs of M rows. The body uses a smaller font (`--font-size-0`, matching the meta row) so more preview text fits per line. Dev UI is absolutely positioned at the right edge and takes no horizontal layout space — body ellipsis extends to the padding edge.

**S rows — no body.** Solo S rows (grouping disabled) or strips have no body; meta is not shown (the colored block IS the row).

### S-grouping rule

Consecutive S-state rows adjacent in render order (strict depth-first pre-order) collapse into a single horizontal strip, regardless of level. Any non-S row interrupts the strip. Tree order is always preserved.

Example render sequence:

```
[L] comment A (level 1)
▌▌▌▌   ← strip (4 S-comments of mixed levels, adjacent in render order)
[M] comment B (level 1, single-line, ellipsis)
▌▌     ← new strip (2 S-comments; first non-S row above broke the prior strip)
```

### S strip segment appearance

Each segment is a narrow clickable colored block. Width and color are determined by the segment's own level — same palette as the left accent bar of L/M rows at that level, and a width scaled to level (matching `--bar-width`). This means a strip of mixed-level S comments renders as a row of varying-width, varying-color blocks, each visually encoding its depth.

Strip layout:

- **Flush-left, no indent** — the segment-width profile reads as a pure compressed level sequence, uninterrupted by indentation whitespace.
- **No gap between segments** — segments pack tightly. A 1px inset box-shadow on each segment's left edge (using the row-separator token `light-dark(#e6e6df, #3a3a3a)` at 50% alpha) acts as a hairline divider: nearly invisible between different-color segments, clearly visible between adjacent same-color segments.
- **Square corners, full row height** — each segment stretches the strip's vertical extent with no radius, visually reading as a rightward extension of the left accent bar used on L/M rows.
- **Short row** — the strip row is much shorter than L/M rows (roughly a quarter of a text-row height) so long S runs read as a compact band rather than taking meaningful vertical space.
- **No wrapping** — `flex-wrap: nowrap` with `overflow: hidden` on the segment container. Segments that overflow the available width are clipped rather than wrapping to a second line.

Solo S rows (a single S comment between non-S rows) render as a 1-segment strip rather than a distinct row type, sharing the strip's layout, styling, and bulk-action path. The only visual difference from a multi-segment strip is segment count. (The `?group=0` debug path is the exception — see below.)

### Click-to-toggle (production)

Rows are click-interactive without any explicit control. The rule is intentionally asymmetric:

- **Click an L row** → set that comment to M
- **Click an M row** → set that comment back to L
- **Click any strip segment** → set **all** segments in that strip to M (bulk promotion — a click on a strip means "I want to read this compressed region", not "exactly this one id")
- **No click path leads to S** — downgrading to S is reserved for the dev UI (`?dev=1`) and, later, Phase 5 collapse gestures (subtree collapse, "focus this thread" off-thread collapse, etc.). This keeps the default click idiomatic (expand / un-expand) and prevents accidental over-collapse during casual reading.

Implementation: a single `onclick` on the `<d-comment>` element delegates to `onRowClick(e, id, lod)`, which bails when `e.target.closest('a, button, input, textarea, [contenteditable]')` matches — so nested links, buttons (including dev UI), and any future interactive elements keep their native behavior. Strip segments are `<button>` elements with their own click handler calling `setLOD(allStripIds, 'M')`. The row has `cursor: pointer`; nested links and buttons override the cursor automatically. Keyboard/ARIA affordances are deferred to Phase 5.

### S-grouping toggle (dev/debug)

A module-level flag `sGroupingEnabled` (default `true`) controls whether adjacent same-level S rows merge into a strip. When `false`, every S comment renders as its own row showing a small colored block where the body would be, with no horizontal merging.

Toggleable via URL query parameter `?group=0` for a session. Useful during development to:

- Verify each S row has independent click-to-cycle behavior (1 row = 1 id)
- Cross-check `lodState` entries per id without the strip abstraction
- Inspect strict pre-order rendering directly

Production default is `true`; the flag is not exposed in production UI.

### Dev UI toggle (dev/debug)

A module-level flag `devUiEnabled` (default `false`) gates the per-row/per-strip LOD toggle buttons (`<s-lod-dev>`) and the `data-index-level` debug attribute. Without the flag these aren't rendered at all, keeping the production DOM clean.

Toggleable via URL query parameter `?dev=1` for a session. When enabled, the toggle buttons appear at the viewport-left gutter of each row (absolute-positioned, `left: 0`, vertically centered). They overlap the accent bar and indent area at deeper levels; this is intentional and acceptable for a debug-only affordance. Independent of `?group=0`.

### Post rendering

Post is always rendered as the story header, not a comment row. Its LOD entry in `lodState` (if any) is simply never read — the renderer has a dedicated code path for the post. Post gets the same UI controls as comments so post-level actions (e.g. "collapse all level ≥ 2") have a home, but those controls affect descendants via selectors, not the post's own rendering.

## Implementation phases

### Phase 1: Remove legacy implementation ✅

Completed via revert rather than quarantine. The old collapse / micro-collapse implementation was removed by resetting `src/routes/i/[id]/+page.svelte` to its pre-collapsing state (commit `09d4a22`).

Reference implementation remains accessible in git history:

- `f5f2362` — initial collapse feature
- `464c9f8` — animated collapse with scroll anchoring
- `0aa129f` — micro-collapsed color strip
- `a39ddc7` — decoupled micro-toggle + 3-state cycling
- `228a02e` — expand/collapse-all button
- `284b873` — auto-group non-thread siblings

Rationale: the legacy logic was ~700 lines entangled across state, template, and CSS. Commenting it out would have added more noise than value; git history is a cleaner reference.

### Phase 2: Baseline (all L)

- Add empty `lodState` map + `getLOD` helper
- Render every comment as L (current full-render path)
- Verify visually nothing regresses for a sample thread

### Phase 3: Primitives + dev UI ✅

- Implement `setLOD`, `toggleLOD`
- Implement all selectors: `self`, `ancestorsOf`, `parentOf`, `childrenOf`, `descendantsOf`, `subtreeOf`, `siblingsOf`, `allComments`
- Add M and S render modes (single-line truncated; colored block)
- Implement S-grouping of adjacent rows in render order (strict pre-order; level-agnostic)
- Add `sGroupingEnabled` flag + `?group=0` URL override (dev/debug toggle)
- Row layout per LOD (L meta-below-body; M meta-first single line; S strip)
- **Per-row dev UI**: four buttons — `[L] [M] [S] [↻]`
  - `[L]`, `[M]`, `[S]` call `toggleLOD(id, <level>)` directly
  - `[↻]` calls `toggleLOD(id)` with no override (cycles L→M→S→L)
  - Current LOD visually indicated (active button highlighted)
- **Per-strip dev UI**: same four buttons acting on all segments in the strip via `setLOD(strip.segments.map(s => s.id), level)`. `[S]` is always active (the strip's members are by definition S). `[↻]` cycles all members in lockstep.
- **Visibility**: dev UI is gated behind the `?dev=1` URL query parameter — it's not rendered at all without the flag, leaving the production surface clean. When rendered, it's `position: absolute` anchored to the viewport-left gutter (`left: 0`, vertically centered) on all three row types (L/M/strip), so placement is consistent regardless of indent depth. At deep levels the buttons overlap the accent bar / indent area — acceptable for a debug-only affordance. Parent rows provide `position: relative` as the containing block. A `z-index: 1` keeps the buttons clickable over row chrome. Reveal policy: `opacity: 0` by default, shown on row hover or when a descendant has `:focus-visible`. `:focus-visible` (not `:focus-within`) is deliberate: mouse-clicking a button leaves focus on the button but not `:focus-visible`, so the dev UI doesn't stay stuck on after the pointer leaves (an earlier bug). Under `@media (hover: none)` (touch devices) always visible.
- Manual testing: all transitions work, order stable, S-grouping visible, `?group=0` unmerges strips and renders solo S via the `s-solo` commentRow path, `?dev=1` reveals toggle buttons + `data-index-level` attribute

### Phase 4: Default initial state ✅

On item load (and on navigation between items):

- Level 1 comments → L (default, no explicit write)
- Level 2 comments → M
- Level ≥ 3 comments → S

Implementation uses a `$effect` keyed on `item.id` that clears `lodState` then walks `treeIndex.allIds` once, assigning M/S by level. Story navigation resets all LOD to the level-derived defaults.

```ts
$effect(() => {
	const _ = item.id; // track
	lodState.clear();
	const mIds: number[] = [];
	const sIds: number[] = [];
	for (const id of treeIndex.allIds) {
		const level = treeIndex.levelOf.get(id) ?? 0;
		if (level === 2) mIds.push(id);
		else if (level >= 3) sIds.push(id);
	}
	setLOD(mIds, 'M');
	setLOD(sIds, 'S');
});
```

`allIds` from the tree index is preferred over the selector `allComments()` here because the effect runs before user interaction, avoiding an extra round-trip through the selector layer. Selectors remain the primary interface for Phase 5 actions.

### Phase 5: UX actions (built on primitives)

Each action is a small function composing selectors + `setLOD`. Examples:

- **Expand thread** (click S/M comment, see it + lineage):
  ```ts
  setLOD([...ancestorsOf(id), id], 'L');
  ```
- **Focus thread** (collapse everything off-thread):
  ```ts
  const keep = new Set([...ancestorsOf(id), id, ...descendantsOf(id)]);
  setLOD(complementOf(keep), 'S');
  ```
  Note: descendants keep their existing LOD; only off-thread nodes are forced to S.
- **Collapse subtree**: `setLOD(subtreeOf(id), 'S')`
- **Expand subtree**: `setLOD(subtreeOf(id), 'L')`
- **Collapse all**: `setLOD(allComments(), 'S')`
- **Expand all**: `lodState.clear()` (default L) or equivalently `setLOD(allComments(), 'L')`

Bind actions to click / toolbar buttons. Replace dev UI with production UX.

## Invariants

1. **Order stability**: rendered row order = depth-first pre-order of original tree. No LOD operation reorders rows. (Intra-row layout — meta-below-body for L, meta-first-single-line for M — is not part of this invariant.)
2. **Single state per node**: every comment resolves to exactly one of `L|M|S`.
3. **Post renders as header, not comment**: the post's LOD entry in `lodState` is never read; the renderer uses a dedicated path. `setLOD` may write to the post id without effect.
4. **Pure selectors**: selector functions are pure — no mutation, no reactive side effects.
5. **Primitive composition**: every UX action is expressible as `setLOD(selectorComposition, level)`.
6. **LOD independence**: a comment's LOD does not depend on or cascade to its ancestors/descendants. Each node renders per its own LOD.

## Resolved design questions

1. **S-descendants rendering**: each comment's LOD is independent. An L descendant under an S parent renders normally at its own depth. Orphaned-context cases are rare and acceptable.
2. **S strip color**: single color per strip, matching the strip's level color.
3. **Keyboard navigation**: not in scope.
4. **Persistence**: none. LOD state resets on page reload / navigation.

## Non-goals (for this spec)

- Author-based filtering, search-term filtering, new-since-visit filtering — Phase 5+ or beyond
- Persisting LOD state across sessions
- Keyboard-driven navigation
- Animated transitions between LOD states
