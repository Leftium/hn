/**
 * IndexedDB-backed per-item view history for tracking new comments.
 *
 * Stores { itemId, viewedAt, commentCount } per item.
 * Auto-evicts entries older than 30 days (HN locks comments ~14 days,
 * but we use a conservative 30-day window).
 */

const DB_NAME = 'hn-app';
const DB_VERSION = 1;
const STORE_NAME = 'item-views';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface ItemViewRecord {
	itemId: number;
	viewedAt: number; // Unix seconds
	commentCount: number;
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

/**
 * Get the previous view record for an item (before updating).
 * Returns null if the item has never been viewed.
 */
export async function getItemView(itemId: number): Promise<ItemViewRecord | null> {
	try {
		const db = await openDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(itemId);
			request.onsuccess = () => resolve(request.result ?? null);
			request.onerror = () => reject(request.error);
		});
	} catch {
		return null;
	}
}

/**
 * Record (or update) the view timestamp and comment count for an item.
 * Also runs cleanup of stale entries.
 */
export async function recordItemView(itemId: number, commentCount: number): Promise<void> {
	try {
		const db = await openDb();
		const record: ItemViewRecord = {
			itemId,
			viewedAt: Math.floor(Date.now() / 1000),
			commentCount
		};

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			store.put(record);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Fire-and-forget cleanup
		evictStaleEntries().catch(() => {});
	} catch {
		// IndexedDB failures are non-fatal
	}
}

/**
 * Remove entries older than MAX_AGE_SECONDS.
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

			const record = cursor.value as ItemViewRecord;
			if (record.viewedAt < cutoff) {
				cursor.delete();
			}
			cursor.continue();
		};

		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Count comments newer than a threshold in a nested comment tree.
 * Walks the full tree recursively. Skips deleted leaf comments
 * (same filter as the render logic).
 */
export function countNewComments(
	comments: { time: number; user: string | null; comments: any[] }[],
	threshold: number
): number {
	let count = 0;
	for (const c of comments) {
		// Skip deleted leaf comments (no user AND no children)
		if (!c.user && c.comments.length === 0) continue;

		if (c.time > threshold) {
			count++;
		}
		count += countNewComments(c.comments, threshold);
	}
	return count;
}
