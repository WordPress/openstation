/**
 * Desktop Mode — Wallpaper shortcut icons.
 *
 * Renders the list of `config.desktopIcons` entries (from
 * `wp_register_desktop_icon()` in PHP) as clickable tiles on the
 * desktop wallpaper. Clicking an icon either opens the referenced
 * native window (via the injected `openWindow` callback) or opens the
 * URL as an iframe window / new tab.
 *
 * Intentionally minimal — no drag-to-rearrange yet (positions are
 * server-declared via the `position` field), no right-click menus.
 * Plugins that want richer icon behaviour can subscribe to the
 * `wp-desktop.desktop-icon.clicked` action and override the default
 * click semantics.
 *
 * @since 0.11.0
 */

import { doAction, HOOKS } from './hooks';
import { sanitizeClassName } from './utils';
import type { DesktopIconServerEntry } from './types';
import type { WindowManager } from './window-manager';

/**
 * Click-dispatch dependencies. The icon module doesn't know how to
 * open a native window on its own — that logic lives in the shell
 * with access to the native-window registry. Passing the opener in
 * keeps this module free of global lookups.
 */
export interface DesktopIconRenderDeps {
	/**
	 * Open a native window by its registered id. Returns `true`
	 * when the window was found and opened; `false` when no window
	 * with that id is registered. `false` is the signal for the
	 * caller to fall back (e.g. the plugin has been deactivated
	 * since the icon was registered).
	 */
	openWindow: ( id: string ) => boolean;
	/** Open an URL as a same-origin admin iframe window. */
	manager: WindowManager;
}

/**
 * Mount the icons grid on the desktop area. Safe to call repeatedly —
 * clears any prior container and re-renders from the current list so
 * a live menu refresh after plugin activation can rebuild the surface
 * without reloading the shell.
 *
 * @since 0.11.0
 *
 * @param host  Desktop-area element (`#wp-desktop-area`).
 * @param icons Ordered list from `config.desktopIcons`.
 * @param deps  See {@link DesktopIconRenderDeps}.
 */
export function renderDesktopIcons(
	host: HTMLElement,
	icons: readonly DesktopIconServerEntry[] | undefined,
	deps: DesktopIconRenderDeps,
): void {
	const existing = host.querySelector( ':scope > .wp-desktop-icons' );
	if ( existing ) {
		existing.remove();
	}
	if ( ! icons || icons.length === 0 ) {
		return;
	}

	const container = document.createElement( 'div' );
	container.className = 'wp-desktop-icons';
	container.setAttribute( 'role', 'list' );
	container.setAttribute( 'aria-label', 'Desktop icons' );

	for ( const entry of icons ) {
		container.appendChild( buildIcon( entry, deps ) );
	}

	host.appendChild( container );
}

function buildIcon(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): HTMLElement {
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = 'wp-desktop-icon';
	tile.dataset.iconId = entry.id;
	tile.setAttribute( 'role', 'listitem' );
	tile.setAttribute( 'aria-label', entry.title );

	const icon = document.createElement( 'span' );
	if ( entry.icon.startsWith( 'http://' ) || entry.icon.startsWith( 'https://' ) ) {
		// URL icon — render as an <img> with empty alt (the button's
		// aria-label describes the target).
		const img = document.createElement( 'img' );
		img.src = entry.icon;
		img.alt = '';
		icon.className = 'wp-desktop-icon__image';
		icon.appendChild( img );
	} else {
		icon.className = `wp-desktop-icon__image dashicons ${ sanitizeClassName( entry.icon ) }`;
		icon.setAttribute( 'aria-hidden', 'true' );
	}
	tile.appendChild( icon );

	const label = document.createElement( 'span' );
	label.className = 'wp-desktop-icon__label';
	label.textContent = entry.title;
	tile.appendChild( label );

	tile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.stopPropagation();
		doAction( HOOKS.DESKTOP_ICON_CLICKED, {
			id: entry.id,
			target: entry.window ? 'window' : 'url',
		} );
		openTarget( entry, deps );
	} );

	return tile;
}

function openTarget(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): void {
	if ( entry.window ) {
		const opened = deps.openWindow( entry.window );
		if ( ! opened ) {
			// Referenced native window is no longer registered (the
			// owning plugin was probably deactivated). No graceful
			// fallback — the icon itself should disappear on the next
			// live menu refresh.
			return;
		}
		return;
	}
	if ( entry.url ) {
		try {
			const parsed = new URL( entry.url, window.location.origin );
			if ( parsed.origin !== window.location.origin ) {
				// Off-site URL — open in a fresh tab with
				// noopener/noreferrer.
				window.open( parsed.toString(), '_blank', 'noopener,noreferrer' );
				return;
			}
			// Same-origin admin URL — open as an iframe window.
			deps.manager.open( {
				id: `desktop-icon-${ entry.id }`,
				url: parsed.toString(),
				title: entry.title,
				icon: entry.icon,
			} );
		} catch {
			// Malformed URL — ignore rather than surface a broken
			// click experience. The sanitizer rejected invalid URLs
			// on the server side, so reaching this branch usually
			// means a filter mangled the value post-registration.
		}
	}
}
