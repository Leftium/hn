import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolveOptions } from '@sveltejs/kit/hooks';
import { createSocialMetadata } from './social-meta.ts';

function fixture(value: unknown, status = 200): typeof fetch {
	return async () => Response.json(value, { status });
}

test('generic feed metadata uses absolute URLs and removes query and fragment', async () => {
	const metadata = createSocialMetadata({
		fetchFn: async () => {
			throw Error('Unexpected request');
		}
	});
	for (const path of ['/', '/news', '/hckrnews/2026-10-19', '//other.example/path']) {
		const url = new URL(`https://hn.example:8443${path}?spoofHost=evil&tracking=1#fragment`);
		const tags = await metadata.tags(url);
		assert.ok(tags.includes(`href="https://hn.example:8443${path}"`));
		assert.ok(tags.includes('content="https://hn.example:8443/icon-512.png"'));
		assert.ok(tags.includes('name="twitter:card" content="summary"'));
		assert.ok(!tags.includes('tracking'));
		assert.ok(!tags.includes('spoofHost'));
	}
});

test('fetches just the root item and escapes all upstream text', async () => {
	const requests: string[] = [];
	const metadata = createSocialMetadata({
		fetchFn: async (url) => {
			requests.push(String(url));
			return Response.json({
				id: 123,
				type: 'story',
				title: 'A & "B" &lt;script&gt; \'C\'',
				kids: [456]
			});
		}
	});
	const tags = await metadata.tags(new URL('https://hn.example/i/123?x=1'));
	assert.deepEqual(requests, ['https://hacker-news.firebaseio.com/v0/item/123.json']);
	assert.ok(tags.includes('A &amp; &quot;B&quot; &lt;script&gt; &#39;C&#39;'));
	assert.ok(!tags.includes('<script>'));
	assert.ok(tags.includes('property="og:url" content="https://hn.example/i/123"'));
});

test('normalizes title HTML entities and markup before escaping metadata', async () => {
	const metadata = createSocialMetadata({
		fetchFn: fixture({
			id: 123,
			type: 'story',
			title: 'R&amp;D <b>&quot;tools&quot;</b> &#39;today&#39; &#x26; &copy; <!-- hidden -->'
		})
	});
	const tags = await metadata.tags(new URL('https://hn.example/i/123'));
	const escaped = 'R&amp;D &quot;tools&quot; &#39;today&#39; &amp; \u00a9';
	assert.ok(tags.includes(`<title>${escaped} | HN Reader</title>`));
	assert.ok(tags.includes(`property="og:title" content="${escaped} | HN Reader"`));
	assert.ok(tags.includes(`name="twitter:title" content="${escaped} | HN Reader"`));
	assert.ok(!tags.includes('&amp;amp;'));
	assert.ok(!tags.includes('<b>'));
	assert.ok(!tags.includes('hidden'));
});

