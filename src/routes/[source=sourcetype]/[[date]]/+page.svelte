<script lang="ts">
	import type { NormalizedStory } from '$lib/fetch-hckrnews';
	import { FEED_NAMES, FEED_SOURCES } from '$lib';
	let { data } = $props();
	import 'open-props/style';
	import dayjs from 'dayjs';

	const cutoffTime = data.visitData?.previousSessionOverride ?? null;
	const feedSource = $derived(FEED_SOURCES.find((f) => f.id === data.source));

	function relativeTime(time: number | string): string {
		const num = typeof time === 'string' ? parseInt(time, 10) : time;
		const timestamp = num < 1e12 ? num * 1000 : num;

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

	function timeDelta(time1: number, time2: number): string {
		const then = dayjs.unix(time1);
		const later = dayjs.unix(time2);

		const seconds = later.diff(then, 'second');
		if (seconds < 60) return `${seconds}s`;

		const minutes = later.diff(then, 'minute');
		if (minutes < 60) return `${minutes}m`;

		const hours = later.diff(then, 'hour');
		if (hours < 24) return `${hours}h`;

		const days = later.diff(then, 'day');
		return `${days}d`;
	}

	function formatVisitTime(timestamp: number): string {
		const date = dayjs.unix(timestamp);
		const hour = date.hour();
		const ampm = hour >= 12 ? 'p' : 'a';
		const hour12 = hour % 12 || 12;
		return `${date.format('YYYY-MM-DD')} ${hour12}:${date.format('mm')}${ampm}`;
	}

	function relativeTimeAbbrev(timestamp: number): string {
		const then = dayjs.unix(timestamp);
		const now = dayjs();

		const minutes = now.diff(then, 'minute');
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;

		const hours = now.diff(then, 'hour');
		if (hours < 24) return `${hours}h ago`;

		const days = now.diff(then, 'day');
		if (days < 30) return `${days}d ago`;

		const months = now.diff(then, 'month');
		if (months < 12) return `${months}mo ago`;

		const years = now.diff(then, 'year');
		return `${years}y ago`;
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

{#snippet storyItem(story: NormalizedStory, index: number, cutoff: number | null)}
	{@const id = story.id}
	{@const dead = story.dead}
	{@const deleted = story.title === '[deleted]'}
	{@const title = story.title}

	{@const points = story.points}
	{@const comments = story.comments}
	{@const time = story.time}
	{@const timeFrontpage = story.time_frontpage}
	{@const dateDiffHours = timeFrontpage
		? dayjs.unix(timeFrontpage).diff(dayjs.unix(time), 'hour')
		: 0}

	{@const link = dead
		? `https://news.ycombinator.com/item?id=${id}`
		: `https://hw.leftium.com/#/item/${id}`}
	{@const domain = story.domain}
	{@const path = story.url
		?.replace(/^https:\/\/(www.)?/, '')
		.replace(domain || '', '')
		.replace(/\/$/, '')}

	{@const isNew = cutoffTime && (timeFrontpage ? timeFrontpage > cutoffTime : time > cutoffTime)}

	<d-item class:new-item={isNew}>
		<a href={link}>
			<d-title class:dead={dead || deleted}>{title}</d-title>
			<d-metadata>
				<s-comments class:high={comments >= 100} class:mid={comments >= 50 && comments < 100}
					>{dead ? '?' : comments} {@render message()}</s-comments
				>
				<s-points class:high={points >= 100} class:mid={points >= 50 && points < 100}
					>{points} {@render upvote()}</s-points
				>
				<s-time>{relativeTime(time)}</s-time>
				{#if timeFrontpage}
					<s-date class:muted={dateDiffHours < 24} class:highlighted={dateDiffHours >= 24}
						>+{timeDelta(time, timeFrontpage)}</s-date
					>
				{/if}
				<s-url>{domain}<s-path>{path}</s-path></s-url>
			</d-metadata>
		</a>
		<s-scroll
			class:new={isNew}
			role="button"
			tabindex="0"
			onclick={(e: MouseEvent) => {
				e.preventDefault();
				const target = e.currentTarget as HTMLElement;
				target.previousElementSibling?.scrollIntoView({
					behavior: 'smooth',
					block: 'start'
				});
			}}
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					const target = e.currentTarget as HTMLElement;
					target.previousElementSibling?.scrollIntoView({
						behavior: 'smooth',
						block: 'start'
					});
				}
			}}
		>
			<s-index>{index + 1}</s-index>
		</s-scroll>
	</d-item>
{/snippet}

<main>
	<d-item class="config-info new-item">
		<a href="/config?from={data.source}">
			<d-title>
				<strong>{FEED_NAMES[data.source]}</strong>
				{#if data.visitData}
					{#if cutoffTime}
						{@const timeAgo = relativeTimeAbbrev(cutoffTime).replace(' ago', '')}
						<span class="visit-count" title={formatVisitTime(cutoffTime)}
							>({data.newStoryCount}
							{data.newStoryCount === 1 ? 'story' : 'stories'} in last {timeAgo})</span
						>
					{:else}
						<span class="visit-count">(First visit)</span>
					{/if}
				{/if}
			</d-title>
			{#if feedSource}
				<d-metadata>
					<span>{feedSource.description}</span>
				</d-metadata>
			{/if}
		</a>
		<a href="/config?from={data.source}" class="scroll-link">
			<s-scroll class="new">
				<s-config>⚙</s-config>
			</s-scroll>
		</a>
	</d-item>

	{#each data.stories ?? [] as story, index (story.id)}
		{@const globalIndex =
			data.startIndex !== undefined ? data.startIndex + index : (data.startPage - 1) * 30 + index}
		{@render storyItem(story, globalIndex, cutoffTime)}
	{/each}

	{#if data.previousDate || data.nextRange}
		<d-item class="more-link">
			{#if data.previousDate}
				<a href="/{data.source}/{data.previousDate}">
					<d-metadata>
						<s-url>More... {data.previousDate}</s-url>
					</d-metadata>
				</a>
			{:else if data.nextRange}
				<a href="/{data.source}/{data.nextRange}">
					<d-metadata>
						<s-url>More...</s-url>
					</d-metadata>
				</a>
			{/if}
			<button
				type="button"
				class="scroll-link"
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					window.scrollTo({ top: 0, behavior: 'smooth' });
				}}
			>
				<s-scroll>
					<s-top-icon>⤒</s-top-icon>
				</s-scroll>
			</button>
		</d-item>
	{/if}

	<pre hidden>{JSON.stringify(data.stories ?? [], null, 4)}</pre>
</main>

<style>
	d-item {
		display: grid;
		grid-template-columns: 1fr 4ch;
		background: light-dark(#ffffff, #262626);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		border-left: 4px solid light-dark(#ffffff, #262626);

		&:first-child {
			border-top: none;
		}

		&:hover {
			background: light-dark(rgb(245, 245, 245), #2d2d2d);
			border-left-color: light-dark(rgb(245, 245, 245), #2d2d2d);
		}

		&.new-item {
			border-left-color: rgba(255, 102, 0, 0.8);
		}

		&.new-item:hover {
			border-left-color: rgba(255, 102, 0, 0.8);
		}

		&.config-info {
			background: light-dark(#f8f8f8, #1f1f1f);
			border-left-color: light-dark(#ddd, #444);
		}

		&.config-info:hover {
			background: light-dark(#f0f0f0, #252525);
			border-left-color: light-dark(#ccc, #555);
		}

		&.config-info d-title,
		&.config-info d-metadata {
			text-align: center;
			justify-content: center;
		}

		&.more-link a {
			min-height: 3.5em;
			align-items: center;
		}

		&.more-link d-metadata {
			justify-content: center;
			padding: var(--size-2);
			font-size: inherit;
			font-weight: var(--font-weight-4);
		}

		&.more-link s-url {
			text-align: center;
		}
	}

	a {
		display: grid;
		grid-column: 1;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	d-title {
		display: flex;
		padding: var(--size-2) var(--size-2) 0;
		color: light-dark(#222222, #e5e5e5);
		font-weight: var(--font-weight-4);
		line-height: 1.2;
		align-items: baseline;
		gap: 1ch;

		&.dead {
			opacity: 0.3;
		}

		.visit-count {
			font-weight: var(--font-weight-2);
			font-size: 15px;
		}
	}

	d-metadata {
		display: flex;
		min-width: 0;
		gap: 0.5ch;
		padding: 0 var(--size-2) var(--size-2);
		color: light-dark(#222222, #e5e5e5);
		font-size: 15px;
		font-weight: var(--font-weight-2);
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

	s-date {
		width: 4ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;

		&.muted {
			opacity: 0.2;
		}

		&.highlighted {
			color: #ff6600;
			opacity: 0.8;
		}
	}

	s-time {
		width: 4ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	s-url {
		min-width: 0;
		overflow: hidden;
		color: var(--url-color);
		font-weight: var(--font-weight-4);
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	s-path {
		opacity: 0.6;
	}

	.scroll-link {
		display: contents;
		color: inherit;
		text-decoration: none;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
	}

	s-scroll {
		display: flex;
		grid-column: 2;
		grid-row: 1 / 3;
		padding: var(--size-2);
		background: light-dark(rgb(245, 245, 245), #2f2f2f);
		border-right: 1px solid light-dark(#e6e6df, #3a3a3a);
		cursor: pointer;
		align-self: stretch;
		align-items: baseline;
		justify-content: flex-end;

		&:hover {
			background: light-dark(rgb(235, 235, 235), #3a3a3a);
		}

		&.new s-index {
			color: #ff6600;
			opacity: 1;
		}
	}

	s-index {
		opacity: 0.6;
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}

	s-config {
		font-size: 18px;
		opacity: 0.5;
	}

	s-scroll:hover s-config,
	.scroll-link:hover s-config {
		opacity: 0.8;
	}

	s-top-icon {
		font-size: 18px;
		opacity: 0.5;
	}

	s-scroll:hover s-top-icon,
	.scroll-link:hover s-top-icon {
		opacity: 0.8;
	}

	a:visited s-url {
		color: var(--url-visited-color);
	}

	a:hover s-url {
		color: var(--url-hover-color);
		text-decoration: underline;
	}

	a:hover s-path {
		opacity: 1;
	}

	@media (min-width: 42.875em) {
		d-item {
			border-left-width: 0;
		}

		d-item.new-item {
			border-left-width: 4px;
		}

		s-scroll {
			border-right: 1px solid light-dark(#e6e6df, #3a3a3a);
		}
	}

	:root {
		--url-color: light-dark(#0645ad, #4da3ff);
		--url-visited-color: light-dark(#0b0080, #9370db);
		--url-hover-color: light-dark(#0645ad, #6db3ff);
	}
</style>
