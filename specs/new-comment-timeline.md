# Spec: Configurable NEW Comment Timeline

**Date:** 2026-07-22
**Status:** Draft
**Companion to:** `specs/comment-view-promotion.md`, `specs/comment-author-promotion.md`, and `specs/item-view.md`

## One Sentence

Preserve the current previous-view NEW behavior while adding bounded, comment-count-deduplicated item checkpoints and a disclosed activity timeline for recovering or manually choosing the NEW cutoff.

## Overview

The item reader currently treats a comment as NEW when its timestamp is later than the item's previous `viewedAt` timestamp. This default is useful and remains the primary behavior. The missing control is recovery: an accidental reload can advance the stored view before the reader has finished the comments that were NEW.

This change keeps a bounded checkpoint history per item. A load records a checkpoint only when the visible comment count differs from the latest checkpoint. Loads with the same count continue using the same automatic cutoff. A filter button beside Search discloses a compact timeline containing relative comment activity, visit markers, a cutoff slider, and previous/next marker actions. Timeline adjustments are transient; every item load starts from the history-derived automatic cutoff.

Completion means that unchanged reloads do not consume the current NEW set, changed discussions retain the existing previous-view default, and a reader can recover an older cutoff or select an arbitrary point without changing the underlying NEW promotion and navigation machinery.

## Scope

In scope:

- Bounded per-item view checkpoints in IndexedDB.
- Checkpoint deduplication by visible comment count.
- An automatic cutoff derived from checkpoint history.
- A transient adjustable cutoff initialized from item history.
- A disclosed timeline with an unlabeled relative-activity plot.
- Visit markers, marker navigation, pointer, touch, and keyboard input.
- Progressive comment hydration.
- Existing NEW count, badge, styling, minimum LOD, pill selection, and navigation.

Out of scope:

- Replacing site-wide 20-minute visit sessions.
- Inferring whether a reload was intentional or accidental.
- Tracking which individual comments were read or entered the viewport.
- Notifications, polling, or automatic refresh.
- A numeric y-axis, activity totals on bars, zooming, or chart inspection UI.
- Cross-device synchronization.
- Changing HN's comment availability or lock behavior.

## Current State

`src/lib/item-view-history.ts` stores one IndexedDB record per item:

```ts
interface ItemViewRecord {
	itemId: number;
	viewedAt: number;
	commentCount: number;
}
```

`recordItemView()` overwrites that record on every item load. Records older than 15 days are evicted.

`src/routes/(ssr-optional)/i/[id]/+page.svelte` initializes NEW tracking as follows:

```txt
read previous item record
  -> set newCommentThreshold = previous.viewedAt
  -> record the current view immediately
  -> hydrate the comment tree progressively
```

A visible comment is NEW when:

```ts
newCommentThreshold !== null && comment.time > newCommentThreshold;
```

The threshold already drives the live visible NEW count, NEW styling and badge, minimum effective LOD M, the NEW highlight pill, and highlighted-comment navigation. The configurable control must continue feeding this single threshold rather than introduce a second definition of NEW.

Site-wide visits use a rolling 20-minute cookie session. That policy is not suitable for item comments because refreshing an active discussion after a short interval can be a meaningful checkpoint.

## Checkpoint Semantics

### Stored shape

Evolve the IndexedDB value to a bounded list:

```ts
interface ItemViewCheckpoint {
	viewedAt: number; // Unix seconds when this distinct comment-count state was loaded
	commentCount: number; // visible count used to classify the state
}

interface ItemViewRecord {
	itemId: number;
	visits: ItemViewCheckpoint[]; // chronological, oldest to newest
}
```

Keep the latest 20 checkpoints per item. Continue evicting item records outside the existing 15-day retention window. Storage size is negligible, and 20 markers remain manageable in the timeline.

### What counts as a checkpoint

The current load is a new checkpoint only when its visible comment count differs from the most recent stored checkpoint.

```txt
no stored checkpoint
  -> automatic cutoff = null
  -> append current checkpoint

current count differs from latest stored count
  -> automatic cutoff = latest stored viewedAt
  -> append current checkpoint

current count equals latest stored count
  -> automatic cutoff = checkpoint before latest, if one exists
  -> do not append or move the latest checkpoint
```

