<script lang="ts">
	import dayjs from 'dayjs';
	import { FEED_SOURCES } from '$lib';
	import 'open-props/style';
	import { browser } from '$app/environment';

	let { data } = $props();

	const currentSource = data?.source || 'hckrnews';
	let manualOverride = $state<number | null>(data?.selectedOverride ?? null);
	let datetimeTimestamp = $state<number | null>(data?.selectedOverride ?? null);

	let formElement: HTMLFormElement;
	let datetimeInput: HTMLInputElement;

	const groupedFeeds = FEED_SOURCES.reduce(
		(acc, feed) => {
			if (!acc[feed.category]) {
				acc[feed.category] = [];
			}
			acc[feed.category].push(feed);
			return acc;
		},
		{} as Record<string, typeof FEED_SOURCES>
	);

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

	const uniqueVisits = $derived(
		(data?.recent ?? []).toReversed().filter((visit, index, arr) => {
			if (index === 0) return true;
			const current = dayjs.unix(visit);
			const prev = dayjs.unix(arr[index - 1]);
			return !current.isSame(prev, 'minute');
		})
	);

	const currentlyUsing = $derived(
		manualOverride || (uniqueVisits.length > 1 ? uniqueVisits[1] : null)
	);

	const defaultDatetime = $derived(
		manualOverride
			? dayjs.unix(manualOverride).format('YYYY-MM-DDTHH:mm')
			: dayjs().format('YYYY-MM-DDTHH:mm')
	);

	function autoSubmit() {
		if (formElement) {
			formElement.requestSubmit();
		}
	}

	function setDatetimeFromVisit(timestamp: number) {
		if (datetimeInput) {
			datetimeInput.value = dayjs.unix(timestamp).format('YYYY-MM-DDTHH:mm');
		}
	}

	function setManualOverride(timestamp: number | null) {
		manualOverride = timestamp;
	}

	if (typeof document !== 'undefined') {
		document.documentElement.classList.add('js-enabled');
	}
</script>

