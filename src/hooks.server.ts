import { createHandler } from 'web-sentinel/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import { createSocialMetadata } from '#lib/social-meta.ts';

export const handle = sequence(
	createHandler({ log: true, preview: false, http_status: 418 }),
	createSocialMetadata().handle
);
