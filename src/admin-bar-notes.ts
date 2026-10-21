/**
 * WordPress.com / Jetpack notifications, while the admin bar is hidden.
 *
 * Jetpack's Notifications module (and WordPress.com's masterbar, which
 * shares the markup) registers a `notes` admin-bar node: a bell whose
 * `#wpnt-notes-unread-count` carries the unread state, and a panel
 * (`#wpnt-notes-panel2`, or `-panel3` on the v3 opt-in) hanging off it
 * that Jetpack's own script fills with an iframe and toggles from a
 * click on the bell. The shell hides the bar by default, so with the
 * default settings none of it reached the user.
 *
 * This module gives the bell a dock tile while the bar is hidden, and
 * only then: in `static` and `dynamic` the bell is on the bar already,
 * and a second one would be a duplicate. The tile does not reimplement
 * anything: its badge mirrors the bell's count, and a click clicks the
 * bell, so the panel, its unread logic and its keyboard handling stay
 * Jetpack's. `desktop.css` keeps that panel renderable under the
 * hidden bar. A site without the node gets no tile.
 *
 * The mode is read off the body class rather than the settings store:
 * the class is what CSS hides the bar by, PHP writes it for the first
 * paint, and a plugin's `openstation_admin_bar_mode` filter lands
 * there too.
 */

import type { SystemDockItem } from './dock';
import { SYSTEM_TILE_ORDER } from './dock-shell-tiles';
import { doAction, HOOKS } from './hooks';
import { __ } from './i18n';

/** Tile id. Stable: it keys visibility overrides in Preferences. */
export const NOTES_TILE_ID = 'os-notifications';

/** Jetpack's admin-bar node: `<li id="wp-admin-bar-notes">`. */
export const NOTES_NODE_ID = 'wp-admin-bar-notes';

const COUNT_ID = 'wpnt-notes-unread-count';
const PANEL_SELECTOR = '#wpnt-notes-panel2, #wpnt-notes-panel3';
const HIDDEN_CLASS = 'os-admin-bar-hidden';

/**
 * How long a pointer press stays the answer to "was the panel open
 * when this click began?". A press and its click are milliseconds
 * apart; anything older belongs to another gesture.
 */
const PRESS_WINDOW_MS = 1000;

/** Wiring for {@link installAdminBarNotes}. */
export interface AdminBarNotesDeps {
	appendSystemTile( item: SystemDockItem ): void;
	removeSystemTile( id: string ): void;
	/** Paint the tile's badge on whichever rail hosts it. */
	setBadge( id: string, count: number ): void;
}

/** Handle returned by {@link installAdminBarNotes}. */
export interface AdminBarNotesController {
	destroy(): void;
}

/**
 * The bell's unread count. `wpn-read` (and `wpnt-loading`, before
 * Jetpack's first fetch) mean nothing is waiting; otherwise the text
 * is the number. An unread bell whose text is not a number still
 * shows a badge rather than none.
 */
export function readUnreadCount( node: Element ): number {
	const count = node.querySelector( `#${ COUNT_ID }` );
	if (
		! count ||
		count.classList.contains( 'wpn-read' ) ||
		count.classList.contains( 'wpnt-loading' )
	) {
		return 0;
	}
	const n = parseInt( count.textContent ?? '', 10 );
	if ( n > 0 ) {
		return n;
	}
	return count.classList.contains( 'wpn-unread' ) ? 1 : 0;
}

/**
 * Whether Jetpack's panel is showing. Its own `display`, not its box:
 * under the hidden bar nothing has a box, and the panel ships with an
 * inline `display:none` that Jetpack's script lifts to open it.
 */
export function isNotesPanelOpen( node: Element ): boolean {
	const panel = node.querySelector( PANEL_SELECTOR );
	return !! panel && window.getComputedStyle( panel ).display !== 'none';
}

/**
 * Start mirroring the bell. Returns a no-op controller on a site that
 * has no `notes` node, which is every site without Jetpack's
 * Notifications module or the WordPress.com masterbar.
 */
