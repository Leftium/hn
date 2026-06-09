import { redirect } from '@sveltejs/kit';

import { getEffectiveHostname } from '$lib/effective-host';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// The legacy HckrWeb host may receive hash routes like /#/item/123. The hash is
	// only visible in the browser, so render the shell instead of redirecting first.
	if (getEffectiveHostname(url) === 'hw.leftium.com') {
		return { isLegacyHost: true };
	}

	redirect(307, '/hckrnews');
};
