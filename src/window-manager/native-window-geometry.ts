/**
 * Per-baseId geometry persistence for native windows.
 *
 * Native windows are excluded from the session-restore snapshot
 * (their `render` callback is a JS closure, not something we can
 * serialize and rehydrate server-side). But "the size I picked last
 * time" survives a reload without needing server state — just store
 * `{ width, height }` per baseId in localStorage and read it back on
 * open.
 *
 * Position is intentionally NOT persisted. Cascade-on-open keeps
 * stacked native windows visible on every viewport size; restoring a
 * remembered position would happily place a window off-screen after
 * the user switches between monitors of different sizes.
 *
 * @since 0.8.5
 */

/** Storage key for the per-baseId geometry map. */
export const NATIVE_GEOMETRY_STORAGE_KEY = 'desktop-mode-native-window-geometry';

/** Cap on remembered entries — protects against unbounded growth. */
const MAX_ENTRIES = 64;

/** Sanity ceiling for a single stored dimension (px). */
const MAX_DIMENSION = 8192;

type SavedGeometry = { width: number; height: number };

type StoredMap = Record< string, SavedGeometry >;

/** Read the persisted map; tolerates missing / corrupt storage. */
function readMap(): StoredMap {
	try {
		const raw = window.localStorage.getItem( NATIVE_GEOMETRY_STORAGE_KEY );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw );
		if ( ! parsed || typeof parsed !== 'object' ) {
			return {};
		}
		return parsed as StoredMap;
	} catch {
		return {};
	}
}

/** Write the persisted map; silent failure under private mode. */
function writeMap( map: StoredMap ): void {
	try {
		window.localStorage.setItem(
			NATIVE_GEOMETRY_STORAGE_KEY,
			JSON.stringify( map ),
		);
	} catch {
		/* storage unavailable — silently degrade */
	}
}

/**
 * Look up the remembered size for a native window.
 *
 * Returns `null` when nothing is stored or the stored value is
 * malformed. Caller is responsible for clamping to a registered
 * `minWidth` / `minHeight`.
 */
export function loadNativeWindowGeometry(
	baseId: string,
): SavedGeometry | null {
	if ( ! baseId ) {
		return null;
	}
	const map = readMap();
	const entry = map[ baseId ];
	if ( ! entry ) {
		return null;
	}
	const width = Number( entry.width );
	const height = Number( entry.height );
	if (
		! Number.isFinite( width ) ||
		! Number.isFinite( height ) ||
		width <= 0 ||
		height <= 0 ||
		width > MAX_DIMENSION ||
		height > MAX_DIMENSION
	) {
		return null;
	}
	return { width: Math.round( width ), height: Math.round( height ) };
}

/**
 * Persist a new size for a native window. No-ops when the new size
 * matches what's already stored — saves an unnecessary write +
 * `storage` event on every micro-resize.
 *
 * Trims the map to {@link MAX_ENTRIES} oldest-out so a long-running
 * shell doesn't accumulate stale entries from removed plugins.
 */
export function saveNativeWindowGeometry(
	baseId: string,
	geometry: SavedGeometry,
): void {
	if ( ! baseId ) {
		return;
	}
	const width = Math.round( Number( geometry.width ) );
	const height = Math.round( Number( geometry.height ) );
	if (
		! Number.isFinite( width ) ||
		! Number.isFinite( height ) ||
		width <= 0 ||
		height <= 0 ||
		width > MAX_DIMENSION ||
		height > MAX_DIMENSION
	) {
		return;
	}
	const map = readMap();
	const prev = map[ baseId ];
	if ( prev && prev.width === width && prev.height === height ) {
		return;
	}
	// Move-to-end (delete + re-insert) so recently-used ids survive
	// the trim. JS object insertion order on string keys is preserved
	// per ES2015+ which all browsers we ship to honor.
	delete map[ baseId ];
	map[ baseId ] = { width, height };
	const keys = Object.keys( map );
	if ( keys.length > MAX_ENTRIES ) {
		const trimmed: StoredMap = {};
		for ( const key of keys.slice( -MAX_ENTRIES ) ) {
			trimmed[ key ] = map[ key ];
		}
		writeMap( trimmed );
		return;
	}
	writeMap( map );
}

/** Test-only — reset persisted state between cases. */
export function __resetNativeWindowGeometryForTests(): void {
	try {
		window.localStorage.removeItem( NATIVE_GEOMETRY_STORAGE_KEY );
	} catch {
		/* nothing to reset */
	}
}
