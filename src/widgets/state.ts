import type { WidgetGeometry } from './types';

const IDS_KEY = 'desktop-mode-widgets';
const GEOMETRY_KEY = 'desktop-mode-widgets-geometry';
const DOCKED_HEIGHTS_KEY = 'desktop-mode-widgets-docked-heights';

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

	}
}

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
