// Node's native TypeScript runner requires the runtime extension.
// @ts-expect-error allowImportingTsExtensions is intentionally not enabled project-wide.
import { fetchHN, SOURCE_URLS } from '../src/lib/fetch-hn.ts';

async function main() {
	if (!process.argv.includes('--live')) {
		console.error('Opt-in required: pnpm diagnose:hn --live [feed]');
		process.exitCode = 1;
		return;
	}
	const source = process.argv.slice(2).find((arg) => arg !== '--live');
	if (source && !Object.hasOwn(SOURCE_URLS, source)) {
		console.error(`Unknown feed: ${source}`);
		process.exitCode = 1;
		return;
	}
	for (const feed of source ? [source] : Object.keys(SOURCE_URLS)) {
		let status: number | undefined;
		let contentType: string | null = null;
		const fetchFn: typeof fetch = async (input, init) => {
			const response = await fetch(input, init);
			status = response.status;
			contentType = response.headers.get('content-type');
			return response;
		};
		const result = await fetchHN(fetchFn, feed);
		console.log(
			JSON.stringify({
				source: feed,
				status,
				contentType,
				parsedCount: result.data?.stories.length ?? 0,
				error: result.error
			})
		);
	}
}
void main();
