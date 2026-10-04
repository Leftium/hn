import { dev } from '$app/env';

export function getEffectiveHostname(url: URL): string {
	return dev ? (url.searchParams.get('spoofHost') ?? url.hostname) : url.hostname;
}
