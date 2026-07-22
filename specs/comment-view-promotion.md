# Spec: Shareable Comment View Promotion and Navigation

**Date:** 2026-07-22
**Status:** Implemented; pending final project checks
**Companion to:** `specs/comment-author-promotion.md` and `specs/comment-lod.md`

## One Sentence

Keep search and highlighted-comment navigation as two independent sticky lanes: a disclosed occurrence navigator for literal search alternatives, and a primary multi-select pill navigator for NEW comments and individually promoted authors.

## Implemented Design

The item route has:

- case-insensitive whitespace-separated literal search with quoted phrases;
- a two-character minimum and 175 ms debounce;
- one entity-safe pass that emits both keyed `<mark>` elements and the occurrence list used by promotion, counting, and navigation;
- search-match minimum LOD L and direct-parent context minimum M;
- shareable `q` and repeated `author` URL parameters;
- previous/next navigation with wrapping and transient active-target styling;
- NEW and author target providers;
- a sticky header with a compact state;
- responsive header and search controls.

Search navigation has been manually confirmed to land on the exact highlighted occurrence. Comment `48990265` is the regression case: `realtime real-time streaming` produces three keyed marks and three navigable occurrences.

It exposes two independent navigation lanes:

```txt
highlight lane: [search icon] [NEW] [alice] [bob] | 3 / 8 | previous | next
search lane:    [query......................... x] | 2 / 12 | previous | next
```

The highlight lane is primary and visible whenever NEW or promoted-author sources are available. Search starts as a small disclosure button; its lane appears only while the search UI is open or a valid query is active. Search never gets replaced by an author label.

Both lanes can remain active without changing each other's policy or position. NEW has automatic priority after visit history resolves, with the first promoted author as the fallback when no source is selected. Sticky compact mode retains the useful navigator controls, and copied URLs recreate search and author promotion without serializing transient navigation choices.

## Boundaries

In scope:

- Whitespace-separated literal alternatives with quoted phrases.
- Search occurrence count and exact-match navigation.
- Multi-select navigation through NEW comments and comments by individually selected promoted authors.
- Collapsed Search disclosure.
- NEW-first transient selection after visit history resolves.
- Sticky compact behavior for one or both navigator lanes.
- URL hydration, live comments, Reset, and narrow layouts.

Out of scope:

- Fuzzy matching, stemming, regex, implicit hyphen normalization, or boolean syntax.
- Searching author names through the text query.
- An `All pinned` control or combined promoted-author scope.
- Automatically selecting newly pinned authors for navigation.
- Serializing selected pills or active target positions.
- Configurable search or NEW promotion levels.
- A tune panel without another concrete view policy to contain.

## Policy and Navigation Are Separate

The route has three related but distinct state layers:

```txt
base LOD policy
  -> lodState and manual/global LOD controls

highlight/promotion policy
  -> search query, promoted authors, NEW threshold

transient navigation policy
  -> selected NEW/author pills and active targets in each lane
```

Changing navigation selection must not change promotion or highlighting. In particular:

- selecting or deselecting an author pill does not pin or unpin the author;
- deselecting all highlight pills does not remove author colors or URL parameters;
- closing or clearing search does not change selected NEW/author pills;
- search and highlight lanes keep separate active targets and counters.

## Search Policy

- `q` is a case-insensitive literal-alternative expression. Whitespace separates alternatives, for example `realtime real-time streaming`.
- Double quotes preserve literal spaces inside one alternative, for example `realtime "real time" streaming`.
- Repeated whitespace is ignored. Empty alternatives and alternatives shorter than two characters are ignored.
- Alternatives are deduplicated case-insensitively while retaining the first spelling.
- Search is inactive when parsing produces no valid alternatives.
- An unmatched opening quote consumes through the end of the query as one phrase. Quote escaping is deferred until a real use case requires it.
- Matching uses leftmost, longest, non-overlapping ranges. With `real real-time`, `real-time` is one occurrence; another `real` elsewhere remains a separate occurrence.
- Matches cannot span rendered text-node boundaries.
- A matching real comment receives minimum effective LOD L.
- The direct parent of a matching reply receives minimum effective LOD M.
- Synthetic promoted-link rows do not participate.
- Hydrated and newly arriving comments are evaluated against the current active query.
- Search never writes effective promotion values into `lodState`.

One shared per-comment pass formats content, maps visible characters back to raw entity-safe ranges, inserts keyed `<mark>` elements, and returns the exact ordered occurrence list. The required invariant is:

```txt
one counted search occurrence
  == one unique keyed <mark>
  == one search navigation target
```

Missing or duplicate marks are implementation errors. Do not hide them by silently counting the containing comment instead.

## Effective LOD

```txt
effective LOD = max(
  base LOD,
  author promotion minimum,
  search-match minimum L,
  NEW-comment minimum M,
  direct-parent context minimum M
)
```

