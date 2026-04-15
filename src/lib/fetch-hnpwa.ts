/**
 * Fetch HN item data (story/comment + nested comment tree) from the HNPWA API.
 * https://api.hnpwa.com/v0/item/{id}.json
 *
 * HNPWA returns comments in HN's native ranked order (not chronological),
 * with the full nested tree in a single request.
 */

export interface HnpwaItem {
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
	comments: HnpwaItem[];
	comments_count: number;
	level: number;
}

const HNPWA_API_BASE = 'https://api.hnpwa.com/v0';

export async function fetchHnpwaItem(
	id: number,
	fetchFn: typeof fetch = fetch
): Promise<HnpwaItem> {
	const response = await fetchFn(`${HNPWA_API_BASE}/item/${id}.json`);

	if (!response.ok) {
		throw new Error(`HNPWA API error: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

/**
 * Extract domain + optional first path segment from a URL.
 * Ported from hw.leftium.com's domainify() logic.
 *
 * HNPWA provides a `domain` field, but it's just the hostname.
 * This adds the smart first-path-segment logic (e.g. "github.com/user").
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