test('decoded markup and attribute payloads remain inert text in generated tags', async () => {
	const metadata = createSocialMetadata({
		fetchFn: fixture({
			id: 123,
			type: 'story',
			title:
				'&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &quot; onload=&quot;bad <img src=x onerror=bad><script>hidden()</script><style>hidden</style>'
		})
	});
	const tags = await metadata.tags(new URL('https://hn.example/i/123'));
	assert.ok(tags.includes('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
	assert.ok(tags.includes('&quot; onload=&quot;bad'));
	assert.ok(!tags.includes('<script>'));
	assert.ok(!tags.includes('<img'));
	assert.ok(!tags.includes('hidden'));
	assert.equal((tags.match(/<\/title>/g) || []).length, 1);
});

test('invalid item IDs never contact upstream', async () => {
	let calls = 0;
	const metadata = createSocialMetadata({
		fetchFn: async () => {
			calls++;
			throw Error('unexpected');
		}
	});
	for (const id of ['0', '-1', '01', '1.5', 'abc', '9007199254740992', '%31', '123/extra']) {
		assert.ok(
			(await metadata.tags(new URL(`https://hn.example/i/${id}`))).includes(
				'<title>HN Reader</title>'
			)
		);
	}
	assert.equal(calls, 0);
});

test('missing, dead, deleted, comment, malformed and failed items use generic metadata', async () => {
	for (const value of [
		null,
		{},
		{ id: 321, type: 'story', title: 'wrong' },
		{ id: 123, type: 'comment', text: 'comment' },
		...[true, false].flatMap((deleted) => [
			{ id: 123, type: 'story', title: 'hidden', deleted, dead: !deleted }
		]),
		{ id: 123, type: 'story', title: 42 }
	]) {
		const metadata = createSocialMetadata({ fetchFn: fixture(value) });
		assert.ok(
			(await metadata.tags(new URL('https://hn.example/i/123'))).includes(
				'<title>HN Reader</title>'
			)
		);
	}
	for (const fetchFn of [
		fixture({}, 503),
		async () => {
			throw Error('network');
		},
		async () => new Response('not json')
	]) {
		const metadata = createSocialMetadata({ fetchFn });
		assert.ok(
			(await metadata.tags(new URL('https://hn.example/i/123'))).includes(
				'<title>HN Reader</title>'
			)
		);
	}
});

test('timeout bounds a non-cooperating fetch and aborts it', async () => {
	let signal: AbortSignal | null | undefined;
	const metadata = createSocialMetadata({
		timeoutMs: 5,
		fetchFn: async (_url, init) => {
			signal = init?.signal;
			return new Promise<Response>(() => {});
		}
	});
	assert.ok(
		(await metadata.tags(new URL('https://hn.example/i/123'))).includes('<title>HN Reader</title>')
	);
	assert.equal(signal?.aborted, true);
});

test('cache deduplicates in-flight requests, expires entries and bounds capacity', async () => {
	let now = 0;
	let calls = 0;
	const metadata = createSocialMetadata({
		now: () => now,
		ttlMs: 100,
		maxEntries: 2,
		fetchFn: async (url) => {
			calls++;
			const id = Number(/\/(\d+)\.json$/.exec(String(url))![1]);
			return Response.json({ id, type: 'story', title: `Story ${id}` });
		}
	});
	const first = new URL('https://hn.example/i/123');
	await Promise.all([metadata.tags(first), metadata.tags(first)]);
	assert.equal(calls, 1);
	await metadata.tags(first);
	assert.equal(calls, 1);
	now = 101;
	await metadata.tags(first);
	assert.equal(calls, 2);
	await metadata.tags(new URL('https://hn.example/i/124'));
	await metadata.tags(new URL('https://hn.example/i/125'));
	await metadata.tags(first);
	assert.equal(calls, 5);
});

test('failures are cached briefly before retrying', async () => {
	let now = 0;
	let calls = 0;
	const metadata = createSocialMetadata({
		now: () => now,
		failureTtlMs: 10,
		fetchFn: async () => {
			calls++;
			throw Error('network');
		}
	});
	const url = new URL('https://hn.example/i/123');
	await metadata.tags(url);
	await metadata.tags(url);
	assert.equal(calls, 1);
	now = 11;
	await metadata.tags(url);
	assert.equal(calls, 2);
});

test('handle injects metadata into initial HTML across chunk boundaries without JavaScript', async () => {
	const metadata = createSocialMetadata({
		fetchFn: fixture({ id: 123, type: 'story', title: 'Initial HTML' })
	});
	const event = { url: new URL('https://hn.example/i/123'), isDataRequest: false } as RequestEvent;
	const response = await metadata.handle({
		event,
		resolve: async (_event, options?: ResolveOptions) => {
			const transform = options!.transformPageChunk!;
			const first = await transform({
				html: '<html><head><title>HN Reader</title></he',
				done: false
			});
			const last = await transform({
				html: 'ad><body><div id="app"></div></body></html>',
				done: true
			});
			return new Response(`${first}${last}`);
		}
	});
	const html = await response.text();
	assert.equal((html.match(/<title>/g) || []).length, 1);
	assert.ok(html.includes('<title>Initial HTML | HN Reader</title>'));
	assert.ok(html.indexOf('property="og:title"') < html.indexOf('</head>'));
	assert.ok(html.includes('<body><div id="app"></div></body>'));
});

test('data and non-HTML responses skip metadata fetching', async () => {
	let calls = 0;
	const metadata = createSocialMetadata({
		fetchFn: async () => {
			calls++;
			throw Error('unexpected');
		}
	});
	for (const isDataRequest of [true, false]) {
		const response = await metadata.handle({
			event: { url: new URL('https://hn.example/i/123'), isDataRequest } as RequestEvent,
			resolve: async () => Response.json({ ok: true })
		});
		assert.deepEqual(await response.json(), { ok: true });
	}
	assert.equal(calls, 0);
});
