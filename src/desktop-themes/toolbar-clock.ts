/**
 * The time in the WordPress toolbar, for a desktop theme that draws the
 * toolbar as a menu bar.
 *
 * Mounted only while the active theme draws the toolbar, so under every
 * other look the toolbar carries no OpenStation node. Whether it shows
 * is the theme's `--os-toolbar-clock-display` token (`none` by default),
 * read by CSS rather than here because a theme's stylesheet can land
 * after the theme is picked.
 */

import { runClock } from '../ui/util/run-clock';

const NODE_ID = 'wp-admin-bar-os-clock';

let stopClock: ( () => void ) | null = null;

/**
 * Mount or remove the toolbar clock. Idempotent.
 *
 * @param on Whether the active theme draws the toolbar.
 */
export function syncToolbarClock( on: boolean ): void {
	if ( typeof document === 'undefined' ) {
		return;
	}
	const existing = document.getElementById( NODE_ID );
	if ( ! on ) {
		stopClock?.();
		stopClock = null;
		existing?.remove();
		return;
	}
	const group = document.getElementById( 'wp-admin-bar-top-secondary' );
	if ( existing || ! group ) {
		return;
	}
	const node = document.createElement( 'li' );
	node.id = NODE_ID;
	const item = document.createElement( 'div' );
	item.className = 'ab-item ab-empty-item';
	const time = document.createElement( 'time' );
	item.append( time );
	node.append( item );
	// Just left of the account menu, where a menu bar keeps its clock.
	group.insertBefore( node, document.getElementById( 'wp-admin-bar-my-account' ) );
	stopClock = runClock( time );
}
