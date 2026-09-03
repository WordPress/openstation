/**
 * Site Spaces: another admin, on its own desktop.
 *
 * A cross-admin activation (the Network Admin tile, a Sites-list
 * "Dashboard" link inside a window) finds or creates THE desktop for
 * that admin — one per admin scope, labelled after it — slides to it,
 * and opens the page there as an ordinary iframe window. The desktop
 * carries the scope (`Desktop.scope`), which is what lets its windows
 * persist through the per-admin session scoping and makes closing it
 * close them (see `src/window-manager/desktops.ts`).
 *
 * Only a SAME-ORIGIN admin can live in a Space: a window is an iframe,
 * and WordPress refuses cross-origin framing. A cross-origin target
 * (the network admin seen from a subdomain or mapped site) opens a
 * browser tab, and a modifier or middle click opens one anywhere — the
 * universal "open elsewhere" gesture. See docs/multisite.md.
 */

import { adminScopeOf, adminScopeOfUrl } from '../admin-scope';
import { deriveWindowId } from '../utils';
import { wantsBrowserTab } from './hop';
import { __ } from '../i18n';

/** The slice of the WindowManager the opener drives. */
export interface SpacesManager {
	getDesktops(): Array< { id: string; label: string; scope?: string } >;
	getActiveDesktopId(): string;
	getPrimaryDesktopId(): string;
	switchDesktop(
		id: string,
		opts?: { direction?: 'next' | 'prev' },
	): void;
	createDesktop( init?: { label?: string; scope?: string } ): {
		id: string;
	};
	open( config: {
		id: string;
		baseId?: string;
		url: string;
		title: string;
		icon?: string;
	} ): unknown;
}

/**
 * Label for a Space, from its scope: the site's path segment, or the
 * admin's own name where the path has none.
 */
export function labelForScope( scope: string ): string {
	if ( scope.endsWith( '/wp-admin/network/' ) ) {
		return __( 'Network Admin' );
	}
	if ( scope.endsWith( '/wp-admin/user/' ) ) {
		return __( 'User Admin' );
	}
	const site = scope
		.slice( 0, scope.indexOf( '/wp-admin/' ) )
		.split( '/' )
		.filter( Boolean )
		.pop();
	return site || __( 'Main site' );
}

/**
 * Builds the opener the tile and the bridge router share. One
 * function, one rule — the two entry points must never disagree on
 * where a cross-admin click lands.
 */
export function createSpaceOpener( deps: {
	manager: SpacesManager;
	adminUrl: string;
} ): ( url: string, event?: MouseEvent ) => void {
	const shellScope = adminScopeOf( new URL( deps.adminUrl ).pathname );

	return ( url: string, event?: MouseEvent ): void => {
		if ( wantsBrowserTab( event ) ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
			return;
		}

		const scope = adminScopeOfUrl( url, deps.adminUrl );
		if ( scope === null ) {
			// Cross-origin (or not an admin URL at all): it cannot be
			// framed, so it cannot be a Space. A tab is the one thing
			// that works on every network shape.
			window.open( url, '_blank', 'noopener,noreferrer' );
			return;
		}

		const { manager } = deps;
		const desktops = manager.getDesktops();
		const activeIdx = desktops.findIndex(
			( d ) => d.id === manager.getActiveDesktopId(),
		);
		if ( scope === shellScope ) {
			// The shell's own admin. Its desktop is the PRIMARY one, not
			// a Space — so a click that lands here while the user is
			// standing in a Space (the main site's Dashboard row in the
			// network Sites list, seen from the main site's own shell)
			// goes home first instead of dropping the home admin's
			// window onto another admin's desktop.
			if ( desktops[ activeIdx ]?.scope ) {
				const primary = manager.getPrimaryDesktopId();
				const primaryIdx = desktops.findIndex(
					( d ) => d.id === primary,
				);
				manager.switchDesktop( primary, {
					direction: primaryIdx > activeIdx ? 'next' : 'prev',
				} );
			}
		} else {
			const existingIdx = desktops.findIndex(
				( d ) => d.scope === scope,
			);
			if ( existingIdx !== -1 ) {
				manager.switchDesktop( desktops[ existingIdx ].id, {
					direction: existingIdx > activeIdx ? 'next' : 'prev',
				} );
			} else {
				const space = manager.createDesktop( {
					label: labelForScope( scope ),
					scope,
				} );
				// A fresh Space appends, so it always slides in from
				// the right.
				manager.switchDesktop( space.id, { direction: 'next' } );
			}
		}

		// The open lands on the now-active desktop; `open()` focuses an
		// existing window with this id there instead of duplicating.
		const id = deriveWindowId( url, deps.adminUrl );
		manager.open( {
			id,
			baseId: id,
			url,
			title: labelForScope( scope ),
			icon: 'dashicons-admin-multisite',
		} );
	};
}
