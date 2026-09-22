/**
 * Wallpaper tone — how bright the desk is, and therefore what colour
 * the things sitting directly on it are drawn in.
 *
 * Desktop icons, their captions and the file tiles have no surface of
 * their own; they paint onto the wallpaper. Starlight is only legible
 * there while the wallpaper is dark, which every wallpaper was before
 * the meshes. This module answers "is it still?" and the answer is one
 * class on `<body>`; `variables.css` does the rest.
 *
 * Two ways to know, in order:
 *
 *   1. The wallpaper says so — `tone` on the definition, which the
 *      registration API carries from PHP. Exact, free, and the right
 *      answer for anything an author ships.
 *   2. The shell measures it. Reserved for the two wallpapers whose
 *      brightness is the USER's choice rather than an author's: an
 *      uploaded photograph and the gradient they mixed. Neither can
 *      declare a tone, because neither is the same surface twice.
 *
 * Anything that answers neither is dark, which is what the desk always
 * assumed. That default matters: a wrong `light` paints Void on Void.
 */

import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from '../settings/constants';
import type { WallpaperDef } from './types';

/** How bright a wallpaper is, from the desk's point of view. */
export type WallpaperTone = 'light' | 'dark';

/** Stamped on `<body>` while the active wallpaper is light. */
export const LIGHT_TONE_CLASS = 'os-wallpaper-light';

/**
 * The luminance at which Void ink overtakes Starlight ink.
 *
 * Both framings land in the same place, which is why this is one
 * number and not a judgement call. Starlight (#fffbff, L 0.9944) on a
 * backdrop stops clearing 4.5:1 once the backdrop passes L 0.182; and
 * the two inks are exactly equally legible — Starlight on the
 * backdrop versus Void (#0c0b0f, L 0.0043) on it — at L 0.188.
 * Anything brighter than that reads better in Void, by both measures.
 */
const LIGHT_LUMINANCE = 0.185;

/** Off-screen raster size for image sampling. Mean luminance needs no detail. */
const SAMPLE_EDGE = 32;

/** How long to wait for an uploaded image before giving up on measuring it. */
const LOAD_TIMEOUT_MS = 3000;

/**
 * The only wallpapers the shell measures, and the list is closed.
 *
 * These two have no author to ask: their surface is whatever the user
 * dropped in or mixed, and it is different on every install. Every
 * other wallpaper is authored, so it either declares a tone or takes
 * the dark default.
 *
 * Measuring the rest as well sounds harmless and is not. Averaging the
 * stops of a two-colour gradient describes neither end of it, and the
 * built-in presets that run dark-to-bright — Aurora, Sunset, Forest —
 * average out above the threshold while the corner the icon grid
 * actually starts in stays dark. They came back "light", and the desk
 * painted Void icons onto a midnight blue.
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
 * Parse the sRGB triplets out of a CSS value.
 *
 * Deliberately narrow: `#rgb`, `#rrggbb` and `rgb()` / `rgba()`, which
 * is everything the gradient editor can produce. A colour it does not
 * recognise is skipped rather than guessed at, and a value with no
 * recognisable colour returns an empty list so the caller can fall
 * through to the default rather than average nothing.
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

/**
 * Tone of a CSS background value, by averaging its colour stops.
 *
 * Null when the value names no colour this can read — a bare `url()`,
 * or a notation outside {@link parseCssColors}. The caller measures
 * the image or falls back; it never averages an empty set.
 */
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
 * Tone of an image, by mean luminance of a small raster of it.
 *
 * The mean is the whole picture rather than the corner the icon grid
 * starts in. A photograph is rarely one brightness, and the desk paints
 * tiles, captions and file icons across all of it, so the average is
 * the honest single answer — the alternative is a per-region ink, which
 * is a different feature.
 *
 * Resolves null rather than throwing on every failure path: a load
 * error, a canvas the browser refuses, a cross-origin image that taints
 * it. The caller then keeps the dark default and the desk looks the way
 * it always did.
 */
export async function toneFromImage( url: string ): Promise< WallpaperTone | null > {
	const cached = measured.get( url );
	if ( cached ) {
		return cached;
	}
	try {
		const image = new Image();
		// Same-origin uploads need nothing; this only helps a
		// correctly-configured remote and is harmless otherwise.
		image.crossOrigin = 'anonymous';
		const loaded = await new Promise< boolean >( ( resolve ) => {
			/*
			 * Bounded, because neither event is guaranteed. A stalled
			 * request fires nothing at all, and an unbounded wait here
			 * would leave one pending promise per wallpaper apply and a
			 * desk that never learns its tone. Giving up reads as "not
			 * knowing", which is already the dark default.
			 */
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
			// A transparent pixel shows the layer under the image, not
			// the image, so it says nothing about how bright the desk is.
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

/**
 * The tone of a wallpaper: declared if it says, measured if it is the
 * user's own, dark otherwise.
 */
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
	// building, so read the value the layer wrote instead — it is the
	// one the user is actually looking at.
	if ( value === '' ) {
		value = readAppliedBackground();
	}
	if ( value === '' ) {
		return 'dark';
	}

	// An image wins over any colour beside it: the custom-image value
	// carries a solid behind the photograph, and averaging that solid
	// in would describe the backstop rather than the desk.
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
