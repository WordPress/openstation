/**
 * Wallpaper tone — how bright the desk is, and so what colour the
 * things sitting directly on it are drawn in. The answer is one class
 * on `<body>`; `variables.css` does the rest.
 *
 * Authored wallpapers declare `tone`. The two whose brightness is the
 * USER's choice are measured instead, since neither is the same
 * surface twice. Anything that answers neither is dark, which is what
 * the desk always assumed: a wrong `light` paints Void on Void.
 */

import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from '../settings/constants';
import type { WallpaperDef } from './types';

/** How bright a wallpaper is, from the desk's point of view. */
export type WallpaperTone = 'light' | 'dark';

/** Stamped on `<body>` while the active wallpaper is light. */
export const LIGHT_TONE_CLASS = 'os-wallpaper-light';

/**
 * Where Void ink overtakes Starlight. Not a judgement call: Starlight
 * (L 0.9944) stops clearing 4.5:1 on a backdrop past L 0.182, and the
 * two inks are equally legible at L 0.188.
 */
const LIGHT_LUMINANCE = 0.185;

/** Off-screen raster size for image sampling. Mean luminance needs no detail. */
const SAMPLE_EDGE = 32;

/** How long to wait for an uploaded image before giving up on measuring it. */
const LOAD_TIMEOUT_MS = 3000;

/**
 * The only wallpapers measured, and the list is closed. Averaging a
 * gradient's stops describes neither end of it: Aurora, Sunset and
 * Forest all average above the threshold while the corner the icon
 * grid starts in stays dark.
 */
const MEASURED_IDS: ReadonlySet< string > = new Set( [
	CUSTOM_IMAGE_ID,
	CUSTOM_GRADIENT_ID,
] );

/** Measured images, keyed by URL. A wallpaper is re-applied often; a photo is not re-measured. */
const measured = new Map< string, WallpaperTone >();

/** WCAG relative luminance of an sRGB triplet. */
export function relativeLuminance( r: number, g: number, b: number ): number {
	const channel = ( v: number ): number => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow( ( s + 0.055 ) / 1.055, 2.4 );
	};
	return (
		0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b )
	);
}

/** Tone for a known luminance. */
export function toneForLuminance( luminance: number ): WallpaperTone {
	return luminance > LIGHT_LUMINANCE ? 'light' : 'dark';
}

/**
 * sRGB triplets in a CSS value. Narrow on purpose: `#rgb`, `#rrggbb`
 * and `rgb()` / `rgba()` is everything the gradient editor produces.
 * Anything else is skipped rather than guessed at.
 */
export function parseCssColors( value: string ): Array< [ number, number, number ] > {
	const out: Array< [ number, number, number ] > = [];

	const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
	let match = hex.exec( value );
	while ( match !== null ) {
		const digits = match[ 1 ];
		const full =
			digits.length === 3
				? digits
					.split( '' )
					.map( ( d ) => d + d )
					.join( '' )
				: digits;
		out.push( [
			parseInt( full.slice( 0, 2 ), 16 ),
			parseInt( full.slice( 2, 4 ), 16 ),
			parseInt( full.slice( 4, 6 ), 16 ),
		] );
		match = hex.exec( value );
	}

	const fn = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi;
	match = fn.exec( value );
	while ( match !== null ) {
		out.push( [
			Number( match[ 1 ] ),
			Number( match[ 2 ] ),
			Number( match[ 3 ] ),
		] );
		match = fn.exec( value );
	}

	return out;
}

/** The first `url(...)` target in a CSS value, unquoted. Null when there is none. */
export function firstCssUrl( value: string ): string | null {
	const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec( value );
	return match ? match[ 2 ].trim() : null;
}

/** Averaged from the value's colour stops. Null when it names none. */
export function toneFromCssColors( value: string ): WallpaperTone | null {
	const colors = parseCssColors( value );
	if ( colors.length === 0 ) {
		return null;
	}
	const total = colors.reduce(
		( sum, [ r, g, b ] ) => sum + relativeLuminance( r, g, b ),
		0,
	);
	return toneForLuminance( total / colors.length );
}

