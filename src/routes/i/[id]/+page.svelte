<script lang="ts">
	import type { HnpwaItem } from '$lib/fetch-hnpwa';
	import { domainify } from '$lib/fetch-hnpwa';
	import { resolve } from '$app/paths';
	import 'open-props/style';
	import dayjs from 'dayjs';

	let { data } = $props();

	const item: HnpwaItem = $derived(data.item);
	const domain = $derived(item.domain || domainify(item.url));

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
	{#each comments.filter((c) => c.user || c.comments.length > 0) as comment (comment.id)}
		{@const isDeleted = !comment.user}
		{@const isOp = !!comment.user && comment.user === item.user}
		<d-comment style:--depth={depth} class:op={isOp} class:deleted={isDeleted}>
			<d-comment-meta>
				{#if isDeleted}
					<s-author class="deleted">[deleted]</s-author>
				{:else}
					<a href="https://news.ycombinator.com/user?id={comment.user}" class="author-link">
						<s-author>{comment.user}</s-author>
					</a>
					{#if isOp}
						<s-op-badge>OP</s-op-badge>
					{/if}
					<s-time>{relativeTime(comment.time)}</s-time>
				{/if}
			</d-comment-meta>
			{#if comment.content}
				<d-comment-body>
					{@html comment.content}
				</d-comment-body>
			{/if}
			{#if comment.comments.length > 0}
				{@render commentTree(comment.comments, depth + 1)}
			{/if}
		</d-comment>
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
					class:high={item.comments_count >= 100}
					class:mid={item.comments_count >= 50 && item.comments_count < 100}
				>
					<a href={hnItemUrl} class="meta-link">
						{item.comments_count}
						{@render message()}
					</a>
				</s-comments>
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
		gap: 0.5ch;
		font-size: 15px;
		font-weight: var(--font-weight-2);
		color: light-dark(#222222, #e5e5e5);
		align-items: center;
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
			calc(var(--size-3) * var(--depth) + var(--size-2));
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		background: light-dark(#ffffff, #262626);

		&.deleted {
			opacity: 0.4;
		}

		&.op d-comment-meta s-author {
			color: #ff6600;
			font-weight: var(--font-weight-6);
		}
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
