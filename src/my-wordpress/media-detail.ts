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
 */

import { __, _n, sprintf } from '../i18n';
import { applyFilters } from '../hooks';
import { renderStatusBarSegments, type StatusBarSegment } from '../desktop-files/folder-status-bar';
import { attachTileDragOut, buildTileFromSpec } from '../desktop-files/tile-spec';
import {
	attachSelection,
	closeActionMenu,
	openActionMenu,
	resolveCommonActions,
	type SelectionAction,
} from '../selection';
import type { EntityRenderHost } from './kind-registry';
import type { MediaListItem, MediaUsage } from './types';
import { fetchMediaUsage } from './media-rest';
import { renderMediaPreview } from './media-preview';
import { getConfig, getSiteName } from './rest';

/**
 * Resolve a row's `postType` to the matching My WordPress entity.
 *
 * Strategy:
 *   1. Find an entity whose `restPath` ends in the post type slug
 *      (e.g. `wp/v2/product` for WooCommerce's `product` CPT).
 *      restPath is what the detail-view fetcher uses, so this is
 *      the most reliable match.
 *   2. Returns `undefined` when no entity is registered — caller
 *      decides on a fallback (id, icon, etc.).
 */
function entityForPostType( postType: string ) {
	const suffix = '/' + postType;
	return getConfig().entities.find( ( e ) => e.restPath.endsWith( suffix ) );
}

function entityIdForPostType( postType: string ): string {
	const match = entityForPostType( postType );
	if ( match ) {
		return match.id;
	}
	if ( postType === 'page' ) {
		return 'pages';
	}
	return 'posts';
}

function entityIconForPostType( postType: string ): string {
	const match = entityForPostType( postType );
	if ( match ) {
		return match.icon;
	}
	if ( postType === 'page' ) {
		return 'dashicons-admin-page';
	}
	return 'dashicons-admin-post';
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
		window.wp as { os?: { myWordpress?: MyWpApi } } | undefined
	)?.os?.myWordpress;
	myWp?.openDetail?.( payload );
}

/**
 * Build a file-tile for a referencing post — visually consistent
 * with the Media / Posts grids: icon on top, title below, a small
 * badge for the `usedAs` discriminator. Draggable (drops to the
 * desktop as a `kind: 'post'` shortcut), double-click navigates
 * into the post's My WordPress detail dossier, right-click opens
 * a small context menu.
 */
function buildUsageTile(
	row: MediaUsage[ 'usedIn' ][ number ],
): HTMLElement {
	const titleText = row.title || `#${ row.postId }`;

	// Canonical tile chrome — same as every other surface. The
	// status ribbon falls out of `spec.status` (the renderer honors
	// the `showPostStatusRibbons` OS-setting itself).
	const tile = buildTileFromSpec( {
		type: 'post',
		ref: String( row.postId ),
		label: titleText,
		icon: entityIconForPostType( row.postType ),
		role: 'entry',
		status: row.status,
		dataset: { postId: row.postId, postType: row.postType },
		extraClasses: [
			'os-my-wordpress__tile',
			'os-my-wordpress__tile--entry',
			'os-my-wordpress__media-tile',
			'os-my-wordpress__tile--usage',
		],
	} );

	attachTileDragOut( tile, {
		kind: 'post',
		ref: String( row.postId ),
		title: titleText,
		icon: entityIconForPostType( row.postType ),
	} );

	return tile;
}

function closeContextMenu(): void {
	closeActionMenu();
}

type UsageRow = MediaUsage[ 'usedIn' ][ number ];

/**
 * Actions for ONE usage row. All three open something per row, so
 * all three are multi-safe: asking for three referencing posts in
 * the editor and getting three editor windows is the expected
 * outcome, and the shared resolver caps nothing here because the set
 * is bounded by how many rows reference one file.
 */