The third case is the essential deduplication rule. The latest checkpoint is the beginning of the still-current discussion state. Reusing its own timestamp as the cutoff would consume the NEW set on a same-count reload, defeating the purpose of deduplication.

Examples:

| Stored checkpoints before load | Current count | Automatic cutoff | Write              |
| ------------------------------ | ------------: | ---------------- | ------------------ |
| none                           |            40 | none             | append `(now, 40)` |
| `(t0, 40)`                     |            40 | none             | none               |
| `(t0, 40)`                     |            45 | `t0`             | append `(now, 45)` |
| `(t0, 40), (t1, 45)`           |            45 | `t0`             | none               |
| `(t0, 40), (t1, 45)`           |            48 | `t1`             | append `(now, 48)` |

Any count change, including a decrease caused by deletion or visibility changes, creates a checkpoint. Equality is the only deduplication condition. Do not add a time window.

Use the same visible-count rule as rendering and `countNewComments()`: dead comments remain visible, deleted leaf comments do not count. Capture the count from the fast HNPWA preview at NEW initialization, before progressive Firebase hydration. Later hydration can update the live plot and NEW count but must not move, append, or rewrite the checkpoint chosen for this load.

### Migration

Upgrade the IndexedDB schema without discarding existing history. Convert a legacy `{ itemId, viewedAt, commentCount }` record lazily or during the database upgrade to:

```ts
{ itemId, visits: [{ viewedAt, commentCount }] }
```

Malformed records fail closed as no history. IndexedDB failures remain non-fatal and produce first-visit behavior.

## Cutoff State

Keep the automatic starting value separate from the transient adjustment:

```ts
automaticNewCommentThreshold: number | null;
adjustedNewCommentThreshold: number | null;

effectiveNewCommentThreshold = adjustedNewCommentThreshold ?? automaticNewCommentThreshold;
```

The existing NEW consumers use the effective threshold.

The adjusted value is local to the current page instance. Do not serialize it in the URL or IndexedDB. Reloading or creating a fresh item-route instance starts from the automatic cutoff derived for that load. Checkpoint recording remains independent of timeline adjustment.

## Timeline Control

### Placement and disclosure

Place a filter disclosure button immediately left of the Search disclosure button. Treat them as a compact control group in the existing view-navigation header.

```txt
[filter] [search] [NEW 12] [alice] | 2 / 15 | previous | next

filter disclosed:
[relative comment activity with markers and cutoff slider]
```

The filter button has accessible name `Choose new comment cutoff`, `aria-expanded`, and `aria-controls`. Its active appearance communicates whether the panel is open. Closing and reopening the panel during the same page instance retains the transient adjustment.

The timeline is complex UI and stays hidden until explicitly disclosed. It must not open automatically when no NEW or author highlight lane is available; the existing automatic Search disclosure behavior remains unchanged.

### Time domain

The horizontal domain uses actual discussion activity, with two weeks as a hard maximum rather than the default displayed width:

```txt
hard end     = min(current time, item.time + 14 days)
activity end = start of the relative day after the latest visible comment
visible end  = min(hard end, activity end)
```

The relative-day calculation targets at least a one-day domain, capped by the current time for younger posts. For example, a thread whose latest comment arrived 5 days and 3 hours after posting ends at 6 days. A currently active thread whose padded activity end is in the future ends at now.

The control displays elapsed time since the post, not calendar labels. The selected-value label uses compact relative units such as `3h after posting`, `2d 6h after posting`, or `Now`. Its accessible value text also includes the absolute local datetime.

Comments whose timestamps fall outside the domain are clamped only for plotting defensiveness; their actual timestamps remain unchanged for NEW classification.

### Relative-activity plot

Render an unlabeled histogram behind or immediately above the slider track:

```txt
           #
    # #   ###
  # ####  #####
----------|----------------
          cutoff
```

