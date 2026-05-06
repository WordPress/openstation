/**
 * Desktop Mode — built-in JS openers for the seven file types.
 *
 * Mirrors `includes/desktop-files/built-in-openers.php` — same
 * ids, same labels, same `isDefault` flags. The PHP side ships
 * metadata only; this side carries the actual URL builders so a
 * double-click can resolve to a working iframe window without
 * any plugin code involved.
 *
 * Built around `adminUrl` from the shell config (read via
 * `wp.desktop.config`). The openers register on bundle boot
 * with placeholder URL builders that read `adminUrl` lazily —
 * which means the openers are ready before `wp.desktop.config`
 * exists, and the lookup happens at click time (when the shell
 * is fully booted).
 *
 * @since 0.9.0
 */

import { registerOpener } from './openers';
import type { DesktopFile } from './file';
import { mountFilesLayer } from './layer';
import { mountFolderStatusBar } from './folder-status-bar';

interface ConfigShape {
	adminUrl?: string;
}

function adminBase(): string {
	const cfg = ( window.wp as { desktop?: { config?: ConfigShape } } | undefined )?.desktop?.config;
	const url = cfg?.adminUrl ?? '/wp-admin/';
	return url.endsWith( '/' ) ? url : `${ url }/`;
}

export function registerBuiltInFileOpeners(): void {
	registerOpener( {
		id: 'wp-post-editor',
		label: 'Block Editor',
		types: [ 'post' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'url',
			url: ( file: DesktopFile ) =>
				`${ adminBase() }post.php?post=${ encodeURIComponent( file.ref() ) }&action=edit`,
		},
	} );

	registerOpener( {
		id: 'wp-media-editor',
		label: 'Media editor',
		types: [ 'attachment' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'url',
			url: ( file: DesktopFile ) =>
				`${ adminBase() }post.php?post=${ encodeURIComponent( file.ref() ) }&action=edit`,
		},
	} );

	registerOpener( {
		id: 'wp-user-profile',
		label: 'User profile',
		types: [ 'user' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'url',
			url: ( file: DesktopFile ) =>
				`${ adminBase() }user-edit.php?user_id=${ encodeURIComponent( file.ref() ) }`,
		},
	} );

	registerOpener( {
		id: 'wp-term-editor',
		label: 'Term editor',
		types: [ 'term' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'url',
			url: ( file: DesktopFile ) => {
				const [ taxonomy, termId ] = file.ref().split( ':' );
				return `${ adminBase() }term.php?taxonomy=${ encodeURIComponent( taxonomy ?? '' ) }&tag_ID=${ encodeURIComponent( termId ?? '' ) }`;
			},
		},
	} );

	registerOpener( {
		id: 'wp-comment-editor',
		label: 'Comment editor',
		types: [ 'comment' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'url',
			url: ( file: DesktopFile ) =>
				`${ adminBase() }comment.php?action=editcomment&c=${ encodeURIComponent( file.ref() ) }`,
		},
	} );

	registerOpener( {
		id: 'desktop-mode-folder-window',
		label: 'Open folder',
		types: [ 'folder' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const folderId = parseInt( file.ref(), 10 );
				if ( ! folderId ) {
					return;
				}
				const wm = ( window.wp as { desktop?: { windowManager?: {
					open: ( cfg: Record< string, unknown > ) => unknown;
				} } } | undefined )?.desktop?.windowManager;
				if ( ! wm ) {
					return;
				}
				const id = `desktop-mode-folder-${ folderId }`;
				wm.open( {
					id,
					baseId: id,
					url: `#folder-${ folderId }`,
					title: file.title(),
					icon: file.icon(),
					native: true,
					render: ( body: HTMLElement ) => {
						body.replaceChildren();
						body.classList.add( 'desktop-mode-folder-window' );
						const layerHost = document.createElement( 'div' );
						layerHost.className = 'desktop-mode-folder-window__layer';
						body.appendChild( layerHost );
						mountFilesLayer( layerHost, folderId );
						// Status bar lives at the bottom of the body.
						// Plugins extend it via the
						// `desktop-mode.files.folder-window.status-bar`
						// filter. See `mountFolderStatusBar`.
						mountFolderStatusBar( body, folderId );
					},
					width: 720,
					height: 480,
					minWidth: 360,
					minHeight: 240,
				} );
			},
		},
	} );

	registerOpener( {
		id: 'desktop-mode-shortcut-opener',
		label: 'Open shortcut',
		types: [ 'shortcut' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				// The PHP `serialize()` for shortcut files attaches
				// `shortcutWindow` (registered native window id) or
				// `shortcutUrl`. Cast through `unknown` since the
				// strict `DesktopFileShape` only types the base shape.
				const extras = file.shape as unknown as {
					shortcutWindow?: string;
					shortcutUrl?: string;
				};
				type WpDesktopShape = {
					openWindow?: ( id: string ) => unknown;
					windowManager?: {
						open: ( cfg: Record< string, unknown > ) => unknown;
					};
					config?: { adminUrl?: string };
				};
				const wp = ( window.wp as
					| { desktop?: WpDesktopShape }
					| undefined )?.desktop;
				if ( ! wp ) {
					return;
				}
				if ( extras.shortcutWindow && wp.openWindow ) {
					wp.openWindow( extras.shortcutWindow );
					return;
				}
				if ( extras.shortcutUrl && wp.windowManager ) {
					try {
						const u = new URL( extras.shortcutUrl, window.location.origin );
						if ( u.origin !== window.location.origin ) {
							window.open( u.toString(), '_blank', 'noopener,noreferrer' );
							return;
						}
						const id = `desktop-icon-${ file.ref() }`;
						wp.windowManager.open( {
							id,
							baseId: id,
							url: u.toString(),
							title: file.title(),
							icon: file.icon(),
						} );
					} catch {
						// Malformed URL — silently ignore. The
						// server-side sanitizer rejects invalid URLs
						// at registration so reaching this branch
						// implies a filter mangled it after the fact.
					}
				}
			},
		},
	} );

	registerOpener( {
		id: 'browser-navigate',
		label: 'Open in browser',
		types: [ 'bookmark' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const url = file.ref();
				if ( ! url ) {
					return;
				}
				// `noopener,noreferrer` keeps the third-party tab
				// from reaching back into the desktop via
				// `window.opener` — important since bookmarks
				// can point anywhere.
				window.open( url, '_blank', 'noopener,noreferrer' );
			},
		},
	} );
}
