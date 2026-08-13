/**
 * OpenStation — built-in JS openers for the built-in file types.
 *
 * Mirrors `includes/desktop-files/built-in-openers.php` — same
 * ids, same labels, same `isDefault` flags. The PHP side ships
 * metadata only; this side carries the actual URL builders so a
 * double-click can resolve to a working iframe window without
 * any plugin code involved.
 *
 * Built around `adminUrl` from the shell config (read via
 * `wp.os.config`). The openers register on bundle boot
 * with placeholder URL builders that read `adminUrl` lazily —
 * which means the openers are ready before `wp.os.config`
 * exists, and the lookup happens at click time (when the shell
 * is fully booted).
 */

import { __ } from '../i18n';
import { registerOpener } from './openers';
import type { DesktopFile } from './file';
import { openAgentChatWindow } from '../agents-dispatch';
import { mountFilesLayer } from './layer';
import { mountFolderStatusBar } from './folder-status-bar';
import { attachIconCanvasMenu } from '../icon-canvas/menu';
import {
	renderBreadcrumbs,
	type BreadcrumbSegment,
} from './breadcrumbs';
import { openCreateFolderDialog } from './create-folder-dialog';
import { rest as filesRest, store as filesStoreApi } from './layer-deps';
import {
	buildOccupiedSet,
	GRID_PADDING,
	snapToEmptyCell,
} from './grid';
import {
	renderPlacementPreview,
	renderPreviewEmpty,
	renderSelectionSummary,
} from './preview';
import { openEmbedWindow } from './embed-window';
import { deriveWindowId } from '../utils';
import { tryNativeUrlRemap } from '../native-url-remap';
import { findMenuEntryForUrl } from './menu-entry';
import { navigateToDownload } from './download-nav';

interface ConfigShape {
	adminUrl?: string;
}

function adminBase(): string {
	const cfg = ( window.wp as { os?: { config?: ConfigShape } } | undefined )?.os?.config;
	const url = cfg?.adminUrl ?? '/wp-admin/';
	return url.endsWith( '/' ) ? url : `${ url }/`;
}

/**
 * The server-sanitized URL of a bookmark/link tile, or `''`.
 *
 * The PHP `serialize()` for these types runs the stored ref
 * through `esc_url_raw()` and ships the result as `shape.url` —
 * read that field (like the preview pane does) instead of the
 * raw `ref()`. Re-validate the protocol client-side as well so a
 * shape mangled after the fact can't smuggle a `javascript:` or
 * `data:` URL into `window.open`.
 */