- Plot visible comments by creation time using approximately 32 equal-width time buckets.
- Normalize bar height to the largest current bucket using a square-root scale. Give every non-empty bucket a 12% minimum height so isolated late comments remain visible without making sparse and busy buckets look equal.
- Do not render a y-axis, numeric y labels, grid lines, per-bar tooltips, or a legend.
- The graph communicates relative activity only. `NEW n` remains the authoritative count.
- Use the existing NEW orange treatment for the portion after the cutoff and a subdued neutral treatment before it.
- Keep plot dimensions and bucket boundaries stable while hydration adds comments. Bar heights may update without animating layout.
- Exclude synthetic promoted-link rows and comments hidden by the rendering policy.
- Mark the decorative plot `aria-hidden="true"`; expose the effect through the slider value and live NEW count.

### Slider and markers

The cutoff is a single value. Comments strictly to its right are NEW.

- Clicking or dragging the track selects an arbitrary second within the domain.
- Use a native range input where practical, with a custom visual layer for the plot and markers.
- Keyboard Arrow keys make a fine adjustment; Page Up and Page Down make a larger adjustment; Home chooses post time; End chooses the domain end.
- Pointer movement updates the plot tint and live NEW count.
- Post time means all later comments are NEW.
- Domain end means no currently loaded comments are NEW.

Render stored checkpoints as focusable markers on the same time scale. A marker's accessible label includes its relative time, absolute local datetime, and recorded visible count. Markers outside the current item domain are omitted.

Previous and next marker buttons move among these ordered stops:

```txt
post time -> stored checkpoints -> domain end
```

The buttons select the nearest strictly earlier or later stop and do not wrap. Disable a direction at its endpoint. Selecting a marker changes the transient cutoff for the current page instance.

## Interaction With Existing NEW Behavior

Changing the effective threshold must reuse the current derived policies:

```txt
effective threshold
  -> isNewComment()
  -> live visible NEW count
  -> NEW badge and row styling
  -> minimum effective LOD M
  -> NEW pill availability and targets
```

Preserve the current highlight-navigation rules:

- NEW is selected initially when the resolved effective threshold yields NEW comments.
- Moving the cutoff updates NEW targets in depth-first render order.
- Preserve the active highlighted comment when it remains eligible; otherwise use the existing nearest-surviving-target behavior.
- A zero-count cutoff removes the NEW pill according to current behavior.
- Reintroducing NEW comments through the slider makes the pill available but does not unexpectedly override an explicit author selection after initial selection has completed.
- Search and author promotion remain independent.

Changing the cutoff can alter effective LOD across many rows. Route it through the existing layout-animation and reading-anchor behavior where practical. Dragging must remain responsive; it is acceptable to defer distributed layout animation until pointer release and update only graph/count feedback during the drag.

## Ownership

```txt
src/lib/item-view-history.ts
  owns checkpoint storage, migration, bounds, deduplication, and automatic cutoff selection

src/routes/(ssr-optional)/i/[id]/+page.svelte
  owns effective cutoff, plot derivation, timeline interaction,
  and integration with existing NEW rendering/navigation
```

Prefer a history API that returns the decision required by the route in one operation, rather than making the component reproduce checkpoint indexing rules:

```ts
interface BeginItemViewResult {
	visits: ItemViewCheckpoint[];
	automaticThreshold: number | null;
	recorded: boolean;
}

beginItemView(itemId: number, visibleCommentCount: number): Promise<BeginItemViewResult>;
```

The operation reads the current record, derives the cutoff, conditionally appends the checkpoint, trims the list, and writes once. Its returned `visits` includes any newly appended checkpoint and supplies the timeline markers.

## Implementation Plan

### Phase 1: Checkpoint history

- [ ] Replace the single-view record with the versioned checkpoint-list shape.
- [ ] Add legacy-record migration and preserve non-fatal IndexedDB behavior.
- [ ] Implement `beginItemView()` with equality-based deduplication and a 20-entry bound.
- [ ] Update item initialization to use the returned automatic threshold and visit list.
- [ ] Add focused tests for first view, changed count, unchanged count, decreased count, trimming, migration, and storage failure.

### Phase 2: Adjustable cutoff state

- [ ] Separate automatic, adjusted, and effective thresholds.
- [ ] Initialize each load from automatic history and keep adjustments transient.
- [ ] Ensure adjustment does not suppress checkpoint recording.
- [ ] Verify NEW count, badge, effective LOD, pill availability, and active-target reconciliation.

