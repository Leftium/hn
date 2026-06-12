import { error } from '@sveltejs/kit';
import { fetchHNItemTree } from '$lib/fetch-hn-item';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	const id = parseInt(params.id, 10);

	if (isNaN(id) || id <= 0) {
		error(400, 'Invalid item ID');
	}

	try {
		const item = await fetchHNItemTree(id, fetch);
		return { item };
	} catch (e) {
		error(404, `Item ${id} not found`);
	}
};
