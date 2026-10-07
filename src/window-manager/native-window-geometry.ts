export const NATIVE_GEOMETRY_STORAGE_KEY = 'desktop-mode-native-window-geometry';

const MAX_ENTRIES = 64;

const MAX_DIMENSION = 8192;

export type SavedWindowState = 'maximized';

type SavedGeometry = {
	width: number;
	height: number;
	x?: number;
	y?: number;
	state?: SavedWindowState;
};

type StoredMap = Record< string, SavedGeometry >;

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

function writeMap( map: StoredMap ): void {
	try {
		window.localStorage.setItem(
			NATIVE_GEOMETRY_STORAGE_KEY,
			JSON.stringify( map ),
		);
	} catch {

	}
}

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

function upsertEntry(
	map: StoredMap,
	baseId: string,
	entry: SavedGeometry,
): void {
	delete map[ baseId ];
	map[ baseId ] = entry;
}

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

export function __resetNativeWindowGeometryForTests(): void {
	try {
		window.localStorage.removeItem( NATIVE_GEOMETRY_STORAGE_KEY );
	} catch {

	}
}