<main>
	<div class="header-bar">
		<h1>Settings</h1>
		<button class="no-js-only" type="submit" form="settings-form">Save</button>
		<button
			class="js-only"
			type="button"
			onclick={() => (window.location.href = `/${currentSource}`)}
		>
			Back
		</button>
	</div>

	<form id="clear-override-form" method="POST" action="?/clearOverride"></form>

	<form id="settings-form" method="POST" action="?/updateSettings" bind:this={formElement}>
		<h2>List <span class="subheader">(which stories shown)</span></h2>
		{#each Object.entries(groupedFeeds) as [category, feeds]}
			{#if category !== 'Curated'}
				<h3>
					{category}
				</h3>
			{/if}
			<div class="radio-group-horizontal">
				{#each feeds as feed}
					<label class:disabled={!feed.available}>
						<input
							type="radio"
							name="feed"
							value={feed.id}
							checked={feed.id === currentSource}
							disabled={!feed.available}
							onchange={autoSubmit}
						/>
						<span class="feed-label">
							<span class="feed-name">{feed.name}</span>
							<span class="feed-description">{feed.description}</span>
						</span>
					</label>
				{/each}
			</div>
		{/each}

		<hr />

		<div class="pages-header">
			<h2>Stories per page</h2>
			<div class="radio-group-inline">
				{#each [1, 2, 3, 4] as pages}
					<label>
						<input
							type="radio"
							name="pages_per_load"
							value={pages}
							checked={pages === data.pagesPerLoad}
							onchange={autoSubmit}
						/>
						{pages * 30}
					</label>
				{/each}
			</div>
		</div>

		<h2>Unread stories</h2>

		<p class="explanation">
			Stories newer than {#if currentlyUsing}<span class="timestamp-highlight"
					>{formatVisitTime(currentlyUsing)} ({relativeTimeAbbrev(currentlyUsing)})</span
				>{:else}this time{/if} marked as unread.
		</p>

		<h3>
			Set unread story date <span class="subheader"
				>(resets to last visit after session timeout)</span
			>
		</h3>

		<label class="custom-time-label">
			<input
				type="radio"
				name="threshold_source"
				value="custom"
				checked={datetimeTimestamp !== null && !uniqueVisits.includes(datetimeTimestamp)}
				onchange={() => {
					const timestamp = Math.floor(new Date(datetimeInput.value).getTime() / 1000);
					datetimeTimestamp = timestamp;
					setManualOverride(timestamp);
					autoSubmit();
				}}
			/>
			<input
				bind:this={datetimeInput}
				type="datetime-local"
				name="custom_datetime"
				value={defaultDatetime}
				onchange={() => {
					// Select the radio button when datetime changes
					const radio = datetimeInput.parentElement?.querySelector(
						'input[type="radio"]'
					) as HTMLInputElement;
					if (radio) radio.checked = true;
					const timestamp = Math.floor(new Date(datetimeInput.value).getTime() / 1000);
					datetimeTimestamp = timestamp;
					setManualOverride(timestamp);
					autoSubmit();
				}}
			/>
		</label>

		<h4>Recent visits</h4>
		{#each uniqueVisits as visit, index}
			{@const [date, time] = formatVisitTime(visit).split(' ')}
			{@const hourDigits = time.split(':')[0]}
			{@const needsGhost = hourDigits.length === 1}
			{@const relTime = relativeTimeAbbrev(visit)}
			{@const isDefault = index === 1 && uniqueVisits.length > 1}
			<label>
				<input
					type="radio"
					name="threshold_source"
					value={visit}
					checked={currentlyUsing === visit}
					onchange={() => {
						setDatetimeFromVisit(visit);
						datetimeTimestamp = visit;
						setManualOverride(visit);
						autoSubmit();
					}}
				/>
				{date}
				{#if needsGhost}<span class="ghost">0</span>{/if}{time} <span class="ago">({relTime})</span>
				{#if isDefault}<span class="default-label">(default)</span>{/if}
			</label>
		{/each}
	</form>
</main>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--size-4);
	}

	.header-bar {
		position: sticky;
		top: 0;
		background-color: light-dark(#fff, #000);
		z-index: 10;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: var(--size-4) var(--size-4) var(--size-3) var(--size-4);
		margin: calc(-1 * var(--size-4)) calc(-1 * var(--size-4)) var(--size-3);
		backdrop-filter: blur(8px);
		background-color: light-dark(rgba(255, 255, 255, 0.9), rgba(0, 0, 0, 0.9));
		border-bottom: 1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));
	}

	h1 {
		margin: 0;
	}

	h2 {
		margin-top: var(--size-5);
		margin-bottom: var(--size-2);
	}

	.subheader {
		font-size: var(--font-size-1);
		font-weight: var(--font-weight-2);
		color: light-dark(#666, #999);
	}

	h3 {
		margin-top: var(--size-3);
		margin-bottom: var(--size-2);
		font-size: var(--font-size-2);
		color: light-dark(#666, #999);
	}

	h4 {
		margin-top: var(--size-3);
		margin-bottom: var(--size-2);
		font-size: var(--font-size-1);
		font-weight: var(--font-weight-4);
		color: light-dark(#666, #999);
	}

	label {
		display: block;
		margin-bottom: var(--size-0);
		font-variant-numeric: tabular-nums;
	}

	label.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.radio-group-horizontal {
		columns: 150px;
		column-gap: var(--size-5);
		margin-bottom: var(--size-2);
	}

	.radio-group-horizontal label {
		display: flex;
		align-items: baseline;
		gap: var(--size-2);
		margin-bottom: var(--size-1);
		break-inside: avoid;
	}

	.radio-group-horizontal label input[type='radio'] {
		flex-shrink: 0;
	}

	.feed-label {
		display: flex;
		flex-direction: column;
		gap: var(--size-0);
	}

	.feed-name {
		white-space: nowrap;
	}

	.feed-description {
		font-size: var(--font-size-0);
		color: light-dark(#999, #666);
		white-space: normal;
		line-height: 1.3;
		min-height: calc(1.3em * 2);
	}

	.pages-header {
		display: flex;
		align-items: baseline;
		gap: var(--size-4);
		flex-wrap: wrap;
	}

	.pages-header h2 {
		margin: 0;
	}

	.radio-group-inline {
		display: flex;
		gap: var(--size-3);
	}

	.radio-group-inline label {
		display: inline-block;
		white-space: nowrap;
	}

	.default-label {
		color: light-dark(#999, #666);
		font-size: var(--font-size-0);
		margin-left: var(--size-2);
	}

	.ago {
		display: inline-block;
		min-width: 8ch;
		text-align: right;
	}

	.ghost {
		visibility: hidden;
	}

	input[type='radio'] {
		margin-right: var(--size-2);
	}

	button {
		padding: var(--size-2) var(--size-3);
		cursor: pointer;
		border: 1px solid light-dark(#ddd, #333);
		background: light-dark(#f5f5f5, #1a1a1a);
		border-radius: 6px;
		font-size: var(--font-size-1);
		transition: all 0.15s ease;
	}

	button:hover {
		background: light-dark(#e8e8e8, #2a2a2a);
		border-color: light-dark(#bbb, #555);
	}

	hr {
		border: none;
		border-top: 1px solid light-dark(#e0e0e0, #333);
		margin: var(--size-5) 0;
	}

	.js-only {
		display: none;
	}

	:global(.js-enabled) .js-only {
		display: inline-block;
	}

	:global(.js-enabled) .no-js-only {
		display: none;
	}

	.explanation {
		margin-top: var(--size-2);
		margin-bottom: var(--size-3);
		line-height: 1.6;
	}

	.timestamp-highlight {
		font-weight: var(--font-weight-6);
		background: light-dark(rgba(255, 102, 0, 0.1), rgba(255, 102, 0, 0.15));
		padding: var(--size-1) var(--size-2);
		border-radius: 4px;
		color: light-dark(#ff6600, #ff6600);
	}

	.custom-time-label {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		margin-bottom: var(--size-3);
	}

	.custom-time-label input[type='datetime-local'] {
		flex: 0 0 auto;
	}
</style>