export function installAdminBarNotes(
	deps: AdminBarNotesDeps,
): AdminBarNotesController {
	const node = document.getElementById( NOTES_NODE_ID );
	if ( ! node ) {
		return { destroy: () => undefined };
	}

	let mounted = false;
	let lastCount = -1;
	let lastOpen = isNotesPanelOpen( node );
	let openAtPress = false;
	let pressedAt = -Infinity;

	const paintBadge = ( force = false ): void => {
		const count = readUnreadCount( node );
		if ( ! mounted || ( ! force && count === lastCount ) ) {
			return;
		}
		lastCount = count;
		deps.setBadge( NOTES_TILE_ID, count );
	};

	/**
	 * Click the bell, the way Jetpack expects to be asked. The count
	 * span is the innermost target, so a handler bound to it, to the
	 * bell's `.ab-item` link or to the node all see the click.
	 */
	const clickBell = (): void => {
		const target =
			node.querySelector< HTMLElement >( `#${ COUNT_ID }` ) ??
			node.querySelector< HTMLElement >( '.ab-item' );
		target?.click();
	};

	const onOpen = ( event?: MouseEvent ): void => {
		// Jetpack closes the panel on a press outside it, which a click
		// on the tile is, so by now the panel may already be closed by
		// the very gesture meant to close it. Decide from the state
		// the press found, and act once the click has finished
		// bubbling, so its outside-click handler has had its turn
		// and cannot undo an open. Only a pointer click has a press
		// behind it (`detail` 0 is Enter or Space), and a press answers
		// for one click only.
		const fromPointer =
			!! event &&
			event.detail > 0 &&
			performance.now() - pressedAt < PRESS_WINDOW_MS;
		pressedAt = -Infinity;
		const wasOpen = fromPointer ? openAtPress : isNotesPanelOpen( node );
		window.setTimeout( () => {
			if ( isNotesPanelOpen( node ) === wasOpen ) {
				clickBell();
			}
		}, 0 );
	};

	const tile: SystemDockItem = {
		id: NOTES_TILE_ID,
		title: __( 'Notifications' ),
		icon: 'dashicons-bell',
		navKind: 'control',
		placeable: true,
		order: SYSTEM_TILE_ORDER.notifications,
		isOpen: () => isNotesPanelOpen( node ),
		onOpen,
	};

	const sync = (): void => {
		const hidden = document.body.classList.contains( HIDDEN_CLASS );
		if ( hidden && ! mounted ) {
			deps.appendSystemTile( tile );
			mounted = true;
			paintBadge( true );
		} else if ( ! hidden && mounted ) {
			deps.removeSystemTile( NOTES_TILE_ID );
			mounted = false;
			lastCount = -1;
		}
	};

	const onNodeChange = (): void => {
		paintBadge();
		const open = isNotesPanelOpen( node );
		if ( open !== lastOpen ) {
			lastOpen = open;
			// The tile's active dot answers a question about the panel,
			// not a window, so no window event repaints it.
			doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );
		}
	};

	const onPress = (): void => {
		openAtPress = isNotesPanelOpen( node );
		pressedAt = performance.now();
	};

	// A rebuilt rail is a fresh tile with no badge on it.
	const onLayoutChanged = (): void => paintBadge( true );

	const bodyObserver = new MutationObserver( sync );
	bodyObserver.observe( document.body, {
		attributes: true,
		attributeFilter: [ 'class' ],
	} );
	const nodeObserver = new MutationObserver( onNodeChange );
	nodeObserver.observe( node, {
		subtree: true,
		childList: true,
		characterData: true,
		attributes: true,
		attributeFilter: [ 'class', 'style' ],
	} );
	// Capture, so the state is read before any bubbling handler of
	// Jetpack's can close the panel.
	document.addEventListener( 'pointerdown', onPress, true );
	document.addEventListener( 'os-layout-changed', onLayoutChanged );

	sync();

	return {
		destroy: () => {
			bodyObserver.disconnect();
			nodeObserver.disconnect();
			document.removeEventListener( 'pointerdown', onPress, true );
			document.removeEventListener( 'os-layout-changed', onLayoutChanged );
			if ( mounted ) {
				deps.removeSystemTile( NOTES_TILE_ID );
				mounted = false;
			}
		},
	};
}