function buildUsageActions(
	row: UsageRow,
): SelectionAction< UsageRow >[] {
	const actions: SelectionAction< UsageRow >[] = [
		{
			id: 'navigate-into',
			label: sprintf(
				// translators: %s is the site title.
				__( 'Open in %s', 'desktop-mode' ),
				getSiteName(),
			),
			icon: 'dashicons-category',
			sort: 10,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					// translators: 1: number of selected rows, 2: site title.
					__( 'Open %1$d items in %2$s', 'desktop-mode' ),
					n,
					getSiteName(),
				),
			onClick: () => {
				openDetailInWindow( {
					entityId: entityIdForPostType( row.postType ),
					postId: row.postId,
					postTitle: row.title,
				} );
			},
		},
	];
	if ( row.editLink ) {
		actions.push( {
			id: 'open-editor',
			label: __( 'Open in editor', 'desktop-mode' ),
			icon: 'dashicons-edit',
			sort: 20,
			multi: true,
			bulkLabel: ( n ) =>
				sprintf(
					// translators: %d: number of selected rows.
					__( 'Open %d items in the editor', 'desktop-mode' ),
					n,
				),
			onClick: () => {
				window.open( row.editLink, '_blank', 'noopener,noreferrer' );
			},
		} );
	}
	if ( row.link ) {
		actions.push( {
			id: 'open-front',
			label: __( 'View on site', 'desktop-mode' ),
			icon: 'dashicons-external',
			sort: 30,
			onClick: () => {
				window.open( row.link, '_blank', 'noopener,noreferrer' );
			},
		} );
	}
	return actions;
}

/**
 * Right-click menu for the usage grid, acting on the current
 * selection (one row, or several).
 */
function openUsageTileMenu(
	rows: readonly UsageRow[],
	pos: { x: number; y: number },
): void {
	const actions = resolveCommonActions( rows, buildUsageActions );
	openActionMenu( pos, {
		actions,
		className: 'os-my-wordpress__menu',
		scope: 'my-wordpress.usage-tile',
	} );
}

