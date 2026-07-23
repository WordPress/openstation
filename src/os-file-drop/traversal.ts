/**
 * OS-file drop manager — folder-tree traversal.
 *
 * Walks `webkitGetAsEntry()` entries from a drop's
 * `DataTransferItemList` into a flat file list with per-file
 * relative paths, plus the list of EMPTY directories (only the
 * drag-drop Entries API can see those; `<input webkitdirectory>`
 * loses them).
 *
 * Two hard-won browser rules are encoded here:
 *
 *   1. `dataTransfer.items` is live and is cleared the moment the
 *      drop handler yields — {@link snapshotEntries} must be called
 *      synchronously, before any `await`.
 *   2. Chromium's `FileSystemDirectoryReader.readEntries()` returns
 *      at most 100 entries per call — {@link readAllEntries} loops
 *      the same reader until it yields an empty batch, or files
 *      101+ are silently dropped.
 *
 * The prefixed APIs are the standardized WICG Entries API and are
 * Baseline across browsers; the File System Access API is
 * deliberately NOT used (Chromium-only).
 *
 * @since 0.9.6
 */

/** One real file discovered in the tree. */
export interface TreeFile {
	file: File;
	/**
	 * Path relative to the drop, INCLUDING the dropped folder's own
	 * name (`docs/reports/q1.pdf` for a dropped `docs` folder) so
	 * the tree recreates itself on the desktop. Empty string for a
	 * file dropped directly (no tree).
	 */
	relativePath: string;
}

export interface TreeCollection {
	files: TreeFile[];
	/** Directory paths (no trailing slash) that contained nothing. */
	emptyDirs: string[];
	/** True when at least one dropped item was a directory. */
	hadDirectory: boolean;
}

/** Depth cap mirroring the server's segment limit. */
const MAX_DEPTH = 32;

/**
 * Synchronously snapshot the entries of a drop. MUST run inside
 * the `drop` event handler before any `await` (rule 1 above).
 */
export function snapshotEntries( items: DataTransferItemList | undefined | null ): FileSystemEntry[] {
	if ( ! items ) {
		return [];
	}
	const out: FileSystemEntry[] = [];
	for ( let i = 0; i < items.length; i++ ) {
		const item = items[ i ];
		if ( item.kind !== 'file' ) {
			continue;
		}
		const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
		if ( entry ) {
			out.push( entry );
		}
	}
	return out;
}

/** Loop `readEntries` until the batch comes back empty (rule 2). */
function readAllEntries( dir: FileSystemDirectoryEntry ): Promise< FileSystemEntry[] > {
	const reader = dir.createReader();
	return new Promise( ( resolve, reject ) => {
		const out: FileSystemEntry[] = [];
		const step = (): void => {
			reader.readEntries( ( batch ) => {
				if ( batch.length === 0 ) {
					resolve( out );
					return;
				}
				out.push( ...batch );
				step();
			}, reject );
		};
		step();
	} );
}

function entryFile( entry: FileSystemFileEntry ): Promise< File > {
	return new Promise( ( resolve, reject ) => {
		entry.file( resolve, reject );
	} );
}

/**
 * Collect the full tree behind a snapshot of dropped entries.
 * Unreadable entries (permission race, file vanished mid-drag) are
 * skipped rather than failing the whole batch.
 */
export async function collectDroppedTree(
	entries: FileSystemEntry[],
): Promise< TreeCollection > {
	const collection: TreeCollection = {
		files: [],
		emptyDirs: [],
		hadDirectory: false,
	};
	for ( const entry of entries ) {
		await collectEntry( entry, '', collection, 0 );
	}
	return collection;
}

async function collectEntry(
	entry: FileSystemEntry,
	prefix: string,
	collection: TreeCollection,
	depth: number,
): Promise< void > {
	if ( depth > MAX_DEPTH ) {
		return;
	}
	if ( entry.isFile ) {
		try {
			const file = await entryFile( entry as FileSystemFileEntry );
			collection.files.push( {
				file,
				// `File.webkitRelativePath` is EMPTY for drag-dropped
				// files — the path must come from the entry walk.
				relativePath: prefix ? `${ prefix }${ file.name }` : '',
			} );
		} catch {
			// Unreadable file — skip, keep the batch going.
		}
		return;
	}
	if ( ! entry.isDirectory ) {
		return;
	}
	collection.hadDirectory = true;
	const dirPath = `${ prefix }${ entry.name }`;
	let children: FileSystemEntry[] = [];
	try {
		children = await readAllEntries( entry as FileSystemDirectoryEntry );
	} catch {
		children = [];
	}
	if ( children.length === 0 ) {
		collection.emptyDirs.push( dirPath );
		return;
	}
	for ( const child of children ) {
		await collectEntry( child, `${ dirPath }/`, collection, depth + 1 );
	}
}