/**
 * Mean luminance of a small raster of the image, over the whole
 * picture: the desk paints tiles and captions across all of it.
 * Resolves null on every failure path, so the caller keeps the dark
 * default.
 */
export async function toneFromImage( url: string ): Promise< WallpaperTone | null > {
	const cached = measured.get( url );
	if ( cached ) {
		return cached;
	}
	try {
		const image = new Image();
		// Only helps a correctly-configured remote; harmless otherwise.
		image.crossOrigin = 'anonymous';
		const loaded = await new Promise< boolean >( ( resolve ) => {
			// Bounded: a stalled request fires neither event, and an
			// unbounded wait would leave a pending promise per apply.
			const timer = setTimeout( () => resolve( false ), LOAD_TIMEOUT_MS );
			const settle = ( ok: boolean ) => () => {
				clearTimeout( timer );
				resolve( ok );
			};
			image.onload = settle( true );
			image.onerror = settle( false );
			image.src = url;
		} );
		if ( ! loaded ) {
			return null;
		}

		const canvas = document.createElement( 'canvas' );
		canvas.width = SAMPLE_EDGE;
		canvas.height = SAMPLE_EDGE;
		const ctx = canvas.getContext( '2d' );
		if ( ! ctx ) {
			return null;
		}
		ctx.drawImage( image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE );
		const { data } = ctx.getImageData( 0, 0, SAMPLE_EDGE, SAMPLE_EDGE );

		let total = 0;
		let counted = 0;
		for ( let i = 0; i < data.length; i += 4 ) {
			// A transparent pixel shows the layer under the image.
			if ( data[ i + 3 ] === 0 ) {
				continue;
			}
			total += relativeLuminance( data[ i ], data[ i + 1 ], data[ i + 2 ] );
			counted++;
		}
		if ( counted === 0 ) {
			return null;
		}
		const tone = toneForLuminance( total / counted );
		measured.set( url, tone );
		return tone;
	} catch {
		// Tainted canvas, no DOM, no 2d context. Not knowing is fine.
		return null;
	}
}

/** Declared if it says, measured if it is the user's own, else dark. */
export async function resolveWallpaperTone(
	def: WallpaperDef,
): Promise< WallpaperTone > {
	if ( def.tone === 'light' || def.tone === 'dark' ) {
		return def.tone;
	}
	if ( def.type !== 'css' || ! MEASURED_IDS.has( def.id ) ) {
		return 'dark';
	}

	let value = '';
	try {
		value = def.resolveValue ? '' : ( def.value ?? '' );
	} catch {
		value = '';
	}
	// `resolveValue` needs a mount context this module has no business
	// building, so read back what the layer wrote.
	if ( value === '' ) {
		value = readAppliedBackground();
	}
	if ( value === '' ) {
		return 'dark';
	}

	// An image wins over a colour beside it: that solid is the backstop
	// behind the photograph, not the desk.
	const url = firstCssUrl( value );
	if ( url !== null ) {
		return ( await toneFromImage( url ) ) ?? 'dark';
	}

	return toneFromCssColors( value ) ?? 'dark';
}

/** The `--os-bg` the layer last wrote, which is what the desk is showing. */
function readAppliedBackground(): string {
	if ( typeof document === 'undefined' ) {
		return '';
	}
	const shell = document.getElementById( 'os-shell' );
	const source = shell ?? document.body;
	if ( ! source ) {
		return '';
	}
	return source.style.getPropertyValue( '--os-bg' ).trim();
}

/** Stamp the tone on `<body>`. Idempotent. */
export function applyWallpaperTone( tone: WallpaperTone ): void {
	if ( typeof document === 'undefined' || ! document.body ) {
		return;
	}
	document.body.classList.toggle( LIGHT_TONE_CLASS, tone === 'light' );
}
