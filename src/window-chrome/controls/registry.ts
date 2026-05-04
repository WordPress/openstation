/**
 * Window-control registry — Layer 2 of the window-chrome framework.
 *
 * A **control** is a button rendered in the title bar — close,
 * minimize, maximize, custom plugin actions. Built-in controls
 * (`core/minimize`, `core/maximize`, `core/focus-tab`, `core/detach`,
 * `core/close`) register here at shell boot in {@link
 * registerBuiltInControls} (Phase C); plugin authors register
 * additional controls via `wp.desktop.registerWindowControl()`. The
 * shell renders the control cluster from this registry, so plugins
 * can reorder, hide, or replace built-ins through
 * {@link WindowControlsConfig} on a window's `appearance`.
 *
 * Generalises the title-bar-button registry pattern (`subscribe`
 * fan-out, `match` predicate, `owner`-based teardown). The
 * `registerTitleBarButton()` API (since 0.17.0) is preserved as a
 * thin alias that delegates to this registry — existing plugins keep
 * working unchanged.
 *
 * @since 0.6.0
 */

import { throwOnRegistrationErrors } from '../../registration-errors';

import type { Window as DesktopWindow } from '../../window';

/**
 * Where the control renders relative to the window title.
 *
 *   - `'left'`     — between the title and the screen-meta cluster.
 *   - `'right'`    — between the screen-meta cluster and the controls.
 *   - `'controls'` — inside the controls cluster itself, alongside
 *                    close / minimize / maximize.
 *
 * Built-in controls always use `'controls'`. Plugin custom buttons
 * default to `'left'` to preserve title-bar-button-style placement.
 *
 * @public
 */
export type WindowControlPlacement = 'left' | 'right' | 'controls';

/**
 * A registered window control.
 *
 * @public
 */
export interface WindowControlDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`. Built-ins use the
	 * `core/*` prefix. Plugins use `vendor/sub-id`.
	 */
	id: string;
	/** Tooltip + aria-label. */
	label: string;
	/**
	 * Icon. Same three accepted shapes as title-bar buttons:
	 *
	 *   - **Dashicons class** — e.g. `'dashicons-visibility'`.
	 *   - **Inline SVG string** — `'<svg viewBox="0 0 24 24">…</svg>'`.
	 *   - **Built-in key** — `'minimize'` / `'maximize'` /
	 *     `'fullscreen'` / `'fullscreen-exit'` / `'detach'` /
	 *     `'close'` / `'menu'`.
	 *
	 * Required when `render` is omitted; ignored when `render` is
	 * provided.
	 */
	icon?: string;
	/**
	 * Where the control renders. Default `'left'` for plugin
	 * registrations; built-ins set `'controls'` explicitly.
	 */
	placement?: WindowControlPlacement;
	/** Sort order within the placement. Default 100. */
	order?: number;
	/**
	 * Predicate — return `true` to render this control on a given
	 * window. Throwing predicates are treated as `false` (logged via
	 * `console.warn`).
	 */
	match: ( window: DesktopWindow ) => boolean;
	/**
	 * Click handler. Mutually exclusive with `render`. Wired to the
	 * `<wpd-window-button>`'s `wpd-button-activate` CustomEvent —
	 * fires exactly once per user activation, no double-firing,
	 * no swallowed clicks during title-bar drag.
	 */
	onClick?: ( window: DesktopWindow, ev: MouseEvent ) => void;
	/**
	 * Custom render. Receives the host element and the window. The
	 * host already carries the icon, label, and `desktop-mode-window__btn`
	 * class; you typically only need to attach event listeners.
	 */
	render?: ( host: HTMLElement, window: DesktopWindow ) => void;
	/**
	 * Owner tag — typically the WordPress script handle that registered
	 * the control. Set to live-unregister on plugin deactivation.
	 */
	owner?: string;
	/**
	 * Internal flag set by built-in registrations. Lets devtools /
	 * inspectors distinguish framework controls from plugin controls
	 * without parsing ids. Plugin code should leave this unset.
	 *
	 * @internal
	 */
	core?: boolean;
}

const registry = new Map< string, WindowControlDef >();
const listeners = new Set<() => void >();

const WINDOW_CONTROL_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a window control. Re-registering with the
 * same id replaces the previous entry. Throws a {@link
 * RegistrationError} on validation failure.
 */
export function registerWindowControl( def: WindowControlDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_CONTROL_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_CONTROL_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if (
			typeof def.onClick !== 'function' &&
			typeof def.render !== 'function'
		) {
			errors.push( 'onClick|render (at least one must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			if ( typeof def.icon !== 'string' || def.icon.trim() === '' ) {
				errors.push( 'icon (required when render is omitted)' );
			}
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if (
			def.placement !== undefined &&
			def.placement !== 'left' &&
			def.placement !== 'right' &&
			def.placement !== 'controls'
		) {
			errors.push( 'placement (must be "left", "right", or "controls")' );
		}
	}

	throwOnRegistrationErrors( 'WindowControl', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * Remove a control by id. No-op when the id wasn't registered.
 *
 * Built-in controls (`core/*`) can be unregistered too — that's the
 * supported way to hide a built-in globally. Per-window hiding goes
 * through `WindowControlsConfig.hide` instead, so the rest of the
 * site keeps the built-in.
 */
export function unregisterWindowControl( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Bulk teardown — drop every control whose `owner` matches. Used by
 * chrome server-sync on plugin deactivation. Built-ins (no `owner`)
 * are never affected.
 */
export function unregisterWindowControlsByOwner( owner: string ): number {
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
 * Snapshot of every registered control, sorted ascending by `order`
 * within id-stable secondary order.
 */
export function listWindowControls(): WindowControlDef[] {
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
 * Controls that match `win`, partitioned by placement. Each bucket is
 * pre-sorted by `order` (then id). Throwing predicates → skipped.
 */
export function controlsForWindow(
	win: DesktopWindow,
): {
	left: WindowControlDef[];
	right: WindowControlDef[];
	controls: WindowControlDef[];
} {
	const left: WindowControlDef[] = [];
	const right: WindowControlDef[] = [];
	const controls: WindowControlDef[] = [];
	for ( const def of listWindowControls() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[desktop-mode] window-control "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		const placement = def.placement ?? 'left';
		if ( placement === 'right' ) {
			right.push( def );
		} else if ( placement === 'controls' ) {
			controls.push( def );
		} else {
			left.push( def );
		}
	}
	return { left, right, controls };
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 */
export function subscribeWindowControls( cb: () => void ): () => void {
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
					'[desktop-mode] window-control registry listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Test-only: drop every control + clear subscribers.
 *
 * @internal
 */
export function _resetWindowControlRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
