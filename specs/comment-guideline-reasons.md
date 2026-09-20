# Floating comment guideline reasons

## Status

Experimental first pass.

## Context

Comments that meet the configured guideline threshold are intentionally de-emphasized with reduced opacity and blur. Hovering or focusing the comment restores readability and shows the matching guideline reasons.

The current reason display is named and exposed as a tooltip, but it participates in the comment row's normal grid/flex layout. Revealing it inserts a `tooltip` grid row for L comments and enables wrapping for M comments. That makes the thread move while the pointer is over a filtered comment.

An earlier overlay-style tooltip also has an undesirable failure mode: if the reasons are placed over the comment, the explanation hides the text the user is trying to inspect.

## Goal

Reveal guideline reasons without changing comment layout and without covering the comment being explained.

The reason panel should behave as a sidecar to the comment rather than as part of the comment's document flow.

## Interaction

When a filtered comment is hovered or receives focus:

1. Restore the comment's normal opacity/readability as today.
2. Reveal its guideline reasons immediately.
3. Float the reason panel outside normal layout, preferably immediately above the comment.
4. If there is not enough viewport space above, place the panel below the comment instead.
5. Never place the panel on top of the comment itself.

When hover/focus leaves the comment, hide the reason panel and return the comment to its filtered appearance.

The reason panel is informational, not interactive. It should not capture pointer input.

## Layout requirements

- Revealing or hiding reasons must not change the position or size of the target comment or neighboring comments.
- The target comment must remain fully visible while its reasons are shown.
- Do not assume a right/left gutter is available. The behavior must work at narrow and wide viewport sizes and for deeply indented comments.
- Prefer above the target comment; fall back below when the preferred placement would overflow the viewport.
- Keep the panel within the viewport horizontally and cap its height if necessary.
- The panel may temporarily cover a neighboring comment. Avoiding both layout movement and all overlap with surrounding content would require reserving permanent space, which is explicitly not the goal.

## Accessibility

Preserve the existing `aria-describedby` relationship between each filtered comment and its reason element.

Reason visibility should continue to respond to keyboard focus as well as pointer hover. The floating presentation must not require pointer interaction with the reason panel itself.

## First-pass implementation

Use CSS Anchor Positioning rather than introducing a positioning library or JavaScript geometry calculations:

- each filtered `d-comment` is a scoped anchor;
- its existing `s-guideline-tooltip` becomes a fixed, anchor-positioned element;
- `position-area: block-start` prefers placement above the comment;
- `position-try-fallbacks: flip-block` flips below when the preferred placement overflows;
- the reason panel is sized from its anchor and capped to the viewport;
- the existing hover/focus grid-row insertion and M-row wrapping are overridden so revealing the panel cannot affect normal flow.

The rules are feature-gated with `@supports`. Browsers without the required anchor-positioning support keep the existing in-flow behavior rather than losing access to the reasons.

This first pass deliberately does **not** use the Popover API. The reason element is already present in the DOM, is non-interactive, and CSS anchor positioning is sufficient to test the layout/placement idea with a small change. If stacking, clipping, or sticky-header interactions prove problematic, promoting the element to the top layer with Popover is the next implementation to try.

## Acceptance checks

Manual verification should cover:

- L comment near the middle of the viewport: reasons appear above; no thread movement.
- M comment near the middle of the viewport: reasons appear above; the row stays one line and neighboring comments do not move.
- Comment near the top of the viewport: reasons flip below rather than leaving the viewport.
- Deeply indented comment: reasons remain usable within the viewport and do not depend on a side gutter.
- Long/multiple guideline reasons: panel height is bounded and content remains readable.
- Keyboard focus: reasons appear and the existing `aria-describedby` target remains present.
- Pointer movement over neighboring content: the informational panel does not intercept pointer input.
- Browser without CSS Anchor Positioning: existing reason display remains usable.

## Known first-pass questions

- A sticky navigation/header occupies viewport space but is not itself a viewport boundary, so anchor overflow fallback may not avoid it in every case.
- During the comment's short opacity/filter transition, stacking/clipping behavior should be visually checked in real browsers.
- If those issues are material, the next pass should test a manual Popover API element using the comment as its implicit anchor while retaining the same above/below positioning policy.
