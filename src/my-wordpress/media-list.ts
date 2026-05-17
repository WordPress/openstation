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
 * @since 0.21.0
 */

import { __, _n, sprintf } from '../i18n';
import { renderStatusBarSegments, type StatusBarSegment } from '../desktop-files/folder-status-bar';
import { applyFilters } from '../hooks';
import type { DragManagerApi } from '../drag';
import type { ShortcutDragData } from '../desktop-files/drag-payloads';
import type { EntityRenderHost } from './kind-registry';
import type { MediaListItem, MyWordPressEntity, MediaPreviewAction } from './types';
import { fetchMediaPage } from './media-rest';
import { getConfig } from './rest';
import { dashiconForMime, renderMediaPreview } from './media-preview';

function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { desktop?: { dragManager?: DragManagerApi } } }
	).wp?.desktop?.dragManager;
	return api ?? null;
}

function stripTags( html: string ): string {
	const div = document.createElement( 'div' );
	div.innerHTML = html;
	return ( div.textContent ?? '' ).trim();
}

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
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className =
		'desktop-mode-my-wordpress__media-tile desktop-mode-file-tile desktop-mode-my-wordpress__tile desktop-mode-my-wordpress__tile--media';
	tile.setAttribute( 'role', 'listitem' );
	tile.dataset.mediaId = String( media.id );
	tile.dataset.mime = media.mime_type;

	const thumbWrap = document.createElement( 'span' );
	thumbWrap.className = 'desktop-mode-my-wordpress__media-tile-thumb';
	thumbWrap.setAttribute( 'aria-hidden', 'true' );

	const sizes = media.media_details?.sizes;
	const thumbUrl =
		media.mime_type.startsWith( 'image/' )
			? (
				sizes?.thumbnail?.source_url ??
					sizes?.medium?.source_url ??
					media.source_url
			)
			: '';
	if ( thumbUrl ) {
		const img = document.createElement( 'img' );
		img.src = thumbUrl;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		thumbWrap.appendChild( img );
	} else {
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ dashiconForMime( media.mime_type ) }`;
		thumbWrap.appendChild( icon );
	}
	tile.appendChild( thumbWrap );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-file-tile__label';
	label.textContent = titleText;
	tile.appendChild( label );

	// Drag-out: the user drops a media tile on the wallpaper / inside
	// a folder window — the `'attachment'` file type already has a
	// server resolver + opener.
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		dragManager.start( {
			payload: {
				type: 'shortcut',
				source: tile,
				data: {
					kind: 'attachment',
					ref: String( media.id ),
					title: titleText,
					icon: dashiconForMime( media.mime_type ),
				} satisfies ShortcutDragData,
				ghost: {
					offsetX: e.clientX - tile.getBoundingClientRect().left,
					offsetY: e.clientY - tile.getBoundingClientRect().top,
				},
			},
			origin: e,
		} );
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

	return tile;
}

function selectTile(
	ctx: MediaListContext,
	tile: HTMLElement,
	media: MediaListItem,
): void {
	if ( ctx.selectedTile ) {
		ctx.selectedTile.classList.remove(
			'desktop-mode-my-wordpress__tile--selected',
		);
	}
	tile.classList.add( 'desktop-mode-my-wordpress__tile--selected' );
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
 * @since 0.21.0
 */
export function renderMediaList(
	host: EntityRenderHost,
	entity: MyWordPressEntity,
): void {
	const cfg = getConfig();

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
	};

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
		try {
			const result = await fetchMediaPage( entity, {
				page: nextPage,
				perPage,
			} );
			ctx.page = nextPage;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			if ( result.items.length === 0 && nextPage === 1 ) {
				renderEmpty( tiles, __( 'No media yet.', 'desktop-mode' ) );
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
			const message =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderEmpty( tiles, message );
			ctx.done = true;
		} finally {
			ctx.loading = false;
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
	}

	paintStatus( ctx );
	void loadMore();
}
