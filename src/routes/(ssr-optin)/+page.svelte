<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';

	let { data } = $props();
	const hckrnewsPath = resolve('/hckrnews');

	$effect(() => {
		if (!browser || !data.isLegacyHost) return;

		// Give legacy item hashes to the shared layout redirect. A bare legacy-host root
		// should behave like normal root traffic and land on the HckrNews list.
		if (!window.location.hash.match(/^#\/item\/\d+\/?$/)) {
			window.location.replace(hckrnewsPath);
		}
	});
</script>

{#if data.isLegacyHost}
	<!-- Only shown without JavaScript; hash links need the browser to expose the item id. -->
	<noscript>
		<div class="legacy-route-message">
			This legacy HckrWeb link may need JavaScript to redirect to the new URL format. If the address
			looks like <code>hw.leftium.com/#/item/123</code>, open
			<code>hn.leftium.com/i/123</code> instead. For the current HckrNews list, open
			<a href={hckrnewsPath}>hn.leftium.com/hckrnews</a>.
		</div>
	</noscript>
{/if}

<style>
	.legacy-route-message {
		max-width: 42.875em;
		margin: var(--size-4) auto;
		padding: var(--size-3) var(--size-4);
		background: light-dark(#fff4cc, #332900);
		border: 1px solid light-dark(#e6c765, #6f5b18);
		border-radius: var(--radius-2);
		color: light-dark(#4d3a00, #ffe8a3);
	}
</style>