Direct-parent context is the union of context required by search and author promotion. It remains derived and does not recursively expand ancestors.

## Search Lane

### Disclosure

When no NEW or promoted-author pills are available after visit history resolves, Search starts open and occupies the otherwise empty right-side space. When highlight pills are available, Search starts as a fixed-size magnifier button with accessible name `Search comments`. Pressing it reveals and focuses the search input; pressing the disclosure again collapses Search without clearing its query.

The search lane is visible while the user has disclosed Search. A valid `q` restored through URL hydration or Back/Forward opens it initially, but the disclosure button can collapse the lane without clearing that active query.

The search lane collapses when the input is empty and the user closes it. Keyboard behavior:

- `Enter`: next search occurrence;
- `Shift+Enter`: previous search occurrence;
- `Escape` with text: clear the query;
- `Escape` with an empty input: collapse Search.

The input uses placeholder `Search comments`, `type="search"`, `enterkeyhint="search"`, `autocomplete="off"`, and `spellcheck="false"`. Its title or accessible description may explain `Use quotes to match a phrase`. Supporting browsers provide the clear affordance inside the input.

### Controls

```txt
[query............................. x] | current / total | previous | next
```

- The status is a non-interactive segment with the same transparent background as the highlight counter. There is no divider between the input and counter.
- The counter counts occurrences, not comments.
- The query's exact value remains in the input and URL; it is never abbreviated in state.
- The input title may expose the full query when available width clips it.
- Supporting browsers provide their native clear affordance inside a non-empty search input.
- Previous and next wrap.
- Activating or editing a query selects the first occurrence but does not scroll automatically.
- Explicit navigation lands on the exact keyed mark, not merely its containing comment.
- The active mark receives a stronger treatment; its containing row may also receive a navigator outline.
- Clearing the search input removes only `q`, search highlights, search promotion, and the search active target.

## Highlight Lane

### Available pills

The lane contains:

- Search disclosure button.
- NEW pill when one or more NEW comments exist.
- One author pill for each currently promoted author.

There is no `All pinned` pill. The expected common cases are NEW alone, the first promoted author alone, or NEW plus one explicitly selected author. Users can select several authors manually when needed.

Pill appearance:

- NEW uses the existing orange visual language.
- Author pills use the same deterministic color as the author's promoted-name pill.
- Every pill has its own rounded border and remains a separate, compact button. The pills and counter share the first visual section of the highlight-navigation enclosure; previous and next form the second and third sections.
- Pills sit directly on the header background without an input-like enclosing box. They remain on one line and use horizontal overflow when space is constrained.
- Selected and unselected states are visually distinct and do not rely only on color.

### Selection state

```ts
type HighlightSource = 'new' | `author:${string}`;

const selectedHighlightSources = new SvelteSet<HighlightSource>();
```

Selection is transient and item-local.

Initialization waits for visit history and the NEW threshold:

```txt
NEW comments exist                 -> select only NEW
no NEW, promoted authors available -> select the first author
no NEW or promoted authors         -> select nothing
```

When no source is selected and promoted authors are available, the first author in locale-sorted order becomes selected. This makes a restored or newly created author-only lane immediately navigable. NEW still remains the only visit-history-driven selection when NEW comments exist.

Removing an author promotion removes the pill and its source from `selectedHighlightSources`. If NEW becomes unavailable, remove `new` from the selected set.

### Targets and controls

Selected sources use OR semantics:

```txt
target comment = NEW selected and comment is NEW
              OR selected author source matches comment.user
```

- Targets are real comments only.
- Targets follow depth-first render order.
- A comment matching several selected sources appears once.
- The counter counts comments.
- Previous and next wrap.
- The first selected source chooses the first target without scrolling.
- Preserve the active comment when it remains eligible. Otherwise choose the nearest surviving target without scrolling.
- The active comment uses navigator-specific row styling distinct from click highlighting.

The lane's trailing controls remain mounted whenever the highlight lane is available:

```txt
current / total | previous | next
```

If no source is selected or selected sources have zero targets, show a subdued `0 / 0` and disable the arrows. Keeping these controls mounted prevents pill selection from shifting the layout. There is no separate clear action: users deselect selected pills directly. When promoted authors are available, deselecting the final source activates the first author again. Deselecting pills does not clear NEW state, unpin authors, remove URL parameters, or affect search.

## Header and Sticky Behavior

At the top on wide desktop layouts:

```txt
[Back] [Ungroup | Expand | Reset]     [Search] [NEW] [alice] | 1 / 8 | prev | next
[query............................................. x] | 2 / 12 | prev | next  (when open)
```

The utility controls and navigation share the first row when space permits. Within the navigation area, Search disclosure is left-aligned. When no highlight pills are available, disclosed Search replaces that button and uses the otherwise empty right-side space. When highlight pills are available, their navigator remains on the first row and disclosed Search uses a separate full-width row; the two complete navigators never share one row. The pills and compact counter share the first visual section of the right-aligned highlight enclosure; previous and next are separate fixed sections.

