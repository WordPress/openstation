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
import { renderPlacementPreview, renderPreviewEmpty } from './preview';
import { openEmbedWindow } from './embed-window';

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
				// Visual cue when the viewer is a recipient (not
				// the folder's owner) — append "· Shared" to the
				// title so it's clear this folder is collaborative.
				const folderRow = filesStoreApi.getState().folders.get( folderId );
				const viewerId = Number( window.desktopModeConfig?.currentUserId ?? 0 );
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
								'desktop-mode-folder-window__split';
							bodyHost.appendChild( split );

							const layerHost = document.createElement( 'div' );
							layerHost.className =
								'desktop-mode-folder-window__layer';
							split.appendChild( layerHost );

							const previewPane = document.createElement( 'div' );
							previewPane.className =
								'desktop-mode-folder-window__preview';
							previewPane.appendChild( renderPreviewEmpty() );
							split.appendChild( previewPane );

							const route = routes[ routes.length - 1 ];
							const layer = mountFilesLayer(
								layerHost,
								route.folderId,
							);
							const offSelection = layer.onSelectionChange(
								( placement ) => {
									if ( ! placement ) {
										previewPane.replaceChildren(
											renderPreviewEmpty(),
										);
										return;
									}
									renderPlacementPreview(
										placement,
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
									'.desktop-mode-file-tile',
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
										'.desktop-mode-file-tile__label',
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
							// `<wpd-context-menu>` recipe across every
							// icon canvas in the shell. The folder
							// window also adds "New folder" as an
							// extra entry so users can create sub-
							// folders directly inside the active
							// folder, matching the wallpaper's CMO.
							const menu = attachIconCanvasMenu( layerHost, {
								scope: `desktop-mode-folder:${ route.folderId }`,
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

	registerOpener( {
		id: 'desktop-mode-link-opener',
		label: 'Open in browser',
		types: [ 'link' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const url = file.ref();
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

	// Agent placements — opening one routes into the agent's
	// dossier in My WordPress (auto-opens the window if it's
	// closed). The desktop-mode-my-wordpress native window listens
	// for the `desktop-mode.open-agent` action and navigates.
	registerOpener( {
		id: 'desktop-mode-agent-opener',
		label: 'Open agent dossier',
		types: [ 'agent' ],
		isDefault: true,
		sort: 10,
		handler: {
			kind: 'js',
			open: ( file: DesktopFile ) => {
				const ref = file.ref();
				const agentId = ref ? Number.parseInt( ref, 10 ) : 0;
				if ( ! Number.isFinite( agentId ) || agentId <= 0 ) {
					return;
				}
				// Open the My WordPress window if it isn't, then ask
				// it to navigate into the agent via a doAction the
				// bundle listens for.
				const open = (
					window as unknown as {
						wp?: { desktop?: { openWindow?: ( id: string ) => unknown } };
					}
				).wp?.desktop?.openWindow;
				if ( typeof open === 'function' ) {
					void open( 'desktop-mode-my-wordpress' );
				}
				// The bundle's `desktop-mode.agents.navigate-into`
				// listener (in `src/my-wordpress/index.ts`) handles
				// the route switch — fires on every dispatch, so
				// works whether the window opens fresh or was
				// already mounted.
				const hooks = (
					window as unknown as {
						wp?: { hooks?: { doAction?: ( name: string, payload: unknown ) => void } };
					}
				).wp?.hooks;
				if ( hooks?.doAction ) {
					hooks.doAction( 'desktop-mode.agents.navigate-into', {
						agentId,
						title: file.title(),
					} );
				}
			},
		},
	} );
}
