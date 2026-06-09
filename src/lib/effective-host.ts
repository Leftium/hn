import { dev } from '$app/environment';

export function getEffectiveHostname(url: URL): string {
	return dev ? (url.searchParams.get('spoofHost') ?? url.hostname) : url.hostname;
}