The navigation stack may span a full second row when the header cannot fit it honestly. On mobile, Back and the global toolbar remain above the full-width navigation stack.

While either lane is active, the header remains sticky. A sentinel immediately before the header detects when its original position has scrolled away; a capture-phase scroll-position check provides a fallback. Compact mode hides:

- Back;
- Ungroup, Expand, and Reset;
- tune or other non-navigation panel controls.

Compact mode retains:

- Search disclosure;
- available NEW/author pills;
- highlight-lane counter/actions whenever the lane is available, disabled when it has no targets;
- the search lane when disclosed.

The highlight pill region stays single-line and horizontally scrollable in compact mode. Counter and arrow controls remain fixed at the trailing edge. Do not clone the input or pill row; the same DOM controls transition into compact layout.

The sticky stack must account for `env(safe-area-inset-top)` and must not cover the active target. Exact-match navigation should measure the rendered sticky height before positioning the target.

## URL Contract

```txt
/i/123?q=realtime%20real-time%20streaming&author=alice%3Am
```

- `q` stores the literal-alternative expression.
- Repeated `author=username:level` values store author promotion.
- Supported author levels are `m` and `l`.
- Invalid alternatives and malformed author values are ignored.
- Author entries serialize by username, then level, for stable URLs.
- User actions update reactive state before replacing the current URL.
- URL edits replace history rather than adding an entry per search keystroke or pin action.
- Initial navigation and `popstate` hydrate search and author policy.
- URL hydration never overwrites an input currently being edited through a feedback loop.

Not serialized:

- selected highlight pills;
- either lane's active target;
- Search disclosure without a valid query;
- manual LOD state;
- click highlighting;
- NEW state or threshold.

## Reset Contract

Reset:

- cancels a pending search update;
- clears `q` and all `author` parameters;
- clears search and author highlighting;
- clears both lanes' active targets;
- clears `selectedHighlightSources`;
- collapses an empty search lane;
- clears transient click highlighting;
- clears manual base LOD mutations and global Ungroup policy;
- reapplies the existing default base LOD policy;
- preserves recorded visits and the current NEW threshold.

## Verification Matrix

Search:

- `streaming`, `realtime`, and `real-time` separately.
- `realtime real-time streaming` together.
- `realtime "real time" streaming` with a quoted phrase.
- Duplicate and empty alternatives.
- Overlapping alternatives and literal regex punctuation.
- Encoded entities, links, formatting tags, and multiple paragraphs.
- Comment `48990265`: three combined-query marks and three exact stops.
- Query hydration, Back/Forward, live comments, Reset, and malformed URLs.

Highlight lane:

- First visit with no NEW: no automatic selection.
- Revisit with NEW: NEW is the only selected source after history resolves.
- URL-restored promoted author: pill available, not selected.
- Newly pinned author: pill appears, not selected.
- NEW plus one author selected.
- Several authors selected manually.
- A NEW comment by a selected author appears once.
- Unpinning an active author reconciles the target.
- Clearing pills leaves highlights and URL promotion intact.

Layout and accessibility:

- Search button expands and focuses the input.
- Empty Escape collapses Search; non-empty Escape clears first.
- Desktop, <=640 px, and <=400 px layouts.
- Compact header actually hides Back/global actions after scrolling.
- Pill region scrolls horizontally without moving counters offscreen.
- One and two active lanes do not cover their target.
- Keyboard focus, accessible names, disabled states, and live status announcements.
- `prefers-reduced-motion` does not introduce animated navigation.

Required checks after implementation approval:

- `pnpm check`
- `pnpm lint`
- `git diff --check`

## Success Criteria

The implementation is complete when all of the following remain true:

- Literal-alternative search emits one keyed mark per counted occurrence.
- Search navigation lands on the exact active mark.
- Search and author promotion restore from item URLs.
- Search starts open when no highlight pills are available; otherwise its disclosure remains independent from highlight navigation.
- NEW has automatic priority, with the first promoted author selected when no source remains active.
- An author-only lane automatically selects its first promoted author.
- Multiple selected highlight sources produce a deduplicated comment list.
- There is no All pinned control or promoted-authors scope.
- Compact sticky mode retains both useful lanes and hides unrelated header actions.
- Reset satisfies the complete two-lane contract.
- URL hydration, live comments, Back/Forward, malformed URLs, and narrow layouts pass verification.

## References

- `src/routes/(ssr-optional)/i/[id]/+page.svelte` - Search engine, independent navigation lanes, URL state, effective LOD, lifecycle, and responsive header.
- `specs/comment-author-promotion.md` - Author promotion, colors, and direct-parent context.
- `specs/comment-lod.md` - Base/effective LOD and global-control behavior.
