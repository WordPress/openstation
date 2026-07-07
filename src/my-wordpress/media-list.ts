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
 * `desktop-mode.my-wordpress.preview-actions` JS filter (paired with
 * the PHP `desktop_mode_my_wordpress_preview_actions` descriptor).
 *
 * @public
 * @since 0.8.6
 */

import { __, _n, sprintf } from '../i18n';
import { renderStatusBarSegments, type StatusBarSegment } from '../desktop-files/folder-status-bar';
import { addAction, applyFilters, removeAction } from '../hooks';
import { FILE_DROP_HOOKS } from '../os-file-drop/hooks';
import type { DropUploadResult } from '../os-file-drop/types';
import { attachTileDragOut, buildTileFromSpec } from '../desktop-files/tile-spec';
import { wpdConfirm } from '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
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
 *
 * @since 0.8.7
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
	selectedId: number | null;
	selectedTile: HTMLElement | null;
	statusBar: HTMLElement;
	entity: MyWordPressEntity;
	host: EntityRenderHost;
	previewActions: MediaPreviewAction[];
	/** @since 0.8.7 */
	query: string;
	/** @since 0.8.7 */
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

function paintStatus( ctx: MediaListContext ): void {
	const segments: StatusBarSegment[] = [
		{
			id: 'count',
			label: describeCount( ctx ),
			align: 'start',
			sort: 10,
		},
	];
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
		'desktop-mode.my-wordpress.status-bar',
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
			'desktop-mode-my-wordpress__media-tile',
			'desktop-mode-my-wordpress__tile',
			'desktop-mode-my-wordpress__tile--media',
		],
	} );

	attachTileDragOut( tile, {
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
	} );

	tile.addEventListener( 'click', () => selectTile( ctx, tile, media ) );
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
		openMediaTileMenu( ctx, tile, media, titleText, {
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
	onSelect?: ( () => void ) | null;
}

/**
 * Build + position the right-click menu for a media tile. Mirrors
 * `openTileMenu()` in `my-wordpress/index.ts` — same `<wpd-context-menu>`
 * shape, same dismiss handling — so plugin authors only have to learn
 * one pattern.
 */
function openMediaTileMenu(
	ctx: MediaListContext,
	tile: HTMLElement,
	media: MediaListItem,
	titleText: string,
	pos: { x: number; y: number },
): void {
	closeAnyMediaTileMenu();
	selectTile( ctx, tile, media );

	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'desktop-mode-my-wordpress__menu' );
	( menu as HTMLElement ).style.left = `${ pos.x }px`;
	( menu as HTMLElement ).style.top = `${ pos.y }px`;

	const base: MediaTileMenuOption[] = [
		{
			id: 'navigate-into',
			label: __( 'Navigate into', 'desktop-mode' ),
			icon: 'dashicons-category',
		},
		{
			id: 'open-source',
			label: __( 'Open file in new tab', 'desktop-mode' ),
			icon: 'dashicons-external',
		},
		{
			id: 'delete',
			label: __( 'Delete permanently', 'desktop-mode' ),
			icon: 'dashicons-trash',
			danger: true,
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
		'desktop-mode.my-wordpress.tile-context-menu',
		base,
		filterCtx,
	);
	const finalOptions = Array.isArray( options ) ? options : base;

	for ( const o of finalOptions ) {
		const opt = document.createElement( 'wpd-context-menu-option' );
		( opt as HTMLElement ).dataset.menuItemId = o.id;
		opt.setAttribute( 'value', o.id );
		opt.setAttribute( 'icon', o.icon );
		if ( o.danger ) {
			opt.setAttribute( 'danger', '' );
		}
		opt.textContent = o.label;
		menu.appendChild( opt );
	}

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		closeAnyMediaTileMenu();
		if ( detail.id === 'navigate-into' ) {
			ctx.host.navigate( {
				kind: 'media-detail',
				entityId: ctx.entity.id,
				mediaId: media.id,
				mediaTitle: titleText,
			} );
			return;
		}
		if ( detail.id === 'open-source' ) {
			window.open( media.source_url, '_blank', 'noopener,noreferrer' );
			return;
		}
		if ( detail.id === 'delete' ) {
			void confirmDeleteMedia( ctx, tile, media, titleText );
			return;
		}
		const match = finalOptions.find( ( o ) => o.id === detail.id );
		if ( match && typeof match.onSelect === 'function' ) {
			try {
				match.onSelect();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error(
					`[my-wordpress/media] tile-context-menu '${ detail.id }' onSelect threw:`,
					err,
				);
			}
		}
	} );

	document.body.appendChild( menu );
	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		( menu as HTMLElement ).style.left = `${ Math.max(
			0,
			window.innerWidth - rect.width - 8,
		) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		( menu as HTMLElement ).style.top = `${ Math.max(
			0,
			window.innerHeight - rect.height - 8,
		) }px`;
	}

	queueMicrotask( () => {
		const onDocPointerDown = ( ev: PointerEvent ) => {
			if ( ev.target instanceof Node && menu.contains( ev.target ) ) {
				return;
			}
			closeAnyMediaTileMenu();
		};
		const onDocKey = ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Escape' ) {
				closeAnyMediaTileMenu();
			}
		};
		document.addEventListener( 'pointerdown', onDocPointerDown, true );
		document.addEventListener( 'keydown', onDocKey );
		menu.addEventListener( 'tile-menu-closed', () => {
			document.removeEventListener(
				'pointerdown',
				onDocPointerDown,
				true,
			);
			document.removeEventListener( 'keydown', onDocKey );
		} );
	} );
}

function closeAnyMediaTileMenu(): void {
	document
		.querySelectorAll( 'wpd-context-menu.desktop-mode-my-wordpress__menu' )
		.forEach( ( n ) => {
			n.dispatchEvent( new CustomEvent( 'tile-menu-closed' ) );
			n.remove();
		} );
}

async function confirmDeleteMedia(
	ctx: MediaListContext,
	tile: HTMLElement,
	media: MediaListItem,
	titleText: string,
): Promise< void > {
	const ok = await wpdConfirm( {
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
		removeMediaFromList( ctx, tile, media.id );
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
		placeholder.className = 'desktop-mode-my-wordpress__preview-empty';
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

function selectTile(
	ctx: MediaListContext,
	tile: HTMLElement,
	media: MediaListItem,
): void {
	// Selected state lives on the `selected` attribute — `<wpd-tile>`
	// derives the `--selected` class from it on every `_paint()`.
	// Toggling the class directly would be wiped out by the next
	// repaint (label edit, thumbnail swap, hover-title toggle…).
	if ( ctx.selectedTile ) {
		ctx.selectedTile.removeAttribute( 'selected' );
	}
	tile.setAttribute( 'selected', '' );
	ctx.selectedTile = tile;
	ctx.selectedId = media.id;

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
	empty.className = 'desktop-mode-my-wordpress__empty';
	empty.textContent = message;
	host.appendChild( empty );
}

/**
 * Paint the Media browse view into `host.body`.
 *
 * @public
 * @since 0.8.6
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
		'desktop-mode-my-wordpress__split desktop-mode-my-wordpress__split--media';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list';

	const tiles = document.createElement( 'div' );
	tiles.className =
		'desktop-mode-my-wordpress__media-grid';
	tiles.setAttribute( 'role', 'list' );
	left.appendChild( tiles );

	const sentinel = document.createElement( 'div' );
	sentinel.className = 'desktop-mode-my-wordpress__sentinel';
	sentinel.setAttribute( 'aria-hidden', 'true' );
	left.appendChild( sentinel );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__preview';
	const previewEmpty = document.createElement( 'div' );
	previewEmpty.className = 'desktop-mode-my-wordpress__preview-empty';
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
			.closest( '[data-desktop-mode-my-wordpress-root]' )
			?.querySelector< HTMLElement >(
				'[data-desktop-mode-my-wordpress-status]',
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
		statusBar,
		entity,
		host,
		previewActions: cfg.previewActions ?? [],
		query: initialQuery,
		abort: null,
	};
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
			'desktop-mode-my-wordpress__media-grid--searching',
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
				'desktop-mode-my-wordpress__media-grid--searching',
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
				'desktop-mode-my-wordpress__preview-empty';
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
				'desktop-mode-my-wordpress__media-grid--searching',
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
			`wpd-tile[data-media-id="${ mediaId }"]`,
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
