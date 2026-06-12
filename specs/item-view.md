# Item View Spec (`/i/[id]`)

## Overview

Render HN items (stories, comments, polls) directly within the HN app, replacing the current external redirect to `hw.leftium.com`. Starts with feature parity to hw.leftium.com as a baseline, with planned divergences in future versions.

## Motivation

- **Correct ordering + freshness**: the official HN Firebase API provides current item metadata and `kids[]` order for building the nested comment tree.
- **Clean route**: `/i/[id]` vs `/#/item/[id]` (hash-based).
- **Single app**: No context switch to a separate site.
- **Foundation for future enhancements** that will diverge significantly from hw.leftium.com's rendering.

## Route

- **Path**: `/i/[id]`
- **Rendering**: CSR (consistent with rest of app; global `ssr = false`)
- **Parameter**: `id` is a numeric HN item ID

## Data Strategy

### Primary: HN Firebase API

```
GET https://hacker-news.firebaseio.com/v0/item/{id}.json
```

Firebase returns flat items with `kids[]` child IDs. The loader recursively fetches each child and builds the nested `comments[]` tree locally, preserving HN's native comment order.

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

### API Comparison

|                    | HNPWA             | Algolia           | Firebase             |
| ------------------ | ----------------- | ----------------- | -------------------- |
| **Comment order**  | HN native         | Chronological     | HN native via `kids` |
| **Single request** | Yes (nested tree) | Yes (nested tree) | No (1 per item)      |
| **Freshness**      | Stale in practice | Near-real-time    | Real-time            |
| **Chosen role**    | Not used          | Not used          | Primary              |

## V1 Scope (Minimal Viable)

### Item Header

- Title (linked to external URL if present)
- Domain extraction via `domainify` for smart first-path segment
- Points count
- Author (linked to HN profile)
- Relative timestamp (using dayjs, already a dependency)
- Link to original HN item page

### Comment Tree

- Recursive rendering from the locally built Firebase `comments[]` tree
- Indented nesting to convey thread structure
- Each comment shows: author, relative time, HTML content
- OP highlighting: visually distinguish comments by the item's original author

### Edge Cases

- Dead items: show `[dead]` stub
- Deleted items: show `[deleted]` stub
- Comment-as-root: when `/i/[id]` points to a comment, render it as a standalone item with its sub-thread and link to the parent item
- Items with no comments: show "No comments." empty state
- Item not found: error state

### Navigation

- Back link to story list (browser back or explicit link)

## Deferred to Future Versions

- **Collapsible sub-threads**: collapse/expand replies (hw.leftium.com triggers this when HTML > 20KB)
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
- **HN Firebase API docs**: `https://github.com/HackerNews/API`
