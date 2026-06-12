import { error } from '@sveltejs/kit';
import { fetchHNItemTree } from '$lib/fetch-hnpwa';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, fetch }) => {
	const id = parseInt(params.id, 10);

	if (isNaN(id) || id <= 0) {
		error(400, 'Invalid item ID');
	}

	const cacheBust = url.searchParams.has('cb');

	try {
		const item = await fetchHNItemTree(id, fetch, cacheBust);
		return { item };
	} catch (e) {
		error(404, `Item ${id} not found`);
	}
};
