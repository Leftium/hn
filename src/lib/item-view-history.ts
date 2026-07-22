/**
 * IndexedDB-backed per-item view history for tracking new comments.
 *
 * Stores a bounded list of distinct visible-comment-count checkpoints per item.
 * Auto-evicts item records whose latest view checkpoint is outside the retention window.
 */

const DB_NAME = 'hn-app';
const DB_VERSION = 1;
const STORE_NAME = 'item-views';
const MAX_AGE_SECONDS = 15 * 24 * 60 * 60;
const MAX_VISITS = 20;

export interface ItemViewCheckpoint {
	viewedAt: number; // Unix seconds
	commentCount: number;
}

export interface ItemViewRecord {
	itemId: number;
	visits: ItemViewCheckpoint[];
}

interface LegacyItemViewRecord extends ItemViewCheckpoint {
	itemId: number;
}

export interface BeginItemViewResult {
	visits: ItemViewCheckpoint[];
	automaticThreshold: number | null;
	recorded: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'itemId' });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

	return dbPromise;
}

function isCheckpoint(value: unknown): value is ItemViewCheckpoint {
	if (!value || typeof value !== 'object') return false;
	const checkpoint = value as Partial<ItemViewCheckpoint>;
	return Number.isFinite(checkpoint.viewedAt) && Number.isFinite(checkpoint.commentCount);
}

function normalizeRecord(value: unknown, itemId: number): ItemViewRecord {
	if (!value || typeof value !== 'object') return { itemId, visits: [] };
	const candidate = value as Partial<ItemViewRecord & LegacyItemViewRecord>;
	if (Array.isArray(candidate.visits)) {
		return {
			itemId,
			visits: candidate.visits
				.filter(isCheckpoint)
				.sort((a, b) => a.viewedAt - b.viewedAt)
				.slice(-MAX_VISITS)
		};
	}
	return isCheckpoint(candidate) ? { itemId, visits: [candidate] } : { itemId, visits: [] };
}

/**
 * Start a view using the current preview count. Equal-count reloads reuse the
 * latest discussion state and retain its preceding checkpoint as the cutoff.
 */
export async function beginItemView(
	itemId: number,
	commentCount: number
): Promise<BeginItemViewResult> {
	try {
		const db = await openDb();
		const result = await new Promise<BeginItemViewResult>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(itemId);
			let nextResult: BeginItemViewResult = {
				visits: [],
				automaticThreshold: null,
				recorded: false
			};

			request.onsuccess = () => {
				const record = normalizeRecord(request.result, itemId);
				const latest = record.visits.at(-1);
				const unchanged = latest?.commentCount === commentCount;
				const automaticThreshold = unchanged
					? (record.visits.at(-2)?.viewedAt ?? null)
					: (latest?.viewedAt ?? null);
				const visits = unchanged
					? record.visits
					: [...record.visits, { viewedAt: Math.floor(Date.now() / 1000), commentCount }].slice(
							-MAX_VISITS
						);

				nextResult = { visits, automaticThreshold, recorded: !unchanged };
				store.put({ itemId, visits } satisfies ItemViewRecord);
			};
			request.onerror = () => reject(request.error);
			tx.oncomplete = () => resolve(nextResult);
			tx.onerror = () => reject(tx.error);
		});

		// Fire-and-forget cleanup.
		evictStaleEntries().catch(() => {});
		return result;
	} catch {
		return { visits: [], automaticThreshold: null, recorded: false };
	}
}

/**
 * Remove records whose latest viewedAt is older than MAX_AGE_SECONDS.
 * Submission age is irrelevant, so a newly viewed old or reposted item is retained.
 */
async function evictStaleEntries(): Promise<void> {
	const db = await openDb();
	const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS;

	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.openCursor();

		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return;

			const record = normalizeRecord(cursor.value, Number(cursor.primaryKey));
			if ((record.visits.at(-1)?.viewedAt ?? 0) < cutoff) {
				cursor.delete();
			}
			cursor.continue();
		};

		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

type CommentLike = {
	time: number;
	user: string | null;
	content: string;
	comments: CommentLike[];
};

/**
 * Whether a comment should be hidden from display.
 * Deleted leaf comments (no user, no children) are hidden.
 * Dead comments have a user + content "<p>[dead]" — always visible.
 * Deleted non-leaf comments are kept for thread structure.
 */
export function isHiddenComment(c: CommentLike): boolean {
	return !c.user && c.comments.length === 0;
}

/**
 * Count visible comments in a nested tree.
 * Includes dead comments (have content). Excludes deleted leaves.
 */
export function countVisibleComments(comments: CommentLike[]): number {
	let count = 0;
	for (const c of comments) {
		if (isHiddenComment(c)) continue;
		count++;
		count += countVisibleComments(c.comments);
	}
	return count;
}

/**
 * Count comments newer than a threshold in a nested comment tree.
 * Walks the full tree recursively. Same visibility filter as rendering.
 */
export function countNewComments(comments: CommentLike[], threshold: number): number {
	let count = 0;
	for (const c of comments) {
		if (isHiddenComment(c)) continue;

		if (c.time > threshold) {
			count++;
		}
		count += countNewComments(c.comments, threshold);
	}
	return count;
}
