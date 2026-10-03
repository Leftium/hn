import type { NormalizedStory } from './fetch-hckrnews';
import { createHash } from 'node:crypto';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, tryAsync, type Result } from 'wellcrafted/result';

export const SOURCE_URLS: Record<string, string> = {
	shownew: 'https://news.ycombinator.com/shownew',
	asknew: 'https://news.ycombinator.com/asknew',
	noobstories: 'https://news.ycombinator.com/noobstories',
	pool: 'https://news.ycombinator.com/pool',
	classic: 'https://news.ycombinator.com/classic',
	launches: 'https://news.ycombinator.com/launches',
	invited: 'https://news.ycombinator.com/invited',
	active: 'https://news.ycombinator.com/active'
};

export type HNFeed = { stories: NormalizedStory[]; nextRange?: string };

type RequestContext = { source: string; url: string; partial?: HNFeed };
type ResponseContext = RequestContext & {
	status: number;
	statusText: string;
	retryAfter: string | null;
	contentType: string | null;
	responseSize: number;
	fingerprint: string;
	preview: string;
	storyRows: number;
};

export const HNError = defineErrors({
	UpstreamHttpError: (context: ResponseContext) => ({
		...context,
		message: `Hacker News refused this request (HTTP ${context.status}).`
	}),
	NetworkError: (context: RequestContext & { cause: string }) => ({
		...context,
		message: 'Could not reach Hacker News.'
	}),
	ParseError: (context: ResponseContext & { parsedStories: number }) => ({
		...context,
		message: 'Hacker News loaded, but its list format could not be parsed.'
	}),
	UnexpectedResponse: (
		context: RequestContext & { reason: string } & Partial<ResponseContext>
	) => ({
		...context,
		message: 'Hacker News returned an unexpected response. Try again later.'
	})
});
export type HNError = InferErrors<typeof HNError>;