### Phase 3: Timeline UI

- [ ] Add grouped Filter and Search disclosures without changing Search's current automatic disclosure.
- [ ] Derive stable activity buckets from the live visible tree.
- [ ] Render the relative-activity plot, selected region, slider, relative/absolute value text, and checkpoint markers.
- [ ] Add previous/next marker navigation.
- [ ] Add responsive, pointer, touch, and keyboard behavior.
- [ ] Integrate cutoff commits with the existing layout-animation and reading-anchor path.

### Phase 4: Verification

- [ ] Run focused formatting, lint, and type checks while editing.
- [ ] Manually verify young, active, old, first-view, no-comment, and progressively hydrated items.
- [ ] Verify an unchanged accidental reload preserves the prior NEW set.
- [ ] Verify a changed-count refresh advances the automatic cutoff to the latest distinct checkpoint.
- [ ] Verify an older marker can recover comments consumed by an earlier changed-count reload.
- [ ] Verify reload discards a transient adjustment and derives the current automatic cutoff.
- [ ] Verify narrow layout and keyboard-only operation.
- [ ] With approval for the expensive checks, run full `pnpm check` and `pnpm lint`.

## Edge Cases

- **First view:** Store one checkpoint and use no automatic cutoff. The timeline can still select an arbitrary transient cutoff.
- **Repeated first-state reload:** If only one equal-count checkpoint exists, keep the automatic cutoff null.
- **Count changes during hydration:** Do not create another checkpoint or change the automatic cutoff during the load.
- **Same count, different membership:** Deduplication intentionally treats this as the same checkpoint. HN comment IDs and counts do not expose a cheap stable membership signature in the current history model. The manual timeline remains the recovery path.
- **Deleted comments lower the count:** Record a distinct checkpoint because the visible discussion state changed.
- **Clock skew or future timestamps:** Clamp UI selection and markers to the domain; keep raw classification semantics defensive and deterministic.
- **Post older than 14 days:** Never extend beyond day 14; the activity bound may still make the visible domain shorter.
- **Inactive discussion:** End at the next whole relative day after its latest visible comment instead of showing an empty tail through day 14.
- **Automatic cutoff after the visible domain:** Preserve the real timestamp for NEW classification but clamp the displayed thumb to the endpoint; both positions classify zero loaded comments as NEW.
- **No comments:** Render an empty plot and functional endpoints; do not fabricate activity bars.
- **All activity in one bucket:** Render that bucket at full relative height and the others empty.
- **IndexedDB unavailable:** Keep the route usable with no automatic history; the timeline can still select a transient cutoff.

## Success Criteria

- [ ] Reloading an item with the same visible comment count does not advance or erase its current automatic NEW set.
- [ ] Loading an item after its visible count changes creates one checkpoint and uses the prior distinct checkpoint as the cutoff.
- [ ] At most 20 checkpoints are retained per item, and legacy records remain usable.
- [ ] The timeline stays hidden until Filter is disclosed and does not interfere with Search disclosure.
- [ ] The plot conveys relative comment activity without a y-axis or numeric activity labels.
- [ ] Slider and marker changes feed the existing single NEW threshold behavior.
- [ ] Every load starts from the automatic cutoff; timeline adjustments remain local to that page instance.
- [ ] The control works with pointer, touch, keyboard, narrow layouts, and progressive hydration.
- [ ] Existing search, author promotion, LOD, NEW badge, count, and navigation behavior continue to pass their checks.

## References

- `src/lib/item-view-history.ts` - Current IndexedDB record, retention, visibility helpers, and NEW counting.
- `src/routes/(ssr-optional)/i/[id]/+page.svelte` - Current threshold initialization, NEW promotion, navigation, and header controls.
- `src/routes/(ssr-optional)/[source=sourcetype]/[[date]]/+page.server.ts` - Site-wide visit-session behavior that must remain separate.
- `specs/comment-view-promotion.md` - Existing NEW/search/author navigation contract.
- `specs/comment-author-promotion.md` - Existing effective LOD and NEW promotion contract.
