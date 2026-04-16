# Spec: Selective Comment LOD (Level of Detail) Rendering

**Status:** Draft — reimplementation of comment toggling
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
- **Post**: root node at level 0 (always rendered L; participates in selectors so post-level UI can manipulate children)
- **Level**: depth from post. Direct children of post are level 1, their replies level 2, etc.
- **LOD** (Level of Detail): how a comment renders
  - **L** (Large): multiline, full text — default
  - **M** (Medium): single line, ellipsis-truncated
  - **S** (Small): colored block only (depth-indicating), consecutive S siblings at same depth group horizontally into a strip
- **Render order**: strict depth-first pre-order traversal. LOD NEVER reorders.

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

Each comment renders as an independent row, indented by depth. A comment's LOD is **independent of its ancestors' LOD** — an L child under an S parent still renders as a full row at its own depth. This may occasionally produce visually orphaned comments (L child with no visible parent context) but is rare in practice and keeps the rendering model trivial: traverse, render each node per its own LOD, done.

### S-grouping rule

When traversing siblings, consecutive S-state comments at the same depth collapse into a single horizontal strip. An M or L comment interrupts the strip. Example siblings:

```
[L] comment A
░░░░░░░░░   ← grouped strip (3 S-comments at same depth)
[M] comment B (single-line, ellipsis)
░░░░░░      ← new grouped strip (2 S-comments)
```

Grouping never crosses depth boundaries or non-sibling gaps. Tree order is preserved.

### S strip color

Single color per strip — the color associated with the strip's shared depth (same depth-color scheme as indentation).

### Post rendering

Post is always rendered as the story header, not a comment row. Its LOD entry in `lodState` (if any) is simply never read — the renderer has a dedicated code path for the post. Post gets the same UI controls as comments so post-level actions (e.g. "collapse all level ≥ 2") have a home, but those controls affect descendants via selectors, not the post's own rendering.

## Implementation phases

### Phase 1: Legacy code quarantine

- Comment out in `src/routes/i/[id]/+page.svelte`:
  - State: `collapsedIds`, `microCollapsedIds`, `autoGroupedIds`, `threadChildIds`, `parentMap`, `childrenMap`
  - Functions: `toggleComment`, `buildCommentMaps`, `buildMicroBlocks`, expand/collapse-all handlers
  - Template branches for collapsed / micro-collapsed / partial-micro
- Wrap with `// LEGACY-LOD: <description>` markers for easy grep/removal later
- Keep imports / types still referenced elsewhere

### Phase 2: Baseline (all L)

- Add empty `lodState` map + `getLOD` helper
- Render every comment as L (current full-render path)
- Verify visually nothing regresses for a sample thread

### Phase 3: Primitives + dev UI

- Implement `setLOD`, `toggleLOD`
- Implement all selectors: `self`, `ancestorsOf`, `parentOf`, `childrenOf`, `descendantsOf`, `subtreeOf`, `siblingsOf`, `allComments`
- Add M and S render modes (single-line truncated; colored block)
- Implement S-grouping of consecutive same-depth siblings
- **Dev UI**: four buttons per comment — `[L] [M] [S] [cycle]`
  - `[L]`, `[M]`, `[S]` call `toggleLOD(id, <level>)` directly
  - `[cycle]` calls `toggleLOD(id)` with no override (cycles L→M→S→L)
  - Current LOD visually indicated (active button highlighted)
- Manual testing: all transitions work, order stable, S-grouping visible

### Phase 4: Default initial state

On item load:

- Level 1 comments → L
- Level 2 comments → M
- Level ≥ 3 comments → S

```ts
setLOD(
	allComments().filter((c) => depthOf(c) === 2),
	'M'
);
setLOD(
	allComments().filter((c) => depthOf(c) >= 3),
	'S'
);
```

Predicate filtering uses native `Array.prototype.filter` on selector output — no predicate API needed in the primitives layer.

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

1. **Order stability**: rendered order = depth-first pre-order of original tree. No LOD operation reorders.
2. **Single state per node**: every comment resolves to exactly one of `L|M|S`.
3. **Post renders as header, not comment**: the post's LOD entry in `lodState` is never read; the renderer uses a dedicated path. `setLOD` may write to the post id without effect.
4. **Pure selectors**: selector functions are pure — no mutation, no reactive side effects.
5. **Primitive composition**: every UX action is expressible as `setLOD(selectorComposition, level)`.
6. **LOD independence**: a comment's LOD does not depend on or cascade to its ancestors/descendants. Each node renders per its own LOD.

## Resolved design questions

1. **S-descendants rendering**: each comment's LOD is independent. An L descendant under an S parent renders normally at its own depth. Orphaned-context cases are rare and acceptable.
2. **S strip color**: single color per strip, matching the strip's depth color.
3. **Keyboard navigation**: not in scope.
4. **Persistence**: none. LOD state resets on page reload / navigation.

## Non-goals (for this spec)

- Author-based filtering, search-term filtering, new-since-visit filtering — Phase 5+ or beyond
- Persisting LOD state across sessions
- Keyboard-driven navigation
- Animated transitions between LOD states
