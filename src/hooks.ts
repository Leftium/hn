import type { Reroute } from '@sveltejs/kit';

import { getEffectiveHostname } from '$lib/effective-host';

export const reroute: Reroute = ({ url }) => {
	if (url.pathname === '/' && getEffectiveHostname(url) === 'hn.leftium.com') {
		return '/hckrnews';
	}
};
