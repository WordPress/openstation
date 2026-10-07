import { OS_ICONS, OS_ICON_NAMES, OS_OWN_ICON_NAMES } from './set';
import type { OsIconDef, OsIconName } from './set';

export { OS_ICONS, OS_ICON_NAMES, OS_CORE_ICON_NAMES, OS_OWN_ICON_NAMES } from './set';
export type { OsIconDef, OsIconName } from './set';

export type OsIconRotation = 90 | 180 | 270;

export interface OsIconOptions {

	size?: number | null;

	className?: string;

	title?: string;

	rotate?: OsIconRotation;
}

function esc( value: string ): string {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

export function osIconDef( name: string ): OsIconDef | null {
	if ( ! Object.prototype.hasOwnProperty.call( OS_ICONS, name ) ) {
		return null;
	}
	return ( OS_ICONS as Readonly< Record< string, OsIconDef > > )[ name ];
}

export function isOsIconName( name: string ): name is OsIconName {
	return osIconDef( name ) !== null;
}

export function osIconSvg( name: string, options: OsIconOptions = {} ): string {
	const def = osIconDef( name );
	if ( ! def ) {
		return '';
	}

	const { size = 24, className, title, rotate } = options;

	const parts = [ 'xmlns="http://www.w3.org/2000/svg"', 'viewBox="0 0 24 24"' ];
	if ( size !== null && size !== undefined ) {
		parts.push( `width="${ size }"`, `height="${ size }"` );
	}
	parts.push( def.a );
	if ( className ) {
		parts.push( `class="${ esc( className ) }"` );
	}
	if ( title ) {
		parts.push( 'role="img"', `aria-label="${ esc( title ) }"` );
	} else {
		parts.push( 'aria-hidden="true"', 'focusable="false"' );
	}

	const body = rotate
		? `<g transform="rotate(${ rotate } 12 12)">${ def.b }</g>`
		: def.b;

	return `<svg ${ parts.join( ' ' ) }>${ body }</svg>`;
}

export function osIcon(
	name: string,
	options: OsIconOptions = {},
): SVGSVGElement {
	const markup = osIconSvg( name, options );
	const host = document.createElement( 'div' );

	host.innerHTML = markup;
	const svg = host.firstElementChild;
	if ( svg instanceof SVGSVGElement ) {
		return svg;
	}
	return document.createElementNS(
		'http://www.w3.org/2000/svg',
		'svg',
	) as SVGSVGElement;
}

export function osIconDataUri(
	name: string,
	options: OsIconOptions = {},
): string {
	const markup = osIconSvg( name, options );
	if ( ! markup ) {
		return '';
	}
	return `data:image/svg+xml,${ encodeURIComponent( markup ) }`;
}

export interface OsIconSetApi {

	svg: ( name: string, options?: OsIconOptions ) => string;

	node: ( name: string, options?: OsIconOptions ) => SVGSVGElement;

	dataUri: ( name: string, options?: OsIconOptions ) => string;

	names: readonly string[];

	ours: readonly string[];

	has: ( name: string ) => boolean;
}

export const osIconSetApi: OsIconSetApi = Object.freeze( {
	svg: osIconSvg,
	node: osIcon,
	dataUri: osIconDataUri,
	names: Object.freeze( [ ...OS_ICON_NAMES ] ),
	ours: Object.freeze( [ ...OS_OWN_ICON_NAMES ] ),
	has: isOsIconName,
} );
