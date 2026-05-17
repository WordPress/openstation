/**
 * My WordPress — Media drill-in view.
 *
 * Triggered by double-clicking a media tile (or clicking "See where
 * this is used" in the preview pane). Fetches
 * `/desktop-mode/v1/media-usage/<id>` and renders one tile per
 * referencing post/page/CPT, grouped by post type. The right pane
 * stays type-aware (preview of the media on top + a list of the
 * selected referrer).
 *
 * Nothing here ever accepts a drop — the section relies on the
 * window-level reject claimant set up by `renderInto`. Media tiles
 * in the left list ARE drag sources (same `kind:'attachment'`
 * payload the browse-view uses) so the user can still drag a
 * media item out from here.
 *
 * @public
 * @since 0.21.0
 */

import { __, _n, sprintf } from '../i18n';
import { applyFilters } from '../hooks';
import { renderStatusBarSegments, type StatusBarSegment } from '../desktop-files/folder-status-bar';
import type { ShortcutDragData } from '../desktop-files/drag-payloads';
import type { EntityRenderHost } from './kind-registry';
import type { MediaUsage } from './types';
import { fetchMediaUsage } from './media-rest';
import { dashiconForMime } from './media-preview';
import { getConfig } from './rest';
import { getDragManager } from './dom-utils';

/**
 * Resolve a row's `postType` to a My WordPress entity id.
 *
 * Strategy:
 *   1. Find an entity whose `restPath` ends in the post type slug
 *      (e.g. `wp/v2/product` for WooCommerce's `product` CPT).
 *      That's the most reliable match — restPath is what the
 *      detail-view fetcher uses.
 *   2. Fall back to the built-in `'posts'` / `'pages'` ids when
 *      no custom entity is registered.
 *   3. Last resort: `'posts'`, knowing the detail-view fetch will
 *      404 if the CPT isn't reachable under `wp/v2/posts`. That's
 *      better than silently ignoring the click — the empty pane
 *      makes the gap visible.
 */
function entityIdForPostType( postType: string ): string {
	const entities = getConfig().entities;
	const suffix = '/' + postType;
	const match = entities.find( ( e ) => e.restPath.endsWith( suffix ) );
	if ( match ) {
		return match.id;
	}
	if ( postType === 'page' ) {
		return 'pages';
	}
	return 'posts';
}

function openDetailInWindow( payload: {
	entityId: string;
	postId: number;
	postTitle: string;
} ): void {
	interface MyWpApi {
		openDetail?: ( args: {
			entityId: string;
			postId: number;
			postTitle: string;
		} ) => void;
	}
	const myWp = (
		window.wp as { desktop?: { myWordpress?: MyWpApi } } | undefined
	)?.desktop?.myWordpress;
	myWp?.openDetail?.( payload );
}

function buildMediaSourceTile( usage: MediaUsage ): HTMLElement {
	// The drill-in view still exposes the source attachment as a
	// drag handle in the preview header — so the user can drag-out
	// from this view too.
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className =
		'desktop-mode-my-wordpress__media-source-tile desktop-mode-file-tile';
	tile.dataset.mediaId = String( usage.media.id );

	const thumbWrap = document.createElement( 'span' );
	thumbWrap.className = 'desktop-mode-my-wordpress__media-tile-thumb';
	thumbWrap.setAttribute( 'aria-hidden', 'true' );
	if ( usage.media.mime.startsWith( 'image/' ) ) {
		const img = document.createElement( 'img' );
		img.src = usage.media.sourceUrl;
		img.alt = usage.media.title;
		img.loading = 'lazy';
		thumbWrap.appendChild( img );
	} else {
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ dashiconForMime( usage.media.mime ) }`;
		thumbWrap.appendChild( icon );
	}
	tile.appendChild( thumbWrap );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-file-tile__label';
	label.textContent = usage.media.title;
	tile.appendChild( label );

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
					ref: String( usage.media.id ),
					title: usage.media.title,
					icon: dashiconForMime( usage.media.mime ),
				} satisfies ShortcutDragData,
				ghost: {
					offsetX: e.clientX - tile.getBoundingClientRect().left,
					offsetY: e.clientY - tile.getBoundingClientRect().top,
				},
			},
			origin: e,
		} );
	} );

	return tile;
}

function buildUsageRow( row: MediaUsage[ 'usedIn' ][ number ] ): HTMLElement {
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className =
		'desktop-mode-my-wordpress__usage-row desktop-mode-file-tile';
	tile.dataset.postId = String( row.postId );
	tile.dataset.postType = row.postType;

	const iconWrap = document.createElement( 'span' );
	iconWrap.className = 'desktop-mode-my-wordpress__usage-icon';
	iconWrap.setAttribute( 'aria-hidden', 'true' );
	const icon = document.createElement( 'span' );
	icon.className =
		row.postType === 'page'
			? 'dashicons dashicons-admin-page'
			: 'dashicons dashicons-admin-post';
	iconWrap.appendChild( icon );
	tile.appendChild( iconWrap );

	const text = document.createElement( 'span' );
	text.className = 'desktop-mode-my-wordpress__usage-text';
	const title = document.createElement( 'span' );
	title.className = 'desktop-mode-my-wordpress__usage-title';
	title.textContent = row.title || `#${ row.postId }`;
	text.appendChild( title );

	const meta = document.createElement( 'span' );
	meta.className = 'desktop-mode-my-wordpress__usage-meta';
	const usedAsLabel: Record< MediaUsage[ 'usedIn' ][ number ][ 'usedAs' ], string > = {
		featured: __( 'Featured image', 'desktop-mode' ),
		content: __( 'Embedded in content', 'desktop-mode' ),
		meta: __( 'In meta field', 'desktop-mode' ),
	};
	meta.textContent = `${ row.postTypeLabel } · ${ usedAsLabel[ row.usedAs ] }`;
	text.appendChild( meta );

	tile.appendChild( text );
	return tile;
}

