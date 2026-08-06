/**
 * My WordPress — Media browse view.
 *
 * Two-pane layout: a CSS Grid of thumbnail tiles on the left, a
 * type-aware preview pane on the right. Newest-first, paged via
 * IntersectionObserver. Each tile is a drag source (`kind:
 * 'attachment'`); the section never accepts drops — the window-
 * level reject claimant set up by `renderInto()` handles that.
 *
 * Plugins extend the right pane via the
 * `os.my-wordpress.preview-actions` JS filter (paired with
 * the PHP `openstation_my_wordpress_preview_actions` descriptor).
 *
 * @public
 */

import { __, _n, sprintf } from '../i18n';
import { renderStatusBarSegments, type StatusBarSegment } from '../desktop-files/folder-status-bar';
import { addAction, applyFilters, removeAction } from '../hooks';
import { FILE_DROP_HOOKS } from '../os-file-drop/hooks';
import type { DropUploadResult } from '../os-file-drop/types';
import { attachTileDragOut, buildTileFromSpec } from '../desktop-files/tile-spec';
import {
	attachSelection,
	closeActionMenu,
	openActionMenu,
	resolveCommonActions,
	type SelectionAction,
	type SelectionHandle,
} from '../selection';
import { copyLinksAction, mediaBulkActions } from './bulk-actions';
import { osConfirm } from '../ui/components/os-confirm-dialog/os-confirm-dialog';
import { showToast } from '../toast';
import type { EntityRenderHost } from './kind-registry';
import { renderListToolbar } from './list-toolbar';
import type { MediaListItem, MyWordPressEntity, MediaPreviewAction } from './types';
import { deleteMediaItem, fetchMediaItem, fetchMediaPage } from './media-rest';
import { getConfig } from './rest';
import { dashiconForMime, renderMediaPreview } from './media-preview';
import { stripTags } from './dom-utils';

/**
 * Per-window media search query memory. Survives a media-detail
 * drill-and-back round-trip so the user doesn't lose their filter.
 * Lives in module scope but is keyed by entity id — switching from
 * Media to a different entity clears the field, which is the
 * intentional UX for "fresh field per entity".
 */
const lastQueryByMediaEntity = new Map< string, string >();

interface MediaListContext {
	page: number;
	totalPages: number;
	total: number;
	loaded: number;
	loading: boolean;
	done: boolean;
	tiles: HTMLElement;
	sentinel: HTMLElement;
	preview: HTMLElement;
	/** Id of the ONE selected item, or null for none / several. */
	selectedId: number | null;
	selectedTile: HTMLElement | null;
	/** Multi-selection controller for the media grid. */
	selection: SelectionHandle | null;
	/** Every rendered item, by id — the menu builds actions from these. */
	itemsById: Map< number, MediaListItem >;
	statusBar: HTMLElement;
	entity: MyWordPressEntity;
	host: EntityRenderHost;
	previewActions: MediaPreviewAction[];
	query: string;
	abort: AbortController | null;
}

function describeCount( ctx: MediaListContext ): string {
	if ( ctx.total === 0 && ctx.loaded === 0 ) {
		return __( 'No media yet.', 'desktop-mode' );
	}
	if ( ctx.total > ctx.loaded && ctx.loaded > 0 ) {
		return sprintf(
			// translators: 1: visible item count, 2: total item count.
			__( '%1$d of %2$d items', 'desktop-mode' ),
			ctx.loaded,
			ctx.total,
		);
	}
	const n = Math.max( ctx.total, ctx.loaded );
	return sprintf(
		// translators: %d is a count of media items.
		_n( '%d item', '%d items', n ),
		n,
	);
}

/**
 * Right pane with nothing — or several things — selected. A media
 * preview is about one file; a set gets a count instead.
 */
