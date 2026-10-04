import assert from 'node:assert/strict';
import test from 'node:test';

// Node's native TypeScript runner requires the runtime extension.
import { fetchHN } from './fetch-hn.ts';

function storyHtml({
	id,
	ageTitle,
	comments = '12&nbsp;comments'
}: {
	id: number;
	ageTitle: string;
	comments?: string;
}) {
	return `<tr class="athing submission" id="${id}"><td class="title"><span class="titleline"><a href="https://example.com/${id}">Story ${id}</a><span class="sitebit comhead"> (<a href="from?site=example.com"><span class="sitestr">example.com</span></a>)</span></span></td></tr><tr><td class="subtext"><span class="subline"><span class="score" id="score_${id}">42 points</span> by <a href="user?id=tester" class="hnuser">tester</a> <span class="age" title="${ageTitle}"><a href="item?id=${id}">1 hour ago</a></span> | <a href="item?id=${id}">${comments}</a></span></td></tr>`;
}

function mockFetch(html: string, requestedUrls: string[]): typeof fetch {
	return (async (input: string | URL | Request) => {
		requestedUrls.push(input.toString());
		return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
	}) as typeof fetch;
}

test('parses the current ISO-only HN age title', async () => {
	const requestedUrls: string[] = [];
	const result = await fetchHN(
		mockFetch(storyHtml({ id: 123, ageTitle: '2026-08-27T18:23:43.000000Z' }), requestedUrls),
		'active'
	);

	assert.equal(result.error, null);
	assert.equal(result.data!.stories.length, 1);
	assert.equal(result.data!.stories[0].time, 1787855023);
	assert.equal(result.data!.stories[0].comments, 12);
	assert.deepEqual(requestedUrls, ['https://news.ycombinator.com/active']);
});

test('retains legacy Unix timestamps and next-id pagination', async () => {
	const requestedUrls: string[] = [];
	const html = `${storyHtml({
		id: 456,
		ageTitle: '2024-01-02T03:04:05.000000Z 1704164645',
		comments: 'discuss'
	})}<a href="shownew?next=789" class="morelink">More</a>`;
	const result = await fetchHN(mockFetch(html, requestedUrls), 'shownew', '789');

	assert.equal(result.error, null);
	assert.equal(result.data!.stories.length, 1);
	assert.equal(result.data!.stories[0].time, 1704164645);
	assert.equal(result.data!.stories[0].comments, 0);
	assert.deepEqual(requestedUrls, ['https://news.ycombinator.com/shownew?next=789']);
});

for (const [status, message] of [
	[419, 'Hacker News refused this request (HTTP 419).'],
	[403, 'Hacker News refused this request (HTTP 403).'],
	[429, 'Hacker News rate-limited this request (HTTP 429).'],
	[500, 'Hacker News returned a server error (HTTP 500).'],
	[503, 'Hacker News returned a server error (HTTP 503).'],
	[404, 'Hacker News returned HTTP 404.']
] as const) {
	test(`HTTP ${status} is a serializable upstream error`, async () => {
		const result = await fetchHN(
			(async () =>
				new Response('Sorry\n', {
					status,
					statusText: 'Refused',
					headers: { 'Retry-After': '60', 'Content-Type': 'text/plain' }
				})) as typeof fetch,
			'active'
		);
		assert.equal(result.data, null);
		assert.equal(result.error?.name, 'UpstreamHttpError');
		if (result.error?.name !== 'UpstreamHttpError') assert.fail('Expected HTTP error');
		assert.equal(result.error?.status, status);
		assert.equal(result.error.message, message);
		assert.equal(result.error?.retryAfter, '60');
		assert.equal(result.error?.preview, 'Sorry');
		assert.equal(result.error?.fingerprint, '21676075593979e0');
		assert.equal(JSON.parse(JSON.stringify(result.error)).status, status);
	});
}