function paintStatus(
	statusBar: HTMLElement,
	count: number,
	entityId: string,
): void {
	const segments: StatusBarSegment[] = [
		{
			id: 'count',
			label: sprintf(
				// translators: %d is the count of posts that reference an attachment.
				_n( '%d reference', '%d references', count ),
				count,
			),
			align: 'start',
			sort: 10,
		},
	];
	const filtered = applyFilters<
		StatusBarSegment[],
		[ { view: 'media-detail'; entityId: string } ]
	>(
		'desktop-mode.my-wordpress.status-bar',
		segments,
		{ view: 'media-detail', entityId },
	);
	renderStatusBarSegments(
		statusBar,
		Array.isArray( filtered ) ? filtered : segments,
	);
}

/**
 * Render the "used in" drill-in view.
 *
 * @public
 * @since 0.21.0
 */
export async function renderMediaDetail(
	host: EntityRenderHost,
	mediaId: number,
): Promise< void > {
	const wrap = document.createElement( 'div' );
	wrap.className =
		'desktop-mode-my-wordpress__split desktop-mode-my-wordpress__split--media-detail';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list desktop-mode-my-wordpress__usage-list';

	const loading = document.createElement( 'div' );
	loading.className = 'desktop-mode-my-wordpress__preview-loading';
	const spinner = document.createElement( 'wpd-spinner' );
	loading.appendChild( spinner );
	left.appendChild( loading );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__preview';

	wrap.append( left, right );
	host.body.appendChild( wrap );

	const statusBar =
		host.body
			.closest( '[data-desktop-mode-my-wordpress-root]' )
			?.querySelector< HTMLElement >(
				'[data-desktop-mode-my-wordpress-status]',
			) ?? document.createElement( 'div' );

	let usage: MediaUsage;
	try {
		usage = await fetchMediaUsage( mediaId );
	} catch ( err ) {
		left.replaceChildren();
		const errBox = document.createElement( 'div' );
		errBox.className = 'desktop-mode-my-wordpress__error';
		errBox.textContent =
			err instanceof Error
				? err.message
				: __( 'Failed to load usage data.', 'desktop-mode' );
		left.appendChild( errBox );
		return;
	}

	// `renderMediaDetail` is only ever dispatched when the active
	// route is `media-detail` — the type-narrowed `entityId` is the
	// section we're inside.
	if ( host.route.kind !== 'media-detail' ) {
		throw new Error(
			'[my-wordpress] renderMediaDetail invoked outside a media-detail route.',
		);
	}
	const entityId = host.route.entityId;

	// Right pane: source media on top, selected referrer below.
	const sourceWrap = document.createElement( 'header' );
	sourceWrap.className = 'desktop-mode-my-wordpress__media-detail-header';
	sourceWrap.appendChild( buildMediaSourceTile( usage ) );

	const summary = document.createElement( 'p' );
	summary.className = 'desktop-mode-my-wordpress__media-detail-summary';
	summary.textContent = sprintf(
		// translators: %d is the count of posts/pages referencing this file.
		_n(
			'%d entry references this file.',
			'%d entries reference this file.',
			usage.usedIn.length,
		),
		usage.usedIn.length,
	);
	sourceWrap.appendChild( summary );

	right.replaceChildren( sourceWrap );

	// Left pane: list of references.
	left.replaceChildren();
	if ( usage.usedIn.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'desktop-mode-my-wordpress__empty';
		empty.textContent = __(
			'No posts or pages reference this file.',
			'desktop-mode',
		);
		left.appendChild( empty );
		paintStatus( statusBar, 0, entityId );
		return;
	}

	const list = document.createElement( 'div' );
	list.className = 'desktop-mode-my-wordpress__usage-rows';
	list.setAttribute( 'role', 'list' );
	for ( const row of usage.usedIn ) {
		const tile = buildUsageRow( row );
		tile.addEventListener( 'click', () => {
			openDetailInWindow( {
				entityId: entityIdForPostType( row.postType ),
				postId: row.postId,
				postTitle: row.title,
			} );
		} );
		list.appendChild( tile );
	}
	left.appendChild( list );

	paintStatus( statusBar, usage.usedIn.length, entityId );
}
