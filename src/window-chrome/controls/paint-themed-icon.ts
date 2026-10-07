import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../../desktop-themes/icons';
import { slotForWindowControl } from '../../desktop-themes/slots';

export function paintThemedControlIcon(
	host: HTMLElement,
	controlId: string,
): boolean {
	const slot = slotForWindowControl( controlId );
	const themed = resolveThemedIcon( slot );
	const tint = resolveThemedIconColor( slot );

	if ( themed === null && tint === null ) {
		return false;
	}

	if ( tint !== null ) {
		host.style.setProperty( '--os-ui-btn-icon-color', tint );
	} else {
		host.style.removeProperty( '--os-ui-btn-icon-color' );
	}

	if ( themed === null ) {
		host.style.setProperty( 'color', tint as string );
		return false;
	}

	if ( themed.startsWith( 'dashicons-' ) ) {
		host.removeAttribute( 'icon-src' );
		host.removeAttribute( 'icon' );
		const span = document.createElement( 'span' );
		span.className = `dashicons ${ themed }`;
		span.setAttribute( 'aria-hidden', 'true' );
		if ( tint !== null ) {
			span.style.color = tint;
		}
		host.appendChild( span );
		return true;
	}

	host.setAttribute( 'icon-src', themed );
	return true;
}
