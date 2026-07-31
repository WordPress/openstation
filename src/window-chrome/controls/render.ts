/**
 * Window-controls cluster painter.
 *
 * Reads the Layer-2 control registry, applies the per-window
 * `WindowControlsConfig` (order / hide / custom inline buttons /
 * placement), and populates the controls cluster element with
 * `<wpd-window-button>` instances. Click handlers are attached to
 * each button at render time; re-rendering tears down the previous
 * buttons and rebuilds, so a plugin can register / unregister
 * controls mid-session and the title bar repaints without page
 * reload.
 *
 * Goes through a `desktop-mode.window.chrome.controls` filter on every
 * paint so plugins can mutate the resolved control list without
 * registering anything (handy for cross-cutting decorators).
 */

import { applyFilters, doAction, HOOKS } from '../../hooks';
import { controlsForWindow, type WindowControlDef } from './registry';
import { paintTitleBarButtonIcon } from '../../title-bar-buttons/paint-icon';
import { paintThemedControlIcon } from './paint-themed-icon';

import type { Window as DesktopWindow } from '../../window';
import type { WindowControlsConfig } from '../../types';
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.

/**
 * Resolve the control list for a window, partitioned by placement.
 * Resolution pipeline:
 *
 *   1. {@link controlsForWindow} returns registry entries whose
 *      `match` predicate accepted the window.
 *   2. Per-window `appearance.controls.hide` removes ids.
 *   3. Per-window `appearance.controls.custom` adds inline entries.
 *   4. Per-window `appearance.controls.order` re-sorts the controls
 *      cluster (only — left/right slots stay in registry order).
 *   5. The `desktop-mode.window.chrome.controls` filter runs once per
 *      placement bucket.
 *
 * @internal
 */
export function resolveWindowControls(
	win: DesktopWindow,
	override?: WindowControlsConfig,
): {
	left: WindowControlDef[];
	right: WindowControlDef[];
	controls: WindowControlDef[];
	placement: 'left' | 'right';
} {
	const buckets = controlsForWindow( win );
	const hide = new Set< string >( override?.hide ?? [] );

	let left = buckets.left.filter( ( c ) => ! hide.has( c.id ) );
	let right = buckets.right.filter( ( c ) => ! hide.has( c.id ) );
	let controls = buckets.controls.filter( ( c ) => ! hide.has( c.id ) );

	// Append custom inline controls. They're scoped to this window
	// only and never enter the global registry.
	if ( override?.custom ) {
		for ( const def of override.custom ) {
			if ( hide.has( def.id ) ) {
				continue;
			}
			const adapted: WindowControlDef = {
				id: def.id,
				label: def.label,
				icon: def.icon,
				placement: def.placement ?? 'controls',
				order: def.order ?? 100,
				match: () => true,
				onClick: def.onClick
					? ( _: DesktopWindow, ev: MouseEvent ) => def.onClick!( ev )
					: undefined,
				render: def.render
					? ( host: HTMLElement ) => def.render!( host )
					: undefined,
			};
			if ( adapted.placement === 'left' ) {
				left.push( adapted );
			} else if ( adapted.placement === 'right' ) {
				right.push( adapted );
			} else {
				controls.push( adapted );
			}
		}
		// Re-sort to honor the new entries' order fields.
		left = sortByOrder( left );
		right = sortByOrder( right );
		controls = sortByOrder( controls );
	}

	// Apply explicit per-window order to the controls cluster only.
	if ( override?.order && override.order.length > 0 ) {
		controls = applyExplicitOrder( controls, override.order );
	}

	const placement = override?.placement ?? 'right';

	const ctx = { windowId: win.id, config: win.config };
	left = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'left' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		left,
		{ ...ctx, placement: 'left' },
	);
	right = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'right' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		right,
		{ ...ctx, placement: 'right' },
	);
	controls = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'controls' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		controls,
		{ ...ctx, placement: 'controls' },
	);

	return { left, right, controls, placement };
}