function renderMediaPreviewEmpty( selectedCount: number ): HTMLElement {
	const empty = document.createElement( 'div' );
	empty.className = 'os-my-wordpress__preview-empty';
	empty.textContent =
		selectedCount > 1
			? sprintf(
				// translators: %d: number of selected media items.
				__( '%d files selected', 'desktop-mode' ),
				selectedCount,
			)
			: __( 'Select a media item to preview it here.', 'desktop-mode' );
	return empty;
}

function paintStatus( ctx: MediaListContext ): void {
	const selectedCount = ctx.selection?.keys().length ?? 0;
	const segments: StatusBarSegment[] = [
		{
			id: 'count',
			label: describeCount( ctx ),
			align: 'start',
			sort: 10,
		},
	];
	if ( selectedCount > 0 ) {
		segments.push( {
			id: 'selection',
			label: sprintf(
				// translators: %d: number of selected media items.
				__( '%d selected', 'desktop-mode' ),
				selectedCount,
			),
			align: 'end',
			sort: 5,
		} );
	}
	if ( ctx.totalPages > 1 ) {
		segments.push( {
			id: 'page',
			label: sprintf(
				// translators: 1: current page, 2: total pages.
				__( 'Page %1$d of %2$d', 'desktop-mode' ),
				Math.max( ctx.page, 1 ),
				ctx.totalPages,
			),
			align: 'end',
			sort: 10,
		} );
	}
	const filtered = applyFilters<
		StatusBarSegment[],
		[ { view: 'list'; entityId: string } ]
	>(
		'os.my-wordpress.status-bar',
		segments,
		{ view: 'list', entityId: ctx.entity.id },
	);
	renderStatusBarSegments(
		ctx.statusBar,
		Array.isArray( filtered ) ? filtered : segments,
	);
}

function buildMediaTile(
	ctx: MediaListContext,
	media: MediaListItem,
): HTMLElement {
	const titleText =
		stripTags( media.title.rendered ) || __( '(no title)', 'desktop-mode' );

	const sizes = media.media_details?.sizes;
	const thumbUrl = media.mime_type.startsWith( 'image/' )
		? ( sizes?.thumbnail?.source_url ??
			sizes?.medium?.source_url ??
			media.source_url )
		: '';

	const tile = buildTileFromSpec( {
		type: 'attachment',
		ref: String( media.id ),
		label: titleText,
		thumbnail: thumbUrl || undefined,
		icon: thumbUrl ? undefined : dashiconForMime( media.mime_type ),
		role: 'entry',
		dataset: { mediaId: media.id, mime: media.mime_type },
		extraClasses: [
			'os-my-wordpress__media-tile',
			'os-my-wordpress__tile',
			'os-my-wordpress__tile--media',
		],
	} );

	attachTileDragOut(
		tile,
		{
			kind: 'attachment',
			ref: String( media.id ),
			title: titleText,
			icon: dashiconForMime( media.mime_type ),
			// Cross-frame bridge payload — lets the Gutenberg drop-
			// receiver build a `core/image` / `core/video` / `core/audio`
			// / `core/file` block when this tile is dropped on an open
			// editor iframe. The full-size source URL is the right block
			// attribute regardless of mime; the receiver picks the
			// concrete block from the MIME prefix.
			bridgePayload: {
				kind: 'attachment',
				id: media.id,
				url: media.source_url,
				title: titleText,
				alt: stripTags( media.alt_text ?? '' ),
				mime: media.mime_type,
				thumbnailUrl: thumbUrl || undefined,
				sizes: media.media_details?.sizes,
			},
		},
		undefined,
		{
			// Multi-drag: drop a selection of files on a folder and
			// every one of them is filed.
			resolveSet: () => {
				const keys = ctx.selection?.keys() ?? [];
				if ( keys.length < 2 ) {
					return [];
				}
				return keys
					.map( ( key ) => ctx.itemsById.get( Number( key ) ) )
					.filter( ( m ): m is MediaListItem => !! m )
					.map( ( m ) => ( {
						kind: 'attachment',
						ref: String( m.id ),
						title:
							stripTags( m.title.rendered ) ||
							__( '(no title)', 'desktop-mode' ),
						icon: dashiconForMime( m.mime_type ),
						entityId: ctx.entity.id,
						bridgePayload: {
							kind: 'attachment' as const,
							id: m.id,
							url: m.source_url,
							title:
								stripTags( m.title.rendered ) ||
								__( '(no title)', 'desktop-mode' ),
							alt: stripTags( m.alt_text ?? '' ),
							mime: m.mime_type,
							sizes: m.media_details?.sizes,
						},
					} ) );
			},
		},
	);

	// Selection is the controller's job; the tile only registers its
	// shape so a multi-selection menu can build actions for it.
	ctx.itemsById.set( media.id, media );
	tile.dataset.mediaId = String( media.id );
	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		ctx.host.navigate( {
			kind: 'media-detail',
			entityId: ctx.entity.id,
			mediaId: media.id,
			mediaTitle: titleText,
		} );
	} );

	tile.addEventListener( 'contextmenu', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		// Finder rule: right-clicking outside the selection replaces
		// it; inside it, the set stands and the menu acts on all of it.
		if ( ! ctx.selection?.model.has( String( media.id ) ) ) {
			ctx.selection?.model.set( [ String( media.id ) ] );
		}
		openMediaTileMenu( ctx, media, {
			x: ( e as MouseEvent ).clientX,
			y: ( e as MouseEvent ).clientY,
		} );
	} );

	return tile;
}

