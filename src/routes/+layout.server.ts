import { getEffectiveHostname } from '$lib/effective-host';
import { parseViolationThreshold } from '$lib/comment-violations';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const sessionStartCookie = cookies.get('session_start');
	const totalVisits = cookies.get('visits_total');

	const effectiveHostname = getEffectiveHostname(url);

	const result: {
		isLegacyHost: boolean;
		sessionExpires?: number;
		visitData?: { total: number };
		violationThreshold: number | null;
	} = {
		// hw.leftium.com is the legacy HckrWeb host; no-JS visitors there likely arrived
		// from old hash-based links that cannot be redirected on the server.
		isLegacyHost: effectiveHostname === 'hw.leftium.com',
		violationThreshold: parseViolationThreshold(cookies.get('comment_violation_threshold'))
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