function responseContext(
	response: Response,
	html: string,
	context: RequestContext
): ResponseContext {
	return {
		...context,
		status: response.status,
		statusText: response.statusText,
		retryAfter: response.headers.get('retry-after'),
		contentType: response.headers.get('content-type'),
		responseSize: new TextEncoder().encode(html).length,
		fingerprint: createHash('sha256').update(html).digest('hex').slice(0, 16),
		preview: html
			.replace(/<[^>]*>/g, ' ')
			.replace(/[\s\p{Cc}]+/gu, ' ')
			.trim()
			.slice(0, 160),
		storyRows: (html.match(/<tr\b[^>]*class=["'][^"']*\bathing\b/g) ?? []).length
	};
}

function parseHNHTML(html: string): { stories: NormalizedStory[]; nextId?: string } {
	const stories: NormalizedStory[] = [];
	const storyRegex =
		/<tr class="athing submission" id="(\d+)">.*?<span class="titleline"><a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<span class="sitebit comhead">.*?<span class="sitestr">([^<]+)<\/span>.*?<\/span>)?<\/span>.*?<span class="score"[^>]*>(\d+) points?<\/span> by <a href="user\?id=([^"]+)"[^>]*>[^<]+<\/a> <span class="age" title="([^"]+)".*?<\/span>.*?(?:<a href="item\?id=\d+">(\d+)&nbsp;comments?<\/a>|<a href="item\?id=\d+">discuss<\/a>)/gs;

	for (const row of html.split(/(?=<tr\b[^>]*class=["'][^"']*\bathing\b)/)) {
		storyRegex.lastIndex = 0;
		const match = storyRegex.exec(row);
		if (!match) continue;
		const [, id, url, rawTitle, domain, points, user, ageTitle, comments] = match;
		const legacyTimestamp = ageTitle.match(/(?:^|\s)(\d{10,})$/)?.[1];
		const timestamp = legacyTimestamp
			? parseInt(legacyTimestamp, 10)
			: Math.floor(
					Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(ageTitle) ? ageTitle : `${ageTitle}Z`) / 1000
				);

		if (!Number.isFinite(timestamp)) continue;

		const title = rawTitle
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&#39;/g, "'")
			.replace(/&#x2F;/g, '/');

		let finalUrl: string | undefined = url;
		let finalDomain: string | undefined = domain;

		if (url.startsWith('item?id=')) {
			finalUrl = `https://news.ycombinator.com/${url}`;
			finalDomain = undefined;
		} else if (!url.startsWith('http')) {
			finalUrl = `https://news.ycombinator.com/${url}`;
		} else if (!domain) {
			try {
				const urlObj = new URL(url);
				finalDomain = urlObj.hostname.replace(/^www\./, '');
			} catch {
				finalDomain = undefined;
			}
		}

		stories.push({
			id: parseInt(id, 10),
			title,
			url: finalUrl,
			domain: finalDomain,
			points: parseInt(points, 10),
			comments: comments ? parseInt(comments, 10) : 0,
			time: timestamp,
			user
		});
	}

	const moreLinkMatch = html.match(
		/href=['"]([^"']*)\?next=(\d+)[^"']*['"][^>]*class=['"]morelink['"]/
	);
	const nextId = moreLinkMatch ? moreLinkMatch[2] : undefined;

	return { stories, nextId };
}

/** Failures retain earlier pages in error.partial; nextRange retries the failed page. */
export async function fetchHN(
	fetchFn: typeof fetch,
	source: string,
	startId?: string,
	pageCount: number = 1,
	startIndex: number = 0
): Promise<Result<HNFeed, HNError>> {
	const baseUrl = SOURCE_URLS[source];
	if (!baseUrl) return HNError.UnexpectedResponse({ source, url: '', reason: 'Unknown feed' });

	const usesPagePagination = source === 'classic' || source === 'active';
	const allStories: NormalizedStory[] = [];
	const seenIds = new Set<number>();
	let currentId = startId;
	let currentPage = startId ? parseInt(startId, 10) : 1;
	let hasMore = false;
	const feed = (): HNFeed => ({
		stories: allStories,
		nextRange: hasMore
			? `${usesPagePagination ? currentPage : currentId}:${startIndex + allStories.length}:${pageCount}`
			: undefined
	});

	for (let page = 0; page < pageCount; page++) {
		const url = usesPagePagination
			? `${baseUrl}${currentPage > 1 ? `?p=${currentPage}` : ''}`
			: `${baseUrl}${currentId ? `?next=${currentId}` : ''}`;
		const context: RequestContext = {
			source,
			url,
			partial: allStories.length ? feed() : undefined
		};
		const fetched = await tryAsync({
			try: async () => {
				const response = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
				return { response, html: await response.text() };
			},
			catch: (cause) =>
				HNError.NetworkError({
					...context,
					cause: (cause instanceof Error ? cause.message : String(cause)).slice(0, 300)
				})
		});
		if (fetched.error) return fetched;
		const { response, html } = fetched.data;
		const diagnostics = responseContext(response, html, context);
		if (!response.ok) return HNError.UpstreamHttpError(diagnostics);
		if (
			/^sorry\b/i.test(diagnostics.preview) ||
			(diagnostics.contentType &&
				!/text\/html|application\/xhtml\+xml/i.test(diagnostics.contentType))
		) {
			return HNError.UnexpectedResponse({
				...diagnostics,
				reason: 'Blocking page or non-HTML response'
			});
		}
		const parsed = parseHNHTML(html);
		if (diagnostics.storyRows > 0 && parsed.stories.length !== diagnostics.storyRows) {
			return HNError.ParseError({ ...diagnostics, parsedStories: parsed.stories.length });
		}
		if (parsed.stories.length === 0) {
			// Only a recognizable list container without rows or pagination is genuinely empty.
			if (
				!/id=["']hnmain["']/.test(html) ||
				!/class=["']itemlist["']/.test(html) ||
				/morelink/.test(html)
			) {
				return HNError.UnexpectedResponse({ ...diagnostics, reason: 'Missing HN list structure' });
			}
			hasMore = false;
			break;
		}
		for (const story of parsed.stories) {
			if (!seenIds.has(story.id)) {
				seenIds.add(story.id);
				allStories.push(story);
			}
		}
		hasMore = /class=["']morelink["']/.test(html);
		if (usesPagePagination) currentPage++;
		else {
			currentId = parsed.nextId;
			hasMore = hasMore && !!currentId;
		}
		if (!hasMore) break;
	}
	return Ok(feed());
}
