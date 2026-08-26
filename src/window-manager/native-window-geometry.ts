/**
 * Per-baseId geometry persistence for native windows.
 *
 * Native windows are excluded from the session-restore snapshot
 * (their `render` callback is a JS closure, not something we can
 * serialize and rehydrate server-side). But "the size I picked last
 * time" and "I left this maximized" survive a reload without needing
 * server state — just store `{ width, height, state? }` per baseId
 * in localStorage and read it back on open.
 *
 * Position is intentionally NOT persisted. Cascade-on-open keeps
 * stacked native windows visible on every viewport size; restoring a
 * remembered position would happily place a window off-screen after
 * the user switches between monitors of different sizes.
 *
 * Width and height ALWAYS represent the floating ("normal") size,
 * even when `state === 'maximized'` — they're the size the window
 * un-maximizes back to. The maximize state is layered on top of that
 * size, not a replacement for it.
 */

/** Storage key for the per-baseId geometry map. */
export const NATIVE_GEOMETRY_STORAGE_KEY = 'desktop-mode-native-window-geometry';

/** Cap on remembered entries — protects against unbounded growth. */
const MAX_ENTRIES = 64;

/** Sanity ceiling for a single stored dimension (px). */
const MAX_DIMENSION = 8192;

/** Persisted window state. Only states worth restoring are listed. */
export type SavedWindowState = 'maximized';

type SavedGeometry = {
	width: number;
	height: number;
	x?: number;
	y?: number;
	state?: SavedWindowState;
};

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
 * Look up the remembered geometry + state for a window.
 *
 * Returns `null` when nothing is stored or the stored value is
 * malformed. Caller is responsible for clamping to a registered
 * `minWidth` / `minHeight` and for clamping `x` / `y` to the
 * current viewport (so a window remembered at x=2800 on a 3440px
 * desktop doesn't open off-screen on a smaller monitor).
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
	const state: SavedWindowState | undefined =
		entry.state === 'maximized' ? 'maximized' : undefined;
	const x = Number( entry.x );
	const y = Number( entry.y );
	const hasPosition =
		Number.isFinite( x ) &&
		Number.isFinite( y ) &&
		x >= 0 &&
		y >= 0 &&
		x <= MAX_DIMENSION &&
		y <= MAX_DIMENSION;
	return {
		width: Math.round( width ),
		height: Math.round( height ),
		...( hasPosition ? { x: Math.round( x ), y: Math.round( y ) } : {} ),
		...( state ? { state } : {} ),
	};
}

/**
 * Persist a new floating size for a native window. Preserves any
 * previously-saved `state` (e.g. 'maximized') so writing the size
 * after a manual resize doesn't drop the maximize preference.
 *
 * No-ops when both size and the (preserved) state already match what's
 * stored — saves an unnecessary write + `storage` event on every
 * micro-resize.
 *
 * Trims the map to {@link MAX_ENTRIES} oldest-out so a long-running
 * shell doesn't accumulate stale entries from removed plugins.
 */
export function saveNativeWindowGeometry(
	baseId: string,
	geometry: { width: number; height: number },
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
	const state =
		prev && prev.state === 'maximized'
			? ( 'maximized' as const )
			: undefined;
	const carriedX = typeof prev?.x === 'number' ? prev.x : undefined;
	const carriedY = typeof prev?.y === 'number' ? prev.y : undefined;
	if (
		prev &&
		prev.width === width &&
		prev.height === height &&
		prev.state === state &&
		prev.x === carriedX &&
		prev.y === carriedY
	) {
		return;
	}
	upsertEntry( map, baseId, {
		width,
		height,
		...( typeof carriedX === 'number' && typeof carriedY === 'number'
			? { x: carriedX, y: carriedY }
			: {} ),
		...( state ? { state } : {} ),
	} );
	writeMapTrimmed( map );
}

/**
 * Persist the user's last drag position for a window. Preserves
 * width / height / state on the existing entry.
 *
 * Skipped when no prior entry exists — there's nothing to seed the
 * width / height from on the position-only path. The next resize-end
 * or maximize event will land the first entry, and subsequent drags
 * will accumulate position on top of it. In practice the first
 * resize-end / drag-end happens within microseconds of opening
 * (cascade defaults aren't user-intentional sizes), so the gap is
 * a one-frame edge case.
 */
export function saveNativeWindowPosition(
	baseId: string,
	position: { x: number; y: number },
): void {
	if ( ! baseId ) {
		return;
	}
	const x = Math.round( Number( position.x ) );
	const y = Math.round( Number( position.y ) );
	if (
		! Number.isFinite( x ) ||
		! Number.isFinite( y ) ||
		x < 0 ||
		y < 0 ||
		x > MAX_DIMENSION ||
		y > MAX_DIMENSION
	) {
		return;
	}
	const map = readMap();
	const prev = map[ baseId ];
	if ( ! prev ) {
		return;
	}
	if ( prev.x === x && prev.y === y ) {
		return;
	}
	upsertEntry( map, baseId, {
		...prev,
		x,
		y,
	} );
	writeMapTrimmed( map );
}

/**
 * Persist (or clear) the saved window state. Width/height are left
 * untouched if a previous entry exists — they represent the floating
 * size to restore to on un-maximize and shouldn't be perturbed.
 *
 * When the store has no prior entry for this baseId and the caller
 * passes `defaults`, we seed the entry with those defaults so a user
 * who maximizes a never-resized window still gets the "open
 * maximized next time" behavior.
 */
export function setNativeWindowSavedState(
	baseId: string,
	state: SavedWindowState | null,
	defaults?: { width: number; height: number },
): void {
	if ( ! baseId ) {
		return;
	}
	const map = readMap();
	const prev = map[ baseId ];
	if ( ! prev ) {
		if ( state === null || ! defaults ) {
			return;
		}
		const width = Math.round( Number( defaults.width ) );
		const height = Math.round( Number( defaults.height ) );
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
		upsertEntry( map, baseId, { width, height, state } );
		writeMapTrimmed( map );
		return;
	}
	if ( state === null ) {
		if ( ! prev.state ) {
			return;
		}
		const { state: _state, ...rest } = prev;
		upsertEntry( map, baseId, rest );
		writeMapTrimmed( map );
		return;
	}
	if ( prev.state === state ) {
		return;
	}
	upsertEntry( map, baseId, {
		...prev,
		state,
	} );
	writeMapTrimmed( map );
}

/**
 * Move-to-end insert into the map so recently-used ids survive the
 * trim. JS object insertion order on string keys is preserved per
 * ES2015+ which all browsers we ship to honor.
 */
function upsertEntry(
	map: StoredMap,
	baseId: string,
	entry: SavedGeometry,
): void {
	delete map[ baseId ];
	map[ baseId ] = entry;
}

/** Write the map after evicting oldest entries past {@link MAX_ENTRIES}. */
function writeMapTrimmed( map: StoredMap ): void {
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
