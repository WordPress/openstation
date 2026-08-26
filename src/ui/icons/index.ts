/**
 * Rendering the icon set.
 *
 * The artwork is in `set.ts`, which is generated from the brand
 * repository. This file is hand-written and is the only thing call
 * sites should import:
 *
 *     import { osIconSvg, osIcon } from '../ui/icons';
 *
 *     // markup, for string-built UI and `innerHTML`
 *     const markup = osIconSvg( 'close', { size: 16 } );
 *
 *     // a node, for `html` templates
 *     html`<button>${ osIcon( 'close', { size: 16 } ) }</button>`
 *
 *     // a data URI, for the `icon:` field of dock / window APIs
 *     wp.os.registerDockItem( { icon: osIconDataUri( 'spaces' ) } );
 *
 * ## Accessibility
 *
 * Icons are `aria-hidden` by default, because the overwhelmingly
 * common case is a glyph inside a button that already carries its own
 * label, and announcing both would read the control twice. Pass a
 * `title` only when the icon is the sole carrier of meaning, and it
 * becomes `role="img"` with an accessible name instead.
 *
 * ## Sizing
 *
 * Default 24, which is what the drawings are for and what WordPress
 * renders Core's icons at. There is a floor worth respecting: Core's
 * glyphs carry 1.5-unit strokes on a 24 grid, so below about 16 they
 * thin out. `size` is a number of CSS pixels, or `null` to omit
 * `width`/`height` entirely and let a stylesheet size the element.
 */

import { OS_ICONS, OS_ICON_NAMES, OS_OWN_ICON_NAMES } from './set';
import type { OsIconDef, OsIconName } from './set';

export { OS_ICONS, OS_ICON_NAMES, OS_CORE_ICON_NAMES, OS_OWN_ICON_NAMES } from './set';
export type { OsIconDef, OsIconName } from './set';

/**
 * Quarter turns, clockwise. The set has one chevron, pointing right,
 * the way `@wordpress/icons` ships it; a menu that opens downwards
 * asks for `90` rather than a second drawing.
 */
export type OsIconRotation = 90 | 180 | 270;

export interface OsIconOptions {
	/**
	 * Rendered size in CSS pixels, applied to both `width` and
	 * `height`. `null` omits both so CSS owns the size. Default 24.
	 */
	size?: number | null;
	/** Extra class on the root `<svg>`. */
	className?: string;
	/**
	 * Accessible name. Omit for the usual case (an icon inside a
	 * labelled control), which renders `aria-hidden`.
	 */
	title?: string;
	/** Quarter turns clockwise about the centre of the grid. */
	rotate?: OsIconRotation;
}

/** Escape for an attribute value or text node. */
function esc( value: string ): string {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

/**
 * Look an icon up, tolerating an unknown name at runtime.
 *
 * The type says `OsIconName`, but plugin-supplied strings reach this
 * through `wp.os.icon()` and through attribute values, where the
 * compiler cannot help. An unknown name renders nothing rather than
 * throwing: a missing glyph is a blemish, a thrown error inside a
 * render pass takes the surface down with it.
 */
export function osIconDef( name: string ): OsIconDef | null {
	// `hasOwnProperty` rather than a bare index: `OS_ICONS.constructor`
	// resolves off the prototype chain and would sail through as an
	// icon, rendering `<svg undefined>undefined</svg>`. Plugin-supplied
	// strings reach this, so the lookup has to refuse inherited keys.
	if ( ! Object.prototype.hasOwnProperty.call( OS_ICONS, name ) ) {
		return null;
	}
	return ( OS_ICONS as Readonly< Record< string, OsIconDef > > )[ name ];
}

/** Whether a string names an icon in the set. */
export function isOsIconName( name: string ): name is OsIconName {
	return osIconDef( name ) !== null;
}

/**
 * One icon as standalone SVG markup.
 *
 * Returns `''` for an unknown name. The output is built from a
 * generated table and the caller's own options, with no
 * interpolation of anything a visitor controls, but `title` and
 * `className` are
 * escaped anyway, because both reach this from plugin registrations.
 */
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

	// Rotation wraps rather than mutating the paths, so the artwork
	// stays byte-identical to the brand source and a re-export lands
	// cleanly.
	const body = rotate
		? `<g transform="rotate(${ rotate } 12 12)">${ def.b }</g>`
		: def.b;

	return `<svg ${ parts.join( ' ' ) }>${ body }</svg>`;
}

/**
 * One icon as a parsed `<svg>` element, for `html` template slots.
 *
 * The templater writes text into slots but inserts a `Node` as-is, so
 * this is the idiomatic way to put an icon inside a template without
 * the `innerHTML`-buffer dance. Each call returns a fresh element: a
 * node can only live in one place in the DOM, so never hold one and
 * render it twice.
 *
 * Returns an empty `<svg>` for an unknown name, so a caller can always
 * append the result.
 */
export function osIcon(
	name: string,
	options: OsIconOptions = {},
): SVGSVGElement {
	const markup = osIconSvg( name, options );
	const host = document.createElement( 'div' );
	// Parsed through `innerHTML` on a plain div: SVG in an HTML
	// document is namespaced correctly by the HTML parser, which
	// `createElementNS` + `innerHTML` on a bare <svg> is not.
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

/**
 * One icon as a `data:` URI.
 *
 * For the `icon:` field of the dock, desktop-icon and window APIs,
 * and for anything painted through a CSS `mask`. Percent-encoded
 * rather than base64: it survives `btoa`'s Latin-1 limits, reads in
 * devtools, and compresses better in a stylesheet.
 *
 * The art is `currentColor` throughout, which is what routes it down
 * the mask path in both painters: the dock masks image icons so a
 * plugin's brand colours cannot break the monochrome rail. A fixed
 * fill would survive neither.
 */
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

/**
 * The set as it reaches plugin authors, on `wp.os.iconSet`.
 *
 * Extenders draw their own glyphs today, which is how a dock ends up
 * with four different crosses in it. Handing them the same thirty the
 * shell uses is the cheapest way for a third-party window to look like
 * it belongs.
 *
 * Named `iconSet` and not `icon` because `wp.os.icons` is already
 * taken, by the wallpaper icon rail's badge and art API. The two are
 * unrelated and the plural would read as though they were siblings.
 */
export interface OsIconSetApi {
	/** Markup, for `innerHTML` and string-built UI. */
	svg: ( name: string, options?: OsIconOptions ) => string;
	/** A fresh element, for appending or for a template slot. */
	node: ( name: string, options?: OsIconOptions ) => SVGSVGElement;
	/** A `data:` URI, for any `icon:` field or CSS mask. */
	dataUri: ( name: string, options?: OsIconOptions ) => string;
	/** Every name in the set, Core's first. */
	names: readonly string[];
	/** Which eleven are OpenStation's own. */
	ours: readonly string[];
	/** Whether a name is in the set. */
	has: ( name: string ) => boolean;
}

/**
 * Built once, frozen, and handed to the facade.
 *
 * Frozen because it is reachable from every plugin on the page: a
 * third party reassigning `wp.os.iconSet.svg` would silently change
 * what every other plugin draws. The arrays are frozen for the same
 * reason, and copied rather than shared so a `sort()` on the caller's
 * side cannot reorder the set for everyone.
 */
export const osIconSetApi: OsIconSetApi = Object.freeze( {
	svg: osIconSvg,
	node: osIcon,
	dataUri: osIconDataUri,
	names: Object.freeze( [ ...OS_ICON_NAMES ] ),
	ours: Object.freeze( [ ...OS_OWN_ICON_NAMES ] ),
	has: isOsIconName,
} );
