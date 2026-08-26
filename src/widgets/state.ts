/**
 * OpenStation — Widget persistence.
 *
 * Three separate localStorage records:
 *
 *   - `desktop-mode-widgets`           — ordered list of enabled widget
 *                                      ids (today's format; unchanged
 *                                      so first-run seeding still
 *                                      works).
 *   - `desktop-mode-widgets-geometry`  — per-id `{ x, y, width, height }`
 *                                      for widgets the user has
 *                                      liberated from the column.
 *                                      Missing keys mean "still docked
 *                                      in the column."
 *   - `desktop-mode-widgets-docked-heights` — per-id height (px) for
 *                                      resizable widgets the user has
 *                                      height-resized while docked.
 *                                      Kept apart from the geometry
 *                                      record because a geometry
 *                                      entry's mere presence marks a
 *                                      widget as floating at boot.
 *
 * Each record writes-through independently so a quota failure in one
 * doesn't corrupt the other.
 */

import type { WidgetGeometry } from './types';

const IDS_KEY = 'desktop-mode-widgets';
const GEOMETRY_KEY = 'desktop-mode-widgets-geometry';
const DOCKED_HEIGHTS_KEY = 'desktop-mode-widgets-docked-heights';

/**
 * Raw read so callers can distinguish "never saved" (null) from
 * "user explicitly cleared the list" (empty array serialised as
 * `[]`). The difference is what lets the layer seed the default
 * clock widget only on genuine first-run.
 */
export function readRawEnabled(): string | null {
	try {
		return window.localStorage.getItem( IDS_KEY );
	} catch {
		return null;
	}
}

export function loadEnabledIds(): string[] {
	const raw = readRawEnabled();
	if ( raw === null ) {
		return [];
	}
	try {
		const parsed = JSON.parse( raw );
		if ( ! Array.isArray( parsed ) ) {
			return [];
		}
		return parsed.filter( ( x ): x is string => typeof x === 'string' );
	} catch {
		return [];
	}
}

export function saveEnabledIds( ids: string[] ): void {
	try {
		window.localStorage.setItem( IDS_KEY, JSON.stringify( ids ) );
	} catch {
		/* private mode / quota exceeded — best-effort */
	}
}

export function loadGeometry(): Record< string, WidgetGeometry > {
	try {
		const raw = window.localStorage.getItem( GEOMETRY_KEY );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw );
		if ( ! parsed || typeof parsed !== 'object' ) {
			return {};
		}
		const out: Record< string, WidgetGeometry > = {};
		for ( const [ id, rawEntry ] of Object.entries( parsed ) ) {
			const entry = sanitizeGeometry( rawEntry );
			if ( entry ) {
				out[ id ] = entry;
			}
		}
		return out;
	} catch {
		return {};
	}
}

export function saveGeometry(
	geometry: Record< string, WidgetGeometry >,
): void {
	try {
		window.localStorage.setItem( GEOMETRY_KEY, JSON.stringify( geometry ) );
	} catch {
		/* best-effort */
	}
}

export function loadDockedHeights(): Record< string, number > {
	try {
		const raw = window.localStorage.getItem( DOCKED_HEIGHTS_KEY );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw );
		if ( ! parsed || typeof parsed !== 'object' ) {
			return {};
		}
		const out: Record< string, number > = {};
		for ( const [ id, value ] of Object.entries( parsed ) ) {
			if ( typeof value === 'number' && Number.isFinite( value ) && value > 0 ) {
				out[ id ] = value;
			}
		}
		return out;
	} catch {
		return {};
	}
}

export function saveDockedHeights(
	heights: Record< string, number >,
): void {
	try {
		window.localStorage.setItem(
			DOCKED_HEIGHTS_KEY,
			JSON.stringify( heights ),
		);
	} catch {
		/* best-effort */
	}
}

/**
 * Reject entries with NaN / non-finite / negative-size coords. A
 * widget whose stored geometry is garbage falls back to default
 * (column-docked) rather than rendering invisibly offscreen.
 */
function sanitizeGeometry( raw: unknown ): WidgetGeometry | null {
	if ( ! raw || typeof raw !== 'object' ) {
		return null;
	}
	const { x, y, width, height } = raw as Partial< WidgetGeometry >;
	if (
		typeof x !== 'number' || ! Number.isFinite( x ) ||
		typeof y !== 'number' || ! Number.isFinite( y ) ||
		typeof width !== 'number' || ! Number.isFinite( width ) || width <= 0 ||
		typeof height !== 'number' || ! Number.isFinite( height ) || height <= 0
	) {
		return null;
	}
	return { x, y, width, height };
}
