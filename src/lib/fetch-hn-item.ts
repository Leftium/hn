/**
 * Fetch HN item data (story/comment + nested comment tree) from the official
 * HN Firebase API.
 */

export interface HNItem {
	id: number;
	title: string;
	points: number | null;
	user: string | null;
	time: number;
	time_ago: string;
	type: 'link' | 'comment' | 'ask' | 'job' | 'poll';
	content: string;
	url: string;
	domain: string;
	comments: HNItem[];
	comments_count: number;
	level: number;
}

interface FirebaseItem {
	id: number;
	deleted?: boolean;
	type?: 'job' | 'story' | 'comment' | 'poll' | 'pollopt';
	by?: string;
	time?: number;
	text?: string;
	dead?: boolean;
	parent?: number;
	poll?: number;
	kids?: number[];
	url?: string;
	score?: number;
	title?: string;
	parts?: number[];
	descendants?: number;
}

function toHNItemType(type: FirebaseItem['type']): HNItem['type'] {
	if (type === 'story') return 'link';
	if (type === 'job' || type === 'poll') return type;
	return 'comment';
}

export async function fetchHNItemTree(id: number, fetchFn: typeof fetch = fetch): Promise<HNItem> {
	const fetchFirebaseItem = async (itemId: number): Promise<FirebaseItem | null> => {
		const response = await fetchFn(`https://hacker-news.firebaseio.com/v0/item/${itemId}.json`);

		if (!response.ok) {
			throw new Error(`HN Firebase API error: ${response.status} ${response.statusText}`);
		}

		return response.json();
	};

	const buildItem = async (itemId: number, level = 0): Promise<HNItem> => {
		const item = await fetchFirebaseItem(itemId);

		if (!item) {
			throw new Error(`HN item ${itemId} not found`);
		}

		const comments = await Promise.all((item.kids ?? []).map((kid) => buildItem(kid, level + 1)));

		return {
			id: item.id,
			title: item.title ?? '',
			points: item.score ?? null,
			user: item.by ?? null,
			time: item.time ?? 0,
			time_ago: '',
			type: toHNItemType(item.type),
			content: item.dead ? '<p>[dead]' : (item.text ?? ''),
			url: item.url ?? (item.type === 'comment' && item.parent ? `item?id=${item.parent}` : ''),
			domain: item.url ? domainify(item.url) : '',
			comments,
			comments_count: item.descendants ?? comments.length,
			level
		};
	};

	return buildItem(id);
}

/**
 * Extract domain + optional first path segment from a URL.
 * Ported from hw.leftium.com's domainify() logic.
 */
export function domainify(url: string | null | undefined): string {
	if (!url) return '';
	try {
		const parsed = new URL(url);
		let domain = parsed.hostname.replace(/^www\./, '');

		// Append first path segment if: domain <= 25 chars, segment 3-15 chars,
		// starts with letter, has no dots (e.g. "github.com/user")
		const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
		if (
			firstSegment &&
			domain.length <= 25 &&
			firstSegment.length >= 3 &&
			firstSegment.length <= 15 &&
			/^[a-z]/i.test(firstSegment) &&
			!firstSegment.includes('.')
		) {
			domain += '/' + firstSegment;
		}

		return domain;
	} catch {
		return '';
	}
}
