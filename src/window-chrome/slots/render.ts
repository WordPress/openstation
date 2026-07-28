/**
 * Window-slot painter — Layer 3 of the chrome framework.
 *
 * For each named slot in the title bar, the painter resolves its
 * content from three sources, in this priority:
 *
 *   1. **Per-window override** — `WindowConfig.appearance.slots[name]`.
 *      Three accepted shapes:
 *        - `null` — render nothing in the slot. Both the default
 *          content (icon dashicons span, title text) and any
 *          registry-matched renderers are suppressed for this slot
 *          on this window. Use this to hide the title or icon
 *          entirely.
 *        - `{ html: string }` — clear the host and write the string
 *          via `textContent` (NOT `innerHTML`) so iframe-side or
 *          plugin-supplied content can't smuggle script.
 *        - `{ render( host ) → void | (() => void) }` — clear the
 *          host (when `replace !== false`) and invoke the callback.
 *          The optional teardown is invoked on re-paint / close.
 *   2. **Default content** — what `dom.ts` painted at construction
 *      time (the icon's dashicons span, the title text). Untouched
 *      when no override / no matching registry entry exists.
 *   3. **Registry entries** — every `WindowSlotDef` in the registry
 *      whose `slot` matches and whose `match( win )` returns true.
 *      Painted in `order` ascending. The lowest-order entry that
 *      sets `replace: true` (default) clears any earlier content;
 *      `replace: false` appends.
 *
 * Layer 4's `controls` cluster is **not** routed through this
 * painter — Layer 2's `paintWindowControls()` owns it. Plugins
 * targeting the controls cluster use the control registry instead.
 *
 * The `desktop-mode.window.chrome.slot` filter fires once per slot
 * after content has settled, with the host as its value — plugins
 * can mutate the host without owning a registry entry (handy for
 * cross-cutting decorators).
 *
 * Returns a teardown function that:
 *   - Calls every plugin-supplied teardown returned by `render()`.
 *   - Restores the slot's default content if a `null` /
 *     `{ html }` / `{ render }` override had cleared it. Restored
 *     content lives in a per-window snapshot map captured on first
 *     paint, so the icon and title come back when an override is
 *     cleared via `applySlot()`.
 */

import { applyFilters, doAction, HOOKS } from '../../hooks';
import { slotsForWindow } from './registry';

import type { Window as DesktopWindow } from '../../window';
import type { WindowSlotName } from '../../types';

const SLOT_NAMES: ReadonlyArray< WindowSlotName > = [
	'before-titlebar',
	'before-icon',
	'icon',
	'title',
	'after-title',
	'before-controls',
	'after-controls',
	'after-titlebar',
];

/**
 * Per-window snapshot of the slots' original (default) DOM. Captured
 * on the first paint so subsequent paints can restore default
 * content when an override is cleared. Keyed by element reference
 * via WeakMap so closed windows don't leak.
 */
const defaultsCache = new WeakMap<
	HTMLElement,
	Map< WindowSlotName, ChildNode[] >
>();

function getSlotHost(
	root: HTMLElement,
	name: WindowSlotName,
): HTMLElement | null {
	return root.querySelector< HTMLElement >(
		`[data-slot="${ name }"]`,
	);
}

function captureDefaults( root: HTMLElement ): Map< WindowSlotName, ChildNode[] > {
	const map = new Map< WindowSlotName, ChildNode[] >();
	for ( const name of SLOT_NAMES ) {
		const host = getSlotHost( root, name );
		if ( ! host ) {
			continue;
		}
		map.set( name, Array.from( host.childNodes ).map( ( n ) => n.cloneNode( true ) as ChildNode ) );
	}
	return map;
}

function clearHost( host: HTMLElement ): void {
	while ( host.firstChild ) {
		host.removeChild( host.firstChild );
	}
}

function restoreDefault(
	host: HTMLElement,
	defaults: ChildNode[],
): void {
	clearHost( host );
	for ( const node of defaults ) {
		host.appendChild( node.cloneNode( true ) );
	}
}

/**
 * Paint every slot on a window. Returns a teardown function the
 * Window class invokes on re-paint and on close.
 *
 * @internal
 */
export function paintWindowSlots( win: DesktopWindow ): () => void {
	const teardowns: Array< () => void > = [];
	const root = win.element;
	if ( ! root ) {
		return () => {};
	}

	// Capture the construction-time defaults the first time we paint
	// this window. The icon and title spans get cloned so we can
	// restore them later when an override is cleared.
	let defaults = defaultsCache.get( root );
	if ( ! defaults ) {
		defaults = captureDefaults( root );
		defaultsCache.set( root, defaults );
	}

	const overrides = win.config.appearance?.slots ?? {};

	for ( const name of SLOT_NAMES ) {
		const host = getSlotHost( root, name );
		if ( ! host ) {
			continue;
		}
		const slotDefaults = defaults.get( name ) ?? [];
		const override = overrides[ name as keyof typeof overrides ];
		const matchingRegistry = slotsForWindow( win, name );

		// Step 1 — establish baseline content.
		// `null` override → empty host (no defaults, no registry).
		// Inline override → clear, write override.
		// Otherwise → restore defaults; registry entries below append.
		if ( override === null ) {
			clearHost( host );
		} else if ( override && 'html' in override ) {
			clearHost( host );
			host.textContent = override.html;
		} else if ( override && 'render' in override ) {
			const replace = override.replace !== false;
			if ( replace ) {
				clearHost( host );
			}
			try {
				const teardown = override.render( host );
				if ( typeof teardown === 'function' ) {
					teardowns.push( teardown );
				}
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'window-slot-inline-render',
					windowId: win.id,
					slot: name,
					error: err,
				} );
			}
		} else {
			restoreDefault( host, slotDefaults );
		}

		// Step 2 — registry entries (skipped when override === null,
		// since the user explicitly asked for an empty slot).
		if ( override !== null ) {
			let firstReplaceFired = false;
			for ( const def of matchingRegistry ) {
				const replace = def.replace !== false;
				if ( replace && ! firstReplaceFired ) {
					clearHost( host );
					firstReplaceFired = true;
				}
				try {
					const teardown = def.render( host, { window: win, slot: name } );
					if ( typeof teardown === 'function' ) {
						teardowns.push( teardown );
					}
				} catch ( err ) {
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-slot-registry-render',
						windowId: win.id,
						slot: name,
						id: def.id,
						error: err,
					} );
				}
			}
		}

		// Step 3 — fire the desktop-mode.window.chrome.slot filter so
		// plugins can mutate the host without owning a registry entry.
		// Filter value is the host element; subscribers may mutate it
		// in place. We swallow the return value (action-shaped
		// filter).
		applyFilters< HTMLElement, [ { windowId: string; slot: WindowSlotName; config: DesktopWindow[ 'config' ] } ] >(
			HOOKS.WINDOW_CHROME_SLOT,
			host,
			{ windowId: win.id, slot: name, config: win.config },
		);
	}

	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'slots',
	} );

	return () => {
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch {
				// Plugin teardown failures shouldn't block the next paint.
			}
		}
	};
}
