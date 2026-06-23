import type { HNItem } from './fetch-hn-item';

interface HnpwaItem {
	id: number;
	title: string;
	points: number | null;
	user: string | null;
	time: number;
	time_ago: string;
	type: HNItem['type'];
	content: string;
	url: string;
	domain: string;
	comments?: HnpwaItem[];
	comments_count: number;
	level: number;
}

const HNPWA_API_BASE = 'https://api.hnpwa.com/v0';

function toHNItem(item: HnpwaItem): HNItem {
	return {
		...item,
		comments: (item.comments ?? []).map(toHNItem),
		kids: []
	};
}

export async function fetchHnpwaItem(
	id: number,
	fetchFn: typeof fetch = fetch
): Promise<HNItem> {
	const response = await fetchFn(`${HNPWA_API_BASE}/item/${id}.json?_=${Date.now()}`);

	if (!response.ok) {
		throw new Error(`HNPWA API error: ${response.status} ${response.statusText}`);
	}

	return toHNItem((await response.json()) as HnpwaItem);
}
