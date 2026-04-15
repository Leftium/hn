# Item View Spec (`/i/[id]`)

## Overview

Render HN items (stories, comments, polls) directly within the HN app, replacing the current external redirect to `hw.leftium.com`. Starts with feature parity to hw.leftium.com as a baseline, with planned divergences in future versions.

## Motivation

- **Correct ordering + freshness**: HNPWA preserves HN's native comment ranking order, and Firebase provides a real-time delta for new comments.
- **Clean route**: `/i/[id]` vs `/#/item/[id]` (hash-based).
- **Single app**: No context switch to a separate site.
- **Foundation for future enhancements** that will diverge significantly from hw.leftium.com's rendering.

## Route

- **Path**: `/i/[id]`
- **Rendering**: CSR (consistent with rest of app; global `ssr = false`)
- **Parameter**: `id` is a numeric HN item ID

## Data Strategy

### Primary: HNPWA API

```
GET https://api.hnpwa.com/v0/item/{id}.json
```

Single request returns the full item with recursively nested `comments[]` in HN's native ranked order (not chronological). This preserves the same comment ordering as the official HN site.

**Story response shape:**

```json
{
	"id": 43998049,
	"title": "Example Title",
	"url": "https://example.com/article",
	"domain": "example.com",
	"points": 190,
	"user": "arittr",
	"time": 1747334875,
	"time_ago": "2 hours ago",
	"type": "link",
	"content": "",
	"comments_count": 63,
	"comments": [
		{
			"id": 43999554,
			"user": "commenter",
			"time": 1747344957,
			"time_ago": "1 hour ago",
			"type": "comment",
			"content": "<p>Comment HTML content</p>",
			"comments": [],
			"comments_count": 0,
			"level": 0,
			"url": "item?id=43999554"
		}
	]
}
```

**Comment response shape** (when navigating directly to a comment):

```json
{
	"id": 44003869,
	"user": "username",
	"time": 1747393182,
	"time_ago": "30 minutes ago",
	"type": "comment",
	"content": "Comment HTML content",
	"url": "item?id=43998049",
	"comments": [],
	"comments_count": 0,
	"level": 0
}
```

### Future: Firebase Freshness Delta

```
GET https://hacker-news.firebaseio.com/v0/item/{id}.json
```

Returns flat item with `kids[]` (child IDs), `score`, `descendants`. After initial HNPWA render, compare Firebase `kids[]` against rendered `comments[].id` to discover new comments. Fetch only the delta individually from Firebase.

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

### API Comparison

|                    | HNPWA                  | Algolia           | Firebase                 |
| ------------------ | ---------------------- | ----------------- | ------------------------ |
| **Comment order**  | HN native (ranked)     | Chronological     | N/A (flat IDs)           |
| **Single request** | Yes (nested tree)      | Yes (nested tree) | No (1 per item)          |
| **Freshness**      | Delayed (cached)       | Near-real-time    | Real-time                |
| **Chosen role**    | Primary (initial load) | Not used          | Freshness delta (future) |

## V1 Scope (Minimal Viable)

### Item Header

- Title (linked to external URL if present)
- Domain extraction (HNPWA provides `domain`; enhanced with `domainify` for smart first-path segment)
- Points count
- Author (linked to HN profile)
- Relative timestamp (using dayjs, already a dependency)
- Link to original HN item page

### Comment Tree

- Recursive rendering from HNPWA's pre-nested `comments[]`
- Indented nesting to convey thread structure
- Each comment shows: author, relative time, HTML content
- OP highlighting: visually distinguish comments by the item's original author

### Edge Cases

- Dead items: show `[dead]` stub
- Deleted items: show `[deleted]` stub
- Comment-as-root: when `/i/[id]` points to a comment, render it as a standalone item with its sub-thread (link to parent story via HNPWA's `url` field)
- Items with no comments: show "No comments." empty state
- Item not found: error state

### Navigation

- Back link to story list (browser back or explicit link)

## Deferred to Future Versions

- **Collapsible sub-threads**: collapse/expand replies (hw.leftium.com triggers this when HTML > 20KB)
- **Firebase freshness delta**: real-time comment updates after initial HNPWA load
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
- **HNPWA API**: `https://api.hnpwa.com/v0/item/{id}.json`
- **HN Firebase API docs**: `https://github.com/HackerNews/API`