interface MediaTileMenuOption {
	id: string;
	label: string;
	icon: string;
	danger?: boolean;
	/** Lower sorts first. Only consulted for a multi-selection. */
	sort?: number;
	multi?: boolean;
	bulkLabel?: ( count: number ) => string;
	onSelect?: ( () => void ) | null;
}

/**
 * Actions for ONE media item, with the shared
 * `os.my-wordpress.tile-context-menu` filter applied (kind
 * `'attachment'`). `resolveCommonActions` calls this once per
 * selected tile and intersects the results.
 *
 * "Open file in new tab" is deliberately single-item: browsers block
 * a burst of `window.open` calls as a popup storm, so a multi-item
 * version would silently open one file and drop the rest.
 */
function buildMediaActions(
	ctx: MediaListContext,
	media: MediaListItem,
	titleText: string,
): SelectionAction< MediaListItem >[] {
	const base: MediaTileMenuOption[] = [
		{
			id: 'navigate-into',
			label: __( 'Navigate into', 'desktop-mode' ),
			icon: 'dashicons-category',
			sort: 10,
		},
		{
			id: 'open-source',
			label: __( 'Open file in new tab', 'desktop-mode' ),
			icon: 'dashicons-external',
			sort: 20,
		},
		{
			id: 'delete',
			label: __( 'Delete permanently', 'desktop-mode' ),
			icon: 'dashicons-trash',
			sort: 90,
			danger: true,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					// translators: %d: number of selected media items.
					__( 'Delete %d files permanently', 'desktop-mode' ),
					n,
				),
		},
	];

	const filterCtx = {
		entityId: ctx.entity.id,
		kind: 'attachment' as const,
		item: media as unknown as Record< string, unknown >,
	};
	const options = applyFilters<
		MediaTileMenuOption[],
		[ typeof filterCtx ]
	>(
		'os.my-wordpress.tile-context-menu',
		base,
		filterCtx,
	);
	const finalOptions = Array.isArray( options ) ? options : base;

	// Core's own media row actions that survive a set — Detach, plus
	// the shared "Copy link". Built apart from `finalOptions` because
	// they carry closures and batched runners.
	const extras: SelectionAction< MediaListItem >[] = [
		...mediaBulkActions(
			{
				onChanged: ( ids ) => {
					// Detach doesn't remove the tile, but it changes
					// what the preview says about the file.
					for ( const id of ids ) {
						const item = ctx.itemsById.get( id );
						if ( item ) {
							item.post = 0;
						}
					}
					const selected = ctx.selection?.keys() ?? [];
					if ( selected.length === 1 ) {
						const item = ctx.itemsById.get(
							Number( selected[ 0 ] ),
						);
						if ( item ) {
							previewSelectedMedia( ctx, item );
						}
					}
				},
			},
			media,
		),
		copyLinksAction(
			media,
			( m ) => m.source_url,
			__( 'Copy file URL', 'desktop-mode' ),
		),
	];

	const mapped = finalOptions.map( ( option ) => {
		const action: SelectionAction< MediaListItem > = {
			id: option.id,
			label: option.label,
			icon: option.icon,
			sort: option.sort,
			danger: option.danger,
			multi: option.multi,
			bulkLabel: option.bulkLabel,
			onClick: () => {
				if ( option.id === 'navigate-into' ) {
					ctx.host.navigate( {
						kind: 'media-detail',
						entityId: ctx.entity.id,
						mediaId: media.id,
						mediaTitle: titleText,
					} );
					return;
				}
				if ( option.id === 'open-source' ) {
					window.open(
						media.source_url,
						'_blank',
						'noopener,noreferrer',
					);
					return;
				}
				if ( option.id === 'delete' ) {
					void confirmDeleteMedia( ctx, media, titleText );
					return;
				}
				if ( typeof option.onSelect === 'function' ) {
					try {
						option.onSelect();
					} catch ( err ) {
						// eslint-disable-next-line no-console
						console.error(
							`[my-wordpress/media] tile-context-menu '${ option.id }' onSelect threw:`,
							err,
						);
					}
				}
			},
		};
		if ( option.id === 'delete' ) {
			action.bulk = ( items ) => deleteManyMedia( ctx, items );
		}
		return action;
	} );

	return [ ...mapped, ...extras ].sort( ( a, b ) => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		return sa - sb;
	} );
}

