import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const sessionStartCookie = cookies.get('session_start');
	const totalVisits = cookies.get('visits_total');

	const result: {
		isLegacyHost: boolean;
		sessionExpires?: number;
		visitData?: { total: number };
	} = {
		// hw.leftium.com is the legacy HckrWeb host; no-JS visitors there likely arrived
		// from old hash-based links that cannot be redirected on the server.
		isLegacyHost: url.hostname === 'hw.leftium.com'
	};

	if (sessionStartCookie) {
		const sessionStart = parseInt(sessionStartCookie, 10);
		result.sessionExpires = sessionStart + 20 * 60;
	}

	const total = totalVisits ? parseInt(totalVisits, 10) : 1;
	result.visitData = {
		total
	};

	return result;
};
