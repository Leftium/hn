import type { Handle } from '@sveltejs/kit/hooks';
import { parseFragment } from 'parse5';

const SITE_NAME = 'HN Reader';

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!;
	});
}

function itemTitle(value: unknown, id: string): string | null {
	if (!value || typeof value !== 'object') return null;
	const item = value as Record<string, unknown>;
	if (
		item.id !== Number(id) ||
		item.deleted ||
		item.dead ||
		!['story', 'job', 'poll'].includes(String(item.type)) ||
		typeof item.title !== 'string'
	)
		return null;
	// Parse upstream HTML once: decode entities, retain visible text, and discard markup.
	// Encoded angle brackets stay text and are escaped again only when emitting tags.
	const nodes = [...parseFragment(item.title).childNodes].reverse();
	const text: string[] = [];
	while (nodes.length) {
		const node = nodes.pop()!;
		if ('value' in node) text.push(node.value);
		else if ('tagName' in node && !['script', 'style', 'template'].includes(node.tagName)) {
			nodes.push(...node.childNodes.slice().reverse());
		}
	}
	return (
		text
			.join('')
			// Strip upstream control characters from HTML metadata.
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.trim()
			.slice(0, 300) || null
	);
}

export function createSocialMetadata({
	fetchFn = globalThis.fetch,
	timeoutMs = 1500,
	ttlMs = 5 * 60 * 1000,
	failureTtlMs = 30 * 1000,
	maxEntries = 256,
	now = Date.now
} = {}) {
	const cache = new Map<string, { expires: number; title: Promise<string | null> }>();

	async function lookup(id: string): Promise<string | null> {
		const cached = cache.get(id);
		if (cached && cached.expires > now()) return cached.title;
		cache.delete(id);
		if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);

		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => {
				resolve(null);
				controller.abort();
			}, timeoutMs);
		});
		const request = Promise.resolve()
			.then(async () => {
				const response = await fetchFn(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
					signal: controller.signal,
					headers: { accept: 'application/json' }
				});
				if (!response.ok) return null;
				return itemTitle(await response.json(), id);
			})
			.catch(() => null);
		const entry = { expires: Infinity, title: Promise.race([request, timeout]) };
		cache.set(id, entry);
		try {
			const title = await entry.title;
			entry.expires = now() + (title ? ttlMs : failureTtlMs);
			return title;
		} finally {
			clearTimeout(timer!);
		}
	}

	async function tags(url: URL): Promise<string> {
		const id = /^\/i\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1];
		const title = id && Number.isSafeInteger(Number(id)) ? await lookup(id) : null;
		const canonicalUrl = new URL(url);
		canonicalUrl.search = '';
		canonicalUrl.hash = '';
		const canonical = canonicalUrl.href;
		const pageTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
		const socialTitle = title || SITE_NAME;
		return [
			`<title>${escapeHtml(pageTitle)}</title>`,
			`<link rel="canonical" href="${escapeHtml(canonical)}" />`,
			...Object.entries({
				'og:type': 'website',
				'og:site_name': SITE_NAME,
				'og:title': socialTitle,
				'og:url': canonical,
				'twitter:card': 'summary',
				'twitter:title': socialTitle,
			}).map(
				([name, content]) =>
					`<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${escapeHtml(content)}" />`
			)
		].join('\n');
	}

	const handle: Handle = async ({ event, resolve }) => {
		if (event.isDataRequest) return resolve(event);
		let buffered = '';
		return resolve(event, {
			transformPageChunk: async ({ html, done }) => {
				// Buffer chunks so a split head tag cannot skip metadata injection.
				buffered += html;
				if (!done) return '';
				if (!buffered.includes('</head>')) return buffered;
				const metadata = await tags(event.url);
				return buffered
					.replace('<title>HN Reader</title>', '')
					.replace('</head>', `${metadata}</head>`);
			}
		});
	};
	return { tags, handle };
}