test('network and response-body failures retain plain cause details', async () => {
	for (const fetchFn of [
		async () => {
			throw new Error('connection failed');
		},
		async () => {
			const response = new Response('');
			response.text = async () => {
				throw new Error('connection failed');
			};
			return response;
		}
	]) {
		const result = await fetchHN(fetchFn as typeof fetch, 'classic');
		assert.equal(result.error?.name, 'NetworkError');
		if (result.error?.name === 'NetworkError')
			assert.equal(result.error.cause, 'connection failed');
	}
});

test('200 blocking pages and unexpected content are failures', async () => {
	for (const html of [
		'Sorry.',
		'<html><body>Please verify your browser</body></html>',
		'{"stories":[]}'
	]) {
		const result = await fetchHN(mockFetch(html, []), 'active');
		assert.equal(result.error?.name, 'UnexpectedResponse');
	}
});

test('recognizable HN rows with changed markup are parse errors', async () => {
	const html = storyHtml({ id: 123, ageTitle: 'invalid' });
	const result = await fetchHN(mockFetch(html, []), 'classic');
	assert.equal(result.error?.name, 'ParseError');
	if (result.error?.name === 'ParseError') {
		assert.equal(result.error.storyRows, 1);
		assert.equal(result.error.parsedStories, 0);
	}
});

test('a broken row cannot borrow metadata from the following story', async () => {
	const html =
		storyHtml({ id: 123, ageTitle: '2026-10-03T03:19:10Z' }).replace(
			'class="score"',
			'class="changed"'
		) + storyHtml({ id: 456, ageTitle: '2026-10-03T03:19:10Z' });
	const result = await fetchHN(mockFetch(html, []), 'classic');
	assert.equal(result.error?.name, 'ParseError');
	if (result.error?.name === 'ParseError') assert.equal(result.error.parsedStories, 1);
});

test('recognizable empty lists succeed without pagination', async () => {
	const result = await fetchHN(
		mockFetch('<table id="hnmain"><table class="itemlist"></table></table>', []),
		'invited'
	);
	assert.equal(result.error, null);
	assert.deepEqual(result.data, { stories: [], nextRange: undefined });
});

test('later-page HTTP failure retains earlier stories and retries the failed page', async () => {
	const urls: string[] = [];
	const first =
		storyHtml({ id: 123, ageTitle: '2026-10-03T03:19:10' }) +
		'<a href="active?p=2" class="morelink">More</a>';
	const result = await fetchHN(
		(async (input) => {
			urls.push(String(input));
			return urls.length === 1
				? new Response(first, { headers: { 'Content-Type': 'text/html' } })
				: new Response('Sorry', { status: 419 });
		}) as typeof fetch,
		'active',
		undefined,
		3
	);
	assert.equal(result.error?.name, 'UpstreamHttpError');
	assert.equal(result.error?.partial?.stories[0].id, 123);
	assert.equal(result.error?.partial?.nextRange, '2:1:3');
	assert.deepEqual(urls, [
		'https://news.ycombinator.com/active',
		'https://news.ycombinator.com/active?p=2'
	]);
});

test('page cursors use the requested page rather than the number of retained stories', async () => {
	const urls: string[] = [];
	const result = await fetchHN(
		mockFetch(storyHtml({ id: 123, ageTitle: '2026-10-03T03:19:10' }), urls),
		'classic',
		'7',
		1,
		42
	);
	assert.equal(result.error, null);
	assert.deepEqual(urls, ['https://news.ycombinator.com/classic?p=7']);
	assert.equal(result.data?.stories[0].time, 1790997550);
	assert.equal(result.data?.nextRange, undefined);
});

test('next-id pagination follows the upstream cursor and deduplicates stories', async () => {
	const urls: string[] = [];
	const html =
		storyHtml({ id: 456, ageTitle: '2026-10-03T03:19:10Z' }) +
		'<a href="shownew?next=789" class="morelink">More</a>';
	const result = await fetchHN(mockFetch(html, urls), 'shownew', undefined, 2);
	assert.equal(result.error, null);
	assert.equal(result.data?.stories.length, 1);
	assert.equal(result.data?.nextRange, '789:1:2');
	assert.deepEqual(urls, [
		'https://news.ycombinator.com/shownew',
		'https://news.ycombinator.com/shownew?next=789'
	]);
});
