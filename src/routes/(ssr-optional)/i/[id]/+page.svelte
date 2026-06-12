<script lang="ts">
	import type { HNItem } from '$lib/fetch-hn-item';
	import { domainify } from '$lib/fetch-hn-item';
	import {
		getItemView,
		recordItemView,
		countNewComments,
		countVisibleComments,
		isHiddenComment
	} from '$lib/item-view-history';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import 'open-props/style';
	import dayjs from 'dayjs';

	/** Max indent steps before capping (deeper comments share the max indent but keep their level badge) */
	const MAX_INDENT = 5;

	/** Cycling color palette per level — chosen for visual distinction */
	const LEVEL_COLORS = [
		'#4a9eda', // blue
		'#2ea87e', // green
		'#c4872f', // amber
		'#d35050', // red
		'#8b5dd0', // purple
		'#d06ca0', // pink
		'#3aa8a0' // teal
	];

	let { data } = $props();

	const item: HNItem = $derived(data.item);
	const domain = $derived(item.domain || domainify(item.url));

	// Derive comment count from tree walk (descendants can include deleted/dead comments)
	const visibleCommentCount = $derived(countVisibleComments(item.comments));

	// --- LOD (Level of Detail) state ---
	// Single source of truth for per-comment render state. Missing key ⇒ default 'L'.
	// Post id may be written freely; the renderer never reads the post's entry.
	// SvelteMap so per-id mutations (setLOD in Phase 3) trigger fine-grained rerenders.
	const lodState = new SvelteMap<number, 'L' | 'M' | 'S'>();

	function getLOD(id: number): 'L' | 'M' | 'S' {
		return lodState.get(id) ?? 'L';
	}

	// Tree index: derived from item.comments + item.id. Rebuilt when the item changes.
	// Selectors and default-state init read from this index; they never walk the raw tree.
	// "Visible" matches isHiddenComment() — the index reflects exactly what the renderer draws.
	interface TreeIndex {
		parentOf: Map<number, number>; // comment id → parent id (post id for top-level)
		childrenOf: Map<number, number[]>; // comment/post id → visible child ids in tree order
		levelOf: Map<number, number>; // post → 0, top-level → 1, etc.
		allIds: number[]; // every visible comment id in depth-first pre-order (excludes post)
	}

	const treeIndex = $derived.by<TreeIndex>(() => {
		const parentOf = new Map<number, number>();
		const childrenOf = new Map<number, number[]>();
		const levelOf = new Map<number, number>([[item.id, 0]]);
		const allIds: number[] = [];

		function walk(comments: HNItem[], parentId: number, level: number) {
			const visible = comments.filter((c) => !isHiddenComment(c));
			childrenOf.set(
				parentId,
				visible.map((c) => c.id)
			);
			for (const c of visible) {
				parentOf.set(c.id, parentId);
				levelOf.set(c.id, level);
				allIds.push(c.id);
				if (c.comments.length > 0) walk(c.comments, c.id, level + 1);
			}
		}
		walk(item.comments, item.id, 1);

		return { parentOf, childrenOf, levelOf, allIds };
	});

	// --- LOD primitives ---
	// setLOD writes uniformly for all ids (no default-cleanup, no special cases).
	// Post id may be written freely; the renderer never reads the post's entry.
	function setLOD(ids: Iterable<number>, lod: 'L' | 'M' | 'S'): void {
		for (const id of ids) lodState.set(id, lod);
	}

	// toggleLOD: with override, sets directly. Without, cycles L → M → S → L.
	function toggleLOD(id: number, override?: 'L' | 'M' | 'S'): void {
		if (override) {
			lodState.set(id, override);
			return;
		}
		const current = getLOD(id);
		const next = current === 'L' ? 'M' : current === 'M' ? 'S' : 'L';
		lodState.set(id, next);
	}

	// --- Click highlight state ---
	// Persistent (no fade): the set of ids most recently affected by a user
	// click. Cleared + refilled on each qualifying action, so at any time it
	// reflects the "last place the user touched". Useful after layout shift
	// from toggling a strip — the N new M rows stay highlighted until the
	// next click, making them easy to re-locate.
	//
	// Only production click actions (row click L↔M, strip click → M) write
	// here. Dev UI (?dev=1) intentionally does not highlight; it's a debug
	// affordance, not production UX.
	const highlightedIds = new SvelteSet<number>();

	function setHighlight(ids: Iterable<number>): void {
		highlightedIds.clear();
		for (const id of ids) highlightedIds.add(id);
	}

	// --- Layout animation (Phase 4.5) ---
	// FLIP-style transitions for LOD changes. Handles three cases in one pass:
	//
	//   A) Same-node height change (row L↔M): <d-comment data-comment-id=X>
	//      stays mounted, only data-lod flips → grid/flex swap drives a height
	//      delta. Animate the element's height before→after.
	//
	//   B) Region swap (strip seg click, B1/B2/B3, A1/A2 bulk actions):
	//      <d-comment-strip> is replaced by N <d-comment> rows (or vice versa).
	//      The swapped DOM nodes don't exist both before AND after, so we:
	//        - animate surviving elements (case A) concurrently,
	//        - fade-in new elements from height:0 → natural height,
	//        - animate total <d-comments> wrapper height to smooth over
	//          removed elements whose DOM is already gone.
	//
	//   C) Scroll anchoring (shared): keep the clicked element visually fixed
	//      across the layout shift, so bulk expansions don't send it
	//      offscreen.
	//
	// Callers:
	//   1. Capture `rectBefore = anchorEl.getBoundingClientRect()`.
	//   2. `const snap = snapshotLayout()`.
	//   3. Mutate state.
	//   4. `await animateLayoutChange(snap, anchorEl, rectBefore)`.
	//
	// Viewport cap: rows whose pre- or post-rect sit outside a 3-viewport band
	// (±1 screen) snap instantly. Keeps A1/A2 cheap on long threads. The
	// wrapper-height animation always runs — it's O(1).
	const ANIM_DURATION_MS = 350;
	// Beyond this many animating elements in band, drop per-row animation and
	// keep only the wrapper-height sweep. Picked by feel; tune if needed.
	const PER_ROW_CAP = 40;

	interface LayoutSnapshot {
		// Height of each mounted <d-comment> (keyed by comment id).
		rowHeights: Map<number, number>;
		// Height of each mounted <d-comment-strip> (keyed by data-strip-key).
		stripHeights: Map<string, number>;
		// Total <d-comments> wrapper height (O(1) FLIP target).
		containerHeight: number;
		// Viewport band at snapshot time for culling offscreen animations.
		viewportTop: number;
		viewportBottom: number;
	}

	function snapshotLayout(): LayoutSnapshot {
		const rowHeights = new Map<number, number>();
		for (const el of document.querySelectorAll<HTMLElement>('d-comment[data-comment-id]')) {
			const id = Number(el.dataset.commentId);
			if (Number.isFinite(id)) rowHeights.set(id, el.offsetHeight);
		}
		const stripHeights = new Map<string, number>();
		for (const el of document.querySelectorAll<HTMLElement>('d-comment-strip[data-strip-key]')) {
			const key = el.dataset.stripKey;
			if (key) stripHeights.set(key, el.offsetHeight);
		}
		const container = document.querySelector<HTMLElement>('d-comments');
		const containerHeight = container?.offsetHeight ?? 0;
		const vh = window.innerHeight;
		return {
			rowHeights,
			stripHeights,
			containerHeight,
			viewportTop: window.scrollY - vh,
			viewportBottom: window.scrollY + 2 * vh
		};
	}

	// Apply a FLIP-style height transition on `el` from hBefore → hAfter.
	// Uses `height` longhand so it composes with background transitions
	// (just-clicked highlight).
	function animateElementHeight(el: HTMLElement, hBefore: number, hAfter: number): void {
		el.style.overflow = 'hidden';
		el.style.height = `${hBefore}px`;
		el.style.transitionProperty = 'none';
		// Force reflow so the height:hBefore takes effect before transition enables.
		void el.offsetHeight;
		el.style.transitionProperty = 'height';
		el.style.transitionDuration = `${ANIM_DURATION_MS}ms`;
		el.style.transitionTimingFunction = 'ease-out';
		el.style.height = `${hAfter}px`;

		const cleanup = () => {
			el.style.height = '';
			el.style.overflow = '';
			el.style.transitionProperty = '';
			el.style.transitionDuration = '';
			el.style.transitionTimingFunction = '';
		};
		el.addEventListener('transitionend', cleanup, { once: true });
		setTimeout(cleanup, ANIM_DURATION_MS + 50);
	}

	// True if element's post-mutation rect (already measured in caller) and
	// snapshot viewport band overlap. Conservative: any intersection counts.
	function inBand(rectTop: number, rectBottom: number, snap: LayoutSnapshot): boolean {
		return rectBottom >= snap.viewportTop && rectTop <= snap.viewportBottom;
	}

	async function animateLayoutChange(
		snap: LayoutSnapshot,
		anchorEl?: HTMLElement | null,
		rectBefore?: DOMRect,
		// Optional: selector for the post-mutation anchor when `anchorEl` itself
		// may be unmounted (e.g. strip → rows swap). If provided, used only
		// when anchorEl is no longer connected.
		anchorAfterSelector?: string
	): Promise<void> {
		await tick();

		// Scroll anchoring — keep anchor element visually in place after layout shift.
		if (rectBefore) {
			let anchorAfter: HTMLElement | null = null;
			if (anchorEl && anchorEl.isConnected) {
				anchorAfter = anchorEl;
			} else if (anchorAfterSelector) {
				anchorAfter = document.querySelector<HTMLElement>(anchorAfterSelector);
			}
			if (anchorAfter) {
				const rectAfter = anchorAfter.getBoundingClientRect();
				const shift = rectAfter.top - rectBefore.top;
				if (Math.abs(shift) > 1) window.scrollBy(0, shift);
			}
		}

		// --- Container-height sweep (always, O(1)) ---
		// Covers the net delta including rows that were unmounted (their
		// DOM is already gone so we can't animate them individually).
		const container = document.querySelector<HTMLElement>('d-comments');
		if (container) {
			const hAfter = container.offsetHeight;
			if (hAfter !== snap.containerHeight) {
				animateElementHeight(container, snap.containerHeight, hAfter);
			}
		}

		// --- Collect per-element animations (with viewport cull + cap) ---
		interface PendingRow {
			el: HTMLElement;
			hBefore: number;
			hAfter: number;
		}
		const survivingRows: PendingRow[] = [];
		const newRows: PendingRow[] = [];

		for (const el of document.querySelectorAll<HTMLElement>('d-comment[data-comment-id]')) {
			const id = Number(el.dataset.commentId);
			if (!Number.isFinite(id)) continue;
			const rect = el.getBoundingClientRect();
			// Post-rect is relative to viewport; snap viewport band is in document
			// coords. Convert: rect.top + window.scrollY. Do this lazily since
			// scroll may have adjusted above.
			const docTop = rect.top + window.scrollY;
			const docBottom = rect.bottom + window.scrollY;
			if (!inBand(docTop, docBottom, snap)) continue;

			const hAfter = el.offsetHeight;
			const hBefore = snap.rowHeights.get(id);
			if (hBefore === undefined) {
				// Newly mounted (was a strip member, now a row).
				if (hAfter > 0) newRows.push({ el, hBefore: 0, hAfter });
			} else if (hBefore !== hAfter) {
				survivingRows.push({ el, hBefore, hAfter });
			}
		}

		// Also handle strips that survived (rare: bulk actions may leave some
		// strips intact but reshape others). Same-key match = same membership
		// ordering, so height delta is meaningful.
		const survivingStrips: PendingRow[] = [];
		for (const el of document.querySelectorAll<HTMLElement>('d-comment-strip[data-strip-key]')) {
			const key = el.dataset.stripKey;
			if (!key) continue;
			const rect = el.getBoundingClientRect();
			const docTop = rect.top + window.scrollY;
			const docBottom = rect.bottom + window.scrollY;
			if (!inBand(docTop, docBottom, snap)) continue;

			const hAfter = el.offsetHeight;
			const hBefore = snap.stripHeights.get(key);
			if (hBefore === undefined) {
				// Newly mounted strip (e.g. B3 regrouped a subtree).
				if (hAfter > 0) newRows.push({ el, hBefore: 0, hAfter });
			} else if (hBefore !== hAfter) {
				survivingStrips.push({ el, hBefore, hAfter });
			}
		}

		const total = survivingRows.length + survivingStrips.length + newRows.length;
		if (total > PER_ROW_CAP) {
			// Too many to animate smoothly — rely on container sweep alone.
			return;
		}

		for (const { el, hBefore, hAfter } of survivingRows) {
			animateElementHeight(el, hBefore, hAfter);
		}
		for (const { el, hBefore, hAfter } of survivingStrips) {
			animateElementHeight(el, hBefore, hAfter);
		}
		for (const { el, hAfter } of newRows) {
			// height: 0 → natural, with opacity fade to soften pop-in.
			el.style.opacity = '0';
			el.style.overflow = 'hidden';
			el.style.height = '0px';
			el.style.transitionProperty = 'none';
			void el.offsetHeight;
			el.style.transitionProperty = 'height, opacity';
			el.style.transitionDuration = `${ANIM_DURATION_MS}ms`;
			el.style.transitionTimingFunction = 'ease-out';
			el.style.height = `${hAfter}px`;
			el.style.opacity = '1';

			const cleanup = () => {
				el.style.height = '';
				el.style.overflow = '';
				el.style.opacity = '';
				el.style.transitionProperty = '';
				el.style.transitionDuration = '';
				el.style.transitionTimingFunction = '';
			};
			el.addEventListener('transitionend', cleanup, { once: true });
			setTimeout(cleanup, ANIM_DURATION_MS + 50);
		}
	}

	// Production click-to-toggle: click an L row → M; click an M row → L.
	// Never toggles to S — downgrading to S is reserved for explicit dev UI
	// (and future Phase 5 collapse gestures). Bails when the click target is
	// a nested interactive element (link, button, etc.) so those keep their
	// native behavior.
	function onRowClick(e: MouseEvent, id: number, lod: 'L' | 'M' | 'S'): void {
		const t = e.target as HTMLElement | null;
		if (t?.closest('a, button, input, textarea, [contenteditable]')) return;
		if (lod === 'L') setLOD([id], 'M');
		else if (lod === 'M') setLOD([id], 'L');
		else return; // lod === 'S' on an L/M-styled row shouldn't occur
		setHighlight([id]);
	}

	// Strip click-to-expand: clicking any segment promotes ALL strip members
	// to M. Rationale: a strip represents a compressed region; a click says
	// "I want to read this region", not "exactly this one id". Bulk action
	// matches the production rule of never toggling down to S. All new M
	// rows are highlighted so the user can re-locate the expanded region
	// after the strip-to-rows layout shift.
	function onStripSegClick(e: MouseEvent, segmentIds: number[]): void {
		const t = e.target as HTMLElement | null;
		if (t?.closest('a, [contenteditable]')) return;
		setLOD(segmentIds, 'M');
		setHighlight(segmentIds);
	}

	// --- Target selectors (pure) ---
	// All selectors return number[] and read from treeIndex. Callers wrap in
	// `new Set(...)` when set operations are needed. Post id is never included
	// in allComments(); it may appear in ancestorsOf() output as the terminal element.
	function self(id: number): number[] {
		return [id];
	}

	function parentOf(id: number): number[] {
		const p = treeIndex.parentOf.get(id);
		return p === undefined ? [] : [p];
	}

	function ancestorsOf(id: number): number[] {
		const result: number[] = [];
		let current = treeIndex.parentOf.get(id);
		while (current !== undefined) {
			result.push(current);
			current = treeIndex.parentOf.get(current);
		}
		return result;
	}

	function childrenOf(id: number): number[] {
		return treeIndex.childrenOf.get(id) ?? [];
	}

	function descendantsOf(id: number): number[] {
		const result: number[] = [];
		const stack = [...childrenOf(id)];
		while (stack.length > 0) {
			const next = stack.shift()!;
			result.push(next);
			stack.unshift(...childrenOf(next));
		}
		return result;
	}

	function subtreeOf(id: number): number[] {
		return [id, ...descendantsOf(id)];
	}

	function siblingsOf(id: number): number[] {
		const parent = treeIndex.parentOf.get(id);
		if (parent === undefined) return [];
		return (treeIndex.childrenOf.get(parent) ?? []).filter((sibId) => sibId !== id);
	}

	function allComments(): number[] {
		return treeIndex.allIds;
	}

	// directChildrenOf: spec-named alias of childrenOf for Phase 5.2 B1.
	// Semantically identical — immediate children, no recursion.
	function directChildrenOf(id: number): number[] {
		return childrenOf(id);
	}

	// allStripMembers: every comment currently resolved to 'S'. Used by A2
	// (Ungroup all) to know which ids to promote to M. Reads lodState directly
	// rather than renderList so it works regardless of grouping/rendering.
	function allStripMembers(): number[] {
		const result: number[] = [];
		for (const id of treeIndex.allIds) if (getLOD(id) === 'S') result.push(id);
		return result;
	}

	// --- Phase 5.1: forward-policy override flag ---
	// When true, default LOD policy yields 'M' (not 'S') for level ≥ 3.
	// Toggled by A2 (Ungroup all). Cleared on A1 toggle (either direction) and
	// on A2 deactivation. Forward-only: existing lodState entries are not
	// retroactively rewritten here; A1/A2 handlers call applyDefaultPolicy()
	// after flipping this flag when they want a reset.
	let ungroupAllFlag = $state(false);

	// --- Phase 4/5: default initial LOD state by level ---
	// Bucket by level and apply default LOD: L for level 1, M for level 2,
	// and S (or M when ungroup is true) for level ≥ 3. Does NOT clear
	// lodState on its own — callers clear first when they want a reset.
	// Scope: when ids is provided, only those ids receive default policy
	// (used by B3 Ungroup subtree's "re-run within scope" path).
	//
	// NOTE: takes `ungroup` as an explicit parameter rather than reading
	// ungroupAllFlag directly, so callers inside $effect don't inadvertently
	// subscribe the effect to the flag (which would cause the effect to
	// re-run when A2 flips the flag, clobbering the handler's writes).
	function applyDefaultPolicy(ungroup: boolean, ids?: Iterable<number>): void {
		const target = ids ?? treeIndex.allIds;
		const L: number[] = [];
		const M: number[] = [];
		const S: number[] = [];
		for (const id of target) {
			const lv = treeIndex.levelOf.get(id) ?? 0;
			if (lv <= 1) L.push(id);
			else if (lv === 2) M.push(id);
			else if (ungroup) M.push(id);
			else S.push(id);
		}
		setLOD(L, 'L');
		setLOD(M, 'M');
		setLOD(S, 'S');
	}

	// Runs on mount and whenever item.id changes (story navigation). Resets
	// any prior entries so manual cycling from a previous story doesn't leak
	// across. ungroupAllFlag also resets per-item for consistent defaults.
	// We pass `false` explicitly (rather than reading ungroupAllFlag) so the
	// effect never subscribes to flag changes — otherwise flipping A2 would
	// re-trigger this effect and clobber the handler's writes.
	$effect(() => {
		void item.id; // track item changes
		lodState.clear();
		highlightedIds.clear();
		ungroupAllFlag = false;
		applyDefaultPolicy(false);
	});

	// --- Phase 5.1: global toolbar active-states + handlers ---
	// Heuristic toggles: active-state is derived from lodState, not stored.
	// A1 active ≡ every comment at L. A2 active ≡ flag set AND no S exists
	// (the flag alone isn't enough — if the user has since manually
	// introduced an S somewhere, A2 should read as inactive).
	const allLActive = $derived.by(() => {
		const ids = treeIndex.allIds;
		if (ids.length === 0) return false;
		for (const id of ids) if (getLOD(id) !== 'L') return false;
		return true;
	});
	const ungroupAllActive = $derived.by(() => {
		if (!ungroupAllFlag) return false;
		for (const id of treeIndex.allIds) if (getLOD(id) === 'S') return false;
		return true;
	});

	// A1 — Expand all. Toggle. Always clears ungroupAllFlag (view reset).
	function onExpandAll(): void {
		ungroupAllFlag = false;
		if (allLActive) {
			lodState.clear();
			applyDefaultPolicy(false);
		} else {
			setLOD(allComments(), 'L');
		}
	}

	// A2 — Ungroup all. Toggle + forward-policy override.
	function onUngroupAll(): void {
		if (ungroupAllActive) {
			ungroupAllFlag = false;
			lodState.clear();
			applyDefaultPolicy(false);
		} else {
			ungroupAllFlag = true;
			setLOD(allStripMembers(), 'M');
		}
	}

	// --- Phase 5.2: per-L row action predicates + handlers ---
	// These are plain functions (not $derived) called from the commentRow
	// snippet. SvelteMap reads via getLOD() make them reactive on render.
	// Returns false for empty scopes so "active" doesn't misreport on leaves.
	function repliesAllL(id: number): boolean {
		const kids = directChildrenOf(id);
		if (kids.length === 0) return false;
		for (const k of kids) if (getLOD(k) !== 'L') return false;
		return true;
	}
	function subtreeAllL(id: number): boolean {
		const desc = descendantsOf(id);
		if (desc.length === 0) return false;
		for (const d of desc) if (getLOD(d) !== 'L') return false;
		return true;
	}
	function subtreeNoS(id: number): boolean {
		const desc = descendantsOf(id);
		if (desc.length === 0) return false;
		for (const d of desc) if (getLOD(d) === 'S') return false;
		return true;
	}
	// B1 — Expand direct replies. Toggle L↔M on immediate children only.
	function onExpandReplies(id: number): void {
		const kids = directChildrenOf(id);
		if (kids.length === 0) return;
		const anyM = kids.some((k) => getLOD(k) === 'M');
		setLOD(kids, anyM ? 'L' : 'M');
	}

	// B2 — Expand subtree. Toggle: if any descendant is M or S, promote
	// all to L; otherwise (all-L) collapse back to default policy (which
	// re-introduces strips at level ≥ 3). This way untoggling Expand
	// subtree also untoggles Ungroup subtree — a single "reset this
	// scope" gesture.
	function onExpandSubtree(id: number): void {
		const desc = descendantsOf(id);
		if (desc.length === 0) return;
		const anyNonL = desc.some((d) => getLOD(d) !== 'L');
		if (anyNonL) setLOD(desc, 'L');
		else applyDefaultPolicy(false, desc);
	}

	// B3 — Ungroup subtree. Toggle: if any descendant is S, promote those S
	// to M; else re-apply default policy within the subtree (re-introducing
	// strips per level ≥ 3). Per spec: no forward-policy override — this is
	// a per-L, state-free action. New arrivals in the subtree follow default
	// policy (may become S).
	function onUngroupSubtree(id: number): void {
		const desc = descendantsOf(id);
		if (desc.length === 0) return;
		const anyS = desc.some((d) => getLOD(d) === 'S');
		if (anyS) {
			// Promote only the S descendants to M; leave existing L/M alone.
			const toPromote = desc.filter((d) => getLOD(d) === 'S');
			setLOD(toPromote, 'M');
		} else {
			// Re-run default policy within the subtree (ungroup=false → strips
			// reappear at level ≥ 3). Note: this overwrites any manual L/M
			// edits inside the subtree — accepted as "reset the scope."
			applyDefaultPolicy(false, desc);
		}
	}

	// Keyboard handler for row click-toggle. Enter/Space activate L↔M.
	// preventDefault on Space so it doesn't scroll the page.
	function onRowKeydown(e: KeyboardEvent, id: number, lod: 'L' | 'M' | 'S'): void {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('a, button, input, textarea, [contenteditable]')) return;
		e.preventDefault();
		if (lod === 'L') setLOD([id], 'M');
		else if (lod === 'M') setLOD([id], 'L');
		else return;
		setHighlight([id]);
	}

	// --- S-grouping toggle (dev) ---
	// Default true; disable with ?group=0 in the URL to render each S row
	// individually (no horizontal merging). See spec §Rendering > S-grouping toggle.
	const sGroupingEnabled = $derived(page.url.searchParams.get('group') !== '0');

	// --- Dev UI toggle ---
	// Default off; enable with ?dev=1 in the URL to render the per-row LOD
	// toggle buttons (s-lod-dev) and the data-index-level debug attribute.
	// Production users don't see these; Phase 5 will replace them with real
	// UX actions. The ungrouped s-solo path (via ?group=0) is independent —
	// it's a rendering mode, not a dev affordance.
	const devUiEnabled = $derived(page.url.searchParams.get('dev') === '1');

	// --- Flat render list ---
	// Walks item.comments in pre-order producing an ordered list of render
	// items. Consecutive S rows (by LOD) are merged into a single strip
	// regardless of level, unless sGroupingEnabled is false. Any non-S row
	// ends the current strip. Tree order is preserved.
	interface RowItem {
		kind: 'row';
		id: number;
		level: number;
		comment: HNItem;
	}
	interface StripSeg {
		id: number;
		level: number;
		comment: HNItem;
	}
	interface StripItem {
		kind: 'strip';
		minLevel: number; // shallowest member level (used for indent anchor)
		segments: StripSeg[];
	}
	type RenderItem = RowItem | StripItem;

	const renderList = $derived.by<RenderItem[]>(() => {
		// First pass: flatten tree into a row list (pre-order, filtered).
		const rows: RowItem[] = [];
		function walk(comments: HNItem[], level: number) {
			for (const c of comments) {
				if (isHiddenComment(c)) continue;
				rows.push({ kind: 'row', id: c.id, level, comment: c });
				if (c.comments.length > 0) walk(c.comments, level + 1);
			}
		}
		walk(item.comments, 1);

		// Second pass: merge adjacent S runs into strips.
		// When grouping is disabled (?group=0), skip merging — solo-S comments
		// then render via the commentRow s-solo path for debug inspection.
		if (!sGroupingEnabled) return rows;

		const result: RenderItem[] = [];
		let run: RowItem[] = [];
		const flushRun = () => {
			if (run.length === 0) return;
			// Always emit as a strip (even for a single S) so solo-S gets the
			// same flush-left colored-block + bulk dev UI treatment as multi-S.
			let minLevel = Infinity;
			for (const r of run) if (r.level < minLevel) minLevel = r.level;
			result.push({
				kind: 'strip',
				minLevel,
				segments: run.map((r) => ({ id: r.id, level: r.level, comment: r.comment }))
			});
			run = [];
		};
		for (const row of rows) {
			if (getLOD(row.id) === 'S') {
				run.push(row);
			} else {
				flushRun();
				result.push(row);
			}
		}
		flushRun();
		return result;
	});

	// New-comment tracking: threshold is the viewedAt from the previous visit.
	// null = first visit (no highlights). Set on mount from IndexedDB.
	let newCommentThreshold = $state<number | null>(null);
	let newCommentCount = $state(0);

	onMount(async () => {
		// Expose LOD primitives to window for DevTools testing (removed in Phase 5).
		(window as any).__lod = {
			get state() {
				return lodState;
			},
			get index() {
				return treeIndex;
			},
			setLOD,
			toggleLOD,
			self,
			parentOf,
			ancestorsOf,
			childrenOf,
			descendantsOf,
			subtreeOf,
			siblingsOf,
			allComments
		};

		const previous = await getItemView(item.id);

		if (previous) {
			newCommentThreshold = previous.viewedAt;
			newCommentCount = countNewComments(item.comments, previous.viewedAt);
		}

		// Record this visit (always, even on first view)
		await recordItemView(item.id, visibleCommentCount);
	});

	const hnItemUrl = $derived(`https://news.ycombinator.com/item?id=${item.id}`);
	const hnUserUrl = $derived(
		item.user ? `https://news.ycombinator.com/user?id=${item.user}` : null
	);

	// External URL for the posted article (not HN self-links)
	const articleUrl = $derived(item.url && !item.url.startsWith('item?id=') ? item.url : hnItemUrl);

	// Comment-type items use parent item URLs like "item?id=NNNNN".
	const parentStoryId = $derived(
		item.type === 'comment' && item.url ? item.url.match(/item\?id=(\d+)/)?.[1] : null
	);

	// Extract path portion of URL for display (after domain)
	const urlPath = $derived(
		item.url && !item.url.startsWith('item?id=')
			? item.url
					.replace(/^https?:\/\/(www\.)?/, '')
					.replace(domain || '', '')
					.replace(/\/$/, '')
			: ''
	);

	function goBack() {
		// If opened in a new tab, history.length is typically 1-2 (browser-dependent).
		// navigation.canGoBack is the most reliable check where available.
		const nav = (window as any).navigation;
		if (nav && typeof nav.canGoBack === 'boolean') {
			if (nav.canGoBack) {
				history.back();
			} else {
				window.location.href = resolve('/');
			}
		} else {
			// Fallback: if we have meaningful history, go back; otherwise go home
			if (history.length > 2) {
				history.back();
			} else {
				window.location.href = resolve('/');
			}
		}
	}

	function relativeTime(time: number): string {
		const timestamp = time < 1e12 ? time * 1000 : time;
		const then = dayjs(timestamp);
		const now = dayjs();

		const minutes = now.diff(then, 'minute');
		if (minutes < 60) return `${minutes}m`;

		const hours = now.diff(then, 'hour');
		if (hours < 24) return `${hours}h`;

		const days = now.diff(then, 'day');
		if (days < 90) return `${days}d`;

		const months = now.diff(then, 'month');
		if (months < 12) return `${months}mo`;

		const years = now.diff(then, 'year');
		return `${years}y`;
	}