function paintStatus(
	statusBar: HTMLElement,
	count: number,
	entityId: string,
	selectedCount = 0,
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
	if ( selectedCount > 0 ) {
		segments.push( {
			id: 'selection',
			label: sprintf(
				// translators: %d: number of selected rows.
				__( '%d selected', 'desktop-mode' ),
				selectedCount,
			),
			align: 'end',
			sort: 5,
		} );
	}
	const filtered = applyFilters<
		StatusBarSegment[],
		[ { view: 'media-detail'; entityId: string } ]
	>(
		'os.my-wordpress.status-bar',
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
 */
export async function renderMediaDetail(
	host: EntityRenderHost,
	mediaId: number,
): Promise< void > {
	const wrap = document.createElement( 'div' );
	wrap.className =
		'os-my-wordpress__split os-my-wordpress__split--media-detail';

	const left = document.createElement( 'div' );
	left.className = 'os-my-wordpress__list os-my-wordpress__usage-list';

	const loading = document.createElement( 'div' );
	loading.className = 'os-my-wordpress__preview-loading';
	const spinner = document.createElement( 'os-spinner' );
	loading.appendChild( spinner );
	left.appendChild( loading );

	const right = document.createElement( 'div' );
	right.className = 'os-my-wordpress__preview';

	wrap.append( left, right );
	host.body.appendChild( wrap );

	const statusBar =
		host.body
			.closest( '[data-os-my-wordpress-root]' )
			?.querySelector< HTMLElement >(
				'[data-os-my-wordpress-status]',
			) ?? document.createElement( 'div' );

	let usage: MediaUsage;
	try {
		usage = await fetchMediaUsage( mediaId );
	} catch ( err ) {
		if ( ! wrap.isConnected ) {
			return;
		}
		left.replaceChildren();
		const errBox = document.createElement( 'div' );
		errBox.className = 'os-my-wordpress__error';
		errBox.textContent =
			err instanceof Error
				? err.message
				: __( 'Failed to load usage data.', 'desktop-mode' );
		left.appendChild( errBox );
		return;
	}

	// Guard against the user navigating away while the fetch was
	// in flight. `navigate()` calls `state.body.replaceChildren()`
	// which detaches `wrap`; the status bar lives in a sibling
	// region and would otherwise be overwritten by stale data
	// from this resolved promise. The `host.route` snapshot
	// captured in `makeRenderHost()` is FROZEN at dispatch time —
	// we can't trust it to reflect the live route.
	if ( ! wrap.isConnected ) {
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

	// Right pane: usage summary on top, then a full type-aware
	// media preview below — same component the browse-view uses, so
	// plugin authors' `preview-actions` / `preview-extras` hooks
	// fire here too.
	const summary = document.createElement( 'div' );
	summary.className = 'os-my-wordpress__media-detail-summary-bar';
	const summaryText = document.createElement( 'p' );
	summaryText.className = 'os-my-wordpress__media-detail-summary';
	summaryText.textContent = sprintf(
		// translators: %d is the count of posts/pages referencing this file.
		_n(
			'%d entry references this file.',
			'%d entries reference this file.',
			usage.usedIn.length,
		),
		usage.usedIn.length,
	);
	summary.appendChild( summaryText );

	right.replaceChildren( summary );

	// Inline media preview — adapt the `MediaUsage.media` payload to
	// the `MediaListItem` shape the renderer expects. Same right-pane
	// preview the browse view shows, so the same plugin hooks fire.
	const mediaItem: MediaListItem = {
		id: usage.media.id,
		title: { rendered: usage.media.title },
		date: usage.media.date,
		mime_type: usage.media.mime,
		source_url: usage.media.sourceUrl,
		media_details: {
			file: usage.media.filename,
		},
		_embedded: usage.media.author.name
			? { author: [ { id: usage.media.author.id, name: usage.media.author.name } ] }
			: undefined,
	} as MediaListItem;

	const previewHost = document.createElement( 'div' );
	previewHost.className = 'os-my-wordpress__media-detail-preview';
	renderMediaPreview( previewHost, mediaItem, {
		entityId,
		previewActions: getConfig().previewActions ?? [],
		postType: getConfig().entities.find( ( e ) => e.id === entityId )
			?.post_type,
	} );
	right.appendChild( previewHost );

	// Left pane: grid of referencing posts. Same file-tile shape
	// the Media browse view uses — drag-out, double-click navigate,
	// right-click context menu.
	left.replaceChildren();
	if ( usage.usedIn.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'os-my-wordpress__empty';
		empty.textContent = __(
			'No posts or pages reference this file.',
			'desktop-mode',
		);
		left.appendChild( empty );
		paintStatus( statusBar, 0, entityId );
		return;
	}

	const grid = document.createElement( 'div' );
	grid.className = 'os-my-wordpress__media-grid os-my-wordpress__usage-grid';
	grid.setAttribute( 'role', 'list' );
	const rowsById = new Map< string, UsageRow >();
	const selection = attachSelection( grid, {
		background: left,
		surface: 'my-wordpress',
		scope: `media-usage:${ entityId }`,
		keyOf: ( el ) => el.dataset.postId ?? null,
		onChange: () =>
			paintStatus(
				statusBar,
				usage.usedIn.length,
				entityId,
				selection.keys().length,
			),
	} );
	host.addTeardown( () => selection.destroy() );

	for ( const row of usage.usedIn ) {
		const tile = buildUsageTile( row );
		rowsById.set( String( row.postId ), row );
		tile.addEventListener( 'dblclick', ( e ) => {
			e.preventDefault();
			openDetailInWindow( {
				entityId: entityIdForPostType( row.postType ),
				postId: row.postId,
				postTitle: row.title,
			} );
		} );
		tile.addEventListener( 'contextmenu', ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			if ( ! selection.model.has( String( row.postId ) ) ) {
				selection.model.set( [ String( row.postId ) ] );
			}
			const rows = selection
				.keys()
				.map( ( key ) => rowsById.get( key ) )
				.filter( ( r ): r is UsageRow => !! r );
			openUsageTileMenu( rows.length > 0 ? rows : [ row ], {
				x: e.clientX,
				y: e.clientY,
			} );
		} );
		grid.appendChild( tile );
	}
	left.appendChild( grid );

	host.addTeardown( closeContextMenu );
	paintStatus( statusBar, usage.usedIn.length, entityId );
}
