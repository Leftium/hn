import { defineParams } from '@sveltejs/kit/params';

const matchSourcetype = (param: string) => {
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

export const params = defineParams({
	sourcetype: (param) => (matchSourcetype(param) ? param : undefined)
});