/** Open the media context menu for the current selection. */
function openMediaTileMenu(
	ctx: MediaListContext,
	media: MediaListItem,
	pos: { x: number; y: number },
): void {
	closeAnyMediaTileMenu();

	const ids = ( ctx.selection?.keys() ?? [] )
		.map( ( k ) => parseInt( k, 10 ) )
		.filter( ( n ) => Number.isFinite( n ) );
	const targets = ids
		.map( ( id ) => ctx.itemsById.get( id ) )
		.filter( ( m ): m is MediaListItem => !! m );
	const items = targets.length > 0 ? targets : [ media ];

	const actions = resolveCommonActions( items, ( item ) =>
		buildMediaActions(
			ctx,
			item,
			stripTags( item.title.rendered ) ||
				__( '(no title)', 'desktop-mode' ),
		),
	);

	openActionMenu( pos, {
		actions,
		className: 'os-my-wordpress__menu',
		scope: 'my-wordpress.media-tile',
		dataset: { mediaIds: items.map( ( m ) => m.id ).join( ',' ) },
	} );
}

function closeAnyMediaTileMenu(): void {
	closeActionMenu();
	document
		.querySelectorAll( 'os-context-menu.os-my-wordpress__menu' )
		.forEach( ( n ) => {
			n.dispatchEvent( new CustomEvent( 'tile-menu-closed' ) );
			n.remove();
		} );
}

/**
 * Delete several media items as one action: one confirm, parallel
 * REST, one toast. Permanent deletion has no Undo, which is exactly
 * why it must not ask N times — a user clicking through N dialogs
 * stops reading them by the third.
 */
