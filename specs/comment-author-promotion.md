# Spec: Comment Author Highlighting and Promotion

**Date:** 2026-07-21
**Status:** Implemented; core interaction manually verified, lifecycle and automated checks pending
**Companion to:** `specs/comment-lod.md`

## One Sentence

Add thread-local author controls that highlight an author's comments and keep them at a minimum LOD, while also keeping NEW comments out of compressed strips.

## Overview

Fully expanded comment rows gain two compact author-scoped icon actions after the timestamp: **Pin** promotes that author's comments to at least M, and **Pin+** promotes them to L. Either action also highlights the author with a distinct color. Author promotion lasts only for the current item view and is not persisted. Independently, comments marked NEW receive a minimum LOD of M so they cannot remain buried in an S strip.

The feature adds minimum-LOD policies around the existing `lodState`; it does not replace or rewrite that state.

Completion means a user can select either author action from an L row, immediately find every visible comment by that author, and still use the existing row and subtree LOD controls without author or NEW promotion being lost.

## Current State

`src/routes/(ssr-optional)/i/[id]/+page.svelte` currently has:

- one `lodState` entry per comment, read through `getLOD()`;
- L, M, and S rendering, with adjacent S comments grouped into strips;
- row clicks that toggle comments between L and M;
- subtree and global controls that write to `lodState`;
- orange, bold author text for OP comments;
- a NEW badge, orange right border, and faint background for comments newer than the previous item view;
- a separate blue background for the most recently clicked row or expanded strip.

Author names remain links to HN profiles. There is no author-scoped interaction or author promotion state. NEW comments can receive the default S LOD and therefore appear only as anonymous strip segments.

## Scope

In scope:

- Thread-local pin-icon and pin-plus-icon actions for comment authors.
- Automatic author colors for promoted authors.
- Minimum effective LOD of M or L for promoted authors.
- Minimum effective LOD of M for NEW comments.
- Interaction with existing row, subtree, strip, and global LOD controls.
- Comments that arrive after the initial render.
- Keyboard and screen-reader labels for the new buttons.

Out of scope:

- Persisting promoted authors across stories, navigation, or reloads.
- User-selected colors.
- A popover, floating menu, context menu, double-click, or long-press interaction.
- Author controls on M rows or S strips.
- Reordering or collecting promoted comments.
- Notifications or following HN users.
- A separate user-management screen.

## User Experience

### Placement

Only L rows render the new controls. They appear directly after the timestamp link and before the existing subtree controls:

```txt
alice  OP  NEW  2h  [pin] [pin+]  |  [Expand replies] [Ungroup] [Expand]
                    author icons    subtree actions
```

Spacing distinguishes author actions from subtree actions. M rows retain their current compact layout and do not render author controls.

The username remains an ordinary HN profile link. Clicking it never changes promotion state.

### Actions and states

Each author has exactly one thread-local promotion state:

```ts
type AuthorPromotion = 'M' | 'L';

const authorPromotions = new SvelteMap<string, AuthorPromotion>();
```

A missing entry means that the author is not promoted.

The two buttons are direct, mutually exclusive choices:

| Current state | Press Pin | Press Pin+ |
| --- | --- | --- |
| Off | M | L |
| M | Off | L |
| L | M | Off |

- **Pin** is active only when the author's state is M.
- **Pin+** is active only when the author's state is L.
- Pressing the active action removes author promotion.
- Pressing the other action changes directly to that level.

This avoids a multi-click cycle. Promoting an author can change the height of comments throughout the thread, so the user must be able to select the intended result with one press.

The buttons have no visible text labels. Both use the same inline SVG pin shape; Pin+ overlays a small plus in the pin's upper-right corner. The SVGs share one view box, and both buttons keep identical fixed outer dimensions so state changes never shift the metadata layout. Use SVG rather than an emoji so the shape is consistent across platforms.

The plus must remain legible at the narrowest supported layout. The buttons are intentionally compact and approximately the same height as the existing inline LOD actions. Active state uses the button background and border treatment already established for LOD actions; it must not depend only on outline versus filled pin artwork.

Accessible names include the author and scope:

- `Pin comments by alice`
- `Pin and fully expand comments by alice`

Titles describe the resulting behavior:

- `Highlight alice and keep their comments visible`
- `Highlight alice and fully expand their comments`

### Highlight appearance

Pin and Pin+ use the same author highlight. Promotion level changes detail, not color.

- A promoted author's name renders as a compact solid-color pill using a color from a fixed accessible palette, high-contrast negative-space text, and the same emphasized weight as the existing OP treatment.
- Color is derived deterministically from the username within the app, so every comment by one author uses the same color without stored preferences.
- OP keeps the existing fixed orange treatment. Promoting the OP adds the same pill shape with an orange background and does not replace orange with a palette color.
- Author highlighting does not add another row background. This preserves the existing NEW and just-clicked background layers.
- Palette collisions between different usernames are acceptable; color is a scanning aid, not a unique identifier.

## LOD Model

### Base and effective LOD

`lodState` remains the source of truth for the base LOD selected by default policy, row interactions, and tree controls. Promotion is a separate minimum applied when rendering.

```ts
type LOD = 'L' | 'M' | 'S';

function getBaseLOD(id: number): LOD;
function getEffectiveLOD(comment: RenderHNItem): LOD;
```

Detail order is:

```txt
S < M < L
```

Effective LOD is the most detailed applicable value:

```txt
effective LOD = max(
  base LOD,
  promoted-author minimum,
  NEW-comment minimum
)
```

Examples:

| Base | Author | NEW | Effective |
| --- | --- | --- | --- |
| S | Off | No | S |
| S | M | No | M |
| S | Off | Yes | M |
| M | L | No | L |
| L | M | Yes | L |

Promotion must not copy effective values into `lodState`. Removing an author promotion or changing the NEW threshold reveals the current base policy rather than restoring a snapshot.

### Rendering and grouping

Rendering decisions use effective LOD:

- A comment with effective L renders as a full row.
- A comment with effective M renders as a compact row.
- Only comments with effective S participate in S strips.

An S comment promoted to M therefore breaks an existing strip at its original depth-first position. Render order remains unchanged.

The existing tree index must expose enough comment data to calculate author and NEW minima without repeatedly walking the raw tree. The implementation may add an `itemById` or `commentById` lookup to `TreeIndex` if needed.

### Existing controls

Existing controls continue to write base `lodState`. They do not clear or weaken author and NEW minima.

- Clicking an effective M row sets its base LOD to L.
- Clicking an effective L row sets its base LOD to M.
- If a minimum prevents a visible downgrade, the effective row may remain at its current level. For example, an author expanded to L remains L after a row attempts L -> M.
- Expand all writes base L for every comment.
- Turning Expand all off reapplies the default base policy; promoted authors and NEW comments remain at their minimum effective LOD.
- Ungroup actions promote base S entries to M within their existing scopes. They do not alter author promotion.
- Regroup/reset actions restore base policy only. A promoted or NEW comment cannot return to effective S.

Heuristic active states for existing controls should describe the rendered result and therefore inspect effective LOD, except where an existing forward-policy flag is explicitly part of the control's contract. The implementation must preserve the current `ungroupAllFlag` semantics from `specs/comment-lod.md`.

### Author action anchoring

The clicked row is already effective L because author actions render only on L rows. Applying Pin or Pin+ may promote comments elsewhere and cause distributed layout changes. The existing layout animation path should receive the clicked row as its anchor. After the update, the browser viewport should keep that row stable when practical.

Exact scroll restoration is not a release requirement if the action completes in one click and the clicked row remains visible. It should not introduce a new multi-step interaction that depends on the button staying under the pointer.

## NEW Comment Promotion

A comment is NEW under the existing rule:

```txt
newCommentThreshold !== null && comment.time > newCommentThreshold
```

NEW supplies a minimum effective LOD of M.

- First visits keep `newCommentThreshold === null`; no comments are promoted as NEW.
- The existing NEW badge, orange right border, faint background, and count remain unchanged.
- Newly hydrated or live comments use the current threshold and receive the minimum immediately.
- A promoted author at L wins over the NEW minimum of M.
- There is no separate NEW promotion button in this scope.