function sortByOrder( list: WindowControlDef[] ): WindowControlDef[] {
	return [ ...list ].sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

function applyExplicitOrder(
	list: WindowControlDef[],
	order: string[],
): WindowControlDef[] {
	const byId = new Map< string, WindowControlDef >();
	for ( const def of list ) {
		byId.set( def.id, def );
	}
	const out: WindowControlDef[] = [];
	const used = new Set< string >();
	for ( const id of order ) {
		const def = byId.get( id );
		if ( def && ! used.has( id ) ) {
			out.push( def );
			used.add( id );
		}
	}
	// Append controls not mentioned in `order`, preserving registry order.
	for ( const def of list ) {
		if ( ! used.has( def.id ) ) {
			out.push( def );
		}
	}
	return out;
}

/**
 * Build a single control button. Mirrors the legacy
 * `createControlButton` factory in `src/window/dom.ts` so existing
 * CSS selectors (`.desktop-mode-window__btn--minimize`, etc.) still
 * match — the variant suffix is derived from the trailing segment of
 * the control id (`core/minimize` → `minimize`).
 */
function buildControlElement(
	def: WindowControlDef,
	win: DesktopWindow,
): { element: HTMLElement; teardown?: () => void } {
	const host = document.createElement( 'wpd-window-button' );
	host.setAttribute( 'aria-label', def.label );
	host.classList.add( 'desktop-mode-window__btn' );

	// Variant class — `core/close` → `close`, `plug/star` → `plug-star`.
	// Matches existing CSS hooks for built-ins; plugin custom controls
	// get a stable class derived from their full id.
	const variant = legacyVariantFor( def.id );
	host.classList.add( `desktop-mode-window__btn--${ variant }` );
	if ( def.id === 'core/close' ) {
		host.setAttribute( 'danger', '' );
	}

	if ( typeof def.render === 'function' ) {
		try {
			def.render( host, win );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-control-render',
				id: def.id,
				windowId: win.id,
				error: err,
			} );
			return { element: host };
		}
	} else {
		// Icon. An active desktop theme gets first refusal on this
		// control's glyph; only when it doesn't override the slot do
		// we fall back to the registered icon, painted through the
		// shared `paintTitleBarButtonIcon` helper so dashicons
		// classes, inline SVG, and built-in icon keys all work
		// identically here.
		if ( ! paintThemedControlIcon( host, def.id ) ) {
			paintTitleBarButtonIcon( host, def.icon ?? '' );
		}
		if ( typeof def.onClick === 'function' ) {
			const handler = ( ev: Event ): void => {
				ev.stopPropagation();
				try {
					def.onClick!( win, ev as MouseEvent );
				} catch ( err ) {
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-control-onclick',
						id: def.id,
						windowId: win.id,
						error: err,
					} );
				}
			};
			// `wpd-window-button` re-emits every native click as a
			// `wpd-button-activate` CustomEvent on the host. Listen
			// there ONLY — the raw `click` ALSO bubbles up
			// `composed: true` from the shadow `<button>`, so binding
			// both fires the handler twice per gesture. That double-
			// fire silently broke maximize / fullscreen for weeks
			// (toggle-on then toggle-off in one user click).
			host.addEventListener( 'wpd-button-activate', handler );
			return {
				element: host,
				teardown: () => {
					host.removeEventListener( 'wpd-button-activate', handler );
				},
			};
		}
	}

	return { element: host };
}

/**
 * Variant suffix used for the `desktop-mode-window__btn--*` class.
 * Built-ins keep their trailing segment (`core/close` → `close`) so
 * the existing CSS keeps matching unchanged. Plugin controls use
 * their full id with `/` collapsed to `-`.
 */
function legacyVariantFor( id: string ): string {
	if ( id.startsWith( 'core/' ) ) {
		return id.slice( 'core/'.length );
	}
	return id.replace( /\//g, '-' );
}

/**
 * Paint the controls cluster on a window. Tears down any previously
 * painted buttons (so plugin renders' event listeners get cleaned up)
 * and rebuilds from the resolved registry.
 *
 * Phase C scope: handles only the controls cluster (close / minimize
 * / maximize / focus / detach + plugin entries with `placement:
 * 'controls'`). The `left` / `right` slots remain owned by the
 * legacy title-bar-button registry — `registerTitleBarButton` still
 * routes through there, and `registerWindowControl` with
 * `placement: 'left'|'right'` is reserved for a future bridge that
 * unifies both surfaces.
 *
 * Returns a teardown function the Window class invokes on close
 * (and on every re-paint to drop the previous handlers).
 *
 * @internal
 */
export function paintWindowControls(
	win: DesktopWindow,
	controlsHost: HTMLElement,
): () => void {
	const teardowns: Array< () => void > = [];

	// Drop previously-painted buttons + their listeners, if any.
	while ( controlsHost.firstChild ) {
		controlsHost.removeChild( controlsHost.firstChild );
	}

	const resolved = resolveWindowControls(
		win,
		win.config.appearance?.controls,
	);

	// Move the controls cluster left when the window opts into
	// `placement: 'left'` — the CSS class flips the order property
	// in the title-bar grid.
	controlsHost.classList.toggle(
		'desktop-mode-window__controls--left',
		resolved.placement === 'left',
	);

	for ( const def of resolved.controls ) {
		const { element, teardown } = buildControlElement( def, win );
		controlsHost.appendChild( element );
		if ( teardown ) {
			teardowns.push( teardown );
		}
	}

	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'controls',
	} );

	return () => {
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch {
				// Plugin teardowns shouldn't take the cluster down; swallow.
			}
		}
	};
}
