import type { NormalizedStory } from './fetch-hckrnews';

const SOURCE_URLS: Record<string, string> = {
	shownew: 'https://news.ycombinator.com/shownew',
	asknew: 'https://news.ycombinator.com/asknew',
	noobstories: 'https://news.ycombinator.com/noobstories',
	pool: 'https://news.ycombinator.com/pool',
	classic: 'https://news.ycombinator.com/classic',
	launches: 'https://news.ycombinator.com/launches',
	invited: 'https://news.ycombinator.com/invited',
	active: 'https://news.ycombinator.com/active'
};

function parseHNHTML(html: string): { stories: NormalizedStory[]; nextId?: string } {
	const stories: NormalizedStory[] = [];
	const storyRegex =
		/<tr class="athing submission" id="(\d+)">.*?<span class="titleline"><a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<span class="sitebit comhead">.*?<span class="sitestr">([^<]+)<\/span>.*?<\/span>)?<\/span>.*?<span class="score"[^>]*>(\d+) points?<\/span> by <a href="user\?id=([^"]+)"[^>]*>[^<]+<\/a> <span class="age" title="[^"]+\s+(\d{10,})".*?<\/span>.*?(?:<a href="item\?id=\d+">(\d+)&nbsp;comments?<\/a>|<a href="item\?id=\d+">discuss<\/a>)/gs;

	let match;
	while ((match = storyRegex.exec(html)) !== null) {
		const [, id, url, rawTitle, domain, points, user, timestamp, comments] = match;

		const title = rawTitle
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&#39;/g, "'");

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
			time: parseInt(timestamp, 10),
			user
		});
	}

	const moreLinkMatch = html.match(
		/href=['"]([^"']*)\?next=(\d+)[^"']*['"][^>]*class=['"]morelink['"]/
	);
	const nextId = moreLinkMatch ? moreLinkMatch[2] : undefined;

	return { stories, nextId };
}

export async function fetchHN(
	fetchFn: typeof fetch,
	source: string,
	startId?: string,
	pageCount: number = 1,
	startIndex: number = 0
): Promise<{ stories: NormalizedStory[]; nextRange?: string }> {
	const baseUrl = SOURCE_URLS[source];
	if (!baseUrl) {
		throw new Error(`Unknown HN source: ${source}`);
	}

	const isClassic = source === 'classic';
	const allStories: NormalizedStory[] = [];
	const seenIds = new Set<number>();
	let currentId = startId;
	let currentPage = startId ? Math.floor(startIndex / 30) + 1 : 1;

	for (let page = 0; page < pageCount; page++) {
		try {
			let url = baseUrl;
			if (isClassic) {
				if (currentPage > 1) {
					url = `${baseUrl}?p=${currentPage}`;
				}
			} else if (currentId) {
				url = `${baseUrl}?next=${currentId}`;
			}

			const response = await fetchFn(url);
			const html = await response.text();
			const parsed = parseHNHTML(html);

			if (parsed.stories.length === 0) break;

			for (const story of parsed.stories) {
				if (!seenIds.has(story.id)) {
					seenIds.add(story.id);
					allStories.push(story);
				}
			}

			if (isClassic) {
				currentPage++;
			} else {
				currentId = parsed.nextId || parsed.stories[parsed.stories.length - 1].id.toString();
			}
		} catch (error) {
			break;
		}
	}

	const totalItems = startIndex + allStories.length;
	const nextRange =
		allStories.length > 0
			? isClassic
				? `${currentPage}:${totalItems}:${pageCount}`
				: `${allStories[allStories.length - 1].id}:${totalItems}:${pageCount}`
			: undefined;

	return {
		stories: allStories,
		nextRange
	};
}
