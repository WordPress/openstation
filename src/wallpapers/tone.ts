import { CUSTOM_GRADIENT_ID, CUSTOM_IMAGE_ID } from '../settings/constants';
import type { WallpaperDef } from './types';

export type WallpaperTone = 'light' | 'dark';

export const LIGHT_TONE_CLASS = 'os-wallpaper-light';

const LIGHT_LUMINANCE = 0.185;

const SAMPLE_EDGE = 32;

const LOAD_TIMEOUT_MS = 3000;

const MEASURED_IDS: ReadonlySet< string > = new Set( [
	CUSTOM_IMAGE_ID,
	CUSTOM_GRADIENT_ID,
] );

const measured = new Map< string, WallpaperTone >();

export function relativeLuminance( r: number, g: number, b: number ): number {
	const channel = ( v: number ): number => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow( ( s + 0.055 ) / 1.055, 2.4 );
	};
	return (
		0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b )
	);
}

export function toneForLuminance( luminance: number ): WallpaperTone {
	return luminance > LIGHT_LUMINANCE ? 'light' : 'dark';
}

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

export function firstCssUrl( value: string ): string | null {
	const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec( value );
	return match ? match[ 2 ].trim() : null;
}

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

export async function toneFromImage( url: string ): Promise< WallpaperTone | null > {
	const cached = measured.get( url );
	if ( cached ) {
		return cached;
	}
	try {
		const image = new Image();

		image.crossOrigin = 'anonymous';
		const loaded = await new Promise< boolean >( ( resolve ) => {
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
		return null;
	}
}

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

	if ( value === '' ) {
		value = readAppliedBackground();
	}
	if ( value === '' ) {
		return 'dark';
	}

	const url = firstCssUrl( value );
	if ( url !== null ) {
		return ( await toneFromImage( url ) ) ?? 'dark';
	}

	return toneFromCssColors( value ) ?? 'dark';
}

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

export function applyWallpaperTone( tone: WallpaperTone ): void {
	if ( typeof document === 'undefined' || ! document.body ) {
		return;
	}
	document.body.classList.toggle( LIGHT_TONE_CLASS, tone === 'light' );
}