function sanitizedWebUrl( file: DesktopFile ): string {
	const url = typeof file.shape.url === 'string' ? file.shape.url : '';
	if ( ! url ) {
		return '';
	}
	try {
		const parsed = new URL( url, window.location.href );
		if ( parsed.protocol !== 'http:' && parsed.protocol !== 'https:' ) {
			return '';
		}
	} catch {
		return '';
	}
	return url;
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

	// Agent user tiles open the Agent chat, not the profile — the
	// per-file predicate keeps this opener invisible to human users
	// (and to the type-level default-apps settings). Registered
	// before the profile opener so the default-flag scan (sort
	// order) picks it for agents.
	registerOpener( {
		id: 'agent-chat',
		label: __( 'Agent chat', 'desktop-mode' ),
		types: [ 'user' ],
		isDefault: true,
		sort: 5,
		appliesTo: ( file: DesktopFile ) =>
			( file.shape as { isAgent?: boolean } ).isAgent === true,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const shape = file.shape as {
					ref: string;
					title: string;
					previewUrl?: string;
					agentDescription?: string;
				};
				openAgentChatWindow(
					{
						id: Number.parseInt( shape.ref, 10 ),
						name: shape.title,
						description: shape.agentDescription ?? '',
						avatarUrl: shape.previewUrl ?? '',
					},
					'agents-open',
				);
			},
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

	// Uploaded files (real desktop storage): double-click downloads.
	// Preview openers are a follow-up; download is the v1 default.
	registerOpener( {
		id: 'desktop-mode-upload-download',
		label: 'Download',
		types: [ 'upload' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const fileId = parseInt( file.ref(), 10 );
				if ( ! fileId ) {
					return;
				}
				// URL minted at click time — nonces expire.
				navigateToDownload( filesRest.getUploadDownloadUrl( fileId ) );
			},
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
				const wm = ( window.wp as { os?: { windowManager?: {
					open: ( cfg: Record< string, unknown > ) => unknown;
				} } } | undefined )?.os?.windowManager;
				if ( ! wm ) {
					return;
				}
				const id = `os-folder-${ folderId }`;
				// Visual cue when the viewer is a recipient (not
				// the folder's owner) — append "· Shared" to the
				// title so it's clear this folder is collaborative.
				const folderRow = filesStoreApi.getState().folders.get( folderId );
				const viewerId = Number( window.openStationConfig?.currentUserId ?? 0 );
				const isRecipient =
					!! folderRow && folderRow.ownerId > 0 && folderRow.ownerId !== viewerId;
				const baseTitle = file.title();
				const titleWithCue = isRecipient
					? `${ baseTitle } · Shared`
					: baseTitle;
				wm.open( {
					id,
					baseId: id,
					url: `#folder-${ folderId }`,
					title: titleWithCue,
					icon: file.icon(),
					native: true,
					render: ( body: HTMLElement ) => {
						body.replaceChildren();
						body.classList.add( 'desktop-mode-folder-window' );

						// Route stack — breadcrumb history within
						// this single window. Opening a sub-folder
						// pushes; clicking Back pops. Each entry
						// owns its own FilesLayer + status bar mount;
						// transitioning between routes disposes the
						// previous mount cleanly.
						interface FolderRoute {
							folderId: number;
							title: string;
						}
						const routes: FolderRoute[] = [
							{ folderId, title: file.title() },
						];
						let currentDispose: ( () => void ) | null = null;

						// Persistent chrome — breadcrumb header (always
						// visible), split body (rebuilt on navigation),
						// status bar (rebuilt on navigation). The
						// breadcrumb DOM is owned by the shared
						// `renderBreadcrumbs` helper so the folder
						// window paints pixel-identical chrome to
						// every other drill-down surface (My
						// WordPress, future detail dossiers, …).
						const breadcrumbsHost = document.createElement( 'header' );
						body.appendChild( breadcrumbsHost );

						const bodyHost = document.createElement( 'div' );
						bodyHost.style.cssText =
							'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;';
						body.appendChild( bodyHost );

						const paintBreadcrumbs = (): void => {
							const segments: BreadcrumbSegment[] = routes.map(
								( route, idx ) => {
									const isCurrent = idx === routes.length - 1;
									if ( isCurrent ) {
										return { label: route.title };
									}
									return {
										label: route.title,
										onClick: () => {
											routes.length = idx + 1;
											mountCurrent();
										},
									};
								},
							);
							renderBreadcrumbs( breadcrumbsHost, segments, {
								onBack: () => {
									if ( routes.length <= 1 ) {
										return;
									}
									routes.pop();
									mountCurrent();
								},
								backDisabled: routes.length <= 1,
							} );
						};

						/**
						 * Build the body for the current top-of-stack
						 * route. Disposes the previous mount, paints
						 * the two-pane shell + status bar, returns
						 * a teardown the next navigation will call.
						 */
						const mountCurrent = (): void => {
							currentDispose?.();
							currentDispose = null;
							bodyHost.replaceChildren();

							// Two-pane layout — left: tile grid, right:
							// preview pane that reacts to tile selection.
							// Same UX as My WordPress so the experience
							// is unified across folder surfaces.
							const split = document.createElement( 'div' );
							split.className =
								'os-folder-window__split';
							bodyHost.appendChild( split );

							const layerHost = document.createElement( 'div' );
							layerHost.className =
								'os-folder-window__layer';
							split.appendChild( layerHost );

							const previewPane = document.createElement( 'div' );
							previewPane.className =
								'os-folder-window__preview';
							previewPane.appendChild( renderPreviewEmpty() );
							split.appendChild( previewPane );

							const route = routes[ routes.length - 1 ];
							const layer = mountFilesLayer(
								layerHost,
								route.folderId,
							);
							// One subscription for the whole selection —
							// the pane has three states, not two: empty,
							// one item (preview it), several (say so and
							// how they break down by type).
							const offSelection = layer.onSelectionChanged(
								( placements ) => {
									if ( placements.length === 0 ) {
										previewPane.replaceChildren(
											renderPreviewEmpty(),
										);
										return;
									}
									if ( placements.length > 1 ) {
										previewPane.replaceChildren(
											renderSelectionSummary( placements ),
										);
										return;
									}
									renderPlacementPreview(
										placements[ 0 ],
										previewPane,
									);
								},
							);

							// In-place sub-folder navigation — when
							// the user double-clicks a folder tile
							// inside this window, push it onto the
							// breadcrumb stack instead of opening a
							// brand-new window. Listen at the layer
							// container so we see the dblclick before
							// the file-tile's default handler bubbles
							// up to `openFile`.
							const dblClickHandler = ( e: Event ) => {
								if ( ! ( e.target instanceof Element ) ) {
									return;
								}
								const tile = e.target.closest< HTMLElement >(
									'.os-file-tile',
								);
								if ( ! tile ) {
									return;
								}
								if ( tile.dataset.fileType !== 'folder' ) {
									return;
								}
								const subId = parseInt(
									tile.dataset.fileRef ?? '',
									10,
								);
								if ( ! subId ) {
									return;
								}
								// Pre-empt the default open handler.
								e.preventDefault();
								e.stopPropagation();
								const subTitle =
									tile.querySelector< HTMLElement >(
										'.os-file-tile__label',
									)?.textContent ?? `#${ subId }`;
								routes.push( {
									folderId: subId,
									title: subTitle,
								} );
								mountCurrent();
							};
							layerHost.addEventListener(
								'dblclick',
								dblClickHandler,
								true,
							);

							// Same Sort By menu My WordPress uses — one
							// `<os-context-menu>` recipe across every
							// icon canvas in the shell. The folder
							// window also adds "New folder" as an
							// extra entry so users can create sub-
							// folders directly inside the active
							// folder, matching the wallpaper's CMO.
							const menu = attachIconCanvasMenu( layerHost, {
								scope: `os-folder:${ route.folderId }`,
								onSort: ( mode ) => layer.sort( mode ),
								extraItems: [
									{
										id: 'new-folder',
										label: 'New folder',
										icon: 'dashicons-portfolio',
										sort: 5,
										onClick: () => {
											openCreateFolderDialog( {
												onSubmit: async ( name ) => {
													const folder =
														await filesRest.createFolder( {
															name,
														} );
													const peers =
														filesStoreApi
															.getState()
															.placementsByFolder.get(
																route.folderId,
															) ?? [];
													const occupied =
														buildOccupiedSet( peers );
													const cell = snapToEmptyCell(
														GRID_PADDING,
														GRID_PADDING,
														occupied,
														layerHost,
													);
													const placement =
														await filesRest.createPlacement( {
															type: 'folder',
															ref: String( folder.id ),
															parentId: route.folderId,
															x: cell.x,
															y: cell.y,
														} );
													filesStoreApi.upsertFolder( folder );
													filesStoreApi.upsertPlacement(
														placement,
													);
												},
											} );
										},
									},
								],
							} );

							// Status bar — re-mount per route so it
							// reflects the active folder's contents.
							const status = mountFolderStatusBar(
								bodyHost,
								route.folderId,
								{
									selection: {
										count: () =>
											layer.getSelection().length,
										subscribe: ( cb ) =>
											layer.onSelectionChanged( () =>
												cb(),
											),
									},
								},
							);

							currentDispose = (): void => {
								offSelection();
								menu.dispose();
								status.dispose();
								layerHost.removeEventListener(
									'dblclick',
									dblClickHandler,
									true,
								);
								layer.dispose();
							};

							paintBreadcrumbs();
						};

						mountCurrent();
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
				type OpenStationShape = {
					openWindow?: ( id: string ) => unknown;
					windowManager?: {
						open: ( cfg: Record< string, unknown > ) => unknown;
					};
					config?: { adminUrl?: string };
				};
				const wp = ( window.wp as
					| { os?: OpenStationShape }
					| undefined )?.os;
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
						// Let a native window claim the URL first, the
						// same way `Dock.openPage` and the shell's link
						// interceptor do. A shortcut knows only a URL,
						// so without this the Spatial layout's core
						// wallpaper tiles — synthesized from the very
						// dock items the remap registry serves — opened
						// the classic iframe even for a user who had
						// explicitly enabled native Posts, Pages,
						// Comments, Plugins or Users. Same app, two
						// answers, depending on which surface you
						// clicked. The registry's own `enabled` gate
						// reads the live OS Settings snapshot, so a
						// disabled native window still falls through to
						// the iframe path below.
						if ( tryNativeUrlRemap( u.toString() ) ) {
							return;
						}
						// Derive the window id from the URL so this
						// shortcut opens (or focuses) the SAME window
						// the dock and the in-shell link interceptor
						// produce for the same URL. Without this, a
						// dock-promoted shortcut on the wallpaper
						// (`file.ref() === 'dock-promoted:<menu-id>'`)
						// opens window id
						// `desktop-icon-dock-promoted:<menu-id>` while
						// clicking the same app from the dock opens
						// `wp-window-<url-slug>` — two parallel
						// windows with independent minimize/focus
						// state, dock indicator never reflects
						// what's open (since fixed). Falls back to
						// the legacy `desktop-icon-…` id only when
						// adminUrl isn't available (defensive — the
						// shell config should always be present by
						// click time).
						const adminUrl = wp.config?.adminUrl;
						const id = adminUrl
							? deriveWindowId( u.toString(), adminUrl )
							: `desktop-icon-${ file.ref() }`;
						// Enrich with the matching admin-menu entry so
						// the window gets the same submenu tab strip /
						// parent-tab / multi behavior as a dock open.
						// Without this, Spatial-layout core tiles (and
						// any dock-promoted shortcut) opened windows
						// with no tab strip at all.
						const entry = findMenuEntryForUrl( u.toString() );
						wp.windowManager.open( {
							id,
							baseId: id,
							url: u.toString(),
							parentUrl: entry?.url ?? u.toString(),
							title: file.title(),
							icon: file.icon(),
							submenu: entry?.submenu,
							multi: !! entry?.multi,
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
				const url = sanitizedWebUrl( file );
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

	registerOpener( {
		id: 'desktop-mode-link-opener',
		label: 'Open in browser',
		types: [ 'link' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const url = sanitizedWebUrl( file );
				if ( ! url ) {
					return;
				}
				window.open( url, '_blank', 'noopener,noreferrer' );
			},
		},
	} );

	registerOpener( {
		id: 'desktop-mode-embed-opener',
		label: 'Open as window',
		types: [ 'embed' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile, ctx ) => {
				openEmbedWindow( file, ctx );
			},
		},
	} );
}
