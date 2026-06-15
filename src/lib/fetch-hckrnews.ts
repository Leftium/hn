export interface NormalizedStory {
	id: number;
	title: string;
	url?: string;
	domain?: string;
	points: number;
	comments: number;
	time: number;
	time_frontpage?: number;
	user: string;
	dead?: boolean;
	deleted?: boolean;
	type?: string;
}

interface HckrNewsItem {
	id: number;
	link_text: string;
	link?: string;
	source?: string;
	submitter?: string;
	points: number;
	comments: number;
	time: number;
	date: number;
	dead?: boolean;
}

export async function fetchHckrnews(
	fetchFn: typeof fetch,
	date?: string
): Promise<{ stories: NormalizedStory[]; previousDate: string }> {
	const filename = date ? `${date.replace(/\./g, '')}.js` : 'latest.js';

	const response = await fetchFn(`https://hckrnews.com/data/${filename}`);
	const text = await response.text();

	const json: HckrNewsItem[] = JSON.parse(text.replace(/^var entries =/, ''));

	let prevDate: Date;
	if (date) {
		const [year, month, day] = date.split('.').map(Number);
		prevDate = new Date(Date.UTC(year, month - 1, day));
	} else {
		const lastItem = json[json.length - 1];
		prevDate = new Date(lastItem.date * 1000);
	}
	prevDate.setUTCDate(prevDate.getUTCDate() - 1);

	const previousDate = `${prevDate.getUTCFullYear()}.${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}.${String(prevDate.getUTCDate()).padStart(2, '0')}`;

	const stories: NormalizedStory[] = json.map((item) => ({
		id: item.id,
		title: item.dead
			? '[dead]'
			: !item.link_text || item.link_text === 'undefined'
				? '[deleted]'
				: item.link_text,
		url: item.link,
		domain: item.source?.replace(/^(www.)?/, ''),
		points: item.points,
		comments: item.comments || 0,
		time: item.time,
		time_frontpage: item.date,
		user: item.submitter ?? '',
		dead: item.dead
	}));

	return { stories, previousDate };
}
