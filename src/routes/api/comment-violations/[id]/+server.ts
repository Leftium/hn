import { parseViolationResult } from '#lib/comment-violations.js';
import type { RequestHandler } from './$types';

const EMPTY_RESULT = { violations: [] };

export const GET: RequestHandler = async ({ fetch, params, setHeaders }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return Response.json(EMPTY_RESULT, { status: 400 });

	try {
		const response = await fetch(`https://classify.stylometry.net/violations/${id}`, {
			signal: AbortSignal.timeout(4_000)
		});
		if (!response.ok) return Response.json(EMPTY_RESULT);

		const result = parseViolationResult(await response.json());
		if (!result || result.id !== id) return Response.json(EMPTY_RESULT);

		setHeaders({ 'cache-control': 'public, max-age=30' });
		return Response.json(result);
	} catch {
		return Response.json(EMPTY_RESULT);
	}
};
