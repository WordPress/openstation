/**
 * Third-party title-bar button registry.
 *
 * Plugins register custom buttons that render in any matching
 * window's title bar — the right surface for cross-window verbs
 * ("connect to", "broadcast", "pin to", "live preview"). The match
 * predicate decides which windows show the button; buttons render
 * via either the high-level `icon`/`label`/`onClick` triple or a
 * custom `render( host, win )` for buttons that need a popover or
 * a dropdown.
 *
 * Buttons are repainted on every focus / state change of a window
 * (see {@link Window.renderCustomTitleBarButtons}); registering or
 * unregistering after a window is open triggers a global refresh
 * via the subscriber list.
 *
 * @since 0.17.0
 */

import { throwOnRegistrationErrors } from '../registration-errors';

import type { Window as DesktopWindow } from '../window';

export interface TitleBarButtonRenderCtx {
	/** The window this button is attached to. */
	window: DesktopWindow;
}

export interface TitleBarButtonDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/` (lower-case alphanum +
	 * hyphen + underscore + slash). Slashes are accepted so plugin
	 * authors can use the same `vendor/sub-id` namespacing
	 * convention as `wp_register_desktop_window( 'wpglp/preview' )`,
	 * `wp_register_desktop_widget( 'myplugin/stats' )`, etc.
	 *
	 * Same shape every other JS-side registry now uses
	 * (`registerCommand`, etc.) — slugs are routinely namespaced
	 * `vendor/sub-id` so two plugins can ship the same short name
	 * without colliding.
	 */
	id: string;
	/** Tooltip + aria-label. */
	label: string;
	/**
	 * Icon to paint inside the button. Three accepted shapes:
	 *
	 *   - **Dashicons class** — e.g. `'dashicons-visibility'`. The
	 *     shell renders a `<span class="dashicons …">` in the
	 *     button's light DOM so WordPress's global Dashicons
	 *     stylesheet reaches it.
	 *   - **Inline SVG string** — `'<svg viewBox="0 0 24 24">…</svg>'`.
	 *     Appended verbatim into the button's light DOM. Plugin code
	 *     is trusted at this level (same JS realm); the shell does
	 *     not sanitise the SVG.
	 *   - **Built-in key** — `'minimize'` / `'maximize'` /
	 *     `'fullscreen'` / `'fullscreen-exit'` / `'detach'` /
	 *     `'close'` / `'menu'`. Forwarded as the `<wpd-window-button>`
	 *     `icon` attribute, which paints the corresponding inline
	 *     SVG from the component's built-in icon map.
	 *
	 * Anything outside those three shapes renders an empty button
	 * (best to use a Dashicons class for new code — the largest
	 * vocabulary, no inline assets).
	 */
	icon: string;
	/** `'left'` (next to title) or `'right'` (before window controls). Default `'left'`. */
	placement?: 'left' | 'right';
	/** Sort order within placement. Default 100. */
	order?: number;
	/**
	 * Predicate — return `true` to render the button on this window.
	 * Common patterns:
	 *   - `( w ) => ! w.config.native`             — iframe windows only
	 *   - `( w ) => w.config.url?.includes( 'post.php' )` — Gutenberg
	 *   - `( w ) => true`                          — every window
	 */
	match: ( window: DesktopWindow ) => boolean;
	/**
	 * Click handler. Called **exactly once per user activation** —
	 * the registry wires it to the `<wpd-window-button>`'s
	 * `wpd-button-activate` CustomEvent rather than raw `click`,
	 * which means no double-firing if you also bind `pointerup` for
	 * unrelated reasons, no swallowed clicks when the title-bar's
	 * drag tracker captured the pointer, no racing.
	 *
	 * Skip this and use `render` for buttons whose UI is more than
	 * a single click (popovers, dropdowns) — there you bind your
	 * own listeners on the host element.
	 *
	 * The `ev` parameter is typed as `MouseEvent` for ergonomics
	 * (existing plugin code that probes `ev.metaKey` / `ev.shiftKey`
	 * keeps working) but at runtime it's a `wpd-button-activate`
	 * CustomEvent — the original click's modifier keys aren't
	 * preserved. If you need them, use `render` and listen to
	 * native `click` directly.
	 */
	onClick?: ( window: DesktopWindow, ev: MouseEvent ) => void;
	/**
	 * Custom render. Receives the host element (a `<wpd-window-button>`)
	 * and the window. Use for buttons that own their own DOM.
	 *
	 * When defined, `onClick` is ignored — your handler binds directly
	 * to the host. The host already carries the icon, label, and the
	 * `wp-desktop-window__btn` class; you typically only need to add
	 * a click listener for a popover anchor.
	 */
	render?: ( host: HTMLElement, window: DesktopWindow ) => void;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * button. Set this when plugin deactivation should live-unregister
	 * the button. Mirrors the pattern used by commands and settings
	 * tabs.
	 */
	owner?: string;
}

const registry = new Map< string, TitleBarButtonDef >();
const listeners = new Set<() => void >();

/**
 * Pattern of valid title-bar button ids. Wider than the command /
 * settings-tab pattern: slashes are allowed so plugins can mirror
 * the `vendor/sub-id` convention they already use for windows,
 * widgets, and icons. Lower-case alphanum, hyphen, underscore,
 * slash. Empty strings rejected.
 *
 * @internal
 */
const TITLE_BAR_BUTTON_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a title-bar button. Re-registering with the
 * same id replaces the previous entry — mirrors WordPress's
 * `register_*` semantics.
 *
 * Throws a {@link RegistrationError} when validation fails. Plugin
 * authors who registered a button and then watched the title bar
 * stay empty used to have to inspect a console warning to discover
 * the field they got wrong; an audible throw turns that into a
 * stack frame they read at registration time.
 *
 * @since 0.18.0  Throws on validation failure (was: returned `false`).
 *
 * @param  def Button definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerTitleBarButton( def: TitleBarButtonDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! TITLE_BAR_BUTTON_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ TITLE_BAR_BUTTON_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.icon !== 'string' || def.icon.trim() === '' ) {
			errors.push( 'icon (missing)' );
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if (
			typeof def.onClick !== 'function' &&
			typeof def.render !== 'function'
		) {
			errors.push( 'onClick|render (at least one must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'TitleBarButton', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterTitleBarButton( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterTitleBarButtonsByOwner( owner: string ): number {
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

export function listTitleBarButtons(): TitleBarButtonDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

/**
 * Buttons that match a given window, partitioned by placement.
 * Sorted by `order` within each side.
 */
export function buttonsForWindow(
	win: DesktopWindow,
): { left: TitleBarButtonDef[]; right: TitleBarButtonDef[] } {
	const left: TitleBarButtonDef[] = [];
	const right: TitleBarButtonDef[] = [];
	for ( const def of listTitleBarButtons() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch {
			continue;
		}
		if ( def.placement === 'right' ) {
			right.push( def );
		} else {
			left.push( def );
		}
	}
	return { left, right };
}

/** Subscribe to registry changes. Used by the shell to repaint open windows. */
export function subscribeTitleBarButtons( cb: () => void ): () => void {
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
				console.error(
					'[wp-desktop-mode] title-bar-button registry listener threw:',
					err,
				);
			}
		}
	}
}
