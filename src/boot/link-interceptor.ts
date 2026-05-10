/**
 * Top-window link interceptor.
 *
 * Intercepts clicks on `/wp-admin/` anchors in the parent shell
 * and opens (or focuses) a matching shell window instead of
 * letting the browser navigate the whole tab.
 *
 * Runs in the capture phase so we beat any handler that calls
 * `stopPropagation` on the bubble phase — the admin bar's own JS,
 * for instance. Handlers that call `preventDefault()` before us
 * (like the desktop-mode toggle, which uses `href="#"`) are
 * respected: we bail on `defaultPrevented` and on anchor links.
 *
 * Iframe content is a separate document realm — clicks inside a
 * window don't bubble up to this listener, so the chromeless
 * iframe's own link rewriter still owns iframe-internal
 * navigation.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 *
 * @since 0.8.1
 */

import { tryNativeUrlRemap } from '../native-url-remap';
import { deriveWindowId } from '../utils';
import { findDockEntryForUrl } from './geometry';
import { INITIAL_ORIGIN } from './origin';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig } from '../types';

/**
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function bindTopWindowLinkInterceptor(
	manager: WindowManager,
	config: DesktopConfig,
): void {
	document.addEventListener(
		'click',
		( e: MouseEvent ) => {
			if ( e.defaultPrevented ) {
				return;
			}
			if (
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			) {
				return;
			}
			const target = e.target as Element | null;
			const link = target && target.closest ? target.closest( 'a[href]' ) : null;
			if ( ! link ) {
				return;
			}
			const anchor = link as HTMLAnchorElement;
			const linkTarget = anchor.getAttribute( 'target' );
			if ( linkTarget && linkTarget !== '' && linkTarget !== '_self' ) {
				return;
			}
			if ( anchor.hasAttribute( 'download' ) ) {
				return;
			}

			const rawHref = anchor.getAttribute( 'href' );
			if ( ! rawHref || rawHref.charAt( 0 ) === '#' ) {
				return;
			}
			if ( /^(mailto:|tel:|javascript:|data:)/i.test( rawHref ) ) {
				return;
			}

			let url: URL;
			try {
				url = new URL( rawHref, window.location.href );
			} catch ( err ) {
				// Malformed href — rare in practice (the browser's own
				// parser is quite lenient) but if a plugin is generating
				// broken URLs the only signal today would be "the link
				// doesn't get intercepted and leaves the shell." Log so
				// the author can trace it.
				if ( typeof console !== 'undefined' ) {
					console.warn(
						'[desktop-mode] Couldn’t parse href; letting the browser handle the click:',
						rawHref,
						err,
					);
				}
				return;
			}

			if ( url.origin !== INITIAL_ORIGIN ) {
				return;
			}
			let adminPath: string;
			try {
				adminPath = new URL( config.adminUrl ).pathname;
			} catch ( err ) {
				// Shell boot should have rejected a bad adminUrl, so
				// reaching this branch means something mutated config
				// after boot. Log + fall back rather than break every
				// link click on the page.
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[desktop-mode] config.adminUrl is not a valid URL; falling back to /wp-admin/:',
						config.adminUrl,
						err,
					);
				}
				adminPath = '/wp-admin/';
			}
			if ( ! url.pathname.startsWith( adminPath ) ) {
				return;
			}

			// admin-post.php and admin-ajax.php are endpoints, not
			// pages. Logout and similar auth routes carry their own
			// redirects and must be allowed to navigate the tab
			// normally.
			if ( /\/(admin-post|admin-ajax)\.php$/.test( url.pathname ) ) {
				return;
			}
			if (
				url.searchParams.has( 'action' ) &&
				url.searchParams.get( 'action' ) === 'logout'
			) {
				return;
			}
			// The Detach-to-classic action explicitly wants a real
			// tab with classic chrome — don't steal it back into the
			// shell.
			if ( url.searchParams.has( 'desktop_mode_classic' ) ) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			// Native URL remap — same path the dock click consults.
			// Any /wp-admin/edit.php anchor in the shell (admin-bar
			// "Posts", a custom dashboard widget link, etc.) routes
			// to the native Posts window when the user is opted in.
			if ( tryNativeUrlRemap( url.href ) ) {
				return;
			}

			const windowId = deriveWindowId( url.href, config.adminUrl );
			const dockEntry = findDockEntryForUrl( url.href, config );
			const fallbackTitle =
				( anchor.textContent || '' ).trim() || dockEntry?.title || '';

			manager.open( {
				id: windowId,
				baseId: windowId,
				multi: !! dockEntry?.multi,
				url: url.href,
				parentUrl: dockEntry?.url ?? url.href,
				title: dockEntry?.title || fallbackTitle,
				icon: dockEntry?.icon || 'dashicons-admin-generic',
				submenu: dockEntry?.submenu,
			} );
		},
		true,
	);
}