## Lifecycle

Author promotion belongs to the displayed item view:

- Clear `authorPromotions` when the item id changes, alongside `lodState` and click-highlight state.
- Do not write author promotion to IndexedDB, cookies, local storage, URL parameters, or server state.
- Preserve promotion while the same item receives HNPWA/Firebase replacement or hydration updates.
- Comments from an already promoted author inherit the policy as soon as they appear.

Synthetic promoted-link rows and deleted comments do not expose author actions. Dead comments may expose them only when they have a real username and use the standard author metadata layout; otherwise they remain unchanged.

## Implementation Plan

### Phase 1: Separate base and effective LOD

- [x] Introduce shared `LOD` and `AuthorPromotion` types.
- [x] Make the existing `lodState` read explicit as base LOD.
- [x] Add a comment lookup to the tree index if effective-LOD consumers need one.
- [x] Add `getEffectiveLOD()` with author and NEW minima.
- [x] Move rendering and S-strip grouping to effective LOD without changing render order.
- [x] Update existing active-state derivations and row toggles according to the rules above.

### Phase 2: Author state and controls

- [x] Add thread-local `authorPromotions` state and clear it on item navigation.
- [x] Add direct M/L/off action handlers using the transition table in this spec.
- [x] Render fixed-size inline SVG pin and pin-plus buttons after the timestamp on L rows only.
- [x] Separate author actions from subtree actions with spacing.
- [x] Add pressed state, accessible names, titles, keyboard behavior, compact sizing, and propagation handling consistent with existing buttons.
- [x] Route author actions through the existing layout animation path with the clicked row as anchor.

### Phase 3: Highlight styling and verification

- [x] Add the deterministic author-color palette and promoted-author pill styling.
- [x] Preserve fixed orange OP styling and existing NEW/just-clicked layers.
- [ ] Verify promotion across initial data, hydration, and later comment arrival.
- [ ] Verify narrow layouts with both author and subtree controls present.

## Edge Cases

- **Several promoted authors:** Each policy applies independently; the more detailed per-comment minimum wins.
- **One author appears many times:** Every currently rendered and later-arriving comment by that username receives the same policy and color.
- **Promoted OP:** OP remains orange; Pin or Pin+ changes only minimum LOD.
- **Comment already above its minimum:** Promotion does not reduce detail. Pinning an existing L row leaves that row L while raising the author's S comments to M.
- **Removing promotion:** Comments immediately use their current base LOD, which may regroup effective S comments into strips.
- **NEW plus author promotion:** L author promotion wins over M NEW promotion.
- **Clicked-row highlight:** The existing blue just-clicked state remains independent of author highlighting.
- **No username:** No author actions render.
- **Palette collision:** Two authors may share a color; their displayed usernames remain the authoritative identity.

## Success Criteria

- [ ] L rows with real authors show fixed-size pin and pin-plus icon buttons after the timestamp.
- [ ] Pin highlights the author and prevents that author's comments from rendering at S.
- [ ] Pin+ highlights the author and renders all that author's comments at L.
- [ ] Pin and Pin+ are mutually exclusive, directly selectable, and removable with one press.
- [ ] Author promotion resets on item navigation and is never persisted.
- [ ] NEW comments render at effective M or L, never S.
- [ ] Promoted and NEW comments keep their original depth-first positions.
- [ ] Existing row, subtree, Ungroup all, and Expand all actions remain usable without clearing promotion policies.
- [ ] New or hydrated comments inherit author and NEW promotion without resetting current thread state.
- [ ] OP, NEW, and just-clicked visual treatments remain distinguishable.
- [ ] The compact controls remain usable on narrow layouts, the plus remains legible, and both buttons have author-specific accessible names.

## References

- `specs/comment-lod.md` - Existing LOD state, rendering, grouping, control, and animation contracts.
- `src/routes/(ssr-optional)/i/[id]/+page.svelte` - Current comment rendering, LOD state, tree index, NEW detection, and production controls.
- `src/lib/item-view-history.ts` - Previous-view threshold and visible-comment tracking used by NEW detection.
