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

### Click highlight

Every production click also updates a `highlightedIds` set (`SvelteSet<number>`) via a `setHighlight(ids)` primitive that atomically clears then refills the set. Rows whose id is in the set render with a persistent soft-blue background (`.just-clicked` class, `rgba(74, 158, 218, 0.12)` light / `0.15` dark). There is no fade — the highlight stays until the next qualifying click replaces it, or until story navigation clears it.

Rationale: when clicking a strip expands it into N new M rows, the layout shifts significantly. The sustained highlight on all N new rows lets the user quickly locate the region they just expanded, regardless of scroll position or where the rows ended up vertically. Same for single L↔M toggles that shift neighboring row heights.

Highlight rules:

- **Click L/M row**: `setHighlight([id])` — only that row highlights
- **Click strip**: `setHighlight(strip.segments.map(s => s.id))` — all new M rows highlight
- **Story navigation** (item id changes): `highlightedIds.clear()` alongside `lodState.clear()` in the default-level `$effect`
- **Dev UI (`?dev=1`) buttons do not write to `highlightedIds`** — dev UI is a debug affordance, separate from production UX

The highlight layers cleanly over `.new-comment` (orange right border + faint orange background): blue background wins (later cascade rule), orange right border remains. Click is the more recent, more relevant signal.

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

### Phase 5: Production UX actions

Dev UI (`?dev=1`) is replaced by production controls. All actions compose `setLOD` with selectors.

Status: **5.1 and 5.2 shipped**; **5.3 (dev UI removal) pending**.

#### Design principles

- **M and S are tight** — too cramped for per-row buttons. Their only production affordance is click-to-toggle (Phase 4): click M → L, click strip → all-M.
- **L has room** — per-row action buttons live on L rows only, inline in the meta line (which sits at the bottom of the row).
- **Global toolbar** sits next to the back button for thread-wide actions, right-aligned in the nav row.
- **Two orthogonal axes**:
  - _Depth_ (inclusion): S ↔ M — are buried comments rendered at all? "Ungroup" actions operate here.
  - _Detail_ (elaboration): M ↔ L — are rendered comments truncated or full? "Expand" actions operate here.
- **Heuristic toggles**: toggle state is derived from current `lodState`, not stored separately. Active/inactive is a `$derived` computation over the scope's current LODs. No snapshot infrastructure.
- **Clicks never collapse to S** — reserved for explicit button actions and future collapse gestures.

#### Button inventory

**Global toolbar** (right side of nav row, order: Ungroup before Expand):

| #   | Label           | Type   | Function                                                                                                                                                                                                                                              |
| --- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2  | **Ungroup all** | toggle | Active when no comments are at S (and `ungroupAllFlag === true`). Active → inactive: clear flag, `lodState.clear()`, re-apply default policy (strips regenerate). Inactive → active: set flag, `setLOD(allStripMembers(), 'M')`. Disabled when A1 on. |
| A1  | **Expand all**  | toggle | Active when all comments are at L. Active → inactive: `lodState.clear()`, re-apply default policy. Inactive → active: `setLOD(allComments(), 'L')`. Always clears `ungroupAllFlag` (view reset).                                                      |

**Per L row** (inline in meta, order: Expand direct replies, Ungroup, Expand):

| #   | Label                     | Type   | Function                                                                                                                                                                                                                                                                              |
| --- | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Expand direct replies** | toggle | Active when all direct children are at L. Toggle: if any direct child at M, `setLOD(directChildrenOf(id), 'L')`; else `setLOD(directChildrenOf(id), 'M')`. On ≤480px viewports the label drops "direct " via CSS (aria-label keeps the full phrase).                                  |
| B3  | **Ungroup**               | toggle | Active when no descendants are at S. Toggle: if any descendant at S, promote those S's to M; else `applyDefaultPolicy(false, descendantsOf(id))` (strips return within scope). Disabled when A1 on.                                                                                   |
| B2  | **Expand**                | toggle | Active when all descendants are at L. Toggle: if any descendant is non-L, `setLOD(descendantsOf(id), 'L')`; else `applyDefaultPolicy(false, descendantsOf(id))` (collapse restores default strips — this way un-toggling Expand also un-toggles Ungroup in a single "reset" gesture). |

Active state is indicated by an inset box-shadow + slightly darker border, not a colored fill — conveys "pressed" without introducing a new visual weight.

#### State model

No snapshots. Toggle active-state is derived from `lodState`:

- A1 active: `allComments().every(id => getLOD(id) === 'L')`
- A2 active: `ungroupAllFlag && allComments().every(id => getLOD(id) !== 'S')`
- B1 active: `directChildrenOf(id).every(c => getLOD(c) === 'L')` (when non-empty)
- B2 active: `descendantsOf(id).every(d => getLOD(d) === 'L')` (when non-empty)
- B3 active: `descendantsOf(id).every(d => getLOD(d) !== 'S')` (when non-empty)

