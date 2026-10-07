import { tryNativeUrlRemap } from '../native-url-remap';
import { deriveWindowId } from '../utils';
import { findDockEntryForUrl } from './geometry';
import { INITIAL_ORIGIN } from './origin';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig } from '../types';

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
				if ( typeof console !== 'undefined' ) {
					console.warn(
						'[openstation] Couldn’t parse href; letting the browser handle the click:',
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
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] config.adminUrl is not a valid URL; falling back to /wp-admin/:',
						config.adminUrl,
						err,
					);
				}
				adminPath = '/wp-admin/';
			}
			if ( ! url.pathname.startsWith( adminPath ) ) {
				return;
			}

			if ( /\/(admin-post|admin-ajax)\.php$/.test( url.pathname ) ) {
				return;
			}
			if (
				url.searchParams.has( 'action' ) &&
				url.searchParams.get( 'action' ) === 'logout'
			) {
				return;
			}

			if ( url.searchParams.has( 'desktop_mode_classic' ) ) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			if ( tryNativeUrlRemap( url.href ) ) {
				return;
			}

			const windowId = deriveWindowId( url.href, config.adminUrl );
			const dockEntry = findDockEntryForUrl( url.href, config );

			const declaredTitle = ( anchor.dataset.osWindowTitle || '' ).trim();
			const fallbackTitle =
				( anchor.textContent || '' ).trim() || dockEntry?.title || '';

			const isAdminBarNew = !! anchor.closest( '#wp-admin-bar-new-content' );

			const openOpts = {
				id: windowId,
				baseId: windowId,
				multi: !! dockEntry?.multi || isAdminBarNew,
				url: url.href,
				parentUrl: dockEntry?.url ?? url.href,

				title: declaredTitle || dockEntry?.title || fallbackTitle,
				icon: dockEntry?.icon || 'dashicons-admin-generic',
				submenu: dockEntry?.submenu,
				selfLabel: dockEntry?.selfLabel,
			};

			if ( isAdminBarNew ) {
				void manager.openNew( openOpts );
				return;
			}

			void manager.open( openOpts );
		},
		true,
	);
}
