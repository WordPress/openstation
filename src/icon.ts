import { hashTitleToHue } from './ui/util/hash-hue';
import { resolveThemedIcon, resolveThemedIconColor } from './desktop-themes/icons';
import { applyIconMask } from './desktop-themes/paint-tinted-icon';

const SVG_URI_PREFIX = 'data:image/svg+xml;base64,';

const silhouetteCache = new Map< string, boolean >();

function isSilhouetteSvg( icon: string ): boolean {
	const cached = silhouetteCache.get( icon );
	if ( cached !== undefined ) {
		return cached;
	}

	let silhouette = false;
	try {
		silhouette = atob( icon.slice( SVG_URI_PREFIX.length ) ).includes(
			'currentColor',
		);
	} catch {

	}

	if ( silhouetteCache.size >= 256 ) {
		silhouetteCache.clear();
	}
	silhouetteCache.set( icon, silhouette );
	return silhouette;
}

export interface RenderIconOptions {

	title: string;

	className?: string;

	slot?: string;
}

export function renderIcon( icon: string, opts: RenderIconOptions ): HTMLElement {
	const className = opts.className ?? '';
	const title = opts.title ?? '';

	let tint: string | null = null;
	if ( opts.slot ) {
		const themed = resolveThemedIcon( opts.slot );
		if ( themed !== null ) {
			icon = themed;
		}

		tint = resolveThemedIconColor( opts.slot );
	}

	if ( typeof icon === 'string' && icon.startsWith( 'dashicons-' ) ) {
		const el = document.createElement( 'span' );
		el.className = `dashicons ${ icon } ${ className }`.trim();
		el.setAttribute( 'aria-hidden', 'true' );
		if ( tint !== null ) {
			el.style.color = tint;
		}
		return el;
	}

	if ( tint !== null && typeof icon === 'string' ) {
		const el = document.createElement( 'span' );
		el.className = className;
		el.setAttribute( 'aria-hidden', 'true' );
		el.style.display = 'inline-block';
		if ( applyIconMask( el, icon, tint ) ) {
			return el;
		}
	}

	if (
		typeof icon === 'string' &&
		icon.startsWith( 'data:image/svg+xml;base64,' )
	) {
		const base64Part = icon.slice( SVG_URI_PREFIX.length );
		if ( /^[A-Za-z0-9+/=]+$/.test( base64Part ) ) {
			const el = document.createElement( 'span' );
			el.className = className;
			el.setAttribute( 'aria-hidden', 'true' );
			el.style.display = 'inline-block';

			if ( isSilhouetteSvg( icon ) && applyIconMask( el, icon, 'currentColor' ) ) {
				return el;
			}

			el.style.backgroundImage = `url("${ icon }")`;
			el.style.backgroundRepeat = 'no-repeat';
			el.style.backgroundPosition = 'center';
			el.style.backgroundSize = 'contain';
			return el;
		}
	}

	if (
		typeof icon === 'string' &&
		/^data:image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test( icon )
	) {
		const commaIdx = icon.indexOf( ',' );
		const payload = commaIdx >= 0 ? icon.slice( commaIdx + 1 ) : '';
		if ( /^[A-Za-z0-9+/=]+$/.test( payload ) ) {
			return makeImgIcon( icon, className );
		}
	}

	if (
		typeof icon === 'string' &&
		( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) )
	) {
		return makeImgIcon( icon, className );
	}

	const span = document.createElement( 'span' );
	span.className = `${ className } os-icon-letter`.trim();
	span.setAttribute( 'aria-hidden', 'true' );
	const letters = letterFromTitle( title );
	span.textContent = letters;
	const hue = hashTitleToHue( title );
	span.style.backgroundColor = `hsl( ${ hue }, 60%, 45% )`;
	span.style.color = '#fff';
	span.style.display = 'inline-flex';
	span.style.alignItems = 'center';
	span.style.justifyContent = 'center';
	span.style.fontWeight = '600';
	span.style.borderRadius = '4px';
	return span;
}

function makeImgIcon( src: string, className: string ): HTMLImageElement {
	const img = document.createElement( 'img' );
	img.className = className;
	img.src = src;
	img.alt = '';
	img.setAttribute( 'aria-hidden', 'true' );
	img.draggable = false;
	return img;
}

function letterFromTitle( title: string ): string {
	const trimmed = ( title ?? '' ).trim();
	if ( trimmed === '' ) {
		return '?';
	}
	const words = trimmed.split( /\s+/ );
	if ( words.length >= 2 ) {
		return ( words[ 0 ][ 0 ] + words[ 1 ][ 0 ] ).toUpperCase();
	}
	const first = words[ 0 ];
	if ( first.length >= 2 ) {
		return first.slice( 0, 2 ).toUpperCase();
	}
	return first.toUpperCase();
}