One piece of additional state:

- **`ungroupAllFlag: boolean`** — forward-policy override for A2. While true, default LOD policy produces M (not S) for would-be strip members. Cleared when A2 toggles off and when A1 toggles (either direction), and reset to `false` on item navigation.

B3 has no forward-policy override — per-L ungroup is state-free. New comments arriving into a B3-ungrouped subtree follow default policy (may appear as S).

**Trade-off accepted**: heuristic toggles don't preserve side-edits made during a "peek." If the user ungroups-all, clicks a revealed M comment to L, then un-ungroups, the L reverts to whatever default policy says (likely S). Un-toggling is a "clear the peek" gesture; losing in-peek edits is acceptable.

**Implementation note — effect subscription hazard**: `applyDefaultPolicy()` takes `ungroup` as an **explicit parameter** rather than reading `ungroupAllFlag` directly. The init `$effect` (runs on `item.id` change) calls `applyDefaultPolicy(false)` so it never subscribes to the flag. If it read the flag instead, flipping A2 would re-trigger the effect, reset the flag to `false`, and clobber the handler's S→M writes. Keeping the flag out of any effect's reactive closure is required.

#### Button enablement rules

| Button | Disabled when                    |
| ------ | -------------------------------- |
| A1     | never                            |
| A2     | A1 is on                         |
| B1     | scope empty (no direct children) |
| B2     | scope empty (no descendants)     |
| B3     | A1 is on, or scope empty         |

Disable (dim, preserve layout) rather than hide.

#### Selectors

Used by Phase 5:

- `childrenOf(id)` — immediate children (Phase 3).
- `directChildrenOf(id)` — spec-named alias of `childrenOf` for B1 (Phase 5.2).
- `descendantsOf(id)` — whole subtree excluding self (Phase 3).
- `allComments()` — every visible comment in tree order (Phase 3).
- `allStripMembers()` — every comment currently at S (Phase 5.1, used by A2).

#### Highlight interaction

Click-highlight (Phase 4) remains reserved for explicit click-toggle on rows and strips. Button actions do **not** write to `highlightedIds` — visual feedback is the LOD change itself.

#### Keyboard / ARIA

Rows use `tabindex="0"` + `onkeydown` (Enter/Space → L↔M toggle). We deliberately do **not** add `role="button"` on `<d-comment>` — nimble.css styles every `[role="button"]` as a full pill (background, border-radius, `text-align: center`, padding), which cannot be opted out of without heavy overrides. AT users still have the explicit B1–B3 buttons on every L row. The three `svelte-ignore` comments (`a11y_click_events_have_key_events`, `a11y_no_static_element_interactions`, `a11y_no_noninteractive_tabindex`) acknowledge this deliberate tradeoff.

All B-buttons call `e.stopPropagation()` so clicking them doesn't trigger the row's L↔M toggle.

#### Implementation order and status

1. ✅ **5.1 — Global toolbar** (commit `fe9948a`): A1 (Expand all), A2 (Ungroup all). Adds `ungroupAllFlag` + extracts `applyDefaultPolicy(ungroup, ids?)` from the init effect. Adds `allStripMembers()` selector.
2. ✅ **5.2 — L row actions**: B1 (Expand direct replies), B3 (Ungroup), B2 (Expand). Adds `directChildrenOf(id)` selector. Inline in meta line; active-state via inset shadow. Responsive label trimming for B1 on ≤480px. Row keyboard/ARIA established.
3. ⬜ **5.3 — Dev UI removal**: pending. Remove `<s-lod-dev>` blocks and CSS; `?dev=1` gate + `data-index-level`; `s-solo` mode + `?group=0`; `window.__lod` debug handle.

#### Deviations from original spec

- **B4 "Focus subtree" dropped**: was planned as a one-shot to collapse everything outside the ancestor/self/descendant chain to S. Removed during 5.2 review; `complementOf` selector and `alreadyFocused` helper removed along with it. Can re-introduce if usage demands.
- **Button labels**: per-row B2 became "Expand" (dropped "subtree" as redundant in-context); B3 became "Ungroup" (ditto). Toolbar kept "Expand all" / "Ungroup all" since "all" is the scope.
- **Button order**: per-row order is B1, B3, B2 (Expand direct replies, Ungroup, Expand) — B1 first because it's the most common intent; Ungroup before Expand because increasing depth usually precedes reading more detail. Toolbar order matches: Ungroup all before Expand all.
- **B2 collapse semantics**: originally spec'd as a pure L↔M toggle. Shipped with a "reset this scope" twist — collapsing from all-L re-applies default policy, so clicking B2 also un-toggles B3. Preserves the heuristic-toggle principle (one click, one obvious result).
- **Active styling**: spec called for "pressed/active" styling without specifying color. Shipped with inset shadow + darker border — an earlier attempt with a colored fill (orange, then dark gray) was too jarring against the neutral comment palette.

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
