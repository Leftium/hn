import type { PageServerLoad } from './$types';
import { fetchHckrnews } from '$lib/fetch-hckrnews';
import { fetchHNApi } from '$lib/fetch-hn-api';
import { fetchHN } from '$lib/fetch-hn';

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
	const source = params.source || 'hckrnews';
	const date = params.date;

	const visitHistory = cookies.get('visits_history');
	const totalVisits = cookies.get('visits_total');
	const pagesPerLoadCookie = cookies.get('pages_per_load');
	const thresholdCookie = cookies.get('new_item_threshold');
	const sessionStartCookie = cookies.get('session_start');

	const defaultPages = pagesPerLoadCookie ? parseInt(pagesPerLoadCookie, 10) : 1;

	const now = Math.floor(Date.now() / 1000);
	const recent = visitHistory ? visitHistory.split('-').map(Number) : [];
	let total = totalVisits ? parseInt(totalVisits, 10) : 0;

	if (!thresholdCookie) {
		recent.push(now);
		total += 1;

		const trimmed = recent.slice(-10);
		cookies.set('visits_history', trimmed.join('-'), { path: '/', maxAge: 60 * 60 * 24 * 365 });
		cookies.set('visits_total', total.toString(), { path: '/', maxAge: 60 * 60 * 24 * 365 });
	}

	const trimmed = recent.slice(-10);
	const previousSession = trimmed.length > 1 ? trimmed[trimmed.length - 2] : null;
	const previousSessionOverride = thresholdCookie ? parseInt(thresholdCookie, 10) : previousSession;
	const currentSession = trimmed.at(-1) ?? null;

	if (previousSessionOverride !== null) {
		cookies.set('new_item_threshold', previousSessionOverride.toString(), {
			path: '/',
			maxAge: 20 * 60,
			httpOnly: false
		});
	}

	cookies.set('session_start', now.toString(), {
		path: '/',
		maxAge: 20 * 60,
		httpOnly: false
	});

	const sessionStart = now;

	const visitData = {
		total,
		currentSession,
		previousSessionOverride,
		recentVisits: trimmed,
		sessionStart
	};

	let result;
	let previousDate: string | undefined;
	let nextRange: string | undefined;
	let startPage = 1;
	let endPage = defaultPages;
	let startIndex = 0;

	if (source === 'hckrnews') {
		const hckrResult = await fetchHckrnews(fetch, date);
		result = hckrResult.stories;
		previousDate = hckrResult.previousDate;
	} else if (['news', 'newest', 'best', 'ask', 'show', 'jobs'].includes(source)) {
		if (date) {
			if (date.includes(':')) {
				const [start, end] = date.split(':').map(Number);
				startPage = start;
				endPage = end;
			} else if (/^\d+$/.test(date)) {
				startPage = endPage = parseInt(date, 10);
			}
		}

		const apiResult = await fetchHNApi(fetch, source, startPage, endPage);
		result = apiResult.stories;
		nextRange = apiResult.nextRange;
		startIndex = (startPage - 1) * 30;
	} else if (['shownew', 'noobstories', 'pool', 'classic', 'launches', 'active'].includes(source)) {
		let startId: string | undefined;
		let pageCount = defaultPages;
		let itemIndex = 0;

		if (date) {
			const parts = date.split(':');
			if (parts.length === 3) {
				startId = parts[0];
				itemIndex = parseInt(parts[1], 10);
				pageCount = parseInt(parts[2], 10);
			} else if (parts.length === 2) {
				startId = parts[0];
				itemIndex = parseInt(parts[1], 10);
			} else {
				startId = date;
				pageCount = 1;
			}
		}

		if ((source === 'classic' || source === 'active') && startId) {
			const pageNum = parseInt(startId, 10);
			startIndex = (pageNum - 1) * 30;
		} else {
			startIndex = itemIndex;
		}

		const hnResult = await fetchHN(fetch, source, startId, pageCount, startIndex);
		result = hnResult.stories;
		nextRange = hnResult.nextRange;
		startIndex = source === 'classic' || source === 'active' ? startIndex : itemIndex;
	} else {
		const hnResult = await fetchHN(fetch, source);
		result = hnResult.stories;
	}

	const newStoryCount = previousSessionOverride
		? result.filter((story) => {
				const storyTime = story.time_frontpage || story.time;
				return storyTime > previousSessionOverride;
			}).length
		: 0;

	return {
		stories: result,
		previousDate,
		nextRange,
		startPage,
		endPage,
		startIndex,
		visitData,
		source,
		newStoryCount
	};
};