</script>

{#snippet upvote()}
	<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
		<path
			fill="currentColor"
			d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14"
		/>
	</svg>
{/snippet}

{#snippet message()}
	<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
		<path
			fill="currentColor"
			d="M20 2H4c-1.103 0-2 .894-2 1.992v12.016C2 17.106 2.897 18 4 18h3v4l6.351-4H20c1.103 0 2-.894 2-1.992V3.992A2 2 0 0 0 20 2"
		/>
	</svg>
{/snippet}

{#snippet commentRow(comment: HNItem, level: number)}
	{@const lod = getLOD(comment.id)}
	{@const isDead = comment.content === '<p>[dead]'}
	{@const isDeleted = !comment.user}
	{@const isOp = !isDead && !!comment.user && comment.user === item.user}
	{@const isNew = newCommentThreshold !== null && comment.time > newCommentThreshold}
	{@const indent = Math.min(level - 1, MAX_INDENT)}
	{@const colorIndex = (level - 1) % LEVEL_COLORS.length}
	{@const barWidth = level === 1 ? 0 : Math.min(1 + level, 14)}
	<!--
		Row click (and Enter/Space) toggles LOD (L↔M). We deliberately do NOT
		add role="button" because nimble.css styles [role="button"] as a full
		button (bg, padding, border-radius, text-align: center) and that
		styling is impossible to opt out of without !important wrestling.
		Instead: tabindex="0" + onkeydown is enough for keyboard access, and
		per-L rows also expose explicit B1–B4 buttons that AT users can
		target directly. The svelte-ignore comments below acknowledge this
		tradeoff rather than the element being keyboard-inaccessible.
	-->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<d-comment
		style:--level={level}
		style:--indent={indent}
		style:--level-color={LEVEL_COLORS[colorIndex]}
		style:--bar-width="{barWidth}px"
		class:top-level={level === 1}
		class:op={isOp}
		class:deleted={isDeleted && !isDead}
		class:dead={isDead}
		class:new-comment={isNew}
		class:just-clicked={highlightedIds.has(comment.id)}
		data-comment-id={comment.id}
		data-lod={lod}
		data-level={level}
		data-index-level={devUiEnabled ? treeIndex.levelOf.get(comment.id) : undefined}
		tabindex={lod === 'S' ? undefined : 0}
		onclick={async (e: MouseEvent) => {
			if (lod === 'S') return; // S-solo path delegates to inner button
			const t = e.target as HTMLElement | null;
			if (t?.closest('a, button, input, textarea, [contenteditable]')) return;
			if (lod !== 'L' && lod !== 'M') return;
			const el = e.currentTarget as HTMLElement;
			const rectBefore = el.getBoundingClientRect();
			const snap = snapshotLayout();
			onRowClick(e, comment.id, lod);
			await animateLayoutChange(snap, el, rectBefore);
		}}
		onkeydown={async (e: KeyboardEvent) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			const t = e.target as HTMLElement | null;
			if (t?.closest('a, button, input, textarea, [contenteditable]')) return;
			if (lod !== 'L' && lod !== 'M') return;
			const el = e.currentTarget as HTMLElement;
			const rectBefore = el.getBoundingClientRect();
			const snap = snapshotLayout();
			onRowKeydown(e, comment.id, lod);
			await animateLayoutChange(snap, el, rectBefore);
		}}
	>
		{#if lod === 'S'}
			<!-- Ungrouped S row (?group=0 dev path): colored block placeholder,
			     click promotes to M to match the production click rule. -->
			<button
				type="button"
				class="s-solo"
				aria-label="expand comment {comment.id} to M"
				onclick={() => setLOD([comment.id], 'M')}
			></button>
		{:else}
			<!--
				L/M row structure: [meta-info] [body] [dev-ui]. Three siblings in one
				fixed DOM order. CSS re-arranges per LOD:
				  - L: grid with body above a [meta-info | dev-ui] row
				  - M: flex-row with body flex-growing between meta-info and dev-ui
			-->
			<d-comment-meta>
				<s-level style:color={LEVEL_COLORS[colorIndex]}>{level - 1}</s-level>
				{#if isDead}
					<a href="https://news.ycombinator.com/item?id={comment.id}" class="dead-link">[dead]</a>
					{#if comment.user}
						<a href="https://news.ycombinator.com/user?id={comment.user}" class="dead-link">
							{comment.user}
						</a>
					{/if}
					<s-time>{relativeTime(comment.time)}</s-time>
				{:else if isDeleted}
					<s-author class="deleted">[deleted]</s-author>
				{:else}
					<a href="https://news.ycombinator.com/user?id={comment.user}" class="author-link">
						<s-author>{comment.user}</s-author>
					</a>
					{#if isOp}
						<s-op-badge>OP</s-op-badge>
					{/if}
					{#if isNew}
						<s-new-badge>NEW</s-new-badge>
					{/if}
					<s-time>{relativeTime(comment.time)}</s-time>
				{/if}
				{#if lod === 'L'}
					{@const hasKids = directChildrenOf(comment.id).length > 0}
					{@const hasDesc = descendantsOf(comment.id).length > 0}
					{@const b1Active = hasKids && repliesAllL(comment.id)}
					{@const b2Active = hasDesc && subtreeAllL(comment.id)}
					{@const b3Active = hasDesc && subtreeNoS(comment.id)}
					<s-lod-actions>
						<button
							type="button"
							class="lod-row-btn"
							class:active={b1Active}
							aria-pressed={b1Active}
							aria-label="Expand direct replies"
							disabled={!hasKids}
							title="Expand/collapse direct replies"
							onclick={async (e) => {
								e.stopPropagation();
								const anchor = (e.currentTarget as HTMLElement).closest(
									'd-comment'
								) as HTMLElement | null;
								const rectBefore = anchor?.getBoundingClientRect();
								const snap = snapshotLayout();
								onExpandReplies(comment.id);
								await animateLayoutChange(snap, anchor, rectBefore);
							}}
						>
							Expand&nbsp;<s-direct>direct&nbsp;</s-direct>replies
						</button>
						<button
							type="button"
							class="lod-row-btn"
							class:active={b3Active}
							aria-pressed={b3Active}
							disabled={!hasDesc || allLActive}
							title="Ungroup/regroup subtree strips"
							onclick={async (e) => {
								e.stopPropagation();
								const anchor = (e.currentTarget as HTMLElement).closest(
									'd-comment'
								) as HTMLElement | null;
								const rectBefore = anchor?.getBoundingClientRect();
								const snap = snapshotLayout();
								onUngroupSubtree(comment.id);
								await animateLayoutChange(snap, anchor, rectBefore);
							}}
						>
							Ungroup
						</button>
						<button
							type="button"
							class="lod-row-btn"
							class:active={b2Active}
							aria-pressed={b2Active}
							disabled={!hasDesc}
							title="Expand/collapse entire subtree"
							onclick={async (e) => {
								e.stopPropagation();
								const anchor = (e.currentTarget as HTMLElement).closest(
									'd-comment'
								) as HTMLElement | null;
								const rectBefore = anchor?.getBoundingClientRect();
								const snap = snapshotLayout();
								onExpandSubtree(comment.id);
								await animateLayoutChange(snap, anchor, rectBefore);
							}}
						>
							Expand
						</button>
					</s-lod-actions>
				{/if}
			</d-comment-meta>
			{#if comment.content && !isDead}
				<d-comment-body>
					{@html comment.content}
				</d-comment-body>
			{/if}
			<!-- Dev UI (Phase 3): LOD toggle buttons. Gated by ?dev=1. Replaced in Phase 5. -->
			{#if devUiEnabled}
				<s-lod-dev>
					<button
						type="button"
						class="lod-btn"
						class:active={lod === 'L'}
						aria-label="set LOD to L"
						onclick={() => toggleLOD(comment.id, 'L')}>L</button
					><button
						type="button"
						class="lod-btn"
						class:active={lod === 'M'}
						aria-label="set LOD to M"
						onclick={() => toggleLOD(comment.id, 'M')}>M</button
					><button
						type="button"
						class="lod-btn"
						aria-label="set LOD to S"
						onclick={() => toggleLOD(comment.id, 'S')}>S</button
					><button
						type="button"
						class="lod-btn cycle"
						aria-label="cycle LOD"
						onclick={() => toggleLOD(comment.id)}>↻</button
					>
				</s-lod-dev>
			{/if}
		{/if}
	</d-comment>
{/snippet}

{#snippet stripRow(strip: StripItem)}
	<d-comment-strip
		data-min-level={strip.minLevel}
		data-strip-size={strip.segments.length}
		data-strip-key="s-{strip.segments[0].id}"
	>
		<d-strip-segs>
			{#each strip.segments as seg (seg.id)}
				{@const segColor = LEVEL_COLORS[(seg.level - 1) % LEVEL_COLORS.length]}
				{@const segWidth = seg.level === 1 ? 3 : Math.min(1 + seg.level, 14)}
				<button
					type="button"
					class="strip-seg"
					style:--seg-color={segColor}
					style:--seg-width="{segWidth}px"
					data-seg-level={seg.level}
					aria-label="expand strip to M (contains comment {seg.id} level {seg.level})"
					title="level {seg.level} — expand strip"
					onclick={async (e) => {
						const anchor = (e.currentTarget as HTMLElement).closest(
							'd-comment-strip'
						) as HTMLElement | null;
						const rectBefore = anchor?.getBoundingClientRect();
						const firstId = strip.segments[0].id;
						const snap = snapshotLayout();
						onStripSegClick(
							e,
							strip.segments.map((s) => s.id)
						);
						// After the strip unmounts, the first segment becomes a
						// <d-comment> row — anchor scroll to it so the clicked
						// region stays put.
						await animateLayoutChange(
							snap,
							anchor,
							rectBefore,
							`d-comment[data-comment-id="${firstId}"]`
						);
					}}
				></button>
			{/each}
		</d-strip-segs>
		<!-- Dev UI (Phase 3): bulk LOD toggle for all strip members. Gated by ?dev=1. -->
		{#if devUiEnabled}
			<s-lod-dev>
				<button
					type="button"
					class="lod-btn"
					aria-label="set all strip members to L"
					onclick={() =>
						setLOD(
							strip.segments.map((s) => s.id),
							'L'
						)}>L</button
				><button
					type="button"
					class="lod-btn"
					aria-label="set all strip members to M"
					onclick={() =>
						setLOD(
							strip.segments.map((s) => s.id),
							'M'
						)}>M</button
				><button
					type="button"
					class="lod-btn active"
					aria-label="all strip members are S"
					title="active (all members already S)">S</button
				><button
					type="button"
					class="lod-btn cycle"
					aria-label="cycle LOD for all strip members"
					onclick={() => {
						for (const s of strip.segments) toggleLOD(s.id);
					}}>↻</button
				>
			</s-lod-dev>
		{/if}
	</d-comment-strip>
{/snippet}

<svelte:head>
	<title>{item.title || 'HN Reader'}</title>
</svelte:head>

<main>
	<d-header>
		<d-nav>
			<button type="button" class="back-btn" onclick={goBack}> ← Back </button>
			<d-lod-toolbar>
				<button
					type="button"
					class="lod-toolbar-btn"
					class:active={ungroupAllActive}
					aria-pressed={ungroupAllActive}
					disabled={allLActive}
					title="Show every comment (no grouped strips)"
					onclick={async (e) => {
						const anchor = e.currentTarget as HTMLElement;
						const rectBefore = anchor.getBoundingClientRect();
						const snap = snapshotLayout();
						onUngroupAll();
						await animateLayoutChange(snap, anchor, rectBefore);
					}}
				>
					Ungroup all
				</button>
				<button
					type="button"
					class="lod-toolbar-btn"
					class:active={allLActive}
					aria-pressed={allLActive}
					title="Expand all comments to full detail"
					onclick={async (e) => {
						const anchor = e.currentTarget as HTMLElement;
						const rectBefore = anchor.getBoundingClientRect();
						const snap = snapshotLayout();
						onExpandAll();
						await animateLayoutChange(snap, anchor, rectBefore);
					}}
				>
					Expand all
				</button>
			</d-lod-toolbar>
		</d-nav>

		<d-item-header>
			{#if item.title}
				<d-title>
					<a href={articleUrl} class="title-link">{item.title}</a>
				</d-title>
				{#if domain}
					<d-url-row>
						<a href={articleUrl} class="url-link">
							{domain}<s-path>{urlPath}</s-path>
						</a>
					</d-url-row>
				{/if}
			{/if}

			<d-metadata>
				<s-comments
					class:high={visibleCommentCount >= 100}
					class:mid={visibleCommentCount >= 50 && visibleCommentCount < 100}
				>
					<a href={hnItemUrl} class="meta-link">
						{visibleCommentCount}
						{@render message()}
					</a>
				</s-comments>
				{#if newCommentCount > 0}
					<s-new-count>{newCommentCount} new</s-new-count>
				{/if}
				<s-points
					class:high={(item.points ?? 0) >= 100}
					class:mid={(item.points ?? 0) >= 50 && (item.points ?? 0) < 100}
				>
					{item.points ?? 0}
					{@render upvote()}
				</s-points>
				<s-time>{relativeTime(item.time)}</s-time>
				{#if item.user}
					<s-user>
						by <a href={hnUserUrl} class="meta-link">{item.user}</a>
					</s-user>
				{/if}
				<s-hn-link>
					<a href={hnItemUrl} class="hn-link">news.ycombinator.com/item?id={item.id}</a>
				</s-hn-link>
			</d-metadata>

			{#if parentStoryId}
				<d-parent>
					<a href="/i/{parentStoryId}" class="meta-link">← parent story</a>
				</d-parent>
			{/if}
		</d-item-header>

		{#if item.content}
			<d-item-body>
				{@html item.content}
			</d-item-body>
		{/if}
	</d-header>

	{#if item.comments.length > 0}
		<d-comments>
			{#each renderList as renderItem (renderItem.kind === 'row' ? `r-${renderItem.id}` : `s-${renderItem.segments[0].id}`)}
				{#if renderItem.kind === 'row'}
					{@render commentRow(renderItem.comment, renderItem.level)}
				{:else}
					{@render stripRow(renderItem)}
				{/if}
			{/each}
		</d-comments>
	{:else}
		<d-empty>No comments.</d-empty>
	{/if}
</main>

<style>
	main {
		width: 100%;
		max-width: 42.875em;
		margin: 0 auto;
	}

	/* --- Header --- */

	d-header {
		display: block;
		background: light-dark(#ffffff, #262626);
		border-bottom: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	d-nav {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		flex-wrap: wrap;
		padding: var(--size-2);
		border-bottom: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	.back-btn {
		padding: var(--size-1) var(--size-2);
		font-size: var(--font-size-1);
		background: light-dark(#f5f5f5, #2a2a2a);
		border: 1px solid light-dark(#ccc, #444);
		border-radius: 4px;
		cursor: pointer;
		color: light-dark(#666, #999);
		transition: all 0.15s ease;

		&:hover {
			background: light-dark(#e0e0e0, #333);
			border-color: light-dark(#999, #666);
			color: light-dark(#333, #ccc);
		}
	}

	d-lod-toolbar {
		display: inline-flex;
		gap: var(--size-1);
		margin-inline-start: auto;
	}

	.lod-toolbar-btn {
		padding: var(--size-1) var(--size-2);
		font-size: var(--font-size-1);
		background: light-dark(#f5f5f5, #2a2a2a);
		border: 1px solid light-dark(#ccc, #444);
		border-radius: 4px;
		cursor: pointer;
		color: light-dark(#666, #999);
		transition: all 0.15s ease;

		&:hover:not(:disabled) {
			background: light-dark(#e0e0e0, #333);
			border-color: light-dark(#999, #666);
			color: light-dark(#333, #ccc);
		}

		&.active {
			/* Active state: inset shadow instead of color change — conveys
			   pressed-ness without introducing a new visual weight. */
			box-shadow: inset 0 1px 3px light-dark(rgb(0 0 0 / 0.15), rgb(0 0 0 / 0.35));
			border-color: light-dark(#999, #666);
		}

		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
	}

	/* Per-L row action buttons. Sit inline in <d-comment-meta> which has
	   flex-wrap, so they'll wrap to a new line on narrow widths rather
	   than overflow. Smaller and lighter than the global toolbar buttons
	   since they repeat on every L row. */
	s-lod-actions {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--size-1);
		margin-inline-start: auto;
	}

	.lod-row-btn {
		padding: 0 var(--size-2);
		font-size: var(--font-size-0);
		line-height: 1.6;
		background: light-dark(#f5f5f5, #2a2a2a);
		border: 1px solid light-dark(#ddd, #3a3a3a);
		border-radius: 3px;
		cursor: pointer;
		color: light-dark(#666, #999);
		transition: all 0.15s ease;

		&:hover:not(:disabled) {
			background: light-dark(#e8e8e8, #333);
			border-color: light-dark(#bbb, #555);
			color: light-dark(#333, #ccc);
		}

		&.active {
			box-shadow: inset 0 1px 3px light-dark(rgb(0 0 0 / 0.15), rgb(0 0 0 / 0.35));
			border-color: light-dark(#999, #666);
		}

		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
	}

	/* Narrow viewports: drop "direct " from the B1 label to save width.
	   aria-label keeps the full phrase for assistive tech. */
	@media (max-width: 480px) {
		.lod-row-btn s-direct {
			display: none;
		}
	}

	d-item-header {
		display: block;
		padding: var(--size-2) var(--size-2) var(--size-2);
	}

	d-title {
		display: block;
		font-weight: var(--font-weight-4);
		line-height: 1.2;
	}

	.title-link {
		color: light-dark(#222222, #e5e5e5);
		text-decoration: none;

		&:hover {
			color: #ff6600;
		}

		&:visited {
			color: light-dark(#555, #aaa);
		}
	}

	d-url-row {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-bottom: var(--size-1);
	}

	.url-link {
		color: var(--url-color);
		font-size: 15px;
		font-weight: var(--font-weight-4);
		text-decoration: none;

		&:visited {
			color: var(--url-visited-color);
		}

		&:hover {
			color: var(--url-hover-color);
			text-decoration: underline;
		}

		&:hover s-path {
			opacity: 1;
		}
	}

	s-path {
		opacity: 0.6;
	}

	d-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5ch;
		font-size: 15px;
		font-weight: var(--font-weight-2);
		color: light-dark(#222222, #e5e5e5);
		align-items: center;
	}

	@media (max-width: 480px) {
		s-hn-link {
			flex-basis: 100%;
			text-align: right;
			margin-left: 0;
		}
	}

	s-comments {
		display: flex;
		gap: 0.25ch;
		width: 6.25ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		align-items: center;
		justify-content: flex-end;

		svg {
			width: 1em;
			height: 1em;
			flex-shrink: 0;
			opacity: 0.2;
		}

		&.mid {
			svg {
				color: #ff6600;
				opacity: 0.8;
			}
		}

		&.high {
			color: #ff6600;
			font-weight: var(--font-weight-4);

			svg {
				opacity: 1;
			}
		}
	}

	s-points {
		display: flex;
		gap: 0.25ch;
		width: 5.25ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		align-items: center;
		justify-content: flex-end;

		svg {
			width: 1em;
			height: 1em;
			flex-shrink: 0;
			opacity: 0.2;
		}

		&.mid {
			svg {
				color: #ff6600;
				opacity: 0.8;
			}
		}

		&.high {
			color: #ff6600;
			font-weight: var(--font-weight-4);

			svg {
				opacity: 1;
			}
		}
	}

	d-metadata s-time {
		width: 4ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	s-user {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta-link {
		color: light-dark(#666, #999);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	s-comments .meta-link {
		display: flex;
		gap: 0.25ch;
		align-items: center;
		color: inherit;
	}

	s-hn-link {
		min-width: 0;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hn-link {
		color: light-dark(#999, #666);
		font-weight: var(--font-weight-2);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	d-parent {
		display: block;
		margin-top: var(--size-2);
		font-size: var(--font-size-1);
	}

	/* --- Item body (story text / comment text for comment items) --- */

	d-item-body {
		display: block;
		padding: var(--size-2) var(--size-2) var(--size-3);
		font-size: var(--font-size-1);
		line-height: 1.5;
		color: light-dark(#333, #ddd);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	d-item-body :global {
		p {
			margin: 0 0 0.75em;

			&:last-child {
				margin-bottom: 0;
			}
		}

		a {
			color: light-dark(#0645ad, #4da3ff);
			text-decoration: none;

			&:hover {
				text-decoration: underline;
			}

			&:visited {
				color: light-dark(#0b0080, #9370db);
			}
		}

		pre {
			overflow-x: auto;
			padding: var(--size-2);
			background: light-dark(#f5f5f5, #1e1e1e);
			border-radius: 4px;
			font-size: 0.9em;
		}

		code {
			font-size: 0.9em;
		}
	}

	/* --- Comments --- */

	d-comments {
		display: block;
	}

	d-comment {
		/*
			Default layout (L): grid with body on top, meta-info below. Dev UI,
			when enabled (?dev=1), is absolute-positioned at the viewport-left
			gutter and sits outside grid flow. Three children in fixed DOM order:
			  <d-comment-meta>  → area "meta"
			  <d-comment-body>  → area "body"
			  <s-lod-dev>       → absolute, left: 0 (see dev UI rules below)
			S-solo and dead rows place a single child in "body" area; that's fine.
			position: relative anchors the absolute dev UI regardless of LOD.
		*/
		position: relative;
		display: grid;
		grid-template-columns: 1fr;
		grid-template-areas:
			'body'
			'meta';
		column-gap: var(--size-2);
		row-gap: var(--size-1);
		padding: var(--size-2) var(--size-2) var(--size-2)
			calc(var(--size-3) * var(--indent, 0) + var(--size-2));
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		border-left: var(--bar-width, 0px) solid
			color-mix(in srgb, var(--level-color, transparent) 70%, transparent);
		background: light-dark(#ffffff, #262626);
		overflow: hidden;
		/* Row click toggles LOD (L↔M). Nested a/button override cursor
		   automatically; comment body text inherits the pointer as a signal
		   that the row is interactive. */
		cursor: pointer;

		/* Top-level comments (depth 0) — no colored left border */
		&.top-level {
			border-left-color: transparent;
		}

		&.deleted {
			opacity: 0.4;
		}

		&.dead {
			opacity: 0.5;
		}

		&.op d-comment-meta s-author {
			color: #ff6600;
			font-weight: var(--font-weight-6);
		}

		&.new-comment {
			border-right: 3px solid #ff6600;
			background: light-dark(rgba(255, 102, 0, 0.03), rgba(255, 102, 0, 0.06));
		}

		/* Click highlight: persistent (no fade) soft-blue background applied
		   to the most recently clicked row (L/M) or every row in a just-
		   expanded strip. Cleared/refilled on each qualifying click via
		   setHighlight; cleared on story navigation. Placed after .new-comment
		   so a NEW row that's just been clicked shows blue (click is the more
		   recent / more relevant signal); the orange right-border from
		   .new-comment is preserved. */
		&.just-clicked {
			background: light-dark(rgba(74, 158, 218, 0.12), rgba(74, 158, 218, 0.15));
		}

		> d-comment-meta {
			grid-area: meta;
		}

		> d-comment-body {
			grid-area: body;
		}

		/*
			M layout override: single line. Switch to flex so body can flex-grow
			between meta-info and (absolutely positioned) dev-UI, and
			ellipsis-truncate. Grid areas are ignored when display changes away
			from grid.
		*/
		&[data-lod='M'] {
			display: flex;
			flex-direction: row;
			align-items: baseline;
			gap: 0.5ch;
			/* Tighter vertical padding for single-line rows */
			padding-top: var(--size-1);
			padding-bottom: var(--size-1);
		}
	}

	s-level {
		display: inline-block;
		margin-right: 0.25ch;
		font-weight: var(--font-weight-6);
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
		user-select: none;
		cursor: default;
	}

	d-comment-meta {
		display: flex;
		gap: 0.5ch;
		font-size: var(--font-size-0);
		color: light-dark(#888, #777);
		align-items: baseline;
		flex-wrap: wrap;
	}

	.author-link {
		color: light-dark(#666, #999);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	.dead-link {
		color: light-dark(#d89899, #a06060);
		font-style: italic;
		font-size: var(--font-size-0);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}

	s-author {
		font-weight: var(--font-weight-4);
	}

	s-op-badge {
		display: inline-block;
		padding: 0 0.4em;
		font-size: 0.75em;
		font-weight: var(--font-weight-7);
		color: #fff;
		background: #ff6600;
		border-radius: 3px;
		vertical-align: baseline;
		line-height: 1.5;
	}

	s-new-badge {
		display: inline-block;
		padding: 0 0.4em;
		font-size: 0.75em;
		font-weight: var(--font-weight-7);
		color: #ff6600;
		background: light-dark(rgba(255, 102, 0, 0.12), rgba(255, 102, 0, 0.2));
		border-radius: 3px;
		vertical-align: baseline;
		line-height: 1.5;
	}

	s-new-count {
		color: #ff6600;
		font-weight: var(--font-weight-5);
		font-size: 0.9em;
		white-space: nowrap;
	}

	d-comment-meta s-time {
		font-variant-numeric: tabular-nums;
	}

	d-comment-meta s-author.deleted {
		font-style: italic;
		font-weight: var(--font-weight-2);
	}

	d-comment-body {
		display: block;
		font-size: var(--font-size-1);
		line-height: 1.5;
		color: light-dark(#333, #ddd);
	}

	d-comment-body :global {
		p {
			margin: 0 0 0.5em;

			&:last-child {
				margin-bottom: 0;
			}
		}

		a {
			color: light-dark(#0645ad, #4da3ff);
			text-decoration: none;
			word-break: break-all;

			&:hover {
				text-decoration: underline;
			}

			&:visited {
				color: light-dark(#0b0080, #9370db);
			}
		}

		pre {
			overflow-x: auto;
			padding: var(--size-2);
			background: light-dark(#f5f5f5, #1e1e1e);
			border-radius: 4px;
			font-size: 0.85em;
			white-space: pre-wrap;
			word-break: break-word;
		}

		code {
			font-size: 0.9em;
		}
	}

	/* --- M render mode: single-line, ellipsis-truncated body ---
	   flex-row parent supplies horizontal packing; body flex-grows and
	   min-width: 0 allows it to shrink so text-overflow: ellipsis engages.
	   Smaller font matches the meta row and lets more preview text fit. */
	d-comment[data-lod='M'] d-comment-body {
		display: block;
		flex: 1 1 0;
		min-width: 0;
		font-size: var(--font-size-0);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* M meta stays on one line (no wrap); dev-UI similarly compact. */
	d-comment[data-lod='M'] d-comment-meta {
		flex-wrap: nowrap;
		white-space: nowrap;
		flex: 0 0 auto;
	}

	d-comment[data-lod='M'] d-comment-body :global {
		p,
		pre,
		blockquote,
		ul,
		ol,
		li {
			display: inline;
			margin: 0;
			padding: 0;
			background: transparent;
			border: 0;
			white-space: nowrap;
		}

		/* Separate consecutive paragraphs with a visual marker */
		p + p::before {
			content: ' · ';
			opacity: 0.5;
		}

		br {
			display: none;
		}
	}

	/* --- S render mode (ungrouped solo) ---
	   When sGroupingEnabled is false, each S comment renders as its own row
	   with a tiny colored block in place of the body. Override grid → block
	   since there's only one child (no body/meta/dev triple). */
	d-comment[data-lod='S'] {
		display: block;
		padding-top: var(--size-1);
		padding-bottom: var(--size-1);
	}

	button.s-solo {
		display: block;
		height: 0.75em;
		width: 4ch;
		padding: 0;
		background: var(--level-color, #888);
		opacity: 0.6;
		border: 0;
		border-radius: 2px;
		cursor: pointer;
		transition: opacity 0.15s ease;

		&:hover {
			opacity: 1;
		}
	}

	/* --- S render mode (grouped strip) ---
	   A horizontal row of narrow, non-filling clickable segments. Each
	   segment's width and color encode its own level (matching the left
	   accent bar of L/M rows at that level). Strip is flush-left (no indent)
	   so segment widths read as a pure level profile of the compressed run.
	   Right side: bulk dev-UI buttons for setting all members at once.

	   Solo strips (data-strip-size="1") collapse vertical padding and render
	   the segment as a full-height, square-cornered accent-bar block — a
	   visual extension of the left-accent-bar style used on L/M rows. */
	/* Strip row: a horizontal band of accent-bar segments spanning the full
	   row height with no vertical padding/margin. Each segment is square-
	   cornered and stretches top-to-bottom — visually a run of left-accent
	   bars extended rightward. An explicit min-height gives the flex
	   container something for children to stretch against. */
	d-comment-strip {
		display: flex;
		gap: var(--size-2);
		align-items: stretch;
		min-height: 0.4375em;
		padding: 0 var(--size-2) 0 0;
		margin: 0;
		background: light-dark(#ffffff, #262626);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		/* Row is intentionally short; dev-UI buttons (when ?dev=1) are
		   absolutely positioned at left: 0 so they don't force the row height
		   via flex stretch, and overflow vertically above/below the band. */
		position: relative;
		overflow: visible;
	}

	d-strip-segs {
		display: flex;
		gap: 0;
		align-items: stretch;
		flex: 1 1 auto;
		min-width: 0;
		/* No flex-wrap: wrapping allocates extra cross-axis space per line
		   which manifests as a bottom margin on segments. Single line only. */
		flex-wrap: nowrap;
		overflow: hidden;
	}

	button.strip-seg {
		display: block;
		flex: 0 0 auto;
		align-self: stretch;
		width: var(--seg-width, 4px);
		height: auto;
		/* Open Props normalize.css adds margin-block-end to buttons; zero it. */
		margin: 0;
		padding: 0;
		background: color-mix(in srgb, var(--seg-color, #888) 70%, transparent);
		border: 0;
		border-radius: 0;
		cursor: pointer;
		/* Hairline divider on the left edge of each segment, matching the
		   row-separator color used elsewhere in the grid. No layout impact
		   (inset shadow, no gap). First segment's divider falls outside
		   d-strip-segs overflow so it's clipped. */
		box-shadow: inset 1px 0 0
			light-dark(
				color-mix(in srgb, #e6e6df 50%, transparent),
				color-mix(in srgb, #3a3a3a 50%, transparent)
			);
		transition: background 0.15s ease;

		&:hover {
			background: var(--seg-color, #888);
		}
	}

	/* --- Dev UI: LOD toggle buttons (Phase 3, removed in Phase 5) ---
	   Only rendered when ?dev=1 is set. Absolute-positioned at the
	   viewport-left gutter (left: 0) and vertically centered, so placement
	   is consistent across L/M/strip rows regardless of indent depth. At
	   deep levels, the buttons overlap the accent bar and indent area —
	   acceptable for a debug affordance, and the gated rendering means
	   production users never see this. Parent rows (d-comment, d-comment-strip)
	   provide position: relative as the containing block.

	   Reveal policy: hidden by default (opacity: 0); shown on row hover, or
	   when a descendant receives keyboard focus. :focus-visible (not
	   :focus-within) is used intentionally so that mouse-clicking a button
	   doesn't sustain the reveal after the pointer leaves. On touch devices
	   (hover: none) always visible. */
	s-lod-dev {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		font-family: var(--font-mono, monospace);
		border: 1px solid light-dark(#ccc, #444);
		border-radius: 3px;
		overflow: hidden;
		background: light-dark(#f5f5f5, #2a2a2a);
		opacity: 0;
		transition: opacity 0.1s ease;
		/* Above row background/borders so buttons remain clickable over the
		   accent bar + indent area. */
		z-index: 1;
	}

	d-comment:hover > s-lod-dev,
	d-comment-strip:hover > s-lod-dev,
	s-lod-dev:has(:focus-visible) {
		opacity: 1;
	}

	@media (hover: none) {
		s-lod-dev {
			opacity: 1;
		}
	}

	button.lod-btn {
		padding: 0 0.4em;
		font-size: 0.75em;
		font-family: inherit;
		line-height: 1.4;
		background: light-dark(#f5f5f5, #2a2a2a);
		color: light-dark(#888, #888);
		border: 0;
		border-right: 1px solid light-dark(#ccc, #444);
		cursor: pointer;
		transition: background 0.1s ease;

		&:last-child {
			border-right: 0;
		}

		&:hover {
			background: light-dark(#e5e5e5, #333);
			color: light-dark(#333, #ccc);
		}

		&.active {
			background: light-dark(#ff6600, #ff6600);
			color: #fff;
		}

		&.cycle {
			font-weight: bold;
		}
	}

	d-empty {
		display: block;
		padding: var(--size-4) var(--size-2);
		text-align: center;
		color: light-dark(#888, #777);
		font-size: var(--font-size-1);
	}

	:root {
		--url-color: light-dark(#0645ad, #4da3ff);
		--url-visited-color: light-dark(#0b0080, #9370db);
		--url-hover-color: light-dark(#0645ad, #6db3ff);
	}
</style>
