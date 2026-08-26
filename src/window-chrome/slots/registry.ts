/**
 * Title-bar slot registry — Layer 3 of the window-chrome framework.
 *
 * The title bar is composed of named **slots** — `before-titlebar`,
 * `before-icon`, `icon`, `title`, `after-title`, `before-controls`,
 * `controls`, `after-controls`, `after-titlebar`. The shell renders
 * default content into each slot to preserve the canonical look;
 * plugin authors register slot renderers via
 * `wp.os.registerWindowSlot()` to replace or augment what a slot
 * draws, on a per-window basis (driven by the `match` predicate).
 *
 * Multiple registrations may target the same slot. The shell calls
 * each matching renderer in `order` ascending order. By default the
 * shell clears the slot host before invoking the lowest-order
 * renderer; subsequent renderers append. A renderer can return a
 * teardown function which the shell invokes when the slot is
 * re-rendered, the window is closed, or the renderer is unregistered.
 *
 * Pattern matches the title-bar-button registry (`subscribe` fan-out,
 * `match` predicate, `owner`-based teardown).
 */

import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';

import type { Window as DesktopWindow } from '../../window';

/**
 * Canonical slot names. The shell renders these in the title bar, in
 * left-to-right document order:
 *
 * `before-titlebar` (above the bar) → `before-icon` → `icon` →
 * `title` → `after-title` → screen-meta cluster → menu (iframe-only)
 * → custom-button left slot → `before-controls` → `controls` (the
 * close/min/max cluster, populated by Layer 2) → `after-controls` →
 * custom-button right slot → `after-titlebar` (below the bar).
 *
 * `before-titlebar` and `after-titlebar` render OUTSIDE the flex
 * row — they're the right place for status banners, progress
 * indicators, or chrome decorations that want to span the full width
 * of the title bar without being squeezed by sibling slots.
 *
 * @public
 */
export type WindowSlotName =
	| 'before-titlebar'
	| 'before-icon'
	| 'icon'
	| 'title'
	| 'after-title'
	| 'before-controls'
	| 'controls'
	| 'after-controls'
	| 'after-titlebar';

/**
 * Optional teardown returned by a slot renderer. The shell invokes it
 * before the slot is re-rendered (registry change, window-state
 * update, runtime mutation) and on window close. Use it to disconnect
 * observers, cancel timers, drop event listeners.
 *
 * @public
 */
export type WindowSlotTeardown = () => void;

/**
 * Render context handed to a slot renderer.
 *
 * @public
 */
export interface WindowSlotRenderContext {
	/** The window the slot is being painted for. */
	window: DesktopWindow;
	/** The slot name being painted. */
	slot: WindowSlotName;
}

/**
 * A registered window-slot renderer.
 *
 * @public
 */
export interface WindowSlotDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`. Two registrations on the
	 * same slot must have different ids; re-registering with the same
	 * id replaces the previous entry.
	 */
	id: string;
	/** Which slot this renderer paints into. */
	slot: WindowSlotName;
	/**
	 * Predicate — return `true` to render this slot on the given
	 * window. Throwing predicates are treated as `false` (logged via
	 * `console.warn`).
	 */
	match: ( window: DesktopWindow ) => boolean;
	/**
	 * Render callback. Receives the slot's host element (a `<div>`
	 * the shell owns) and a context object. Mutate the host directly.
	 * Optionally return a teardown function the shell will call on
	 * re-render / unregister / window close.
	 *
	 * If multiple renderers target the same slot and `replace` is
	 * left at its default `true`, the lowest-order renderer's host is
	 * cleared before its render fires; subsequent renderers see the
	 * accumulated DOM and can append.
	 */
	render: (
		host: HTMLElement,
		ctx: WindowSlotRenderContext,
	) => void | WindowSlotTeardown;
	/** Sort order. Lower runs first. Default 100. */
	order?: number;
	/**
	 * When `true` (default), the shell clears the slot host before
	 * the renderer runs. When `false`, the renderer appends to
	 * whatever earlier-order renderers wrote. Most plugins want
	 * `true` — append-mode is for advanced compositions.
	 */
	replace?: boolean;
	/**
	 * Owner tag — typically the WordPress script handle that registered
	 * the slot. Set to live-unregister on plugin deactivation.
	 */
	owner?: string;
}

/**
 * Cross-bundle shared backing store. The lazy
 * `window-system[.min].js` bundle constructs/reads from this
 * registry while main writes to it via `registerBuiltIn*` and
 * `wp.os.register*` — each bundle would otherwise see its
 * own empty copy. See `AGENTS.md` ("Cross-bundle state") and
 * the Stage-8 callout in `BUNDLE-SIZE-REPORT.md` for the
 * pattern.
 */
interface RegistryStore {
	registry: Map< string, WindowSlotDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-slots-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_SLOT_ID = /^[a-z0-9_/-]+$/;

const KNOWN_SLOTS: ReadonlySet< WindowSlotName > = new Set( [
	'before-titlebar',
	'before-icon',
	'icon',
	'title',
	'after-title',
	'before-controls',
	'controls',
	'after-controls',
	'after-titlebar',
] );

/**
 * Register (or replace) a window-slot renderer. Throws a
 * {@link RegistrationError} on validation failure.
 */
export function registerWindowSlot( def: WindowSlotDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_SLOT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_SLOT_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.slot !== 'string' || def.slot.trim() === '' ) {
			errors.push( 'slot (missing)' );
		} else if ( ! KNOWN_SLOTS.has( def.slot as WindowSlotName ) ) {
			errors.push(
				`slot (must be one of ${ Array.from( KNOWN_SLOTS ).join( ', ' ) })`,
			);
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			errors.push( 'render (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowSlot', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * Remove a slot renderer by id. No-op when the id wasn't registered.
 */
export function unregisterWindowSlot( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Bulk teardown — drop every slot renderer whose `owner` matches.
 */
export function unregisterWindowSlotsByOwner( owner: string ): number {
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

/**
 * Snapshot of every registered slot renderer, sorted ascending by
 * `(order, id)` so iteration is deterministic across reloads.
 */
export function listWindowSlots(): WindowSlotDef[] {
	return Array.from( registry.values() ).sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

/**
 * Renderers targeting a specific slot for a specific window —
 * filtered by the registered `match` predicate, sorted by `order`.
 */
export function slotsForWindow(
	win: DesktopWindow,
	slot: WindowSlotName,
): WindowSlotDef[] {
	const out: WindowSlotDef[] = [];
	for ( const def of listWindowSlots() ) {
		if ( def.slot !== slot ) {
			continue;
		}
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[openstation] window-slot "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		out.push( def );
	}
	return out;
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 */
export function subscribeWindowSlots( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.error(
					'[openstation] window-slot registry listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Test-only: drop every slot renderer + clear subscribers.
 *
 * @internal
 */
export function _resetWindowSlotRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
