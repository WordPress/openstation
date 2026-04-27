/**
 * Label translators for accent + dock-size ids.
 *
 * Keeping the `__()` calls inside a switch — rather than on the const
 * arrays directly — means the extract-pot pass sees string literals, and
 * the consts stay static. Any id we haven't translated explicitly falls
 * back to the English label.
 */

import { __ } from '../i18n';
import type { AccentId, DockPlacementId, DockSizeId } from './types';

export function translateAccentLabel( id: AccentId, fallback: string ): string {
	switch ( id ) {
		case 'wp-blue':
			return __( 'WordPress Blue' );
		case 'indigo':
			return __( 'Indigo' );
		case 'teal':
			return __( 'Teal' );
		case 'emerald':
			return __( 'Emerald' );
		case 'amber':
			return __( 'Amber' );
		case 'rose':
			return __( 'Rose' );
		default:
			return fallback;
	}
}

export function translateDockSizeLabel( id: DockSizeId, fallback: string ): string {
	switch ( id ) {
		case 'compact':
			return __( 'Compact' );
		case 'default':
			return __( 'Default' );
		case 'large':
			return __( 'Large' );
		default:
			return fallback;
	}
}

export function translateDockPlacementLabel(
	id: DockPlacementId,
	fallback: string,
): string {
	switch ( id ) {
		case 'bottom':
			return __( 'Bottom' );
		case 'left':
			return __( 'Left' );
		case 'right':
			return __( 'Right' );
		default:
			return fallback;
	}
}
