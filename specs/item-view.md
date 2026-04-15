# Item View Spec (`/i/[id]`)

## Overview

Render HN items (stories, comments, polls) directly within the HN app, replacing the current external redirect to `hw.leftium.com`. Starts with feature parity to hw.leftium.com as a baseline, with planned divergences in future versions.

## Motivation

- **Freshness**: hw.leftium.com uses HNPWA API which is often delayed due to caching. Algolia indexes HN in near-real-time.
- **Clean route**: `/i/[id]` vs `/#/item/[id]` (hash-based).
- **Single app**: No context switch to a separate site.
- **Foundation for future enhancements** that will diverge significantly from hw.leftium.com's rendering.

## Route

- **Path**: `/i/[id]`
- **Rendering**: CSR (consistent with rest of app; global `ssr = false`)
- **Parameter**: `id` is a numeric HN item ID

## Data Strategy

### Primary: Algolia API

```
GET https://hn.algolia.com/api/v1/items/{id}
```

Single request returns the full item with recursively nested `children[]`. This replaces HNPWA entirely — the HN app has never used HNPWA, and Algolia is strictly better (fresher, more reliable, includes polls).

**Story response shape:**

```json
{
	"id": 43998049,
	"author": "arittr",
	"title": "Example Title",
	"url": "https://example.com/article",
	"text": null,
	"points": 190,
	"type": "story",
	"created_at_i": 1747334875,
	"children": [
		{
			"id": 43999554,
			"author": "commenter",
			"text": "<p>Comment HTML content</p>",
			"type": "comment",
			"created_at_i": 1747340000,
			"parent_id": 43998049,
			"story_id": 43998049,
			"children": [
				/* nested replies */
			]
		}
	]
}
```

**Comment response shape** (when navigating directly to a comment):

```json
{
	"id": 44003869,
	"author": "username",
	"text": "Comment HTML content",
	"type": "comment",
	"created_at_i": 1747393182,
	"parent_id": 43999554,
	"story_id": 43998049,
	"points": null,
	"children": []
}
```

### Future: Firebase Freshness Delta

```
GET https://hacker-news.firebaseio.com/v0/item/{id}.json
```

Returns flat item with `kids[]` (child IDs), `score`, `descendants`. After initial Algolia render, compare Firebase `kids[]` against rendered `children[].id` to discover new comments. Fetch only the delta individually from Firebase.

**Firebase response shape:**

```json
{
	"id": 43998049,
	"by": "arittr",
	"title": "Example Title",
	"url": "https://example.com/article",
	"score": 190,
	"time": 1747334875,
	"type": "story",
	"kids": [44006399, 44003190, 43999554],
	"descendants": 62,
	"dead": false,
	"deleted": false
}
```

## V1 Scope (Minimal Viable)

### Item Header

- Title (linked to external URL if present)
- Domain extraction (reuse `domainify` logic from hw.leftium.com: domain + smart first-path segment)
- Points count
- Author (linked to HN profile)
- Relative timestamp (using dayjs, already a dependency)
- Link to original HN item page

### Comment Tree

- Recursive rendering from Algolia's pre-nested `children[]`
- Indented nesting to convey thread structure
- Each comment shows: author, relative time, HTML content
- OP highlighting: visually distinguish comments by the item's original author

### Edge Cases

- Dead items: show `[dead]` stub
- Deleted items: show `[deleted]` stub
- Comment-as-root: when `/i/[id]` points to a comment, render it as a standalone item with its sub-thread (link to parent story)
- Items with no comments: show empty state
- Item not found: error state

### Navigation

- Back link to story list (browser back or explicit link)

## Deferred to Future Versions

- **Collapsible sub-threads**: collapse/expand replies (hw.leftium.com triggers this when HTML > 20KB)
- **Firebase freshness delta**: real-time comment updates after initial Algolia load
- **Poll rendering**: bar charts for poll options
- **Live/polling updates**: periodic refresh for active threads
- **SSR**: server-rendered item pages for link sharing, Open Graph previews, SEO
- **Deep-link to individual comments**: `/i/[id]#comment-[id]` with scroll-to
- **Comment text search/filter**
- **User-specific features**: upvote status, collapse memory, etc.

## Reference

- **hw.leftium.com source**: `/Volumes/p/hckrweb`
  - Item rendering: `assets/js/hw.js` (`hw.comments.render()`, lines 179-331)
  - Templates: `assets/templates/post-comments.mustache`, `comments.mustache`
  - API client: `assets/js/libs/hnapi.js`
- **Algolia HN API docs**: `https://hn.algolia.com/api`
- **HN Firebase API docs**: `https://github.com/HackerNews/API`
