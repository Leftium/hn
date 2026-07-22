# Spec: Shareable Comment View Promotion

**Date:** 2026-07-22
**Status:** In progress
**Companion to:** `specs/comment-author-promotion.md` and `specs/comment-lod.md`

## One Sentence

Add a shareable comment-view policy that promotes and highlights literal search matches, serializes search and author promotion in the item URL, and exposes view controls through an attached toolbar and extensible panel.

## Current and Target Shape

The item route already derives effective comment LOD from base `lodState`, author promotion, NEW status, and promoted-reply parent context. Author promotion is currently local to the mounted item view, and the global Reset/Ungroup/Expand controls have no shared container for future view policies.

The target keeps base LOD and promotion policy separate. Search matches add another effective-LOD minimum, search and author policies are represented in the URL, and an attached Comment View toolbar keeps common actions visible while disclosing search and future policy controls.

Completion means a copied item URL recreates its search and author-promoted view, matched text is visible and highlighted, and Reset restores the existing default comment policy.

## User Experience

The header keeps Back as a standalone navigation action and renders the comment controls as a separate nimble.css `[role="group"]`:

```txt
[Back]   [Search comments................] [Ungroup | Expand | Reset]
```

Search is a primary control and consumes the flexible space to the left of the button group. At mobile widths it moves to a full-width second row while Back and the group remain top-aligned:

```txt
[Back]                   [Ungroup | Expand | Reset | tune]
[ Search comments........................................ ]
```

At the narrowest breakpoint, tune becomes the rightmost group segment and collapses or reveals the search row. A URL-loaded active search reveals it automatically. Wider layouts omit tune until there are additional tuning controls to disclose.

The search row is also the future expansion region. Its markup must support later sections, including controls for the NEW-comment promotion level and the visit date used to determine NEW status, but it must not show placeholders for deferred features.

Reset, Ungroup, and Expand remain available while the panel is closed. Reset is an action; Ungroup and Expand retain their toggle semantics and pressed states.

Back never joins the comment-view button group. Narrow layouts may move search or the group to another grid row, but must not hide Reset, Ungroup, or Expand.

The author Pin/Pin+ pair and each comment's thread LOD actions also use nimble.css button groups. Feature CSS may retain compact sizing, SVG styling, and active-state colors, but must not reimplement the group's borders, dividers, radii, or hover behavior.

## Search Policy

- Search is a case-insensitive literal substring match against visible comment text.
- Input updates after a 150-200 ms debounce.
- A trimmed query shorter than two characters is inactive.
- A matching real comment receives minimum effective LOD L.
- The direct parent of a matching reply receives minimum effective LOD M.
- Every match that occurs within a rendered text node is highlighted without modifying element markup or attributes.
- Synthetic promoted-link rows do not participate.
- Hydrated and newly arriving comments are evaluated against the current URL query.

Search does not write to `lodState`.

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

Direct-parent context is the union of parents required by author and search promotion. It remains derived rendering policy.

## URL Contract

```txt
/i/123?q=sqlite&author=alice%3Am&author=bob%3Al
```

- `q` stores the single active search query.
- Repeated `author=username:level` values store author promotion.
- Supported levels are `m` and `l`.
- Empty, short, or malformed values are ignored.
- Serialization orders author entries by username, then level, for stable URLs.
- Runtime search and author policy live in reactive component state. User actions update that state first, then replace the current URL rather than adding one history entry per edit.
- Initial item navigation hydrates runtime policy from the URL. Browser `popstate` hydrates it for back/forward navigation. URL replacement does not continuously write back into an input being edited.
- Back/forward navigation reparses the URL-backed policy.
- Manual per-comment LOD, toolbar disclosure, click highlighting, and NEW state are not serialized.

Do not reserve URL parameters for configurable NEW behavior until its visit-date semantics are designed.

## Reset Contract

Reset:

- removes `q` and all `author` parameters;
- clears search and author highlighting;
- clears the transient click highlight;
- clears manual base LOD mutations and the global Ungroup policy;
- reapplies the existing default base LOD policy;
- preserves recorded visits and the current NEW threshold.

When NEW promotion becomes configurable, Reset should restore its policy controls to their defaults without deleting visit history.

## Implementation Plan

- [x] Hydrate reactive search and author policy from the current item URL.
- [x] Serialize policy changes deterministically with history replacement.
- [x] Derive search matches and their direct-parent context.
- [x] Highlight matches within comment text without rewriting markup boundaries.
- [x] Build the nimble.css button groups, promoted desktop search, responsive search row, and narrow-layout tune disclosure.
- [x] Add complete Reset behavior.
- [ ] Verify URL restoration, combined policies, hydration, live comments, HTML content, keyboard behavior, and narrow layouts.

## Success Criteria

- [ ] A two-character or longer query reactively promotes matching comments to L and highlights matching text.
- [ ] One-character and empty queries do not promote comments.
- [ ] Matching replies retain direct-parent M context.
- [ ] Author Pin and Pin+ changes are reflected in the URL.
- [ ] Copying and opening the URL recreates search and author promotion.
- [ ] Reset restores the default base view and removes shareable promotion parameters.
- [ ] Common actions remain available when narrow-layout search is collapsed.
- [ ] The search expansion region can accept future NEW-policy sections without changing the toolbar structure.

## References

- `specs/comment-author-promotion.md` - Existing author, NEW, and parent-context policy.
- `specs/comment-lod.md` - Base LOD, grouping, and global-control contracts.
- `src/routes/(ssr-optional)/i/[id]/+page.svelte` - Item URL, comment rendering, and toolbar implementation.
