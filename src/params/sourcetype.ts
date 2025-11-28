import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => {
	return [
		'hckrnews',
		'news',
		'newest',
		'best',
		'ask',
		'show',
		'jobs',
		'shownew',
		'asknew',
		'active',
		'bestcomments',
		'noobstories',
		'pool',
		'classic',
		'launches',
		'invited'
	].includes(param);
};
