<script lang="ts">
	import type { HnpwaItem } from '$lib/fetch-hnpwa';
	import { domainify } from '$lib/fetch-hnpwa';
	import {
		getItemView,
		recordItemView,
		countNewComments,
		countVisibleComments,
		isHiddenComment
	} from '$lib/item-view-history';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
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

	const item: HnpwaItem = $derived(data.item);
	const domain = $derived(item.domain || domainify(item.url));

	// Derive comment count from tree walk (HNPWA's comments_count inflates by including deleted/dead)
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

		function walk(comments: HnpwaItem[], parentId: number, level: number) {
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

	// --- S-grouping toggle (dev) ---
	// Default true; disable with ?group=0 in the URL to render each S row
	// individually (no horizontal merging). See spec §Rendering > S-grouping toggle.
	const sGroupingEnabled = $derived(page.url.searchParams.get('group') !== '0');

	// --- Flat render list ---
	// Walks item.comments in pre-order producing an ordered list of render
	// items. Consecutive same-level S rows (by LOD) are merged into a strip
	// unless sGroupingEnabled is false. Interruption rules (strict pre-order):
	// any non-S row, or any S row at a different level, ends the current strip.
	interface RowItem {
		kind: 'row';
		id: number;
		level: number;
		comment: HnpwaItem;
	}
	interface StripItem {
		kind: 'strip';
		level: number;
		ids: number[];
		comments: HnpwaItem[];
	}
	type RenderItem = RowItem | StripItem;

	const renderList = $derived.by<RenderItem[]>(() => {
		// First pass: flatten tree into a row list (pre-order, filtered).
		const rows: RowItem[] = [];
		function walk(comments: HnpwaItem[], level: number) {
			for (const c of comments) {
				if (isHiddenComment(c)) continue;
				rows.push({ kind: 'row', id: c.id, level, comment: c });
				if (c.comments.length > 0) walk(c.comments, level + 1);
			}
		}
		walk(item.comments, 1);

		// Second pass: merge adjacent same-level S runs into strips.
		if (!sGroupingEnabled) return rows;

		const result: RenderItem[] = [];
		let run: RowItem[] = [];
		const flushRun = () => {
			if (run.length === 0) return;
			if (run.length === 1) {
				result.push(run[0]);
			} else {
				result.push({
					kind: 'strip',
					level: run[0].level,
					ids: run.map((r) => r.id),
					comments: run.map((r) => r.comment)
				});
			}
			run = [];
		};
		for (const row of rows) {
			const isS = getLOD(row.id) === 'S';
			if (isS && (run.length === 0 || run[0].level === row.level)) {
				run.push(row);
			} else {
				flushRun();
				if (isS) {
					run.push(row);
				} else {
					result.push(row);
				}
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

	// HNPWA comment-type items have url like "item?id=NNNNN"
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

{#snippet commentRow(comment: HnpwaItem, level: number)}
	{@const lod = getLOD(comment.id)}
	{@const isDead = comment.content === '<p>[dead]'}
	{@const isDeleted = !comment.user}
	{@const isOp = !isDead && !!comment.user && comment.user === item.user}
	{@const isNew = newCommentThreshold !== null && comment.time > newCommentThreshold}
	{@const indent = Math.min(level - 1, MAX_INDENT)}
	{@const colorIndex = (level - 1) % LEVEL_COLORS.length}
	{@const barWidth = level === 1 ? 0 : Math.min(1 + level, 14)}
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
		data-lod={lod}
		data-level={level}
		data-index-level={treeIndex.levelOf.get(comment.id)}
	>
		{#if lod === 'S'}
			<!-- Ungrouped S row: tiny colored block placeholder, click to cycle -->
			<button
				type="button"
				class="s-solo"
				aria-label="cycle LOD for comment {comment.id}"
				onclick={() => toggleLOD(comment.id)}
			></button>
		{:else if comment.content && !isDead}
			<d-comment-body>
				{@html comment.content}
			</d-comment-body>
		{/if}
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
		</d-comment-meta>
	</d-comment>
{/snippet}

{#snippet stripRow(strip: StripItem)}
	{@const indent = Math.min(strip.level - 1, MAX_INDENT)}
	{@const colorIndex = (strip.level - 1) % LEVEL_COLORS.length}
	<d-comment-strip
		style:--level={strip.level}
		style:--indent={indent}
		style:--level-color={LEVEL_COLORS[colorIndex]}
		data-level={strip.level}
		data-strip-size={strip.ids.length}
	>
		{#each strip.ids as id (id)}
			<button
				type="button"
				class="strip-seg"
				aria-label="cycle LOD for comment {id}"
				title="cycle LOD for #{id}"
				onclick={() => toggleLOD(id)}
			></button>
		{/each}
	</d-comment-strip>
{/snippet}

<svelte:head>
	<title>{item.title || 'HN Reader'}</title>
</svelte:head>

<main>
	<d-header>
		<d-nav>
			<button type="button" class="back-btn" onclick={goBack}> ← Back </button>
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
			{#each renderList as renderItem (renderItem.kind === 'row' ? `r-${renderItem.id}` : `s-${renderItem.ids[0]}`)}
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
		display: block;
		padding: var(--size-2) var(--size-2) var(--size-2)
			calc(var(--size-3) * var(--indent, 0) + var(--size-2));
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		border-left: var(--bar-width, 0px) solid
			color-mix(in srgb, var(--level-color, transparent) 70%, transparent);
		background: light-dark(#ffffff, #262626);
		overflow: hidden;

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

		/* Spacing applies only when meta follows a body (typical case);
		   bodyless comments render meta alone without extra margin. */
		&:not(:first-child) {
			margin-top: var(--size-1);
		}
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

	/* --- M render mode: single-line, ellipsis-truncated body --- */
	d-comment[data-lod='M'] d-comment-body {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* Hide line-break side-effects of inner block-level elements */
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
	   with a tiny colored block in place of the body. */
	d-comment[data-lod='S'] {
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
	   A horizontal row divided into equal-width clickable segments,
	   one per S id. Uses the same indent/level-color as a regular row. */
	d-comment-strip {
		display: flex;
		gap: 1px;
		padding: var(--size-1) var(--size-2) var(--size-1)
			calc(var(--size-3) * var(--indent, 0) + var(--size-2));
		background: light-dark(#ffffff, #262626);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	button.strip-seg {
		display: block;
		flex: 1 1 0;
		height: 0.75em;
		padding: 0;
		background: var(--level-color, #888);
		opacity: 0.6;
		border: 0;
		border-radius: 2px;
		cursor: pointer;
		min-width: 0.5ch;
		transition: opacity 0.15s ease;

		&:hover {
			opacity: 1;
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
