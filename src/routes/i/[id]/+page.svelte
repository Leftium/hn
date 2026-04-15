<script lang="ts">
	import type { HnpwaItem } from '$lib/fetch-hnpwa';
	import { domainify } from '$lib/fetch-hnpwa';
	import 'open-props/style';
	import dayjs from 'dayjs';

	let { data } = $props();

	const item: HnpwaItem = $derived(data.item);
	const domain = $derived(item.domain || domainify(item.url));

	const hnItemUrl = $derived(`https://news.ycombinator.com/item?id=${item.id}`);
	const hnUserUrl = $derived(
		item.user ? `https://news.ycombinator.com/user?id=${item.user}` : null
	);

	// HNPWA comment-type items have url like "item?id=NNNNN"
	const parentStoryId = $derived(
		item.type === 'comment' && item.url ? item.url.match(/item\?id=(\d+)/)?.[1] : null
	);

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

{#snippet commentTree(comments: HnpwaItem[], depth: number)}
	{#each comments as comment (comment.id)}
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

<main>
	<d-header>
		<d-nav>
			<button type="button" class="back-btn" onclick={() => history.back()}> ← Back </button>
		</d-nav>

		<d-item-header>
			{#if item.title}
				<d-title>
					{#if item.url && !item.url.startsWith('item?id=')}
						<a href={item.url} class="title-link">{item.title}</a>
					{:else}
						<a href={hnItemUrl} class="title-link">{item.title}</a>
					{/if}
				</d-title>
				{#if domain}
					<d-domain>({domain})</d-domain>
				{/if}
			{/if}

			<d-metadata>
				{#if item.points !== null}
					<s-points>{item.points} point{item.points === 1 ? '' : 's'}</s-points>
				{/if}
				{#if item.user}
					<span>by</span>
					<a href={hnUserUrl} class="meta-link">{item.user}</a>
				{/if}
				<s-time>{relativeTime(item.time)}</s-time>
				<span>|</span>
				<a href={hnItemUrl} class="meta-link">
					{item.comments_count} comment{item.comments_count === 1 ? '' : 's'}
				</a>
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
		padding: var(--size-3) var(--size-2);
	}

	d-title {
		display: block;
		font-weight: var(--font-weight-6);
		font-size: var(--font-size-3);
		line-height: 1.3;
		margin-bottom: var(--size-1);
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

	d-domain {
		display: block;
		font-size: var(--font-size-1);
		color: light-dark(#888, #777);
		margin-bottom: var(--size-2);
	}

	d-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4ch;
		font-size: var(--font-size-1);
		color: light-dark(#666, #999);
		align-items: baseline;
	}

	s-points {
		font-weight: var(--font-weight-4);
	}

	d-metadata s-time {
		font-variant-numeric: tabular-nums;
	}

	.meta-link {
		color: light-dark(#666, #999);
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
</style>
