import type { Reroute } from '@sveltejs/kit/hooks';

import { getEffectiveHostname } from '#lib/effective-host.js';

export const reroute: Reroute = ({ url }) => {
	if (url.pathname === '/' && getEffectiveHostname(url) === 'hn.leftium.com') {
		return '/hckrnews';
	}
};
