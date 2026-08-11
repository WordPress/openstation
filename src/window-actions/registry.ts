/**
 * Window actions-menu registry.
 *
 * The ⋯ menu in every window's title bar had a fixed menu: five
 * built-in items, none of them reachable from a plugin. That made it
 * the one title-bar surface with no extension point — a plugin could
 * add a *button* next to the title (`registerTitleBarButton`) but not
 * an *item* in the menu, which is where an infrequent, wordy,
 * per-window verb actually belongs. "Send to your Mac" was the case
 * that made the gap obvious; it is not the only one.
 *
 * So: an action is a labelled row in that menu, gated by a predicate,
 * with a handler. Everything else — how the menu opens, closes,
 * focuses, and repaints — stays where it was.
 *
 * ## Why the label and visibility are functions
 *
 * Both are read every time the menu opens, not once at registration.
 * A menu item whose meaning depends on state ("Send to your Mac" /
 * "Bring back into OpenStation" for the same window, depending on
 * where it currently lives) is otherwise impossible to express
 * without the plugin re-registering itself on every transition. One
 * item that answers "what does this do right now?" is the honest
 * shape for a toggle: a window is in one place or the other, never
 * both, so two competing items would misdescribe it.
 */

import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';

import type { Window as DesktopWindow } from '../window';

export interface WindowActionDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`. Slashes are accepted so
	 * plugins can use the same `vendor/sub-id` namespacing every other
	 * JS registry here takes.
	 */
	id: string;
	/**
	 * Menu row text. A function is called on every menu open, so an
	 * action whose meaning depends on state can say what it will
	 * actually do right now.
	 */
	label: string | ( ( window: DesktopWindow ) => string );
	/**
	 * Dashicons class for the row's leading glyph — e.g.
	 * `'dashicons-desktop'`. A function is re-read on every open,
	 * alongside `label`.
	 */
	icon?: string | ( ( window: DesktopWindow ) => string );
	/** Sort order among registered actions. Default 100. */
	order?: number;
	/**
	 * Predicate — return `true` to show the row on this window. Read
	 * on every menu open, so an action can appear and disappear with
	 * the state it depends on (a host connecting, a capability
	 * changing, a window navigating somewhere else).
	 *
	 * Omit to show on every window.
	 */
	isVisible?: ( window: DesktopWindow ) => boolean;
	/**
	 * Handler. The shell closes the menu before calling it, so a
	 * handler that opens a dialog or navigates does not have to
	 * compete with a still-painted popover.
	 */
	onSelect: ( window: DesktopWindow ) => void;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * action. Set it when plugin deactivation should live-unregister
	 * the row, exactly as commands and settings tabs do.
	 */
	owner?: string;
}

/**
 * Cross-bundle shared backing store — the lazy `window-system` bundle
 * reads this registry while the main bundle and plugin bundles write
 * to it. Without the shared store each bundle would see its own empty
 * copy. See AGENTS.md, "Cross-bundle state".
 */
interface RegistryStore {
	registry: Map< string, WindowActionDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-actions-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/** Same id shape as the title-bar button registry. @internal */
const WINDOW_ACTION_ID = /^[a-z0-9_/-]+$/;

/** Tell every subscriber the registry changed. */
function notify(): void {
	for ( const listener of Array.from( listeners ) ) {
		try {
			listener();
		} catch {
			// A broken subscriber must not stop the others from
			// repainting — the menu is shared surface.
		}
	}
}

/**
 * Register (or replace) a window action. Re-registering the same id
 * replaces the previous entry, mirroring WordPress `register_*`
 * semantics.
 *
 * @param  def Action definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerWindowAction( def: WindowActionDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_ACTION_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_ACTION_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if (
			typeof def.label !== 'string' &&
			typeof def.label !== 'function'
		) {
			errors.push( 'label (must be a string or a function)' );
		} else if ( typeof def.label === 'string' && def.label.trim() === '' ) {
			errors.push( 'label (empty)' );
		}
		if ( typeof def.onSelect !== 'function' ) {
			errors.push( 'onSelect (must be a function)' );
		}
		if (
			def.isVisible !== undefined &&
			typeof def.isVisible !== 'function'
		) {
			errors.push( 'isVisible (must be a function when set)' );
		}
	}

	throwOnRegistrationErrors( 'WindowAction', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * @param id Action id.
 */
export function unregisterWindowAction( id: string ): void {
	if ( registry.delete( String( id || '' ).toLowerCase() ) ) {
		notify();
	}
}

/**
 * Drop every action a departing plugin registered.
 *
 * @param owner Script handle passed as `owner` at registration.
 * @return How many actions were removed.
 */
export function unregisterWindowActionsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
		if ( def.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/** @return Every registered action, in `order`. */
export function listWindowActions(): WindowActionDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

/**
 * Subscribe to registry changes.
 *
 * @param listener Called after every register / unregister.
 * @return Unsubscribe.
 */
export function subscribeWindowActions( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

/**
 * Resolve an action's label for one window.
 *
 * @param def    Action.
 * @param window The window the menu belongs to.
 * @return Row text.
 */
export function resolveActionLabel(
	def: WindowActionDef,
	window: DesktopWindow,
): string {
	if ( typeof def.label === 'function' ) {
		try {
			return String( def.label( window ) ?? '' );
		} catch {
			return '';
		}
	}
	return def.label;
}

/**
 * Resolve an action's icon for one window.
 *
 * @param def    Action.
 * @param window The window the menu belongs to.
 * @return Dashicons class, or '' for no glyph.
 */
export function resolveActionIcon(
	def: WindowActionDef,
	window: DesktopWindow,
): string {
	if ( typeof def.icon === 'function' ) {
		try {
			return String( def.icon( window ) ?? '' );
		} catch {
			return '';
		}
	}
	return def.icon ?? '';
}

/**
 * Whether an action should appear on this window right now.
 *
 * A throwing predicate hides the row rather than breaking the menu:
 * the menu is shared surface, and one plugin's bug should not cost
 * the user their "Reload".
 *
 * @param def    Action.
 * @param window The window the menu belongs to.
 * @return True to show the row.
 */
export function isActionVisible(
	def: WindowActionDef,
	window: DesktopWindow,
): boolean {
	if ( typeof def.isVisible !== 'function' ) {
		return true;
	}
	try {
		return !! def.isVisible( window );
	} catch {
		return false;
	}
}
