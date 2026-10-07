import { __ } from '../i18n';
import { doAction, HOOKS } from '../hooks';
import { registerOpener } from './openers';
import { ensureDeferredStyle } from '../deferred-styles';
import type { DesktopFile } from './file';
import { openAgentChatWindow } from '../agents-dispatch';
import { mountFilesLayer, orderForFolder } from './layer';
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

						ensureDeferredStyle( 'desktop-mode-my-wordpress' );

						interface FolderRoute {
							folderId: number;
							title: string;
						}
						const routes: FolderRoute[] = [
							{ folderId, title: file.title() },
						];
						let currentDispose: ( () => void ) | null = null;

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

						const mountCurrent = (): void => {
							currentDispose?.();
							currentDispose = null;
							bodyHost.replaceChildren();

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
														orderForFolder(
															route.folderId,
														),
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
				const extras = file.shape as unknown as {
					shortcutWindow?: string;
					shortcutUrl?: string;
					shortcutSystemTile?: string;
				};
				type OpenStationShape = {
					openWindow?: ( id: string ) => unknown;
					getSystemTile?: (
						id: string,
					) => { onOpen: () => void } | null;
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

				if ( extras.shortcutSystemTile && wp.getSystemTile ) {
					wp.getSystemTile( extras.shortcutSystemTile )?.onOpen();
					return;
				}

				doAction( HOOKS.DESKTOP_ICON_CLICKED, {
					id: file.shape.ref,
					target: extras.shortcutWindow ? 'window' : 'url',
				} );
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

						if ( tryNativeUrlRemap( u.toString() ) ) {
							return;
						}

						const adminUrl = wp.config?.adminUrl;
						const id = adminUrl
							? deriveWindowId( u.toString(), adminUrl )
							: `desktop-icon-${ file.ref() }`;

						const entry = findMenuEntryForUrl( u.toString() );
						wp.windowManager.open( {
							id,
							baseId: id,
							url: u.toString(),
							parentUrl: entry?.url ?? u.toString(),
							title: file.title(),
							icon: file.icon(),
							submenu: entry?.submenu,
							selfLabel: entry?.selfLabel,
							multi: !! entry?.multi,
						} );
					} catch {

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
