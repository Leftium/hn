<script lang="ts">
	import type { HnpwaItem } from '$lib/fetch-hnpwa';
	import { domainify } from '$lib/fetch-hnpwa';
	import {
		getItemView,
		recordItemView,
		countNewComments,
		countVisibleComments,
		isHiddenComment
	} from '$lib/item-view-history';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import 'open-props/style';
	import dayjs from 'dayjs';

	/** Max indent levels before capping (deeper comments show same indent but retain depth indicator) */
	const MAX_INDENT = 5;

	/** Cycling color palette for depth indicators — chosen for visual distinction */
	const DEPTH_COLORS = [
		'#4a9eda', // blue
		'#2ea87e', // green
		'#c4872f', // amber
		'#d35050', // red
		'#8b5dd0', // purple
		'#d06ca0', // pink
		'#3aa8a0' // teal
	];

	let { data } = $props();

	const item: HnpwaItem = $derived(data.item);
	const domain = $derived(item.domain || domainify(item.url));

	// Derive comment count from tree walk (HNPWA's comments_count inflates by including deleted/dead)
	const visibleCommentCount = $derived(countVisibleComments(item.comments));

	// New-comment tracking: threshold is the viewedAt from the previous visit.
	// null = first visit (no highlights). Set on mount from IndexedDB.
	let newCommentThreshold = $state<number | null>(null);
	let newCommentCount = $state(0);

	// Collapse state: Set of comment IDs that are collapsed.
	// Default: all depth > 0 comments start collapsed.
	let collapsedIds = $state(new Set<number>());

	// Micro-collapse state: Set of comment IDs whose descendant subtrees
	// are rendered as a 4px color strip instead of individual collapsed lines.
	// Default: all comments that have visible grandchildren (depth-2+ descendants).
	let microCollapsedIds = $state(new Set<number>());

	// Parent map: child ID → parent ID (for ancestor expansion)
	let parentMap = $state(new Map<number, number>());

	// Children map: parent ID → visible child IDs (for sibling lookups)
	let childrenMap = $state(new Map<number, number[]>());

	// IDs that were auto-micro-grouped by leaf expansion (so we can reverse it)
	let autoGroupedIds = $state(new Set<number>());

	// Thread-protected child IDs: these children are excluded from their parent's
	// micro-collapse strip (rendered normally while siblings become strips)
	let threadChildIds = $state(new Set<number>());

	/** Collect all comment IDs at depth > 0, and build child→parent map + parent→children map */
	function buildCommentMaps(
		comments: HnpwaItem[],
		depth: number,
		parentId: number | null,
		collapsed: Set<number>,
		parents: Map<number, number>,
		children: Map<number, number[]>,
		microCollapsed: Set<number>
	) {
		const visibleIds: number[] = [];
		for (const c of comments) {
			if (isHiddenComment(c)) continue;
			visibleIds.push(c.id);
			if (depth > 0) collapsed.add(c.id);
			if (parentId !== null) parents.set(c.id, parentId);
			// Non-root comments with visible grandchildren get micro-collapsed by default.
			// Depth-0 comments keep their children as individual collapsed lines for navigation.
			if (depth > 0 && hasVisibleGrandchildren(c)) {
				microCollapsed.add(c.id);
			}
			if (c.comments?.length)
				buildCommentMaps(c.comments, depth + 1, c.id, collapsed, parents, children, microCollapsed);
		}
		if (parentId !== null) {
			children.set(parentId, visibleIds);
		}
	}

	/** Check if a comment has any visible grandchildren (children who themselves have visible children) */
	function hasVisibleGrandchildren(comment: HnpwaItem): boolean {
		return (
			comment.comments?.some(
				(c) => !isHiddenComment(c) && c.comments?.some((gc) => !isHiddenComment(gc))
			) ?? false
		);
	}

	/** Count all visible descendants of a comment (recursive) */
	function countVisibleDescendants(comments: HnpwaItem[]): number {
		let count = 0;
		for (const c of comments) {
			if (isHiddenComment(c)) continue;
			count++;
			if (c.comments?.length) count += countVisibleDescendants(c.comments);
		}
		return count;
	}

	/** Collect IDs of all visible descendants that have visible grandchildren (micro-eligible) */
	function collectEligibleDescendantIds(comments: HnpwaItem[], out: number[]) {
		for (const c of comments) {
			if (isHiddenComment(c)) continue;
			if (hasVisibleGrandchildren(c)) out.push(c.id);
			if (c.comments?.length) collectEligibleDescendantIds(c.comments, out);
		}
		return out;
	}

	// Re-initialize collapsed set, parent map, children map, and micro-collapsed set whenever item changes
	$effect(() => {
		const collapsed = new Set<number>();
		const parents = new Map<number, number>();
		const children = new Map<number, number[]>();
		const micro = new Set<number>();
		buildCommentMaps(item.comments, 0, null, collapsed, parents, children, micro);
		collapsedIds = collapsed;
		parentMap = parents;
		childrenMap = children;
		microCollapsedIds = micro;
		autoGroupedIds = new Set<number>();
		threadChildIds = new Set<number>();
	});

	/** Strip HTML tags and decode entities to plain text for collapsed preview */
	function stripHtml(html: string): string {
		return html
			.replace(/<[^>]+>/g, ' ')
			.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
			.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&apos;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	/** Collect descendant depths (visible only) from a comment subtree, in tree order */
	function collectDescendantDepths(comments: HnpwaItem[], baseDepth: number, out: number[]) {
		for (const c of comments) {
			if (isHiddenComment(c)) continue;
			out.push(baseDepth);
			if (c.comments?.length) collectDescendantDepths(c.comments, baseDepth + 1, out);
		}
		return out;
	}

	/**
	 * Build an array of color blocks for the micro-collapsed strip.
	 * Each descendant gets a block colored by its depth.
	 * Width matches the depth's left border width: Math.min(2 + depth, 14)px.
	 * @param comments — children of the comment being micro-collapsed
	 * @param baseDepth — the depth of those children (parent depth + 1)
	 */
	function buildMicroBlocks(
		comments: HnpwaItem[],
		baseDepth: number
	): Array<{ color: string; width: number }> {
		const depths = collectDescendantDepths(comments, baseDepth, []);
		return depths.map((d) => ({
			color: DEPTH_COLORS[d % DEPTH_COLORS.length],
			width: Math.min(2 + d, 14)
		}));
	}

	/** Collect all descendant IDs (visible only) from a comment subtree */
	function collectDescendantIds(comments: HnpwaItem[], out: number[]) {
		for (const c of comments) {
			if (isHiddenComment(c)) continue;
			out.push(c.id);
			if (c.comments?.length) collectDescendantIds(c.comments, out);
		}
		return out;
	}

	/** Toggle collapsed state. Returns set of comment IDs whose collapsed state changed. */
	function toggleComment(comment: HnpwaItem): Set<number> {
		const selfCollapsed = collapsedIds.has(comment.id);
		const childIds = comment.comments.filter((c) => !isHiddenComment(c)).map((c) => c.id);
		const changed = new Set<number>();

		const next = new Set(collapsedIds);

		if (selfCollapsed) {
			const isLeaf = childIds.length === 0;

			// Expand self + all ancestors
			if (next.delete(comment.id)) changed.add(comment.id);
			const expandedAncestors: number[] = [];
			let ancestorId = parentMap.get(comment.id);
			while (ancestorId !== undefined) {
				if (next.delete(ancestorId)) changed.add(ancestorId);
				expandedAncestors.push(ancestorId);
				ancestorId = parentMap.get(ancestorId);
			}
			// Also expand direct children
			for (const id of childIds) {
				if (next.delete(id)) changed.add(id);
			}
			// Disable micro-collapse on self AND direct children so their
			// subtrees render normally (not hidden behind strips)
			const nextMicro = new Set(microCollapsedIds);
			nextMicro.delete(comment.id);
			for (const id of childIds) {
				nextMicro.delete(id);
			}

			if (isLeaf) {
				// For leaf comments: micro-group the *parents* along the thread path
				// so non-thread siblings become strips, while the thread child is
				// rendered normally (protected via threadChildIds).

				// Reverse any previous auto-grouping first
				for (const id of autoGroupedIds) {
					nextMicro.delete(id);
				}
				const newAutoGrouped = new Set<number>();
				const newThreadChildren = new Set<number>();

				// Walk the thread path: for each node, micro-group its parent
				// (which strips all siblings) and protect the node itself
				const threadNodes = [comment.id, ...expandedAncestors];
				for (const nodeId of threadNodes) {
					const pid = parentMap.get(nodeId);
					if (pid === undefined) continue; // depth-0, no parent to group

					// Protect this node from being stripped
					newThreadChildren.add(nodeId);

					// Micro-group the parent (if not already micro-grouped)
					if (!nextMicro.has(pid)) {
						nextMicro.add(pid);
						newAutoGrouped.add(pid);
					}
				}

				autoGroupedIds = newAutoGrouped;
				threadChildIds = newThreadChildren;
			}

			microCollapsedIds = nextMicro;
		} else if (childIds.length === 0) {
			// Expanded leaf: collapse self + all ancestors at depth >= 1
			if (!next.has(comment.id)) changed.add(comment.id);
			next.add(comment.id);
			let ancestorId = parentMap.get(comment.id);
			while (ancestorId !== undefined) {
				// Stop before depth-0 (depth-0 comments have no parent in parentMap)
				const isDepthZero = !parentMap.has(ancestorId);
				if (isDepthZero) break;
				if (!next.has(ancestorId)) changed.add(ancestorId);
				next.add(ancestorId);
				ancestorId = parentMap.get(ancestorId);
			}
			// Reverse any auto-micro-grouping from the previous leaf expansion
			if (autoGroupedIds.size > 0) {
				const nextMicro = new Set(microCollapsedIds);
				for (const id of autoGroupedIds) {
					nextMicro.delete(id);
				}
				microCollapsedIds = nextMicro;
				autoGroupedIds = new Set<number>();
				threadChildIds = new Set<number>();
			}
		} else {
			// Already expanded with children: toggle direct children only
			const anyChildCollapsed = childIds.some((id) => next.has(id));
			if (anyChildCollapsed) {
				// Some children collapsed → expand all direct children
				for (const id of childIds) {
					if (next.delete(id)) changed.add(id);
				}
				// Disable micro-collapse on self AND children so their subtrees render
				const nextMicro = new Set(microCollapsedIds);
				nextMicro.delete(comment.id);
				for (const id of childIds) {
					nextMicro.delete(id);
				}
				microCollapsedIds = nextMicro;
			} else {
				// All children expanded → collapse direct children
				for (const id of childIds) {
					if (!next.has(id)) changed.add(id);
					next.add(id);
				}
			}
		}

		collapsedIds = next;
		return changed;
	}

	/**
	 * Snapshot all comment heights, run a state mutation, then animate
	 * changed elements and scroll-anchor to keep `anchorEl` in place.
	 */
	async function animateStateChange(anchorEl: HTMLElement, mutate: () => void) {
		// Snapshot heights before mutation
		const heightsBefore = new Map<number, number>();
		const allEls = document.querySelectorAll<HTMLElement>('d-comment[data-comment-id]');
		for (const el of allEls) {
			heightsBefore.set(Number(el.dataset.commentId), el.offsetHeight);
		}
		// Also snapshot micro-collapsed strips
		const stripHeightsBefore = new Map<number, number>();
		const allStrips = document.querySelectorAll<HTMLElement>('d-micro-collapsed[data-micro-id]');
		for (const el of allStrips) {
			stripHeightsBefore.set(Number(el.dataset.microId), el.offsetHeight);
		}

		const rectBefore = anchorEl.getBoundingClientRect();

		mutate();
		await tick();

		// Scroll anchoring
		const rectAfter = anchorEl.getBoundingClientRect();
		const shift = rectAfter.top - rectBefore.top;
		if (Math.abs(shift) > 1) {
			window.scrollBy(0, shift);
		}

		// Track which before-comments disappeared (for strip animation)
		const disappearedHeight = new Map<number, number>(); // parentId → total height lost
		for (const [id, hBefore] of heightsBefore) {
			const el = document.querySelector<HTMLElement>(`[data-comment-id="${id}"]`);
			if (el) {
				// Still exists — animate if height changed
				const hAfter = el.offsetHeight;
				if (hBefore !== hAfter) animateHeight(el, hBefore, hAfter);
			} else {
				// Disappeared — accumulate height under its parent for strip animation
				const pid = parentMap.get(id);
				if (pid !== undefined) {
					disappearedHeight.set(pid, (disappearedHeight.get(pid) ?? 0) + hBefore);
				}
			}
		}

		// Animate strips that existed before and changed height
		for (const [id, hBefore] of stripHeightsBefore) {
			const el = document.querySelector<HTMLElement>(`[data-micro-id="${id}"]`);
			if (!el) continue;
			const hAfter = el.offsetHeight;
			if (hBefore !== hAfter) animateHeight(el, hBefore, hAfter);
		}

		// Animate newly-appeared strips: start from total height of
		// disappeared children so it looks like lines compress into strip
		const allStripsAfter = document.querySelectorAll<HTMLElement>(
			'd-micro-collapsed[data-micro-id]'
		);
		for (const el of allStripsAfter) {
			const id = Number(el.dataset.microId);
			if (stripHeightsBefore.has(id)) continue;
			const lostHeight = disappearedHeight.get(id) ?? 0;
			animateHeight(el, lostHeight || 0, el.offsetHeight);
		}

		// Animate newly-appeared comments
		const allElsAfter = document.querySelectorAll<HTMLElement>('d-comment[data-comment-id]');
		for (const el of allElsAfter) {
			const id = Number(el.dataset.commentId);
			if (heightsBefore.has(id)) continue;
			animateHeight(el, 0, el.offsetHeight);
		}
	}

	/** Animate an element's height from hBefore to hAfter */
	function animateHeight(el: HTMLElement, hBefore: number, hAfter: number) {
		el.style.overflow = 'hidden';
		el.style.height = `${hBefore}px`;
		el.style.transitionProperty = 'none';
		void el.offsetHeight;
		el.style.transitionProperty = 'height';
		el.style.transitionDuration = '350ms';
		el.style.transitionTimingFunction = 'ease-out';
		el.style.height = `${hAfter}px`;
		const onEnd = () => {
			el.style.height = '';
			el.style.overflow = '';
			el.style.transitionProperty = '';
			el.style.transitionDuration = '';
			el.style.transitionTimingFunction = '';
		};
		el.addEventListener('transitionend', onEnd, { once: true });
		setTimeout(onEnd, 400);
	}

	onMount(async () => {
		const previous = await getItemView(item.id);

		if (previous) {
			newCommentThreshold = previous.viewedAt;
			newCommentCount = countNewComments(item.comments, previous.viewedAt);
		}

		// Record this visit (always, even on first view)
		await recordItemView(item.id, visibleCommentCount);
	});

	const hnItemUrl = $derived(`https://news.ycombinator.com/item?id=${item.id}`);
	const hnUserUrl = $derived(
		item.user ? `https://news.ycombinator.com/user?id=${item.user}` : null
	);

	// External URL for the posted article (not HN self-links)
	const articleUrl = $derived(item.url && !item.url.startsWith('item?id=') ? item.url : hnItemUrl);

	// HNPWA comment-type items have url like "item?id=NNNNN"
	const parentStoryId = $derived(
		item.type === 'comment' && item.url ? item.url.match(/item\?id=(\d+)/)?.[1] : null
	);

	// Extract path portion of URL for display (after domain)
	const urlPath = $derived(
		item.url && !item.url.startsWith('item?id=')
			? item.url
					.replace(/^https?:\/\/(www\.)?/, '')
					.replace(domain || '', '')
					.replace(/\/$/, '')
			: ''
	);

	function goBack() {
		// If opened in a new tab, history.length is typically 1-2 (browser-dependent).
		// navigation.canGoBack is the most reliable check where available.
		const nav = (window as any).navigation;
		if (nav && typeof nav.canGoBack === 'boolean') {
			if (nav.canGoBack) {
				history.back();
			} else {
				window.location.href = resolve('/');
			}
		} else {
			// Fallback: if we have meaningful history, go back; otherwise go home
			if (history.length > 2) {
				history.back();
			} else {
				window.location.href = resolve('/');
			}
		}
	}

	function relativeTime(time: number): string {
		const timestamp = time < 1e12 ? time * 1000 : time;
		const then = dayjs(timestamp);
		const now = dayjs();

		const minutes = now.diff(then, 'minute');
		if (minutes < 60) return `${minutes}m`;

		const hours = now.diff(then, 'hour');
		if (hours < 24) return `${hours}h`;

		const days = now.diff(then, 'day');
		if (days < 90) return `${days}d`;

		const months = now.diff(then, 'month');
		if (months < 12) return `${months}mo`;

		const years = now.diff(then, 'year');
		return `${years}y`;
	}
</script>

{#snippet upvote()}
	<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
		<path
			fill="currentColor"
			d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14"
		/>
	</svg>
{/snippet}

{#snippet message()}
	<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
		<path
			fill="currentColor"
			d="M20 2H4c-1.103 0-2 .894-2 1.992v12.016C2 17.106 2.897 18 4 18h3v4l6.351-4H20c1.103 0 2-.894 2-1.992V3.992A2 2 0 0 0 20 2"
		/>
	</svg>
{/snippet}

{#snippet leafIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
		<path
			fill="currentColor"
			d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66l.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8"
		/>
	</svg>
{/snippet}

{#snippet commentTree(comments: HnpwaItem[], depth: number)}
	{#each comments.filter((c) => !isHiddenComment(c)) as comment (comment.id)}
		{@const isDead = comment.content === '<p>[dead]'}
		{@const isDeleted = !comment.user}
		{@const isOp = !isDead && !!comment.user && comment.user === item.user}
		{@const isNew = newCommentThreshold !== null && comment.time > newCommentThreshold}
		{@const indent = Math.min(depth, MAX_INDENT)}
		{@const colorIndex = depth % DEPTH_COLORS.length}
		{@const barWidth = depth === 0 ? 0 : Math.min(2 + depth, 14)}
		{@const isCollapsed = collapsedIds.has(comment.id)}
		{@const hasChildren = comment.comments.filter((c) => !isHiddenComment(c)).length > 0}
		{@const hasGrandchildren = hasVisibleGrandchildren(comment)}
		{@const descendantCount = hasChildren ? countVisibleDescendants(comment.comments) : 0}
		{@const isLeaf = !hasChildren}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<d-comment
			data-comment-id={comment.id}
			style:--depth={depth}
			style:--indent={indent}
			style:--depth-color={DEPTH_COLORS[colorIndex]}
			style:--bar-width="{barWidth}px"
			class:top-level={depth === 0}
			class:op={isOp}
			class:deleted={isDeleted && !isDead}
			class:dead={isDead}
			class:new-comment={isNew}
			class:collapsed={isCollapsed}
			class:has-children={hasChildren}
			onclick={async (e: MouseEvent) => {
				// Don't toggle when clicking links
				if ((e.target as HTMLElement).closest('a')) return;
				const el = document.querySelector(
					`[data-comment-id="${comment.id}"]`
				) as HTMLElement | null;
				if (!el) return;

				await animateStateChange(el, () => toggleComment(comment));

				el.classList.add('just-clicked');
				setTimeout(() => el.classList.remove('just-clicked'), 1200);
			}}
		>
			<d-comment-meta>
				{#if depth > 0}
					<s-depth style:color={DEPTH_COLORS[colorIndex]}>{depth}</s-depth>
				{/if}
				{#if isDead}
					<a href="https://news.ycombinator.com/item?id={comment.id}" class="dead-link">[dead]</a>
					{#if comment.user}
						<a href="https://news.ycombinator.com/user?id={comment.user}" class="dead-link">
							{comment.user}
						</a>
					{/if}
					<s-time>{relativeTime(comment.time)}</s-time>
				{:else if isDeleted}
					<s-author class="deleted">[deleted]</s-author>
				{:else}
					<a href="https://news.ycombinator.com/user?id={comment.user}" class="author-link">
						<s-author>{comment.user}</s-author>
					</a>
					{#if isOp}
						<s-op-badge>OP</s-op-badge>
					{/if}
					{#if isNew}
						<s-new-badge>NEW</s-new-badge>
					{/if}
					<s-time>{relativeTime(comment.time)}</s-time>
					{#if isLeaf}
						<s-leaf-icon>{@render leafIcon()}</s-leaf-icon>
					{/if}
				{/if}
				{#if !isCollapsed && hasChildren}
					{@const allDescendantIds = collectDescendantIds(comment.comments, [])}
					{@const anyDescendantCollapsed = allDescendantIds.some((id) => collapsedIds.has(id))}
					<s-reply-count>{descendantCount} replies</s-reply-count>
					{#if hasGrandchildren}
						{@const eligibleChildIds = comment.comments
							.filter((c) => !isHiddenComment(c) && hasVisibleGrandchildren(c))
							.map((c) => c.id)}
						{@const allEligibleIds = collectEligibleDescendantIds(comment.comments, [])}
						{@const childrenGrouped = eligibleChildIds.some((id) => microCollapsedIds.has(id))}
						{@const deeperGrouped = allEligibleIds.some(
							(id) => !eligibleChildIds.includes(id) && microCollapsedIds.has(id)
						)}
						{@const groupLabel = childrenGrouped
							? 'grouped'
							: deeperGrouped
								? 'partially grouped'
								: 'ungrouped'}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<s-micro-toggle
							class:grouped={childrenGrouped}
							class:partial={!childrenGrouped && deeperGrouped}
							onclick={async (e: MouseEvent) => {
								e.stopPropagation();
								const commentEl = document.querySelector<HTMLElement>(
									`[data-comment-id="${comment.id}"]`
								);
								if (!commentEl) return;

								await animateStateChange(commentEl, () => {
									const nextMicro = new Set(microCollapsedIds);

									if (childrenGrouped) {
										for (const id of eligibleChildIds) {
											nextMicro.delete(id);
										}
									} else if (deeperGrouped) {
										for (const id of allEligibleIds) {
											nextMicro.delete(id);
										}
									} else {
										const nextCollapsed = new Set(collapsedIds);
										for (const id of allEligibleIds) {
											nextMicro.add(id);
										}
										for (const id of allDescendantIds) {
											nextCollapsed.add(id);
										}
										collapsedIds = nextCollapsed;
									}
									microCollapsedIds = nextMicro;
								});
							}}>{groupLabel}</s-micro-toggle
						>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<s-expand-toggle
						onclick={async (e: MouseEvent) => {
							e.stopPropagation();
							const commentEl = document.querySelector<HTMLElement>(
								`[data-comment-id="${comment.id}"]`
							);
							if (!commentEl) return;

							await animateStateChange(commentEl, () => {
								const nextCollapsed = new Set(collapsedIds);
								const nextMicro = new Set(microCollapsedIds);

								if (anyDescendantCollapsed) {
									for (const id of allDescendantIds) {
										nextCollapsed.delete(id);
									}
									const allEligible = hasGrandchildren
										? collectEligibleDescendantIds(comment.comments, [])
										: [];
									for (const id of allEligible) {
										nextMicro.delete(id);
									}
								} else {
									for (const id of allDescendantIds) {
										nextCollapsed.add(id);
									}
									if (hasGrandchildren) {
										const allEligible = collectEligibleDescendantIds(comment.comments, []);
										for (const id of allEligible) {
											nextMicro.add(id);
										}
									}
								}
								collapsedIds = nextCollapsed;
								microCollapsedIds = nextMicro;
							});
						}}>{anyDescendantCollapsed ? 'expand all' : 'collapse all'}</s-expand-toggle
					>
				{/if}
			</d-comment-meta>
			{#if isCollapsed && comment.content && !isDead}
				<s-collapsed-preview>{stripHtml(comment.content)}</s-collapsed-preview>
			{/if}
			{#if !isCollapsed && comment.content && !isDead}
				<d-comment-body>
					{@html comment.content}
				</d-comment-body>
			{/if}
		</d-comment>
		{#if comment.comments.length > 0}
			{@const isMicroCollapsed = microCollapsedIds.has(comment.id)}
			{@const threadChild = isMicroCollapsed
				? comment.comments.find((c) => !isHiddenComment(c) && threadChildIds.has(c.id))
				: null}
			{#if isMicroCollapsed && !threadChild}
				{@const blocks = buildMicroBlocks(comment.comments, depth + 1)}
				{#if blocks.length > 0}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<d-micro-collapsed
						data-micro-id={comment.id}
						onclick={async (e: MouseEvent) => {
							e.stopPropagation();
							const parentEl = document.querySelector<HTMLElement>(
								`[data-comment-id="${comment.id}"]`
							);
							const anchorEl = parentEl || (e.currentTarget as HTMLElement);

							await animateStateChange(anchorEl, () => {
								const next = new Set(microCollapsedIds);
								next.delete(comment.id);
								microCollapsedIds = next;
							});
						}}
					>
						{#each blocks as block}
							<s-micro-block style:width="{block.width}px" style:background={block.color}
							></s-micro-block>
						{/each}
					</d-micro-collapsed>
				{/if}
			{:else if isMicroCollapsed && threadChild}
				{@const nonThreadChildren = comment.comments.filter(
					(c) => !isHiddenComment(c) && c.id !== threadChild.id
				)}
				{@const blocks = buildMicroBlocks(nonThreadChildren, depth + 1)}
				{#if blocks.length > 0}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<d-micro-collapsed
						data-micro-id={comment.id}
						onclick={async (e: MouseEvent) => {
							e.stopPropagation();
							const parentEl = document.querySelector<HTMLElement>(
								`[data-comment-id="${comment.id}"]`
							);
							const anchorEl = parentEl || (e.currentTarget as HTMLElement);

							await animateStateChange(anchorEl, () => {
								const next = new Set(microCollapsedIds);
								next.delete(comment.id);
								microCollapsedIds = next;
							});
						}}
					>
						{#each blocks as block}
							<s-micro-block style:width="{block.width}px" style:background={block.color}
							></s-micro-block>
						{/each}
					</d-micro-collapsed>
				{/if}
				{@render commentTree([threadChild], depth + 1)}
			{:else}
				{@render commentTree(comment.comments, depth + 1)}
			{/if}
		{/if}
	{/each}
{/snippet}

<svelte:head>
	<title>{item.title || 'HN Reader'}</title>
</svelte:head>

<main>
	<d-header>
		<d-nav>
			<button type="button" class="back-btn" onclick={goBack}> ← Back </button>
		</d-nav>

		<d-item-header>
			{#if item.title}
				<d-title>
					<a href={articleUrl} class="title-link">{item.title}</a>
				</d-title>
				{#if domain}
					<d-url-row>
						<a href={articleUrl} class="url-link">
							{domain}<s-path>{urlPath}</s-path>
						</a>
					</d-url-row>
				{/if}
			{/if}

			<d-metadata>
				<s-comments
					class:high={visibleCommentCount >= 100}
					class:mid={visibleCommentCount >= 50 && visibleCommentCount < 100}
				>
					<a href={hnItemUrl} class="meta-link">
						{visibleCommentCount}
						{@render message()}
					</a>
				</s-comments>
				{#if newCommentCount > 0}
					<s-new-count>{newCommentCount} new</s-new-count>
				{/if}
				<s-points
					class:high={(item.points ?? 0) >= 100}
					class:mid={(item.points ?? 0) >= 50 && (item.points ?? 0) < 100}
				>
					{item.points ?? 0}
					{@render upvote()}
				</s-points>
				<s-time>{relativeTime(item.time)}</s-time>
				{#if item.user}
					<s-user>
						by <a href={hnUserUrl} class="meta-link">{item.user}</a>
					</s-user>
				{/if}
				<s-hn-link>
					<a href={hnItemUrl} class="hn-link">news.ycombinator.com/item?id={item.id}</a>
				</s-hn-link>
			</d-metadata>

			{#if parentStoryId}
				<d-parent>
					<a href="/i/{parentStoryId}" class="meta-link">← parent story</a>
				</d-parent>
			{/if}
		</d-item-header>

		{#if item.content}
			<d-item-body>
				{@html item.content}
			</d-item-body>
		{/if}
	</d-header>

	{#if item.comments.length > 0}
		<d-comments>
			{@render commentTree(item.comments, 0)}
		</d-comments>
	{:else}
		<d-empty>No comments.</d-empty>
	{/if}
</main>

<style>
	main {
		width: 100%;
		max-width: 42.875em;
		margin: 0 auto;
	}

	/* --- Header --- */

	d-header {
		display: block;
		background: light-dark(#ffffff, #262626);
		border-bottom: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	d-nav {
		display: flex;
		padding: var(--size-2);
		border-bottom: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	.back-btn {
		padding: var(--size-1) var(--size-2);
		font-size: var(--font-size-1);
		background: light-dark(#f5f5f5, #2a2a2a);
		border: 1px solid light-dark(#ccc, #444);
		border-radius: 4px;
		cursor: pointer;
		color: light-dark(#666, #999);
		transition: all 0.15s ease;

		&:hover {
			background: light-dark(#e0e0e0, #333);
			border-color: light-dark(#999, #666);
			color: light-dark(#333, #ccc);
		}
	}

	d-item-header {
		display: block;
		padding: var(--size-2) var(--size-2) var(--size-2);
	}

	d-title {
		display: block;
		font-weight: var(--font-weight-4);
		line-height: 1.2;
	}

	.title-link {
		color: light-dark(#222222, #e5e5e5);
		text-decoration: none;

		&:hover {
			color: #ff6600;
		}

		&:visited {
			color: light-dark(#555, #aaa);
		}
	}

	d-url-row {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-bottom: var(--size-1);
	}

	.url-link {
		color: var(--url-color);
		font-size: 15px;
		font-weight: var(--font-weight-4);
		text-decoration: none;

		&:visited {
			color: var(--url-visited-color);
		}

		&:hover {
			color: var(--url-hover-color);
			text-decoration: underline;
		}

		&:hover s-path {
			opacity: 1;
		}
	}

	s-path {
		opacity: 0.6;
	}

	d-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5ch;
		font-size: 15px;
		font-weight: var(--font-weight-2);
		color: light-dark(#222222, #e5e5e5);
		align-items: center;
	}

	@media (max-width: 480px) {
		s-hn-link {
			flex-basis: 100%;
			text-align: right;
			margin-left: 0;
		}
	}

	s-comments {
		display: flex;
		gap: 0.25ch;
		width: 6.25ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		align-items: center;
		justify-content: flex-end;

		svg {
			width: 1em;
			height: 1em;
			flex-shrink: 0;
			opacity: 0.2;
		}

		&.mid {
			svg {
				color: #ff6600;
				opacity: 0.8;
			}
		}

		&.high {
			color: #ff6600;
			font-weight: var(--font-weight-4);

			svg {
				opacity: 1;
			}
		}
	}

	s-points {
		display: flex;
		gap: 0.25ch;
		width: 5.25ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		align-items: center;
		justify-content: flex-end;

		svg {
			width: 1em;
			height: 1em;
			flex-shrink: 0;
			opacity: 0.2;
		}

		&.mid {
			svg {
				color: #ff6600;
				opacity: 0.8;
			}
		}

		&.high {
			color: #ff6600;
			font-weight: var(--font-weight-4);

			svg {
				opacity: 1;
			}
		}
	}

	d-metadata s-time {
		width: 4ch;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	s-user {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta-link {
		color: light-dark(#666, #999);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	s-comments .meta-link {
		display: flex;
		gap: 0.25ch;
		align-items: center;
		color: inherit;
	}

	s-hn-link {
		min-width: 0;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hn-link {
		color: light-dark(#999, #666);
		font-weight: var(--font-weight-2);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	d-parent {
		display: block;
		margin-top: var(--size-2);
		font-size: var(--font-size-1);
	}

	/* --- Item body (story text / comment text for comment items) --- */

	d-item-body {
		display: block;
		padding: var(--size-2) var(--size-2) var(--size-3);
		font-size: var(--font-size-1);
		line-height: 1.5;
		color: light-dark(#333, #ddd);
		border-top: 1px solid light-dark(#e6e6df, #3a3a3a);
	}

	d-item-body :global {
		p {
			margin: 0 0 0.75em;

			&:last-child {
				margin-bottom: 0;
			}
		}

		a {
			color: light-dark(#0645ad, #4da3ff);
			text-decoration: none;

			&:hover {
				text-decoration: underline;
			}

			&:visited {
				color: light-dark(#0b0080, #9370db);
			}
		}

		pre {
			overflow-x: auto;
			padding: var(--size-2);
			background: light-dark(#f5f5f5, #1e1e1e);
			border-radius: 4px;
			font-size: 0.9em;
		}

		code {
			font-size: 0.9em;
		}
	}

	/* --- Comments --- */

	d-comments {
		display: block;
	}

	d-micro-collapsed {
		display: flex;
		height: 4px;
		overflow: hidden;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 0.15s ease;

		&:hover {
			opacity: 1;
		}
	}

	s-micro-block {
		display: block;
		height: 100%;
		flex-shrink: 0;
	}

	d-comment {
		display: block;
		position: relative;
		padding: var(--size-2) var(--size-2) var(--size-2)
			calc(var(--size-3) * var(--indent, 0) + var(--size-2));
		background: light-dark(#ffffff, #262626);
		overflow: hidden;

		/* Depth accent bar — flush top and bottom */
		&::before {
			content: '';
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			width: var(--bar-width, 0px);
			background: color-mix(in srgb, var(--depth-color, transparent) 70%, transparent);
		}

		/* Separator line — starts after the accent bar */
		&::after {
			content: '';
			position: absolute;
			top: 0;
			left: var(--bar-width, 0px);
			right: 0;
			height: 1px;
			background: light-dark(#e6e6df, #3a3a3a);
		}

		&.deleted {
			opacity: 0.4;
		}

		&.dead {
			opacity: 0.5;
		}

		&.op d-comment-meta s-author {
			color: #ff6600;
			font-weight: var(--font-weight-6);
		}

		&.new-comment {
			border-right: 3px solid #ff6600;
			background: light-dark(rgba(255, 102, 0, 0.03), rgba(255, 102, 0, 0.06));
		}

		&.has-children,
		&.collapsed {
			cursor: pointer;
		}

		&:global(.just-clicked) {
			background: light-dark(rgba(74, 158, 218, 0.12), rgba(74, 158, 218, 0.15)) !important;
			transition-property: background;
			transition-duration: 0s;
		}

		/* Fade out after class is removed */
		&:not(:global(.just-clicked)) {
			transition-property: background;
			transition-duration: 0.8s;
			transition-timing-function: ease-out;
		}

		&.collapsed {
			display: flex;
			align-items: baseline;
			gap: 0;
			padding-top: var(--size-1);
			padding-bottom: var(--size-1);

			d-comment-meta {
				margin-bottom: 0;
				flex-shrink: 0;
			}
		}
	}

	s-depth {
		display: inline-block;
		margin-right: 0.25ch;
		font-weight: var(--font-weight-6);
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
		user-select: none;
		cursor: default;
	}

	s-collapsed-preview {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-0);
		color: light-dark(#666, #888);
		margin-left: 1ch;
	}

	d-comment-meta {
		display: flex;
		gap: 0.5ch;
		font-size: var(--font-size-0);
		color: light-dark(#888, #777);
		margin-bottom: var(--size-1);
		align-items: baseline;
	}

	.author-link {
		color: light-dark(#666, #999);
		text-decoration: none;

		&:hover {
			color: #ff6600;
			text-decoration: underline;
		}
	}

	.dead-link {
		color: light-dark(#d89899, #a06060);
		font-style: italic;
		font-size: var(--font-size-0);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}

	s-author {
		font-weight: var(--font-weight-4);
	}

	s-op-badge {
		display: inline-block;
		padding: 0 0.4em;
		font-size: 0.75em;
		font-weight: var(--font-weight-7);
		color: #fff;
		background: #ff6600;
		border-radius: 3px;
		vertical-align: baseline;
		line-height: 1.5;
	}

	s-new-badge {
		display: inline-block;
		padding: 0 0.4em;
		font-size: 0.75em;
		font-weight: var(--font-weight-7);
		color: #ff6600;
		background: light-dark(rgba(255, 102, 0, 0.12), rgba(255, 102, 0, 0.2));
		border-radius: 3px;
		vertical-align: baseline;
		line-height: 1.5;
	}

	s-new-count {
		color: #ff6600;
		font-weight: var(--font-weight-5);
		font-size: 0.9em;
		white-space: nowrap;
	}

	d-comment-meta s-time {
		font-variant-numeric: tabular-nums;
	}

	s-leaf-icon {
		display: inline-flex;
		align-items: center;
		color: light-dark(#8bc34a, #6a9f3a);
		opacity: 0.5;
		font-size: 0.85em;

		svg {
			width: 1em;
			height: 1em;
		}
	}

	s-reply-count {
		margin-left: auto;
		font-size: 0.8em;
		font-variant-numeric: tabular-nums;
		color: light-dark(#999, #666);
		white-space: nowrap;
		user-select: none;
	}

	s-micro-toggle,
	s-expand-toggle {
		padding: 0 0.5ch;
		font-size: 0.8em;
		color: light-dark(#999, #666);
		border-radius: 3px;
		cursor: pointer;
		user-select: none;
		transition: all 0.15s ease;
		background: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04));
		white-space: nowrap;

		&:hover {
			color: light-dark(#555, #bbb);
			background: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.1));
		}
	}

	s-micro-toggle {
		&.grouped {
			color: light-dark(#666, #999);
			background: light-dark(rgba(74, 158, 218, 0.12), rgba(74, 158, 218, 0.18));
		}

		&.grouped:hover {
			background: light-dark(rgba(74, 158, 218, 0.2), rgba(74, 158, 218, 0.25));
		}

		&.partial {
			color: light-dark(#777, #888);
			background: light-dark(rgba(74, 158, 218, 0.06), rgba(74, 158, 218, 0.1));
		}

		&.partial:hover {
			background: light-dark(rgba(74, 158, 218, 0.12), rgba(74, 158, 218, 0.18));
		}
	}

	d-comment-meta s-author.deleted {
		font-style: italic;
		font-weight: var(--font-weight-2);
	}

	d-comment-body {
		display: block;
		font-size: var(--font-size-1);
		line-height: 1.5;
		color: light-dark(#333, #ddd);
	}

	d-comment-body :global {
		p {
			margin: 0 0 0.5em;

			&:last-child {
				margin-bottom: 0;
			}
		}

		a {
			color: light-dark(#0645ad, #4da3ff);
			text-decoration: none;
			word-break: break-all;

			&:hover {
				text-decoration: underline;
			}

			&:visited {
				color: light-dark(#0b0080, #9370db);
			}
		}

		pre {
			overflow-x: auto;
			padding: var(--size-2);
			background: light-dark(#f5f5f5, #1e1e1e);
			border-radius: 4px;
			font-size: 0.85em;
			white-space: pre-wrap;
			word-break: break-word;
		}

		code {
			font-size: 0.9em;
		}
	}

	d-empty {
		display: block;
		padding: var(--size-4) var(--size-2);
		text-align: center;
		color: light-dark(#888, #777);
		font-size: var(--font-size-1);
	}

	:root {
		--url-color: light-dark(#0645ad, #4da3ff);
		--url-visited-color: light-dark(#0b0080, #9370db);
		--url-hover-color: light-dark(#0645ad, #6db3ff);
	}
</style>
