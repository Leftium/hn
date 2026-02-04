<script lang="ts">
	import { favicon } from '@leftium/logo';
	import 'sanitize.css';
	import { FEED_SOURCES } from '$lib';
	import { browser } from '$app/environment';
	import { navigating } from '$app/stores';
	import dayjs from 'dayjs';

	import '../app.css';

	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	let { children, data } = $props();

	const availableFeeds = FEED_SOURCES.filter((feed) => feed.available);
	const mainFeeds = availableFeeds.filter(
		(feed) => feed.category === 'Curated' || feed.category === 'Hacker News'
	);
	const moreFeeds = availableFeeds.filter(
		(feed) => feed.category === 'More lists' && feed.id !== 'launches'
	);

	let sessionTimeRemaining = $state<number | null>(null);

	function formatExpiryTime(timestamp: number): string {
		const date = dayjs.unix(timestamp);
		const hour = date.hour();
		const ampm = hour >= 12 ? 'p' : 'a';
		const hour12 = hour % 12 || 12;
		return `${hour12}:${date.format('mm')}${ampm}`;
	}

	const updateSessionTime = () => {
		if (!browser) return;
		const cookies = document.cookie.split('; ');
		const sessionStartCookie = cookies.find((row) => row.startsWith('session_start='));

		if (sessionStartCookie) {
			const sessionStart = parseInt(sessionStartCookie.split('=')[1], 10);
			const now = Math.floor(Date.now() / 1000);
			const elapsed = now - sessionStart;
			const remaining = Math.max(0, 20 * 60 - elapsed);
			const minutes = Math.floor(remaining / 60);
			sessionTimeRemaining = minutes;
		} else {
			sessionTimeRemaining = null;
		}
	};

	$effect(() => {
		if (!browser) return;

		updateSessionTime();
		const interval = setInterval(updateSessionTime, 60000);

		return () => clearInterval(interval);
	});

	let clientSessionExpires = $state<number | null>(data.sessionExpires || null);

	if (browser) {
		navigating.subscribe((nav) => {
			if (nav === null) {
				const now = Math.floor(Date.now() / 1000);
				const cookies = document.cookie.split('; ');
				const thresholdCookie = cookies.find((row) => row.startsWith('new_item_threshold='));
				const currentThreshold = thresholdCookie ? thresholdCookie.split('=')[1] : now.toString();
				document.cookie = `new_item_threshold=${currentThreshold}; path=/; max-age=${20 * 60}`;
				document.cookie = `session_start=${now}; path=/; max-age=${20 * 60}`;
				clientSessionExpires = now + 20 * 60;
				updateSessionTime();
			}
		});
	}

	function getOrdinalSuffix(n: number): string {
		const lastDigit = n % 10;
		const lastTwoDigits = n % 100;

		if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
			return 'th';
		}

		switch (lastDigit) {
			case 1:
				return 'st';
			case 2:
				return 'nd';
			case 3:
				return 'rd';
			default:
				return 'th';
		}
	}

	async function endSession() {
		document.cookie = 'new_item_threshold=; path=/; max-age=0';
		document.cookie = 'session_start=; path=/; max-age=0';
		window.location.href = '/';
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<wrap-page>
	{@render children?.()}

	<footer>
		<div class="footer-content">
			<div class="footer-column">
				<h3>Lists</h3>
				<ul>
					{#each mainFeeds as feed}
						<li><a href="/{feed.id}">{feed.name}</a></li>
					{/each}
				</ul>
			</div>
			<div class="footer-column">
				<h3>More Lists</h3>
				<ul>
					{#each moreFeeds as feed}
						<li><a href="/{feed.id}">{feed.name}</a></li>
					{/each}
				</ul>
			</div>
			<div class="footer-column">
				<h3>About</h3>
				<ul>
					<li>
						<a href="https://github.com/Leftium/hn" target="_blank" rel="noopener">
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="currentColor"
								style="vertical-align: text-bottom; margin-right: 4px;"
							>
								<path
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
								/>
							</svg>
							Leftium/hn
						</a>
					</li>
					<li>
						<a href="https://leftium.com" target="_blank" rel="noopener">
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="currentColor"
								style="vertical-align: text-bottom; margin-right: 4px;"
							>
								<path
									d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"
								/>
							</svg>
							Leftium.com
						</a>
					</li>
					{#if clientSessionExpires}
						<li class="session-item">
							<h4>Session</h4>
							<div class="session-text">
								Ends: {formatExpiryTime(clientSessionExpires)}
								{#if sessionTimeRemaining !== null && sessionTimeRemaining >= 0}
									({sessionTimeRemaining}m)
								{/if}
							</div>
							<button onclick={endSession} class="end-session-btn">End session</button>
							{#if data.visitData}
								<div class="visits-text">
									{data.visitData.total}{getOrdinalSuffix(data.visitData.total)} visit
								</div>
							{/if}
						</li>
					{/if}
				</ul>
			</div>
		</div>
	</footer>
</wrap-page>

<style>
	wrap-page {
		display: block;
		box-shadow: var(--shadow-6);
	}

	@media (min-width: 42.875em) {
		wrap-page {
			border-left: 1px solid light-dark(#e6e6df, #3a3a3a);
			border-right: 1px solid light-dark(#e6e6df, #3a3a3a);
		}
	}

	footer {
		background: light-dark(#e8e8e8, #1a1a1a);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
		padding: var(--size-6) var(--size-4);
	}

	.footer-content {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--size-6);
		max-width: 42.875em;
		margin: 0 auto;
	}

	footer h3 {
		font-size: var(--font-size-2);
		font-weight: var(--font-weight-6);
		margin-bottom: var(--size-3);
		color: light-dark(#333, #ccc);
	}

	footer ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	footer li {
		margin-bottom: var(--size-2);
	}

	footer a {
		color: light-dark(#666, #999);
		text-decoration: none;
		font-size: var(--font-size-1);
		transition: color 0.15s ease;
		word-break: break-word;
		overflow-wrap: break-word;
	}

	footer a:hover {
		color: light-dark(#ff6600, #ff9944);
		text-decoration: underline;
	}

	.session-item {
		display: flex;
		flex-direction: column;
		gap: var(--size-1);
		margin-top: var(--size-4);
	}

	.session-item h4 {
		font-size: var(--font-size-1);
		font-weight: var(--font-weight-6);
		margin: 0;
		color: light-dark(#666, #999);
	}

	.session-text {
		color: light-dark(#666, #999);
		font-size: var(--font-size-1);
	}

	.visits-text {
		color: light-dark(#666, #999);
		font-size: var(--font-size-1);
		margin-top: var(--size-2);
	}

	.end-session-btn {
		align-self: flex-start;
		padding: var(--size-1) var(--size-2);
		font-size: var(--font-size-0);
		background: light-dark(#f5f5f5, #2a2a2a);
		border: 1px solid light-dark(#ccc, #444);
		border-radius: 4px;
		cursor: pointer;
		color: light-dark(#666, #999);
		transition: all 0.15s ease;
		margin-left: 0;
	}

	.end-session-btn:hover {
		background: light-dark(#e0e0e0, #333);
		border-color: light-dark(#999, #666);
		color: light-dark(#333, #ccc);
	}
</style>
