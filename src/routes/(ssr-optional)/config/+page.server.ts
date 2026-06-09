import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const COOKIE_OPTIONS = {
	path: '/',
	maxAge: 60 * 60 * 24 * 365
};

export const load: PageServerLoad = async ({ cookies, url }) => {
	const visitHistory = cookies.get('visits_history')?.split('-').map(Number) ?? [];
	const total = parseInt(cookies.get('visits_total') ?? '0', 10);
	const thresholdCookie = cookies.get('new_item_threshold');
	const sessionStartCookie = cookies.get('session_start');

	const previousSession = visitHistory.length > 1 ? visitHistory[visitHistory.length - 2] : null;
	const isOverridden = thresholdCookie && parseInt(thresholdCookie, 10) !== previousSession;

	if (thresholdCookie) {
		cookies.set('new_item_threshold', thresholdCookie, {
			path: '/',
			maxAge: 20 * 60,
			httpOnly: false
		});
	}

	if (sessionStartCookie) {
		cookies.set('session_start', sessionStartCookie, {
			path: '/',
			maxAge: 20 * 60,
			httpOnly: false
		});
	}

	return {
		recent: visitHistory,
		total,
		source: url.searchParams.get('from') || 'hckrnews',
		pagesPerLoad: parseInt(cookies.get('pages_per_load') ?? '1', 10),
		selectedOverride: isOverridden && thresholdCookie ? parseInt(thresholdCookie, 10) : null
	};
};

export const actions: Actions = {
	updateSettings: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const pagesPerLoad = data.get('pages_per_load');
		const thresholdSource = data.get('threshold_source');
		const customDatetime = data.get('custom_datetime');

		if (pagesPerLoad) {
			cookies.set('pages_per_load', pagesPerLoad.toString(), COOKIE_OPTIONS);
		}

		if (thresholdSource === 'custom' && customDatetime) {
			const timestamp = Math.floor(new Date(customDatetime.toString()).getTime() / 1000);
			cookies.set('new_item_threshold', timestamp.toString(), {
				path: '/',
				maxAge: 20 * 60,
				httpOnly: false
			});
		} else if (thresholdSource && thresholdSource !== 'custom') {
			cookies.set('new_item_threshold', thresholdSource.toString(), {
				path: '/',
				maxAge: 20 * 60,
				httpOnly: false
			});
		}

		const selectedFeed = data.get('feed') || url.searchParams.get('from') || 'hckrnews';
		throw redirect(303, `/config?from=${selectedFeed}`);
	},
	clearOverride: async ({ cookies, url }) => {
		const visitHistory = cookies.get('visits_history')?.split('-').map(Number) ?? [];
		const previousSession = visitHistory.length > 1 ? visitHistory[visitHistory.length - 2] : null;

		if (previousSession) {
			cookies.set('new_item_threshold', previousSession.toString(), {
				path: '/',
				maxAge: 20 * 60,
				httpOnly: false
			});
		} else {
			cookies.delete('new_item_threshold', { path: '/' });
		}

		const selectedFeed = url.searchParams.get('from') || 'hckrnews';
		throw redirect(303, `/config?from=${selectedFeed}`);
	}
};
