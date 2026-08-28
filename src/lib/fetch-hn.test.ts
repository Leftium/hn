import assert from 'node:assert/strict';
import test from 'node:test';

// Node's native TypeScript runner requires the runtime extension.
// @ts-expect-error allowImportingTsExtensions is intentionally not enabled project-wide.
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
		return new Response(html, { status: 200 });
	}) as typeof fetch;
}

test('parses the current ISO-only HN age title', async () => {
	const requestedUrls: string[] = [];
	const result = await fetchHN(
		mockFetch(storyHtml({ id: 123, ageTitle: '2026-08-27T18:23:43.000000Z' }), requestedUrls),
		'active'
	);

	assert.equal(result.stories.length, 1);
	assert.equal(result.stories[0].time, 1787855023);
	assert.equal(result.stories[0].comments, 12);
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

	assert.equal(result.stories.length, 1);
	assert.equal(result.stories[0].time, 1704164645);
	assert.equal(result.stories[0].comments, 0);
	assert.deepEqual(requestedUrls, ['https://news.ycombinator.com/shownew?next=789']);
});
