/**
 * Label translators for accent + dock-size ids.
 *
 * Keeping the `__()` calls inside a switch — rather than on the const
 * arrays directly — means the extract-pot pass sees string literals, and
 * the consts stay static. Any id we haven't translated explicitly falls
 * back to the English label.
 */

import { __ } from '../i18n';
import type {
	AccentId,
	AdminBarModeId,
	DesktopLayoutId,
	DockPlacementId,
	DockSizeId,
	WindowRadiusId,
} from './types';

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

export function translateWindowRadiusLabel(
	id: WindowRadiusId,
	fallback: string,
): string {
	switch ( id ) {
		case 'sharp':
			return __( 'Sharp' );
		case 'default':
			return __( 'Default' );
		case 'round':
			return __( 'Round' );
		default:
			return fallback;
	}
}

export function translateAdminBarModeLabel(
	id: AdminBarModeId,
	fallback: string,
): string {
	switch ( id ) {
		case 'static':
			return __( 'Static' );
		case 'dynamic':
			return __( 'Dynamic' );
		case 'hidden':
			return __( 'Hidden' );
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

export function translateDesktopLayoutLabel(
	id: DesktopLayoutId,
	fallback: string,
): string {
	switch ( id ) {
		case 'classic':
			return __( 'Side bar' );
		case 'unified':
			return __( 'One dock' );
		case 'spatial':
			return __( 'Spatial' );
		case 'openstation':
			return __( 'OpenStation' );
		default:
			return fallback;
	}
}

export function translateDesktopLayoutDescription(
	id: DesktopLayoutId,
): string {
	switch ( id ) {
		case 'classic':
			return __(
				'Two rails: a side bar with the core admin menus, plus a bottom dock for plugin apps.',
			);
		case 'unified':
			return __(
				'One dock: WordPress first, then a divider, then the OpenStation controls.',
			);
		case 'spatial':
			return __(
				'Bottom dock for plugin apps; core admin menus appear as icons on the wallpaper.',
			);
		case 'openstation':
			return __(
				'The same one dock, dressed up: a lit divider, and hover any tile to fan its submenu out as a flyout.',
			);
		default:
			return '';
	}
}
