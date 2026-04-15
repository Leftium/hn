# Session-Based Visit Tracking Implementation Plan

## Overview

Implement a session-based visit tracking system using rolling cookies with a 20-minute timeout. This provides better UX through transparent session management and prepares for future comment highlighting features.

## Original System Problems

- Complex baseline calculations with `visit_baseline`
- SessionStorage usage prevented SSR from accessing user's baseline selection
- No visibility into when a new visit will be recorded
- No user control over session boundaries

## Proposed Solution

Use a short-lived rolling cookie (20 minutes) that naturally defines session boundaries. A new visit is recorded when the session cookie expires, not based on arbitrary time differences.

## Implementation Tasks

### Phase 1: Core Session Management (High Priority)

- [x] Add `session_active` cookie with 20-minute rolling expiry
  - Cookie refreshed on every page load
  - Presence/absence determines if request is part of existing session
- [x] Update visit recording logic in `+page.server.ts`
  - Record new visit only when `session_active` cookie is missing/expired
  - Keep recording visits to history array (up to 10)

### Phase 2: Baseline Improvements (Medium Priority)

- [x] Replace sessionStorage baseline with cookie-based selection
  - Added `selected_baseline` persistent cookie
  - Updated config page to save selection to cookie instead of sessionStorage
  - Updated main page to read baseline from cookie (SSR accessible)
- [x] Add session status display
  - Calculate and show time remaining in current session
  - Added "End Session" button to manually expire session cookie
  - Displayed in header metadata alongside visit info

### Phase 3: UI Enhancements (Low Priority)

- [x] Improve config page baseline selection
  - Added help tooltip explaining baseline behavior
  - Improved status display (automatic vs manual)
  - Fixed form submission bugs
- [x] Clean up old code
  - Renamed `visits_recent` cookie to `visits_history`
  - Simplified baseline calculation code

## Technical Details

### New Cookie Structure

```javascript
// Session management (short-lived)
session_active: "1"                    // 20-min expiry, refreshed on each request

// Visit tracking (persistent, 1 year)
visits_history: "ts1-ts2-ts3..."      // Timestamps of up to 10 recent visits
visits_total: "123"                   // Total visit count
selected_baseline: "timestamp"        // User's chosen baseline (optional)

// To remove
visits_recent: ...                    // Rename to visits_history
```

### Session Logic Pseudocode

```javascript
// On every route load (except /config)
if (!isConfigPage) {
	if (!cookies.get('session_active')) {
		// New session - record visit
		recordNewVisit();
	}
	// Always refresh session cookie (extends it)
	cookies.set('session_active', '1', { maxAge: 20 * 60 });
}
```

### Benefits

1. **Intuitive behavior**: Activity keeps session alive, inactivity ends it
2. **User control**: Can see and manually end sessions
3. **SSR-friendly**: All state in cookies, no JS required
4. **Simpler code**: Remove complex time calculations
5. **Future-proof**: Same system will work for comment highlighting

## Testing Plan

1. Verify 20-minute timeout feels natural for reading sessions
2. Test session extends properly during active browsing
3. Confirm baseline selection persists across page loads
4. Ensure manual session end works correctly
5. Validate that excluded paths (config) don't record visits

## Success Criteria

- Sessions feel natural and match user's mental model of "visits"
- Users can understand and control when new visits are recorded
- Highlighting works on first page load (SSR) with custom baselines
- Code is simpler and easier to maintain
