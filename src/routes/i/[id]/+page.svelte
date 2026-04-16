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
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import 'open-props/style';
	import dayjs from 'dayjs';

	/** Max indent levels before capping (deeper comments show same indent but retain depth indicator) */
	const MAX_INDENT = 5;

	/** Cycling color palette for depth indicators — chosen for visual distinction */
	const DEPTH_COLORS = [
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

	// New-comment tracking: threshold is the viewedAt from the previous visit.
	// null = first visit (no highlights). Set on mount from IndexedDB.
	let newCommentThreshold = $state<number | null>(null);
	let newCommentCount = $state(0);

	onMount(async () => {
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

{#snippet commentTree(comments: HnpwaItem[], depth: number)}
	{#each comments.filter((c) => !isHiddenComment(c)) as comment (comment.id)}
		{@const isDead = comment.content === '<p>[dead]'}
		{@const isDeleted = !comment.user}
		{@const isOp = !isDead && !!comment.user && comment.user === item.user}
		{@const isNew = newCommentThreshold !== null && comment.time > newCommentThreshold}
		{@const indent = Math.min(depth, MAX_INDENT)}
		{@const colorIndex = depth % DEPTH_COLORS.length}
		{@const barWidth = depth === 0 ? 0 : Math.min(2 + depth, 14)}
		<d-comment
			style:--depth={depth}
			style:--indent={indent}
			style:--depth-color={DEPTH_COLORS[colorIndex]}
			style:--bar-width="{barWidth}px"
			class:top-level={depth === 0}
			class:op={isOp}
			class:deleted={isDeleted && !isDead}
			class:dead={isDead}
			class:new-comment={isNew}
			data-lod={getLOD(comment.id)}
			data-level={treeIndex.levelOf.get(comment.id)}
		>
			<d-comment-meta>
				{#if depth > 0}
					<s-depth style:color={DEPTH_COLORS[colorIndex]}>{depth}</s-depth>
				{/if}
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
			{#if comment.content && !isDead}
				<d-comment-body>
					{@html comment.content}
				</d-comment-body>
			{/if}
		</d-comment>
		{#if comment.comments.length > 0}
			{@render commentTree(comment.comments, depth + 1)}
		{/if}
	{/each}
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
			{@render commentTree(item.comments, 0)}
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
			color-mix(in srgb, var(--depth-color, transparent) 70%, transparent);
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

	s-depth {
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
		margin-bottom: var(--size-1);
		align-items: baseline;
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