async function deleteManyMedia(
	ctx: MediaListContext,
	items: readonly MediaListItem[],
): Promise< void > {
	const ok = await osConfirm( {
		title: __( 'Delete media?', 'desktop-mode' ),
		message: sprintf(
			// translators: %d: number of selected media items.
			__(
				'%d files will be permanently deleted. This cannot be undone.',
				'desktop-mode',
			),
			items.length,
		),
		confirmLabel: __( 'Delete', 'desktop-mode' ),
		cancelLabel: __( 'Cancel', 'desktop-mode' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}

	const results = await Promise.allSettled(
		items.map( ( item ) => deleteMediaItem( item.id ) ),
	);
	let deleted = 0;
	let failed = 0;
	results.forEach( ( result, index ) => {
		if ( result.status === 'fulfilled' ) {
			deleted += 1;
			const tile = ctx.tiles.querySelector< HTMLElement >(
				`[data-media-id="${ items[ index ].id }"]`,
			);
			if ( tile ) {
				removeMediaFromList( ctx, tile, items[ index ].id );
			}
		} else {
			failed += 1;
		}
	} );
	ctx.selection?.refresh();

	showToast( {
		message:
			failed > 0
				? sprintf(
					// translators: 1: number deleted, 2: number that failed.
					__(
						'%1$d files deleted · %2$d could not be deleted',
						'desktop-mode',
					),
					deleted,
					failed,
				)
				: sprintf(
					// translators: %d: number of files deleted.
					__( '%d files deleted.', 'desktop-mode' ),
					deleted,
				),
	} );
}

async function confirmDeleteMedia(
	ctx: MediaListContext,
	media: MediaListItem,
	titleText: string,
): Promise< void > {
	const ok = await osConfirm( {
		title: __( 'Delete media?', 'desktop-mode' ),
		message: sprintf(
			// translators: %s is a media item title.
			__( '“%s” will be permanently deleted. This cannot be undone.', 'desktop-mode' ),
			titleText,
		),
		confirmLabel: __( 'Delete', 'desktop-mode' ),
		cancelLabel: __( 'Cancel', 'desktop-mode' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}
	try {
		await deleteMediaItem( media.id );
		const tile = ctx.tiles.querySelector< HTMLElement >(
			`[data-media-id="${ media.id }"]`,
		);
		if ( tile ) {
			removeMediaFromList( ctx, tile, media.id );
		}
		ctx.selection?.refresh();
		showToast( { message: __( 'Media deleted.', 'desktop-mode' ) } );
	} catch ( err ) {
		const message =
			err instanceof Error
				? err.message
				: __( 'Couldn’t delete that file.', 'desktop-mode' );
		showToast( { message } );
	}
}

function removeMediaFromList(
	ctx: MediaListContext,
	tile: HTMLElement,
	mediaId: number,
): void {
	tile.remove();
	if ( ctx.selectedId === mediaId ) {
		ctx.selectedId = null;
		ctx.selectedTile = null;
		// Restore the "select a media item" placeholder.
		ctx.preview.replaceChildren();
		const placeholder = document.createElement( 'div' );
		placeholder.className = 'os-my-wordpress__preview-empty';
		placeholder.textContent = __(
			'Select a media item to preview it here.',
			'desktop-mode',
		);
		ctx.preview.appendChild( placeholder );
	}
	ctx.loaded = Math.max( 0, ctx.loaded - 1 );
	ctx.total = Math.max( 0, ctx.total - 1 );
	paintStatus( ctx );
}

/**
 * Paint the right pane for the ONE selected media item. Selection
 * itself (and the `selected` attribute on tiles) belongs to the
 * controller; this is only the preview half.
 */
function previewSelectedMedia(
	ctx: MediaListContext,
	media: MediaListItem,
): void {
	const titleText =
		stripTags( media.title.rendered ) || __( '(no title)', 'desktop-mode' );
	renderMediaPreview( ctx.preview, media, {
		entityId: ctx.entity.id,
		previewActions: ctx.previewActions,
		onOpenDetail: () => {
			ctx.host.navigate( {
				kind: 'media-detail',
				entityId: ctx.entity.id,
				mediaId: media.id,
				mediaTitle: titleText,
			} );
		},
	} );
}

function renderEmpty( host: HTMLElement, message: string ): void {
	const empty = document.createElement( 'div' );
	empty.className = 'os-my-wordpress__empty';
	empty.textContent = message;
	host.appendChild( empty );
}

/**
 * Paint the Media browse view into `host.body`.
 *
 * @public
 */
export function renderMediaList(
	host: EntityRenderHost,
	entity: MyWordPressEntity,
): void {
	const cfg = getConfig();
	const initialQuery = lastQueryByMediaEntity.get( entity.id ) ?? '';

	const toolbar = renderListToolbar( {
		placeholder: __( 'Search media…', 'desktop-mode' ),
		ariaLabel: __( 'Search media', 'desktop-mode' ),
		initialValue: initialQuery,
		onSearchChange: ( q ) => {
			lastQueryByMediaEntity.set( entity.id, q );
			void resetForSearch( q );
		},
	} );
	host.body.appendChild( toolbar.host );
	host.addTeardown( () => toolbar.destroy() );

	const split = document.createElement( 'div' );
	split.className =
		'os-my-wordpress__split os-my-wordpress__split--media';

	const left = document.createElement( 'div' );
	left.className = 'os-my-wordpress__list';

	const tiles = document.createElement( 'div' );
	tiles.className =
		'os-my-wordpress__media-grid';
	tiles.setAttribute( 'role', 'list' );
	left.appendChild( tiles );

	const sentinel = document.createElement( 'div' );
	sentinel.className = 'os-my-wordpress__sentinel';
	sentinel.setAttribute( 'aria-hidden', 'true' );
	left.appendChild( sentinel );

	const right = document.createElement( 'div' );
	right.className = 'os-my-wordpress__preview';
	const previewEmpty = document.createElement( 'div' );
	previewEmpty.className = 'os-my-wordpress__preview-empty';
	previewEmpty.textContent = __(
		'Select a media item to preview it here.',
		'desktop-mode',
	);
	right.appendChild( previewEmpty );

	split.append( left, right );
	host.body.appendChild( split );

	// Locate the window status bar (mounted by the host) so we can
	// repaint it as pages load. If absent (test harness, custom
	// chrome), paint into a detached element — `renderStatusBarSegments`
	// tolerates a host that isn't in the DOM.
	const statusBar =
		host.body
			.closest( '[data-os-my-wordpress-root]' )
			?.querySelector< HTMLElement >(
				'[data-os-my-wordpress-status]',
			) ?? document.createElement( 'div' );

	const ctx: MediaListContext = {
		page: 0,
		totalPages: 1,
		total: 0,
		loaded: 0,
		loading: false,
		done: false,
		tiles,
		sentinel,
		preview: right,
		selectedId: null,
		selectedTile: null,
		selection: null,
		itemsById: new Map(),
		statusBar,
		entity,
		host,
		previewActions: cfg.previewActions ?? [],
		query: initialQuery,
		abort: null,
	};

	ctx.selection = attachSelection( tiles, {
		background: left,
		surface: 'my-wordpress',
		scope: entity.id,
		keyOf: ( el ) => el.dataset.mediaId ?? null,
		onChange: ( keys ) => {
			const ids = keys
				.map( ( k ) => parseInt( k, 10 ) )
				.filter( ( n ) => Number.isFinite( n ) );
			ctx.selectedId = ids.length === 1 ? ids[ 0 ] : null;
			ctx.selectedTile =
				ids.length === 1
					? ctx.selection?.elementFor( String( ids[ 0 ] ) ) ?? null
					: null;
			if ( ids.length === 1 ) {
				const media = ctx.itemsById.get( ids[ 0 ] );
				if ( media ) {
					previewSelectedMedia( ctx, media );
				}
			} else {
				ctx.preview.replaceChildren(
					renderMediaPreviewEmpty( ids.length ),
				);
			}
			paintStatus( ctx );
		},
	} );
	host.addTeardown( () => ctx.selection?.destroy() );
	host.addTeardown( () => ctx.abort?.abort() );

	const sentinelIsVisible = (): boolean => {
		const sr = sentinel.getBoundingClientRect();
		const rr = left.getBoundingClientRect();
		const slack = 200;
		return sr.top < rr.bottom + slack && sr.bottom > rr.top - slack;
	};

	const loadMore = async () => {
		if ( ctx.loading || ctx.done ) {
			return;
		}
		ctx.loading = true;
		const nextPage = ctx.page + 1;
		const perPage = cfg.mediaPerPage ?? 48;
		const queryAtFetchTime = ctx.query;
		const controller = new AbortController();
		ctx.abort = controller;
		try {
			const result = await fetchMediaPage( entity, {
				page: nextPage,
				perPage,
				search: queryAtFetchTime || undefined,
				signal: controller.signal,
			} );
			if ( ctx.query !== queryAtFetchTime ) {
				return;
			}
			ctx.page = nextPage;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			if ( result.items.length === 0 && nextPage === 1 ) {
				renderEmpty(
					tiles,
					queryAtFetchTime
						? sprintf(
							// translators: %s is the user-entered search query.
							__( 'No media match "%s".', 'desktop-mode' ),
							queryAtFetchTime,
						)
						: __( 'No media yet.', 'desktop-mode' ),
				);
				ctx.done = true;
				paintStatus( ctx );
				return;
			}
			for ( const item of result.items ) {
				tiles.appendChild( buildMediaTile( ctx, item ) );
				ctx.loaded += 1;
			}
			if ( ctx.page >= ctx.totalPages ) {
				ctx.done = true;
			}
			paintStatus( ctx );
		} catch ( err ) {
			if ( err instanceof DOMException && err.name === 'AbortError' ) {
				return;
			}
			const message =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderEmpty( tiles, message );
			ctx.done = true;
		} finally {
			ctx.loading = false;
			if ( ctx.abort === controller ) {
				ctx.abort = null;
			}
		}
		if ( ! ctx.done ) {
			requestAnimationFrame( () => {
				if ( sentinelIsVisible() ) {
					void loadMore();
				}
			} );
		}
	};

	const resetForSearch = async ( q: string ): Promise< void > => {
		// Keep the previous results visible (dimmed via the
		// `--searching` class) until the new page lands, then swap
		// atomically. See `renderEntityList.resetForSearch` for the
		// full rationale — same fix shape applied here.
		ctx.abort?.abort();
		ctx.abort = null;
		ctx.query = q;

		tiles.classList.add(
			'os-my-wordpress__media-grid--searching',
		);

		const controller = new AbortController();
		ctx.abort = controller;
		ctx.loading = true;
		const perPage = cfg.mediaPerPage ?? 48;

		try {
			const result = await fetchMediaPage( entity, {
				page: 1,
				perPage,
				search: q || undefined,
				signal: controller.signal,
			} );
			if ( ctx.query !== q ) {
				return;
			}

			tiles.replaceChildren();
			tiles.classList.remove(
				'os-my-wordpress__media-grid--searching',
			);

			ctx.page = 1;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			ctx.loaded = 0;
			ctx.done = ctx.page >= ctx.totalPages;
			ctx.selectedId = null;
			ctx.selectedTile = null;
			ctx.preview.replaceChildren();
			const emptyPreview = document.createElement( 'div' );
			emptyPreview.className =
				'os-my-wordpress__preview-empty';
			emptyPreview.textContent = __(
				'Select a media item to preview it here.',
				'desktop-mode',
			);
			ctx.preview.appendChild( emptyPreview );

			if ( result.items.length === 0 ) {
				renderEmpty(
					tiles,
					q
						? sprintf(
							// translators: %s is the user-entered search query.
							__( 'No media match "%s".', 'desktop-mode' ),
							q,
						)
						: __( 'No media yet.', 'desktop-mode' ),
				);
				ctx.done = true;
			} else {
				for ( const item of result.items ) {
					tiles.appendChild( buildMediaTile( ctx, item ) );
					ctx.loaded += 1;
				}
			}
			paintStatus( ctx );
		} catch ( err ) {
			if ( err instanceof DOMException && err.name === 'AbortError' ) {
				return;
			}
			tiles.classList.remove(
				'os-my-wordpress__media-grid--searching',
			);
			tiles.replaceChildren();
			const message =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderEmpty( tiles, message );
			ctx.done = true;
		} finally {
			ctx.loading = false;
			if ( ctx.abort === controller ) {
				ctx.abort = null;
			}
		}

		if ( ! ctx.done ) {
			requestAnimationFrame( () => {
				if ( sentinelIsVisible() ) {
					void loadMore();
				}
			} );
		}
	};

	if ( typeof IntersectionObserver !== 'undefined' ) {
		const observer = new IntersectionObserver(
			( entries ) => {
				for ( const e of entries ) {
					if ( e.isIntersecting ) {
						void loadMore();
					}
				}
			},
			{ root: left, rootMargin: '200px 0px' },
		);
		observer.observe( sentinel );
		host.addTeardown( () => observer.disconnect() );
	} else {
		// Graceful fallback for environments without
		// IntersectionObserver (very old browsers, some test
		// harnesses). A scroll-driven check keeps infinite scroll
		// working — measurably less efficient, but better than
		// page-1-only.
		const onScroll = () => {
			if ( sentinelIsVisible() ) {
				void loadMore();
			}
		};
		left.addEventListener( 'scroll', onScroll, { passive: true } );
		host.addTeardown( () => left.removeEventListener( 'scroll', onScroll ) );
	}

	// Live-refresh — fold freshly-uploaded attachments into the grid
	// as the OS-drop manager finishes them. We do this by id (single
	// REST GET) so the visible page-1 set + scroll position are kept
	// intact. Subscribers added per renderMediaList() call are torn
	// down when the host unmounts so a closed window stops listening.
	const liveNs = `desktop-mode/my-wordpress-media-live-${ Math.random()
		.toString( 36 )
		.slice( 2, 8 ) }`;
	addAction<
		[
			{
				file: File;
				result: DropUploadResult;
				fields: { filename: string };
				context: unknown;
			},
		]
	>( FILE_DROP_HOOKS.AFTER_UPLOAD, liveNs, ( payload ) => {
		void spliceNewMedia( ctx, payload.result.id );
	} );
	host.addTeardown( () =>
		removeAction( FILE_DROP_HOOKS.AFTER_UPLOAD, liveNs ),
	);
	host.addTeardown( () => closeAnyMediaTileMenu() );

	paintStatus( ctx );
	void loadMore();
}

/**
 * Fetch and prepend a freshly-uploaded attachment. If we already
 * have a tile for that id (rare — e.g. a second AFTER_UPLOAD fires
 * for the same item via a plugin), the duplicate is ignored.
 */
async function spliceNewMedia(
	ctx: MediaListContext,
	mediaId: number,
): Promise< void > {
	if ( ! ctx.tiles.isConnected ) {
		return;
	}
	if (
		ctx.tiles.querySelector(
			`os-tile[data-media-id="${ mediaId }"]`,
		)
	) {
		return;
	}
	try {
		const item = await fetchMediaItem( mediaId );
		// The newest item belongs at the top of the grid; insertBefore
		// against `firstChild` is the cheap way to prepend.
		ctx.tiles.insertBefore( buildMediaTile( ctx, item ), ctx.tiles.firstChild );
		ctx.loaded += 1;
		ctx.total += 1;
		paintStatus( ctx );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[my-wordpress/media] live-refresh fetch failed:',
			err,
		);
	}
}
