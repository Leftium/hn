import { error, json } from '@sveltejs/kit';
import { fetchHNItemTree } from '$lib/fetch-hn-item';
import type { RequestHandler } from './$types';

const MAX_BATCH_SIZE = 12;
const MAX_DEPTH = 2;

export const POST: RequestHandler = async ({ request, fetch }) => {
	const body = (await request.json()) as { ids?: unknown; depth?: unknown };
	const ids = Array.isArray(body.ids)
		? body.ids.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, MAX_BATCH_SIZE)
		: [];
	const depth =
		typeof body.depth === 'number' && Number.isFinite(body.depth)
			? Math.max(1, Math.min(MAX_DEPTH, Math.floor(body.depth)))
			: MAX_DEPTH;

	if (ids.length === 0) {
		error(400, 'Expected ids array');
	}

	try {
		const items = await Promise.all(ids.map((id) => fetchHNItemTree(id, fetch, { maxDepth: depth })));
		return json({ items });
	} catch {
		error(404, 'Comment children not found');
	}
};
