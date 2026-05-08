/**
 * My WordPress — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-my-wordpress` window opens. Renders a folder-style
 * file explorer over the WordPress REST API: the root view shows
 * tiles for each registered entity (Phase 1: Posts, Pages); clicking
 * one drills into a two-pane infinite-scroll list with a rendered
 * HTML preview on the right.
 *
 * The `<wpd-*>` web components are defined by the main desktop
 * bundle; this module only consumes them.
 *
 * @public
 * @since 0.8.0
 */

import { __, _n, sprintf } from '../i18n';
import { applyFilters, doAction } from '../hooks';
import {
	attachIconCanvasMenu,
	type SortMode,
} from '../icon-canvas/menu';
import {
	renderStatusBarSegments,
	type StatusBarSegment,
} from '../desktop-files/folder-status-bar';
import { setShortcutDragPayload } from '../desktop-files/drag-shortcut';
import {
	renderBreadcrumbs,
	type BreadcrumbSegment,
} from '../desktop-files/breadcrumbs';
import {
	buildEditUrl,
	fetchAttachedMedia,
	fetchCommentStats,
	fetchComments,
	fetchEntityDetail,
	fetchEntityList,
	fetchEntityTotal,
	fetchMediaByIds,
	fetchRevision,
	fetchRevisions,
	fetchTermStats,
	fetchTerms,
	fetchUser,
	fetchUserStats,
	type CommentStats,
	type TermStats,
	type UserStats,
	getConfig,
	getEntity,
	trashEntity,
	type RelatedComment,
	type RelatedMedia,
	type RelatedRevision,
	type RelatedRevisionDetail,
	type RelatedTerm,
	type RelatedUser,
} from './rest';
import type {
	ContributorRef,
	EntityDetail,
	EntityListItem,
	MyWordPressEntity,
	Route,
	SubRelation,
} from './types';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const WINDOW_ID = 'desktop-mode-my-wordpress';

const ROOT_SEL = '[data-desktop-mode-my-wordpress-root]';
const BREADCRUMBS_SEL = '[data-desktop-mode-my-wordpress-breadcrumbs]';
const BODY_SEL = '[data-desktop-mode-my-wordpress-body]';
const STATUS_SEL = '[data-desktop-mode-my-wordpress-status]';

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

function wpdConfirmGlobal(
	options: ConfirmOptions,
): Promise< boolean > {
	const fn = (
		window.wp as
			| {
					desktop?: {
						confirm?: ( o: ConfirmOptions ) => Promise< boolean >;
					};
			}
			| undefined
	)?.desktop?.confirm;
	if ( typeof fn !== 'function' ) {
		return Promise.resolve( false );
	}
	return fn( options );
}

interface OpenWindowOptions {
	id?: string;
	url: string;
	title: string;
	icon?: string;
}

function openIframeWindow( opts: OpenWindowOptions ): void {
	const manager = (
		window.wp as
			| {
					desktop?: {
						windowManager?: {
							open: ( args: {
								id?: string;
								url: string;
								title: string;
								icon?: string;
							} ) => unknown;
						};
					};
			}
			| undefined
	)?.desktop?.windowManager;
	if ( ! manager || typeof manager.open !== 'function' ) {
		return;
	}
	manager.open( {
		id: opts.id,
		url: opts.url,
		title: opts.title,
		icon: opts.icon,
	} );
}

function stripTags( html: string ): string {
	const div = document.createElement( 'div' );
	div.innerHTML = html;
	return ( div.textContent ?? '' ).trim();
}

function getThumbnail( item: EntityListItem | EntityDetail ): string {
	const media = item._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	if ( ! media ) {
		return '';
	}
	const sizes = media.media_details?.sizes;
	const preferred =
		sizes?.medium?.source_url ??
		sizes?.thumbnail?.source_url ??
		sizes?.large?.source_url ??
		media.source_url;
	return preferred ?? '';
}

interface RenderState {
	route: Route;
	body: HTMLElement;
	root: HTMLElement;
	breadcrumbs: HTMLElement;
	statusBar: HTMLElement;
	teardown: Array< () => void >;
}

interface StatusContext {
	view: 'root' | 'list' | 'detail' | 'sub-list';
	entityId?: string;
	postId?: number;
	relation?: string;
}

/**
 * Paint the My WordPress status bar with the supplied segments.
 * Same DOM + CSS as the file-system folder window
 * (`desktop-mode-folder-status-bar`), just sourced from REST data
 * and the active route. Plugins can extend the rail via
 * `desktop-mode.my-wordpress.status-bar` (mirrors the file-system
 * filter, scoped to this surface).
 */
function paintStatus(
	state: RenderState,
	baseSegments: StatusBarSegment[],
	ctx: StatusContext,
): void {
	const filtered = applyFilters<
		StatusBarSegment[],
		[ StatusContext ]
	>(
		'desktop-mode.my-wordpress.status-bar',
		baseSegments,
		ctx,
	);
	renderStatusBarSegments(
		state.statusBar,
		Array.isArray( filtered ) ? filtered : baseSegments,
	);
}

function pluralLabel(
	n: number,
	singular: string,
	plural: string,
): string {
	return `${ n.toLocaleString() } ${ n === 1 ? singular : plural }`;
}

function navigate( state: RenderState, route: Route ): void {
	clearTeardown( state );
	state.route = route;
	updateBreadcrumbs( state );
	state.body.replaceChildren();
	if ( route.kind === 'root' ) {
		renderRoot( state );
		return;
	}
	const entity = getEntity( route.entityId );
	if ( ! entity ) {
		renderError(
			state,
			__( 'Unknown entity type.', 'desktop-mode' ),
		);
		return;
	}
	if ( route.kind === 'list' ) {
		renderEntityList( state, entity );
		return;
	}
	if ( route.kind === 'detail' ) {
		renderDetail( state, entity, route.postId, route.postTitle );
		return;
	}
	if ( route.kind === 'sub-list' ) {
		renderSubList(
			state,
			entity,
			route.postId,
			route.postTitle,
			route.relation,
		);
	}
}

function parentRoute( route: Route ): Route {
	switch ( route.kind ) {
		case 'root':
			return route;
		case 'list':
			return { kind: 'root' };
		case 'detail':
			return { kind: 'list', entityId: route.entityId };
		case 'sub-list':
			return {
				kind: 'detail',
				entityId: route.entityId,
				postId: route.postId,
				postTitle: route.postTitle,
			};
		default:
			return { kind: 'root' };
	}
}

function clearTeardown( state: RenderState ): void {
	for ( const fn of state.teardown ) {
		try {
			fn();
		} catch {
			// Tear-down should never throw; ignore.
		}
	}
	state.teardown = [];
}

function updateBreadcrumbs( state: RenderState ): void {
	const { route } = state;

	// Build the segment list, then defer to the shared
	// `renderBreadcrumbs` helper. Same chrome the folder window
	// uses — we don't own the breadcrumb DOM anymore, so a tweak
	// to the visual lands in one place.
	const segments: BreadcrumbSegment[] = [];
	const isRoot = route.kind === 'root';
	segments.push(
		isRoot
			? { label: __( 'My WordPress', 'desktop-mode' ) }
			: {
				label: __( 'My WordPress', 'desktop-mode' ),
				onClick: () => navigate( state, { kind: 'root' } ),
			},
	);

	if ( route.kind !== 'root' ) {
		const entity = getEntity( route.entityId );
		const label = entity ? entity.label : route.entityId;
		segments.push(
			route.kind === 'list'
				? { label }
				: {
					label,
					onClick: () =>
						navigate( state, {
							kind: 'list',
							entityId: route.entityId,
						} ),
				},
		);
	}

	if ( route.kind === 'detail' || route.kind === 'sub-list' ) {
		const postTitle = route.postTitle;
		const entityId = route.entityId;
		const postId = route.postId;
		segments.push(
			route.kind === 'detail'
				? { label: postTitle }
				: {
					label: postTitle,
					onClick: () =>
						navigate( state, {
							kind: 'detail',
							entityId,
							postId,
							postTitle,
						} ),
				},
		);
	}
	if ( route.kind === 'sub-list' ) {
		segments.push( { label: subRelationLabel( route.relation ) } );
	}

	renderBreadcrumbs( state.breadcrumbs, segments, {
		onBack: () => {
			if ( state.route.kind === 'root' ) {
				return;
			}
			navigate( state, parentRoute( state.route ) );
		},
		backDisabled: isRoot,
	} );
}

function subRelationLabel( relation: SubRelation ): string {
	switch ( relation ) {
		case 'author':
			return __( 'Author', 'desktop-mode' );
		case 'contributors':
			return __( 'Contributors', 'desktop-mode' );
		case 'comments':
			return __( 'Comments', 'desktop-mode' );
		case 'categories':
			return __( 'Categories', 'desktop-mode' );
		case 'tags':
			return __( 'Tags', 'desktop-mode' );
		case 'media':
			return __( 'Attached media', 'desktop-mode' );
		case 'revisions':
			return __( 'Revisions', 'desktop-mode' );
		default:
			return relation;
	}
}

function renderRoot( state: RenderState ): void {
	const cfg = getConfig();
	const grid = document.createElement( 'div' );
	grid.className =
		'desktop-mode-my-wordpress__grid desktop-mode-my-wordpress__canvas';
	grid.setAttribute( 'role', 'list' );

	const layout = createTileLayout( grid, 'root' );
	const select = createTileSelector();

	const tilesByEntity = new Map< string, HTMLButtonElement >();

	cfg.entities.forEach( ( entity, idx ) => {
		const tile = buildIconTile( {
			role: 'folder',
			icon: entity.icon,
			label: entity.label,
		} );
		tile.dataset.entityId = entity.id;
		tilesByEntity.set( entity.id, tile );
		const tileKey = `entity:${ entity.id }`;
		// Folders have no real "date" — synthesize one from registry
		// order so date-sort still produces a deterministic outcome.
		const synthDate = new Date( 2020, 0, 1 + idx ).toISOString();
		layout.place( tile, tileKey, {
			name: entity.label,
			date: synthDate,
		} );
		attachTileDrag( tile, layout, {
			tileKey,
			// Folder tiles use Finder-style semantics: single click
			// selects (visual highlight only — no navigation, so a
			// fast double-click can't race the tile out of the DOM),
			// double click navigates.
			onClick: () => select( tile ),
		} );
		tile.addEventListener( 'dblclick', ( e ) => {
			e.preventDefault();
			navigate( state, { kind: 'list', entityId: entity.id } );
		} );
		grid.appendChild( tile );
	} );

	// Fire one cheap count ping per entity in parallel so the root
	// folder tiles can show "Posts · 142" / "Pages · 18". Each ping
	// is `?per_page=1&_fields=id` — payload size of one id, total
	// served via `X-WP-Total`. Failures fall through silently
	// (the bare label is still useful).
	cfg.entities.forEach( ( entity ) => {
		void fetchEntityTotal( entity )
			.then( ( total ) => {
				if ( state.route.kind !== 'root' ) {
					return; // Navigated away — don't paint stale.
				}
				const tile = tilesByEntity.get( entity.id );
				if ( ! tile ) {
					return;
				}
				const label = tile.querySelector< HTMLElement >(
					'.desktop-mode-file-tile__label',
				);
				if ( label ) {
					label.textContent = `${ entity.label } · ${ total.toLocaleString() }`;
				}
			} )
			.catch( () => {
				// Silent — the unsuffixed label still works.
			} );
	} );

	state.body.appendChild( grid );
	const menu = attachIconCanvasMenu( grid, {
		scope: 'my-wordpress:root',
		onSort: ( mode ) => layout.sort( mode ),
	} );
	state.teardown.push( () => menu.dispose() );
	state.teardown.push( () => layout.dispose() );

	paintStatus(
		state,
		[
			{
				id: 'count',
				label: pluralLabel( cfg.entities.length, 'folder', 'folders' ),
				align: 'start',
				sort: 10,
			},
		],
		{ view: 'root' },
	);
}

/**
 * Build a tile that visually matches the wallpaper file tiles
 * (`.desktop-mode-file-tile`) — same fixed 88px width, same icon /
 * label composition, same hover/focus chrome. Adopting the live
 * class keeps the My WordPress window visually consistent with the
 * desktop without forking the look-and-feel rules.
 */
function buildIconTile( spec: {
	role: 'folder' | 'entry';
	icon: string;
	label: string;
} ): HTMLButtonElement {
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className =
		'desktop-mode-file-tile desktop-mode-my-wordpress__tile' +
		( spec.role === 'folder'
			? ' desktop-mode-my-wordpress__tile--folder'
			: ' desktop-mode-my-wordpress__tile--entry' );
	tile.setAttribute( 'role', 'listitem' );
	tile.dataset.role = spec.role;

	const visual = document.createElement( 'span' );
	visual.className = `desktop-mode-file-tile__icon dashicons ${ sanitizeClass(
		spec.icon,
	) }`;
	visual.setAttribute( 'aria-hidden', 'true' );
	tile.appendChild( visual );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-file-tile__label';
	label.textContent = spec.label;
	tile.appendChild( label );

	return tile;
}

function renderError( state: RenderState, message: string ): void {
	const empty = document.createElement( 'div' );
	empty.className = 'desktop-mode-my-wordpress__empty';
	empty.textContent = message;
	state.body.appendChild( empty );
}

interface ListContext {
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
	observer: IntersectionObserver | null;
	layout: TileLayout;
}

function renderEntityList(
	state: RenderState,
	entity: MyWordPressEntity,
): void {
	const cfg = getConfig();
	const split = document.createElement( 'div' );
	split.className = 'desktop-mode-my-wordpress__split';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list';
	const tiles = document.createElement( 'div' );
	tiles.className =
		'desktop-mode-my-wordpress__tiles desktop-mode-my-wordpress__canvas';
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
		'Select an entry to preview it here.',
		'desktop-mode',
	);
	right.appendChild( previewEmpty );

	split.appendChild( left );
	split.appendChild( right );
	state.body.appendChild( split );

	const tileLayout = createTileLayout( tiles, `entity:${ entity.id }` );
	const menu = attachIconCanvasMenu( tiles, {
		scope: `my-wordpress:${ entity.id }`,
		onSort: ( mode ) => tileLayout.sort( mode ),
	} );
	state.teardown.push( () => menu.dispose() );

	const ctx: ListContext = {
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
		observer: null,
		layout: tileLayout,
	};
	state.teardown.push( () => tileLayout.dispose() );

	const repaintListStatus = () => {
		// Show "X of Y items" while infinite scroll still has more
		// to load — matches what the user sees vs what the server
		// reports — and collapse to "Y items" once everything has
		// landed. Avoids the "I see 24 tiles but it says 26" gap.
		let itemLabel: string;
		if ( ctx.total === 0 && ctx.loaded === 0 ) {
			itemLabel = pluralLabel( 0, 'item', 'items' );
		} else if ( ctx.total > ctx.loaded && ctx.loaded > 0 ) {
			itemLabel = sprintf(
				// translators: 1: visible item count, 2: total item count.
				__( '%1$d of %2$d items', 'desktop-mode' ),
				ctx.loaded,
				ctx.total,
			);
		} else {
			itemLabel = pluralLabel(
				Math.max( ctx.total, ctx.loaded ),
				'item',
				'items',
			);
		}
		const segments: StatusBarSegment[] = [
			{ id: 'count', label: itemLabel, align: 'start', sort: 10 },
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
		paintStatus( state, segments, {
			view: 'list',
			entityId: entity.id,
		} );
	};
	repaintListStatus();

	/**
	 * True when the sentinel sits within the scroller's visible
	 * rect (plus the same 200px slack the IntersectionObserver
	 * applies). Used to chain `loadMore()` calls after each page
	 * settles — `IntersectionObserver` only fires on transitions
	 * of `isIntersecting`, so when page 1 lands but the sentinel
	 * was already in view (small entity counts, big window),
	 * nothing transitions and the observer never re-pulls.
	 */
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
		const isFirst = nextPage === 1;
		showSpinner( tiles, isFirst );
		try {
			const result = await fetchEntityList( entity, {
				page: nextPage,
				perPage: cfg.perPage,
			} );
			ctx.page = nextPage;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			hideSpinner( tiles );
			if ( result.items.length === 0 && isFirst ) {
				renderListEmpty( tiles, entity );
				ctx.done = true;
				repaintListStatus();
				return;
			}
			for ( const item of result.items ) {
				tiles.appendChild( buildEntityTile( state, ctx, entity, item ) );
				ctx.loaded += 1;
			}
			if ( ctx.page >= ctx.totalPages ) {
				ctx.done = true;
			}
			repaintListStatus();
		} catch ( err ) {
			hideSpinner( tiles );
			const msg =
				err instanceof Error ? err.message : __( 'Unknown error.', 'desktop-mode' );
			renderListError( tiles, msg );
			ctx.done = true;
		} finally {
			ctx.loading = false;
		}
		// Chain — keep pulling pages while the sentinel is still
		// within the rootMargin slack and there's more to load.
		// Wrapped in `requestAnimationFrame` so the layout has
		// settled with the freshly-appended tiles before we
		// measure the sentinel's position.
		if ( ! ctx.done ) {
			requestAnimationFrame( () => {
				if ( sentinelIsVisible() ) {
					void loadMore();
				}
			} );
		}
	};

	if ( typeof IntersectionObserver !== 'undefined' ) {
		ctx.observer = new IntersectionObserver(
			( entries ) => {
				for ( const e of entries ) {
					if ( e.isIntersecting ) {
						void loadMore();
					}
				}
			},
			{ root: left, rootMargin: '200px 0px' },
		);
		ctx.observer.observe( sentinel );
		state.teardown.push( () => ctx.observer?.disconnect() );
	}

	void loadMore();
}

function renderListEmpty(
	host: HTMLElement,
	entity: MyWordPressEntity,
): void {
	const empty = document.createElement( 'div' );
	empty.className = 'desktop-mode-my-wordpress__empty';
	empty.textContent = sprintf(
		// translators: %s is an entity-type label (e.g. "Posts", "Pages").
		__( 'No %s yet.', 'desktop-mode' ),
		entity.label.toLowerCase(),
	);
	host.appendChild( empty );
}

function renderListError( host: HTMLElement, message: string ): void {
	const err = document.createElement( 'div' );
	err.className = 'desktop-mode-my-wordpress__error';
	err.textContent = message;
	host.appendChild( err );
}

function showSpinner( host: HTMLElement, isFirst: boolean ): void {
	const id = isFirst
		? 'desktop-mode-my-wordpress__spinner--first'
		: 'desktop-mode-my-wordpress__spinner--more';
	if ( host.querySelector( `[data-spinner="${ id }"]` ) ) {
		return;
	}
	const wrap = document.createElement( 'div' );
	wrap.dataset.spinner = id;
	wrap.className = isFirst
		? 'desktop-mode-my-wordpress__spinner desktop-mode-my-wordpress__spinner--first'
		: 'desktop-mode-my-wordpress__spinner';
	const spinner = document.createElement( 'wpd-spinner' );
	wrap.appendChild( spinner );
	host.appendChild( wrap );
}

function hideSpinner( host: HTMLElement ): void {
	host.querySelectorAll( '[data-spinner]' ).forEach( ( n ) => n.remove() );
}

function buildEntityTile(
	state: RenderState,
	ctx: ListContext,
	entity: MyWordPressEntity,
	item: EntityListItem,
): HTMLElement {
	const titleText =
		stripTags( item.title.rendered ) || __( '(no title)', 'desktop-mode' );
	const tile = buildIconTile( {
		role: 'entry',
		icon: entity.icon,
		label: titleText,
	} );
	tile.dataset.entryId = String( item.id );

	// Make the tile a native HTML5 drag source so the user can
	// drag it out of the My WordPress window and drop it on the
	// wallpaper, on a folder icon, or inside an open folder
	// window — the desktop FilesLayer reads the payload and files
	// a `post`-type placement (a shortcut) at the drop target.
	// Internal rearrange is still disabled (single click selects,
	// double click opens) — only the cross-window drag-out fires.
	tile.draggable = true;
	tile.addEventListener( 'dragstart', ( e: DragEvent ) => {
		hideTooltip();
		if ( ! e.dataTransfer ) {
			return;
		}
		setShortcutDragPayload( e.dataTransfer, {
			type: 'post',
			ref: String( item.id ),
			title: titleText,
			icon: entity.icon,
		} );
		// Browser uses the drag source as the default ghost — that
		// already looks right (the tile follows the cursor with a
		// subtle alpha). No setDragImage override needed.
	} );

	// If another user is editing right now, surface that on the
	// tile itself (overlay lock badge + class for styling) so the
	// user can see at a glance which posts to skip — and tooltip
	// adds the locking user's name.
	const lock = item.desktop_mode_lock ?? null;
	if ( lock ) {
		tile.classList.add( 'desktop-mode-my-wordpress__tile--locked' );
		const badge = document.createElement( 'span' );
		badge.className =
			'desktop-mode-my-wordpress__tile-lock dashicons dashicons-lock';
		badge.setAttribute( 'aria-hidden', 'true' );
		tile.appendChild( badge );
		// translators: 1: post title, 2: name of the user who has the post locked.
		const lockedAriaLabel = __(
			'%1$s — currently being edited by %2$s',
			'desktop-mode',
		);
		tile.setAttribute(
			'aria-label',
			sprintf( lockedAriaLabel, titleText, lock.userName ),
		);
	}

	// Hover tooltip — built lazily once per tile.
	let tooltip: HTMLElement | null = null;
	const showTooltip = ( ev: MouseEvent ) => {
		if ( ! tooltip ) {
			tooltip = buildTooltip( titleText, item );
		}
		document.body.appendChild( tooltip );
		positionTooltip( tooltip, ev );
	};
	const moveTooltip = ( ev: MouseEvent ) => {
		if ( tooltip && tooltip.isConnected ) {
			positionTooltip( tooltip, ev );
		}
	};
	const hideTooltip = () => {
		if ( tooltip && tooltip.isConnected ) {
			tooltip.remove();
		}
	};
	tile.addEventListener( 'mouseenter', showTooltip );
	tile.addEventListener( 'mousemove', moveTooltip );
	tile.addEventListener( 'mouseleave', hideTooltip );
	state.teardown.push( hideTooltip );

	const tileKey = `entry:${ item.id }`;
	ctx.layout.place( tile, tileKey, {
		name: titleText,
		date: item.date || new Date( 0 ).toISOString(),
	} );
	attachTileDrag( tile, ctx.layout, {
		tileKey,
		onClick: () => {
			selectTile( state, ctx, tile, entity, item.id );
		},
		onDragStart: hideTooltip,
	} );

	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		hideTooltip();
		openEditor( entity, item.id, titleText );
	} );

	tile.addEventListener( 'contextmenu', ( e ) => {
		e.preventDefault();
		hideTooltip();
		openTileMenu( state, ctx, entity, item, titleText, {
			x: e.clientX,
			y: e.clientY,
		} );
	} );

	return tile;
}

function buildTooltip( title: string, item: EntityListItem ): HTMLElement {
	const tip = document.createElement( 'div' );
	tip.className = 'desktop-mode-my-wordpress__tooltip';
	tip.setAttribute( 'role', 'tooltip' );

	const heading = document.createElement( 'div' );
	heading.className = 'desktop-mode-my-wordpress__tooltip-title';
	heading.textContent = title;
	tip.appendChild( heading );

	const lock = item.desktop_mode_lock ?? null;
	if ( lock ) {
		const banner = document.createElement( 'div' );
		banner.className = 'desktop-mode-my-wordpress__tooltip-lock';
		const icon = document.createElement( 'span' );
		icon.className = 'dashicons dashicons-lock';
		icon.setAttribute( 'aria-hidden', 'true' );
		banner.appendChild( icon );
		const text = document.createElement( 'span' );
		text.textContent = sprintf(
			// translators: %s is the user name currently editing the post.
			__( '%s is currently editing', 'desktop-mode' ),
			lock.userName,
		);
		banner.appendChild( text );
		tip.appendChild( banner );
	}

	const thumb = getThumbnail( item );
	if ( thumb ) {
		const img = document.createElement( 'img' );
		img.className = 'desktop-mode-my-wordpress__tooltip-thumb';
		img.src = thumb;
		img.alt = '';
		tip.appendChild( img );
	}

	const excerpt = stripTags( item.excerpt?.rendered ?? '' );
	if ( excerpt ) {
		const p = document.createElement( 'p' );
		p.className = 'desktop-mode-my-wordpress__tooltip-excerpt';
		p.textContent =
			excerpt.length > 240 ? excerpt.slice( 0, 237 ) + '…' : excerpt;
		tip.appendChild( p );
	}

	return tip;
}

function positionTooltip( tip: HTMLElement, ev: MouseEvent ): void {
	const offset = 16;
	let x = ev.clientX + offset;
	let y = ev.clientY + offset;
	const rect = tip.getBoundingClientRect();
	if ( x + rect.width > window.innerWidth - 8 ) {
		x = Math.max( 8, ev.clientX - rect.width - offset );
	}
	if ( y + rect.height > window.innerHeight - 8 ) {
		y = Math.max( 8, ev.clientY - rect.height - offset );
	}
	tip.style.left = `${ x }px`;
	tip.style.top = `${ y }px`;
}

function selectTile(
	state: RenderState,
	ctx: ListContext,
	tile: HTMLElement,
	entity: MyWordPressEntity,
	id: number,
): void {
	if ( ctx.selectedTile ) {
		ctx.selectedTile.classList.remove(
			'desktop-mode-my-wordpress__tile--selected',
		);
	}
	tile.classList.add( 'desktop-mode-my-wordpress__tile--selected' );
	ctx.selectedTile = tile;
	ctx.selectedId = id;
	void renderPreview( state, ctx, entity, id );
}

async function renderPreview(
	state: RenderState,
	ctx: ListContext,
	entity: MyWordPressEntity,
	id: number,
): Promise< void > {
	showPreviewLoading( ctx.preview );

	let detail: EntityDetail;
	try {
		detail = await fetchEntityDetail( entity, id );
	} catch ( err ) {
		ctx.preview.replaceChildren();
		// Skip if the user has clicked something else in the meantime.
		if ( ctx.selectedId !== id ) {
			return;
		}
		showPreviewError( ctx.preview, err );
		return;
	}

	if ( ctx.selectedId !== id ) {
		return; // Selection moved on while we were fetching.
	}

	appendPostArticle( ctx.preview, detail, entity, {
		onExplore: () => {
			navigate( state, {
				kind: 'detail',
				entityId: entity.id,
				postId: detail.id,
				postTitle: stripTags( detail.title.rendered ),
			} );
		},
	} );
}

/**
 * Replace the preview pane content with a centered, large spinner.
 * Reused by every code path that fetches preview data
 * (post select, sub-list selection, detail-view post hydration).
 */
function showPreviewLoading( host: HTMLElement ): void {
	host.replaceChildren();
	const loading = document.createElement( 'div' );
	loading.className = 'desktop-mode-my-wordpress__preview-loading';
	const spinner = document.createElement( 'wpd-spinner' );
	spinner.setAttribute( 'size', '128' );
	loading.appendChild( spinner );
	host.appendChild( loading );
}

function showPreviewError( host: HTMLElement, err: unknown ): void {
	host.replaceChildren();
	const box = document.createElement( 'div' );
	box.className = 'desktop-mode-my-wordpress__error';
	box.textContent =
		err instanceof Error ? err.message : __( 'Unknown error.', 'desktop-mode' );
	host.appendChild( box );
}

interface PostArticleOptions {
	/**
	 * When supplied, an additional secondary button is rendered in
	 * the article footer that drills the window into the post's
	 * detail view (Author / Comments / Categories / etc.). The
	 * detail-view path itself doesn't pass this — there's nothing
	 * deeper to navigate into from there.
	 */
	onExplore?: () => void;
}

function appendPostArticle(
	host: HTMLElement,
	detail: EntityDetail,
	entity: MyWordPressEntity,
	opts: PostArticleOptions = {},
): void {
	host.replaceChildren();
	const article = document.createElement( 'article' );
	article.className = 'desktop-mode-my-wordpress__article';

	const heading = document.createElement( 'h2' );
	heading.className = 'desktop-mode-my-wordpress__article-title';
	heading.textContent = stripTags( detail.title.rendered );
	article.appendChild( heading );

	const meta = buildPostMetaLine( detail );
	if ( meta ) {
		article.appendChild( meta );
	}

	const thumb = getThumbnail( detail );
	if ( thumb ) {
		const img = document.createElement( 'img' );
		img.className = 'desktop-mode-my-wordpress__article-hero';
		img.src = thumb;
		img.alt = '';
		article.appendChild( img );
	}

	const content = document.createElement( 'div' );
	content.className = 'desktop-mode-my-wordpress__article-content';
	// `content.rendered` is sanitised server-side by core's
	// `the_content` pipeline before it reaches the REST response.
	content.innerHTML = detail.content.rendered;
	article.appendChild( content );

	const footer = document.createElement( 'footer' );
	footer.className = 'desktop-mode-my-wordpress__article-footer';

	if ( opts.onExplore ) {
		const exploreBtn = document.createElement( 'wpd-button' );
		exploreBtn.setAttribute( 'variant', 'secondary' );
		exploreBtn.textContent = __( 'Explore details', 'desktop-mode' );
		exploreBtn.title = __(
			'See author, comments, categories, tags, attached media, and revisions for this entry.',
			'desktop-mode',
		);
		exploreBtn.addEventListener( 'click', () => {
			opts.onExplore?.();
		} );
		footer.appendChild( exploreBtn );
	}

	const editBtn = document.createElement( 'wpd-button' );
	editBtn.setAttribute( 'variant', 'primary' );
	editBtn.textContent = __( 'Open in editor', 'desktop-mode' );
	editBtn.addEventListener( 'click', () => {
		openEditor( entity, detail.id, stripTags( detail.title.rendered ) );
	} );
	footer.appendChild( editBtn );

	article.appendChild( footer );

	host.appendChild( article );
}

function buildPostMetaLine( detail: EntityDetail ): HTMLElement | null {
	const parts: string[] = [];
	const author = detail._embedded?.author?.[ 0 ];
	if ( author?.name ) {
		parts.push( author.name );
	}
	if ( detail.date ) {
		try {
			parts.push(
				new Date( detail.date ).toLocaleDateString( undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				} ),
			);
		} catch {
			parts.push( detail.date );
		}
	}
	if ( detail.status && detail.status !== 'publish' ) {
		parts.push( detail.status );
	}
	if ( parts.length === 0 ) {
		return null;
	}
	const line = document.createElement( 'p' );
	line.className = 'desktop-mode-my-wordpress__article-meta';
	line.textContent = parts.join( ' · ' );
	return line;
}

/* ---------------------------------------------------------- *
 *  Detail view — drilled into via "Navigate into".
 *
 *  Layout = same two-pane shell as the entity-list view: the
 *  left pane shows folder-style tiles for each related entity
 *  type (Author, Comments, Categories, Tags, Featured image,
 *  Attached media, Revisions); the right pane keeps the post's
 *  rendered article visible so the user always knows which
 *  post they're inside.
 * ---------------------------------------------------------- */

function renderDetail(
	state: RenderState,
	entity: MyWordPressEntity,
	postId: number,
	postTitle: string,
): void {
	const split = document.createElement( 'div' );
	split.className = 'desktop-mode-my-wordpress__split';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list';
	const tiles = document.createElement( 'div' );
	tiles.className =
		'desktop-mode-my-wordpress__tiles desktop-mode-my-wordpress__canvas';
	tiles.setAttribute( 'role', 'list' );
	left.appendChild( tiles );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__preview';
	showPreviewLoading( right );

	split.appendChild( left );
	split.appendChild( right );
	state.body.appendChild( split );

	const layout = createTileLayout(
		tiles,
		`detail:${ entity.id }:${ postId }`,
	);
	const menu = attachIconCanvasMenu( tiles, {
		scope: `my-wordpress:${ entity.id }:detail:${ postId }`,
		onSort: ( mode ) => layout.sort( mode ),
	} );
	state.teardown.push( () => menu.dispose() );
	state.teardown.push( () => layout.dispose() );

	// Show a placeholder tile-grid spinner while we load the post.
	const spinnerWrap = document.createElement( 'div' );
	spinnerWrap.className = 'desktop-mode-my-wordpress__spinner';
	spinnerWrap.appendChild( document.createElement( 'wpd-spinner' ) );
	tiles.appendChild( spinnerWrap );

	void ( async () => {
		let detail: EntityDetail;
		try {
			detail = await fetchEntityDetail( entity, postId );
		} catch ( err ) {
			tiles.removeChild( spinnerWrap );
			renderListError(
				tiles,
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' ),
			);
			showPreviewError( right, err );
			return;
		}

		// Skip if the user navigated away while fetching.
		if (
			state.route.kind !== 'detail' ||
			state.route.postId !== postId
		) {
			return;
		}

		tiles.removeChild( spinnerWrap );

		const select = createTileSelector();

		const subFolders: Array< {
			relation: SubRelation;
			label: string;
			icon: string;
			count: number;
			disabled?: boolean;
			synthDate: string;
		} > = [];
		let dateCounter = 0;
		const nextDate = () =>
			new Date( 2020, 0, 1 + dateCounter++ ).toISOString();

		const author = detail._embedded?.author?.[ 0 ];
		subFolders.push( {
			relation: 'author',
			label: author?.name
				? sprintf(
					// translators: %s is an author display name.
					__( 'Author · %s', 'desktop-mode' ),
					author.name,
				)
				: __( 'Author', 'desktop-mode' ),
			icon: 'dashicons-admin-users',
			count: 1,
			disabled: ! detail.author,
			synthDate: nextDate(),
		} );

		// Contributors — additional users beyond the post_author,
		// sourced server-side from Co-Authors Plus + the
		// `desktop_mode_my_wordpress_post_contributors` filter.
		// Hide the folder when no extras exist.
		const contributors = detail.desktop_mode_contributors ?? [];
		if ( contributors.length > 0 ) {
			subFolders.push( {
				relation: 'contributors',
				label: sprintf(
					// translators: %d is a count of additional contributor users.
					_n(
						'Contributors · %d',
						'Contributors · %d',
						contributors.length,
					),
					contributors.length,
				),
				icon: 'dashicons-groups',
				count: contributors.length,
				synthDate: nextDate(),
			} );
		}

		const commentsHref = ( detail._links?.replies ?? [] )[ 0 ];
		const commentCountFromLink =
			typeof commentsHref?.count === 'number' ? commentsHref.count : null;
		const repliesEmbed = detail._embedded?.replies?.[ 0 ] ?? [];
		const commentCount =
			commentCountFromLink ?? repliesEmbed.length;
		subFolders.push( {
			relation: 'comments',
			label: sprintf(
				// translators: %d is a comment count.
				_n( 'Comments · %d', 'Comments · %d', commentCount ),
				commentCount,
			),
			icon: 'dashicons-admin-comments',
			count: commentCount,
			disabled: detail.comment_status === 'closed' && commentCount === 0,
			synthDate: nextDate(),
		} );

		const categoryIds = detail.categories ?? [];
		if ( categoryIds.length > 0 ) {
			subFolders.push( {
				relation: 'categories',
				label: sprintf(
					// translators: %d is a category count.
					_n( 'Categories · %d', 'Categories · %d', categoryIds.length ),
					categoryIds.length,
				),
				icon: 'dashicons-category',
				count: categoryIds.length,
				synthDate: nextDate(),
			} );
		}

		const tagIds = detail.tags ?? [];
		if ( tagIds.length > 0 ) {
			subFolders.push( {
				relation: 'tags',
				label: sprintf(
					// translators: %d is a tag count.
					_n( 'Tags · %d', 'Tags · %d', tagIds.length ),
					tagIds.length,
				),
				icon: 'dashicons-tag',
				count: tagIds.length,
				synthDate: nextDate(),
			} );
		}

		if ( detail.featured_media && detail.featured_media > 0 ) {
			subFolders.push( {
				relation: 'media',
				label: __( 'Attached media', 'desktop-mode' ),
				icon: 'dashicons-format-image',
				count: 1,
				synthDate: nextDate(),
			} );
		} else {
			// Even without a featured image there may be media attached
			// to this post — surface the folder so users can check.
			subFolders.push( {
				relation: 'media',
				label: __( 'Attached media', 'desktop-mode' ),
				icon: 'dashicons-admin-media',
				count: 0,
				synthDate: nextDate(),
			} );
		}

		subFolders.push( {
			relation: 'revisions',
			label: __( 'Revisions', 'desktop-mode' ),
			icon: 'dashicons-backup',
			count: 0,
			synthDate: nextDate(),
		} );

		for ( const sub of subFolders ) {
			const tile = buildIconTile( {
				role: 'folder',
				icon: sub.icon,
				label: sub.label,
			} );
			tile.dataset.relation = sub.relation;
			if ( sub.disabled ) {
				tile.setAttribute( 'aria-disabled', 'true' );
			}
			const tileKey = `relation:${ sub.relation }`;
			layout.place( tile, tileKey, {
				name: sub.label,
				date: sub.synthDate,
			} );
			attachTileDrag( tile, layout, {
				tileKey,
				// Sub-folder tiles use the same Finder-style
				// semantics as the root folder tiles: single click
				// selects (visual only), double click navigates.
				// Disabled tiles still receive the selection so the
				// user has a hover/focus affordance, but no dblclick
				// listener is attached below.
				onClick: () => select( tile ),
			} );
			if ( ! sub.disabled ) {
				tile.addEventListener( 'dblclick', ( e ) => {
					e.preventDefault();
					navigate( state, {
						kind: 'sub-list',
						entityId: entity.id,
						postId,
						postTitle,
						relation: sub.relation,
					} );
				} );
			}
			tiles.appendChild( tile );
		}

		appendPostArticle( right, detail, entity );

		const segments: StatusBarSegment[] = [
			{
				id: 'count',
				label: pluralLabel(
					subFolders.length,
					'folder',
					'folders',
				),
				align: 'start',
				sort: 10,
			},
		];
		if ( detail.status ) {
			segments.push( {
				id: 'status',
				label: detail.status,
				align: 'end',
				sort: 10,
			} );
		}
		paintStatus( state, segments, {
			view: 'detail',
			entityId: entity.id,
			postId,
		} );
	} )();

	// Initial spinner-time status — replaced by the segments above
	// once the post detail resolves.
	paintStatus(
		state,
		[
			{
				id: 'loading',
				label: __( 'Loading…', 'desktop-mode' ),
				align: 'start',
				sort: 10,
			},
		],
		{ view: 'detail', entityId: entity.id, postId },
	);

	void postTitle; // Reserved for future header rendering inside the canvas.
}

/* ---------------------------------------------------------- *
 *  Sub-list view — drilled into from a detail-view tile.
 *  Lists individual related items (one comment / one term /
 *  one media / one revision per tile) with a context-sensitive
 *  preview pane on the right.
 * ---------------------------------------------------------- */

interface SubItemView {
	id: string;
	icon: string;
	label: string;
	date: string;
	preview: () => HTMLElement | Promise< HTMLElement >;
}

function renderSubList(
	state: RenderState,
	entity: MyWordPressEntity,
	postId: number,
	postTitle: string,
	relation: SubRelation,
): void {
	const split = document.createElement( 'div' );
	split.className = 'desktop-mode-my-wordpress__split';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list';
	const tiles = document.createElement( 'div' );
	tiles.className =
		'desktop-mode-my-wordpress__tiles desktop-mode-my-wordpress__canvas';
	tiles.setAttribute( 'role', 'list' );
	left.appendChild( tiles );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__preview';
	const previewEmpty = document.createElement( 'div' );
	previewEmpty.className = 'desktop-mode-my-wordpress__preview-empty';
	previewEmpty.textContent = __(
		'Select an item to preview it here.',
		'desktop-mode',
	);
	right.appendChild( previewEmpty );

	split.appendChild( left );
	split.appendChild( right );
	state.body.appendChild( split );

	const layout = createTileLayout(
		tiles,
		`sub-list:${ entity.id }:${ postId }:${ relation }`,
	);
	const menu = attachIconCanvasMenu( tiles, {
		scope: `my-wordpress:${ entity.id }:${ relation }:${ postId }`,
		onSort: ( mode ) => layout.sort( mode ),
	} );
	state.teardown.push( () => menu.dispose() );
	state.teardown.push( () => layout.dispose() );

	const spinnerWrap = document.createElement( 'div' );
	spinnerWrap.className = 'desktop-mode-my-wordpress__spinner';
	spinnerWrap.appendChild( document.createElement( 'wpd-spinner' ) );
	tiles.appendChild( spinnerWrap );

	paintStatus(
		state,
		[
			{
				id: 'loading',
				label: __( 'Loading…', 'desktop-mode' ),
				align: 'start',
				sort: 10,
			},
		],
		{ view: 'sub-list', entityId: entity.id, postId, relation },
	);

	void ( async () => {
		let items: SubItemView[];
		try {
			items = await loadSubItems( entity, postId, relation );
		} catch ( err ) {
			tiles.removeChild( spinnerWrap );
			renderListError(
				tiles,
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' ),
			);
			return;
		}

		if (
			state.route.kind !== 'sub-list' ||
			state.route.postId !== postId ||
			state.route.relation !== relation
		) {
			return;
		}

		tiles.removeChild( spinnerWrap );

		paintStatus(
			state,
			[
				{
					id: 'count',
					label: pluralLabel( items.length, 'item', 'items' ),
					align: 'start',
					sort: 10,
				},
			],
			{
				view: 'sub-list',
				entityId: entity.id,
				postId,
				relation,
			},
		);

		if ( items.length === 0 ) {
			renderListEmptyMessage(
				tiles,
				emptySubListMessage( relation ),
			);
			return;
		}

		let selectedKey: string | null = null;
		let selectedTile: HTMLElement | null = null;

		for ( const item of items ) {
			const tile = buildIconTile( {
				role: 'entry',
				icon: item.icon,
				label: item.label,
			} );
			tile.dataset.subItemId = item.id;
			const tileKey = `sub:${ item.id }`;
			layout.place( tile, tileKey, {
				name: item.label,
				date: item.date,
			} );
			attachTileDrag( tile, layout, {
				tileKey,
				onClick: () => {
					if ( selectedTile ) {
						selectedTile.classList.remove(
							'desktop-mode-my-wordpress__tile--selected',
						);
					}
					tile.classList.add(
						'desktop-mode-my-wordpress__tile--selected',
					);
					selectedTile = tile;
					selectedKey = tileKey;

					showPreviewLoading( right );
					Promise.resolve( item.preview() )
						.then( ( node ) => {
							if ( selectedKey !== tileKey ) {
								return; // Selection moved on.
							}
							right.replaceChildren( node );
						} )
						.catch( ( err ) => {
							if ( selectedKey !== tileKey ) {
								return;
							}
							showPreviewError( right, err );
						} );
				},
			} );
			tiles.appendChild( tile );
		}
	} )();

	// `postTitle` is captured by the route + breadcrumb helpers; this
	// view doesn't need it inline today but the signature mirrors the
	// other render functions for consistency.
	void postTitle;
}

function renderListEmptyMessage(
	host: HTMLElement,
	message: string,
): void {
	const empty = document.createElement( 'div' );
	empty.className = 'desktop-mode-my-wordpress__empty';
	empty.textContent = message;
	host.appendChild( empty );
}

function emptySubListMessage( relation: SubRelation ): string {
	switch ( relation ) {
		case 'comments':
			return __( 'No comments on this post yet.', 'desktop-mode' );
		case 'categories':
			return __( 'No categories assigned.', 'desktop-mode' );
		case 'tags':
			return __( 'No tags assigned.', 'desktop-mode' );
		case 'media':
			return __( 'No media attached to this post.', 'desktop-mode' );
		case 'revisions':
			return __( 'No revisions yet.', 'desktop-mode' );
		case 'author':
			return __( 'No author available.', 'desktop-mode' );
		case 'contributors':
			return __( 'No additional contributors.', 'desktop-mode' );
		default:
			return __( 'Nothing to show.', 'desktop-mode' );
	}
}

async function loadSubItems(
	entity: MyWordPressEntity,
	postId: number,
	relation: SubRelation,
): Promise< SubItemView[] > {
	if ( relation === 'comments' ) {
		const comments = await fetchComments( postId );
		return comments.map( commentToView );
	}
	if ( relation === 'media' ) {
		// Three sources are merged here, in priority order:
		//
		//  1. **Featured image** — `post.featured_media`. Always
		//     surfaced first when set.
		//  2. **In-content references** — Gutenberg's image / gallery
		//     blocks render `<img class="wp-image-NNN">`, and core's
		//     classic editor wraps the same NNN attachment id around
		//     uploads via `[caption id="attachment_NNN"]`. Modern
		//     posts upload media as standalone (`parent=0`) and
		//     reference them from block markup, so this regex pass
		//     is the canonical "media on this post" answer for any
		//     post that hasn't been touched in the legacy editor.
		//  3. **Parent-attached** — `?parent=postId`. Mostly empty
		//     for Gutenberg posts, but valid for classic-editor
		//     uploads. Kept for completeness.
		//
		// The three lists are deduped by id and fetched in one
		// `?include=…` round-trip.
		const detail = await fetchEntityDetail( entity, postId );
		const ids = new Set< number >();
		if ( detail.featured_media && detail.featured_media > 0 ) {
			ids.add( detail.featured_media );
		}
		extractContentMediaIds( detail.content?.rendered ?? '' ).forEach(
			( id ) => ids.add( id ),
		);

		// Parent-attached pass runs in parallel with the include-batch
		// fetch since they don't depend on each other.
		const [ batched, parentAttached ] = await Promise.all( [
			fetchMediaByIds( Array.from( ids ) ).catch( () => [] ),
			fetchAttachedMedia( postId ).catch( () => [] ),
		] );

		const seen = new Set< number >();
		const merged: RelatedMedia[] = [];
		// Featured first (so it sits at column 0), then any extra
		// in-content references in document order, then any
		// parent-attached items the previous two missed.
		const featuredId = detail.featured_media ?? 0;
		const orderedFromBatch = batched
			.slice()
			.sort( ( a, b ) => {
				if ( a.id === featuredId && b.id !== featuredId ) {
					return -1;
				}
				if ( b.id === featuredId && a.id !== featuredId ) {
					return 1;
				}
				return 0;
			} );
		for ( const m of [ ...orderedFromBatch, ...parentAttached ] ) {
			if ( seen.has( m.id ) ) {
				continue;
			}
			seen.add( m.id );
			merged.push( m );
		}
		return merged.map( mediaToView );
	}
	if ( relation === 'categories' || relation === 'tags' ) {
		const detail = await fetchEntityDetail( entity, postId );
		const ids =
			relation === 'categories'
				? detail.categories ?? []
				: detail.tags ?? [];
		const terms = await fetchTerms(
			relation === 'categories' ? 'categories' : 'tags',
			ids,
		);
		return terms.map( termToView );
	}
	if ( relation === 'author' ) {
		const detail = await fetchEntityDetail( entity, postId );
		if ( ! detail.author ) {
			return [];
		}
		const user = await fetchUser( detail.author );
		return [ userToView( user ) ];
	}
	if ( relation === 'contributors' ) {
		// The contributor payload from REST already carries
		// userId / userName / userAvatarUrl, so we can build views
		// without an extra `/wp/v2/users/<id>` round-trip per row.
		// On a sub-item click we still upgrade to a full user fetch
		// for the rich preview (bio, link) — see `contributorToView`.
		const detail = await fetchEntityDetail( entity, postId );
		const contribs = detail.desktop_mode_contributors ?? [];
		return contribs.map( contributorToView );
	}
	if ( relation === 'revisions' ) {
		const revs = await fetchRevisions( entity, postId );
		// Revisions only make sense in chronological order — newest
		// first by default. The user can still re-sort via the
		// canvas Sort By menu if they want alphabetic / oldest first.
		const ordered = revs.slice().sort( ( a, b ) => {
			const ta = Date.parse( a.modified || a.date || '' );
			const tb = Date.parse( b.modified || b.date || '' );
			return tb - ta;
		} );
		return ordered.map( ( r ) => revisionToView( r, entity, postId ) );
	}
	return [];
}

function commentToView( c: RelatedComment ): SubItemView {
	const author = c.author_name || __( 'Anonymous', 'desktop-mode' );
	return {
		id: `comment:${ c.id }`,
		icon: 'dashicons-admin-comments',
		label: author,
		date: c.date,
		preview: async () => renderCommentDossier( c ),
	};
}

/**
 * Right-pane dossier for a single comment. Header is the author
 * card (avatar + name + status badge + activity count), then the
 * comment body, then context — parent post link with author chip,
 * reply-to-quote when this is a thread reply, sibling replies if
 * any. Single round-trip to `/desktop-mode/v1/comment-stats/<id>`.
 */
async function renderCommentDossier(
	c: RelatedComment,
): Promise< HTMLElement > {
	let stats: CommentStats | null = null;
	try {
		stats = await fetchCommentStats( c.id );
	} catch {
		stats = null;
	}

	const wrap = document.createElement( 'div' );
	wrap.className =
		'desktop-mode-my-wordpress__article desktop-mode-my-wordpress__comment';

	if ( ! stats ) {
		// Fall back to the listing payload — at least we have the
		// content + status from the original comments fetch.
		appendCommentHeader( wrap, {
			authorName: c.author_name || __( 'Anonymous', 'desktop-mode' ),
			avatarUrl: c.author_avatar_urls
				? pickAvatar( c.author_avatar_urls ) ?? ''
				: '',
			authorLink: '',
			authorWebsite: '',
			status: c.status || 'approved',
			date: c.date,
			editLink: '',
			totalApproved: 0,
		} );
		const body = document.createElement( 'div' );
		body.className =
			'desktop-mode-my-wordpress__article-content desktop-mode-my-wordpress__comment-body';
		body.innerHTML = c.content.rendered;
		wrap.appendChild( body );
		return wrap;
	}

	const { author, comment, post, parent, replies } = stats;

	appendCommentHeader( wrap, {
		authorName:
			author.displayName ||
			author.name ||
			__( 'Anonymous', 'desktop-mode' ),
		avatarUrl: author.avatarUrl,
		authorLink: author.profileLink ?? '',
		authorWebsite: author.url ?? '',
		status: comment.status,
		date: comment.date,
		editLink: comment.editLink,
		totalApproved: author.totalApprovedComments,
	} );

	// Parent comment quote (when this is a reply).
	if ( parent ) {
		const quote = document.createElement( 'blockquote' );
		quote.className = 'desktop-mode-my-wordpress__comment-quote';
		const lead = document.createElement( 'div' );
		lead.className = 'desktop-mode-my-wordpress__comment-quote-lead';
		lead.textContent = sprintf(
			// translators: %s is the parent comment's author name.
			__( 'In reply to %s', 'desktop-mode' ),
			parent.authorName,
		);
		quote.appendChild( lead );
		const excerpt = document.createElement( 'p' );
		excerpt.textContent = parent.excerpt || '';
		quote.appendChild( excerpt );
		wrap.appendChild( quote );
	}

	// The comment body itself.
	const body = document.createElement( 'div' );
	body.className =
		'desktop-mode-my-wordpress__article-content desktop-mode-my-wordpress__comment-body';
	// `comment.rendered` is run server-side through the standard
	// `comment_text` filter chain, which is the same trust model
	// the public site uses to render comments.
	body.innerHTML = comment.rendered;
	wrap.appendChild( body );

	// Parent post card.
	if ( post ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'On post', 'desktop-mode' );
		section.appendChild( h );
		const card = document.createElement( 'div' );
		card.className = 'desktop-mode-my-wordpress__comment-post';
		const titleEl = document.createElement( 'a' );
		titleEl.className = 'desktop-mode-my-wordpress__comment-post-title';
		titleEl.href = post.link;
		titleEl.target = '_blank';
		titleEl.rel = 'noopener noreferrer';
		titleEl.textContent = post.title || `#${ post.id }`;
		card.appendChild( titleEl );
		const meta = document.createElement( 'div' );
		meta.className = 'desktop-mode-my-wordpress__comment-post-meta';
		const parts: string[] = [];
		parts.push( formatDate( post.date ) );
		if ( post.author?.name ) {
			parts.push( post.author.name );
		}
		if ( post.status && post.status !== 'publish' ) {
			parts.push( post.status );
		}
		meta.textContent = parts.join( ' · ' );
		card.appendChild( meta );
		section.appendChild( card );
		wrap.appendChild( section );
	}

	// Replies thread.
	if ( replies.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = sprintf(
			// translators: %d is the number of direct replies to a comment.
			_n( 'Reply (%d)', 'Replies (%d)', replies.length ),
			replies.length,
		);
		section.appendChild( h );
		const list = document.createElement( 'ul' );
		list.className = 'desktop-mode-my-wordpress__comment-replies';
		for ( const r of replies ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-my-wordpress__comment-reply';
			if ( r.avatarUrl ) {
				const img = document.createElement( 'img' );
				img.src = r.avatarUrl;
				img.alt = '';
				img.className =
					'desktop-mode-my-wordpress__comment-reply-avatar';
				li.appendChild( img );
			}
			const txt = document.createElement( 'div' );
			txt.className = 'desktop-mode-my-wordpress__comment-reply-text';
			const head = document.createElement( 'div' );
			head.className = 'desktop-mode-my-wordpress__comment-reply-head';
			const who = document.createElement( 'span' );
			who.className = 'desktop-mode-my-wordpress__comment-reply-name';
			who.textContent = r.authorName || __( 'Anonymous', 'desktop-mode' );
			head.appendChild( who );
			const when = document.createElement( 'span' );
			when.className = 'desktop-mode-my-wordpress__comment-reply-when';
			when.textContent = formatDate( r.date );
			head.appendChild( when );
			txt.appendChild( head );
			const ex = document.createElement( 'p' );
			ex.className = 'desktop-mode-my-wordpress__comment-reply-excerpt';
			ex.textContent = r.excerpt || '';
			txt.appendChild( ex );
			li.appendChild( txt );
			list.appendChild( li );
		}
		section.appendChild( list );
		wrap.appendChild( section );
	}

	// Moderation/forensic strip — only shown to users with
	// `moderate_comments` (the server doesn't ship these otherwise).
	if ( comment.ip || comment.userAgent ) {
		const dl = document.createElement( 'dl' );
		dl.className = 'desktop-mode-my-wordpress__user-milestones';
		if ( comment.ip ) {
			const dt = document.createElement( 'dt' );
			dt.textContent = __( 'IP', 'desktop-mode' );
			dl.appendChild( dt );
			const dd = document.createElement( 'dd' );
			dd.textContent = comment.ip;
			dl.appendChild( dd );
		}
		if ( comment.userAgent ) {
			const dt = document.createElement( 'dt' );
			dt.textContent = __( 'User agent', 'desktop-mode' );
			dl.appendChild( dt );
			const dd = document.createElement( 'dd' );
			dd.textContent = comment.userAgent;
			dl.appendChild( dd );
		}
		wrap.appendChild( dl );
	}

	return wrap;
}

function appendCommentHeader(
	host: HTMLElement,
	header: {
		authorName: string;
		avatarUrl: string;
		authorLink: string;
		authorWebsite: string;
		status: string;
		date: string;
		editLink: string;
		totalApproved: number;
	},
): void {
	const wrap = document.createElement( 'header' );
	wrap.className = 'desktop-mode-my-wordpress__user-header';

	if ( header.avatarUrl ) {
		const img = document.createElement( 'img' );
		img.src = header.avatarUrl;
		img.alt = '';
		img.className = 'desktop-mode-my-wordpress__user-avatar';
		wrap.appendChild( img );
	}

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__user-headline';

	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = header.authorName;
	right.appendChild( h );

	const badges = document.createElement( 'div' );
	badges.className = 'desktop-mode-my-wordpress__user-roles';
	const status = document.createElement( 'span' );
	status.className =
		'desktop-mode-my-wordpress__user-role desktop-mode-my-wordpress__comment-status--' +
		( header.status || 'approved' );
	status.textContent = header.status || 'approved';
	badges.appendChild( status );
	const dateBadge = document.createElement( 'span' );
	dateBadge.className =
		'desktop-mode-my-wordpress__user-role desktop-mode-my-wordpress__comment-date-badge';
	dateBadge.textContent = formatDate( header.date );
	badges.appendChild( dateBadge );
	if ( header.totalApproved > 1 ) {
		const totalBadge = document.createElement( 'span' );
		totalBadge.className = 'desktop-mode-my-wordpress__user-role';
		totalBadge.textContent = sprintf(
			// translators: %d is a comment count for a particular author.
			_n(
				'%d comment site-wide',
				'%d comments site-wide',
				header.totalApproved,
			),
			header.totalApproved,
		);
		badges.appendChild( totalBadge );
	}
	right.appendChild( badges );

	const links = document.createElement( 'div' );
	links.className = 'desktop-mode-my-wordpress__user-links';
	if ( header.authorLink ) {
		const a = document.createElement( 'a' );
		a.href = header.authorLink;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Author archive', 'desktop-mode' );
		links.appendChild( a );
	}
	if ( header.authorWebsite ) {
		const a = document.createElement( 'a' );
		a.href = header.authorWebsite;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Website', 'desktop-mode' );
		links.appendChild( a );
	}
	if ( header.editLink ) {
		const a = document.createElement( 'a' );
		a.href = header.editLink;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Moderate', 'desktop-mode' );
		links.appendChild( a );
	}
	if ( links.childElementCount > 0 ) {
		right.appendChild( links );
	}

	wrap.appendChild( right );
	host.appendChild( wrap );
}

function userToView( u: RelatedUser ): SubItemView {
	return {
		id: `user:${ u.id }`,
		icon: 'dashicons-admin-users',
		label: u.name || u.slug || `#${ u.id }`,
		date: new Date( 0 ).toISOString(),
		preview: async () => {
			const fallbackName = u.name || u.slug || `#${ u.id }`;
			const fallbackAvatar = pickAvatar( u.avatar_urls ) ?? '';
			return renderUserDossier( {
				userId: u.id,
				fallbackName,
				fallbackAvatar,
				fallbackDescription: u.description ?? '',
			} );
		},
	};
}

/**
 * Build a SubItemView from the compact `ContributorRef` shape that
 * the `desktop_mode_contributors` REST field returns. The tile +
 * basic preview come from the embedded payload — no extra round-
 * trip for the tile. Clicking the tile fires the rich user-stats
 * endpoint for the dossier, falling back to the compact shape +
 * a `/wp/v2/users/<id>` description fetch on permission errors.
 */
function contributorToView( c: ContributorRef ): SubItemView {
	return {
		id: `contributor:${ c.userId }`,
		icon: 'dashicons-admin-users',
		label: c.userName || `#${ c.userId }`,
		date: new Date( 0 ).toISOString(),
		preview: async () =>
			renderUserDossier( {
				userId: c.userId,
				fallbackName: c.userName,
				fallbackAvatar: c.userAvatarUrl,
				fallbackDescription: '',
			} ),
	};
}

/**
 * One-stop renderer for the right preview pane when a user is
 * selected (Author or Contributors sub-folder).
 *
 * Source of truth is `/desktop-mode/v1/user-stats/<id>` — a single
 * round-trip that returns profile + counts + recent activity +
 * top categories + activity sparkline. On permission errors we
 * fall through to the compact `/wp/v2/users/<id>` view.
 */
async function renderUserDossier( opts: {
	userId: number;
	fallbackName: string;
	fallbackAvatar: string;
	fallbackDescription: string;
} ): Promise< HTMLElement > {
	let stats: UserStats | null = null;
	try {
		stats = await fetchUserStats( opts.userId );
	} catch {
		stats = null;
	}

	const wrap = document.createElement( 'div' );
	wrap.className =
		'desktop-mode-my-wordpress__article desktop-mode-my-wordpress__user';

	if ( ! stats ) {
		// Permission denied / network error — fall back to the
		// compact REST user record so we at least show name + bio.
		let basic: RelatedUser | null = null;
		try {
			basic = await fetchUser( opts.userId );
		} catch {
			basic = null;
		}
		appendUserHeader( wrap, {
			name: basic?.name ?? opts.fallbackName,
			avatarUrl:
				( basic && pickAvatar( basic.avatar_urls ) ) || opts.fallbackAvatar,
			roles: [],
			website: '',
			link: basic?.link ?? '',
		} );
		const desc = basic?.description ?? opts.fallbackDescription;
		if ( desc ) {
			const bio = document.createElement( 'div' );
			bio.className = 'desktop-mode-my-wordpress__user-bio';
			bio.textContent = desc;
			wrap.appendChild( bio );
		}
		return wrap;
	}

	const { profile, counts, recent, topTerms, milestones, activity } = stats;

	appendUserHeader( wrap, {
		name: profile.name || opts.fallbackName,
		avatarUrl: profile.avatarUrl || opts.fallbackAvatar,
		roles: profile.roleLabels ?? [],
		website: profile.website,
		link: profile.link,
	} );

	if ( profile.description ) {
		const bio = document.createElement( 'div' );
		bio.className = 'desktop-mode-my-wordpress__user-bio';
		bio.textContent = profile.description;
		wrap.appendChild( bio );
	}

	// Stat cards row.
	const cards = document.createElement( 'div' );
	cards.className = 'desktop-mode-my-wordpress__user-stats';
	cards.appendChild(
		buildStatCard(
			counts.posts.total.toLocaleString(),
			__( 'Posts', 'desktop-mode' ),
			counts.posts.publish > 0
				? sprintf(
					// translators: %d is a published-post count.
					__( '%d published', 'desktop-mode' ),
					counts.posts.publish,
				)
				: '',
		),
	);
	cards.appendChild(
		buildStatCard(
			counts.pages.total.toLocaleString(),
			__( 'Pages', 'desktop-mode' ),
			counts.pages.publish > 0
				? sprintf(
					// translators: %d is a published-page count.
					__( '%d published', 'desktop-mode' ),
					counts.pages.publish,
				)
				: '',
		),
	);
	cards.appendChild(
		buildStatCard(
			counts.commentsReceived.toLocaleString(),
			__( 'Comments received', 'desktop-mode' ),
			'',
		),
	);
	cards.appendChild(
		buildStatCard(
			counts.commentsLeft.toLocaleString(),
			__( 'Comments left', 'desktop-mode' ),
			'',
		),
	);
	wrap.appendChild( cards );

	// Activity sparkline (12-month publishing rhythm).
	const spark = buildActivitySparkline( activity );
	if ( spark ) {
		wrap.appendChild( spark );
	}

	// Milestones row.
	const milestoneRow = buildMilestonesRow( profile, milestones );
	if ( milestoneRow ) {
		wrap.appendChild( milestoneRow );
	}

	// Recent activity list.
	if ( recent.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'Recent posts', 'desktop-mode' );
		section.appendChild( h );
		const ul = document.createElement( 'ul' );
		ul.className = 'desktop-mode-my-wordpress__user-recent';
		for ( const r of recent ) {
			const li = document.createElement( 'li' );
			const a = document.createElement( 'a' );
			a.href = r.link;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = r.title || `#${ r.id }`;
			li.appendChild( a );
			const meta = document.createElement( 'span' );
			meta.className = 'desktop-mode-my-wordpress__user-recent-meta';
			meta.textContent = `${ formatDate( r.date ) } · ${ r.status }`;
			li.appendChild( meta );
			ul.appendChild( li );
		}
		section.appendChild( ul );
		wrap.appendChild( section );
	}

	// Top categories / tags as chips.
	if ( topTerms.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'Top categories & tags', 'desktop-mode' );
		section.appendChild( h );
		const chips = document.createElement( 'div' );
		chips.className = 'desktop-mode-my-wordpress__user-chips';
		for ( const t of topTerms ) {
			const chip = document.createElement( 'span' );
			chip.className =
				'desktop-mode-my-wordpress__user-chip ' +
				( t.taxonomy === 'post_tag'
					? 'desktop-mode-my-wordpress__user-chip--tag'
					: 'desktop-mode-my-wordpress__user-chip--category' );
			const name = document.createElement( 'span' );
			name.textContent = t.name;
			chip.appendChild( name );
			const count = document.createElement( 'span' );
			count.className = 'desktop-mode-my-wordpress__user-chip-count';
			count.textContent = String( t.count );
			chip.appendChild( count );
			chips.appendChild( chip );
		}
		section.appendChild( chips );
		wrap.appendChild( section );
	}

	return wrap;
}

function appendUserHeader(
	host: HTMLElement,
	header: {
		name: string;
		avatarUrl: string;
		roles: string[];
		website: string;
		link: string;
	},
): void {
	const wrap = document.createElement( 'header' );
	wrap.className = 'desktop-mode-my-wordpress__user-header';

	if ( header.avatarUrl ) {
		const img = document.createElement( 'img' );
		img.src = header.avatarUrl;
		img.alt = '';
		img.className = 'desktop-mode-my-wordpress__user-avatar';
		wrap.appendChild( img );
	}

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__user-headline';
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = header.name;
	right.appendChild( h );

	if ( header.roles.length > 0 ) {
		const rolesRow = document.createElement( 'div' );
		rolesRow.className = 'desktop-mode-my-wordpress__user-roles';
		for ( const r of header.roles ) {
			const badge = document.createElement( 'span' );
			badge.className = 'desktop-mode-my-wordpress__user-role';
			badge.textContent = r;
			rolesRow.appendChild( badge );
		}
		right.appendChild( rolesRow );
	}

	const links = document.createElement( 'div' );
	links.className = 'desktop-mode-my-wordpress__user-links';
	if ( header.link ) {
		const a = document.createElement( 'a' );
		a.href = header.link;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Author archive', 'desktop-mode' );
		links.appendChild( a );
	}
	if ( header.website ) {
		const a = document.createElement( 'a' );
		a.href = header.website;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Website', 'desktop-mode' );
		links.appendChild( a );
	}
	if ( links.childElementCount > 0 ) {
		right.appendChild( links );
	}

	wrap.appendChild( right );
	host.appendChild( wrap );
}

function buildStatCard(
	value: string,
	label: string,
	caption: string,
): HTMLElement {
	const card = document.createElement( 'div' );
	card.className = 'desktop-mode-my-wordpress__user-stat';
	const v = document.createElement( 'span' );
	v.className = 'desktop-mode-my-wordpress__user-stat-value';
	v.textContent = value;
	card.appendChild( v );
	const l = document.createElement( 'span' );
	l.className = 'desktop-mode-my-wordpress__user-stat-label';
	l.textContent = label;
	card.appendChild( l );
	if ( caption ) {
		const c = document.createElement( 'span' );
		c.className = 'desktop-mode-my-wordpress__user-stat-caption';
		c.textContent = caption;
		card.appendChild( c );
	}
	return card;
}

/**
 * Build an inline SVG sparkline of "posts published per month for
 * the last 12 months." Returns `null` when the user has no
 * activity in the window — drawing an empty chart adds noise.
 */
function buildActivitySparkline(
	activity: UserStats[ 'activity' ],
): HTMLElement | null {
	if ( activity.length === 0 ) {
		return null;
	}
	// Fill missing months so the bar chart shows the full 12-month
	// rhythm even for sparse posters.
	const now = new Date();
	const months: Array< { ym: string; count: number; label: string } > = [];
	for ( let i = 11; i >= 0; i -= 1 ) {
		const d = new Date( now.getFullYear(), now.getMonth() - i, 1 );
		const ym = `${ d.getFullYear() }-${ String( d.getMonth() + 1 ).padStart( 2, '0' ) }`;
		const found = activity.find( ( a ) => a.ym === ym );
		months.push( {
			ym,
			count: found?.count ?? 0,
			label: d.toLocaleString( undefined, { month: 'short' } ),
		} );
	}
	const max = Math.max( 1, ...months.map( ( m ) => m.count ) );

	const wrap = document.createElement( 'section' );
	wrap.className =
		'desktop-mode-my-wordpress__user-section desktop-mode-my-wordpress__user-spark';
	const h = document.createElement( 'h3' );
	h.textContent = __( 'Activity (last 12 months)', 'desktop-mode' );
	wrap.appendChild( h );

	const chart = document.createElement( 'div' );
	chart.className = 'desktop-mode-my-wordpress__user-spark-chart';
	for ( const m of months ) {
		const col = document.createElement( 'div' );
		col.className = 'desktop-mode-my-wordpress__user-spark-col';
		const bar = document.createElement( 'div' );
		bar.className = 'desktop-mode-my-wordpress__user-spark-bar';
		bar.style.height = `${ Math.round( ( m.count / max ) * 100 ) }%`;
		bar.title = sprintf(
			// translators: 1: month label, 2: post count.
			__( '%1$s · %2$d posts', 'desktop-mode' ),
			m.label,
			m.count,
		);
		if ( m.count === 0 ) {
			bar.classList.add( 'desktop-mode-my-wordpress__user-spark-bar--empty' );
		}
		col.appendChild( bar );
		const lbl = document.createElement( 'span' );
		lbl.className = 'desktop-mode-my-wordpress__user-spark-label';
		lbl.textContent = m.label;
		col.appendChild( lbl );
		chart.appendChild( col );
	}
	wrap.appendChild( chart );
	return wrap;
}

function buildMilestonesRow(
	profile: UserStats[ 'profile' ],
	milestones: UserStats[ 'milestones' ],
): HTMLElement | null {
	const items: Array< { label: string; value: string } > = [];
	if ( profile.registered ) {
		items.push( {
			label: __( 'Member since', 'desktop-mode' ),
			value: formatYearMonth( profile.registered ),
		} );
	}
	if ( milestones.firstPublished ) {
		items.push( {
			label: __( 'First published', 'desktop-mode' ),
			value: formatYearMonth( milestones.firstPublished ),
		} );
	}
	if ( milestones.lastPublished ) {
		items.push( {
			label: __( 'Last published', 'desktop-mode' ),
			value: formatYearMonth( milestones.lastPublished ),
		} );
	}
	if ( items.length === 0 ) {
		return null;
	}
	const dl = document.createElement( 'dl' );
	dl.className = 'desktop-mode-my-wordpress__user-milestones';
	for ( const item of items ) {
		const dt = document.createElement( 'dt' );
		dt.textContent = item.label;
		dl.appendChild( dt );
		const dd = document.createElement( 'dd' );
		dd.textContent = item.value;
		dl.appendChild( dd );
	}
	return dl;
}

function formatYearMonth( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString( undefined, {
			year: 'numeric',
			month: 'long',
		} );
	} catch {
		return iso;
	}
}

function pickAvatar(
	avatars?: Record< string, string >,
): string | null {
	if ( ! avatars ) {
		return null;
	}
	return (
		avatars[ '96' ] ??
		avatars[ '48' ] ??
		avatars[ '24' ] ??
		Object.values( avatars )[ 0 ] ??
		null
	);
}

function termToView( t: RelatedTerm ): SubItemView {
	return {
		id: `term:${ t.id }`,
		icon: t.taxonomy === 'post_tag' ? 'dashicons-tag' : 'dashicons-category',
		label: t.name,
		date: new Date( 0 ).toISOString(),
		preview: async () => renderTermDossier( t ),
	};
}

/**
 * Right-pane dossier for a term (category / tag): same WOW
 * treatment as the user dossier — header with badge + count, stat
 * cards (Posts / Comments / Distinct authors), 12-month activity
 * sparkline, milestones, recent posts (with author avatars), top
 * authors as cards, and co-occurring terms as chips. Source of
 * truth is the new `desktop_mode/v1/term-stats/<tax>/<id>`
 * endpoint — single round-trip per selection.
 */
async function renderTermDossier( t: RelatedTerm ): Promise< HTMLElement > {
	let stats: TermStats | null = null;
	try {
		stats = await fetchTermStats( t.taxonomy, t.id );
	} catch {
		stats = null;
	}

	const wrap = document.createElement( 'div' );
	wrap.className =
		'desktop-mode-my-wordpress__article desktop-mode-my-wordpress__term';

	if ( ! stats ) {
		// Permission denied / unknown taxonomy — fall back to the
		// compact REST term record.
		appendTermHeader( wrap, {
			name: t.name,
			taxonomyLabel: t.taxonomy,
			isTag: t.taxonomy === 'post_tag',
			count: t.count ?? 0,
			link: t.link ?? '',
			parentName: '',
		} );
		if ( t.description ) {
			const body = document.createElement( 'div' );
			body.className = 'desktop-mode-my-wordpress__user-bio';
			body.innerHTML = t.description;
			wrap.appendChild( body );
		}
		return wrap;
	}

	const { profile, counts, recent, topAuthors, coTerms, milestones, activity } =
		stats;

	appendTermHeader( wrap, {
		name: profile.name,
		taxonomyLabel: profile.taxonomyLabel || profile.taxonomy,
		isTag: profile.taxonomy === 'post_tag',
		count: profile.storedCount,
		link: profile.link,
		parentName: profile.parentName ?? '',
	} );

	if ( profile.description ) {
		const bio = document.createElement( 'div' );
		bio.className = 'desktop-mode-my-wordpress__user-bio';
		bio.innerHTML = profile.description;
		wrap.appendChild( bio );
	}

	// Stat cards.
	const cards = document.createElement( 'div' );
	cards.className = 'desktop-mode-my-wordpress__user-stats';
	cards.appendChild(
		buildStatCard(
			counts.posts.total.toLocaleString(),
			__( 'Posts', 'desktop-mode' ),
			counts.posts.publish > 0
				? sprintf(
					// translators: %d is a published-post count.
					__( '%d published', 'desktop-mode' ),
					counts.posts.publish,
				)
				: '',
		),
	);
	cards.appendChild(
		buildStatCard(
			counts.commentsReceived.toLocaleString(),
			__( 'Comments', 'desktop-mode' ),
			'',
		),
	);
	cards.appendChild(
		buildStatCard(
			counts.distinctAuthors.toLocaleString(),
			__( 'Authors', 'desktop-mode' ),
			counts.distinctAuthors === 1
				? __( 'one contributor', 'desktop-mode' )
				: '',
		),
	);
	wrap.appendChild( cards );

	// 12-month activity sparkline (reused from the user dossier).
	const spark = buildActivitySparkline( activity );
	if ( spark ) {
		wrap.appendChild( spark );
	}

	// Milestones.
	const milestoneRow = buildTermMilestonesRow( milestones );
	if ( milestoneRow ) {
		wrap.appendChild( milestoneRow );
	}

	// Top authors row — cards with avatar + name + count.
	if ( topAuthors.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'Top contributors', 'desktop-mode' );
		section.appendChild( h );
		const grid = document.createElement( 'div' );
		grid.className = 'desktop-mode-my-wordpress__term-authors';
		for ( const a of topAuthors ) {
			const card = document.createElement( 'div' );
			card.className = 'desktop-mode-my-wordpress__term-author';
			if ( a.userAvatarUrl ) {
				const img = document.createElement( 'img' );
				img.src = a.userAvatarUrl;
				img.alt = '';
				img.className = 'desktop-mode-my-wordpress__term-author-avatar';
				card.appendChild( img );
			}
			const text = document.createElement( 'div' );
			text.className = 'desktop-mode-my-wordpress__term-author-text';
			const name = document.createElement( 'span' );
			name.className = 'desktop-mode-my-wordpress__term-author-name';
			name.textContent = a.userName;
			text.appendChild( name );
			const count = document.createElement( 'span' );
			count.className = 'desktop-mode-my-wordpress__term-author-count';
			count.textContent = sprintf(
				// translators: %d is a post count.
				_n( '%d post', '%d posts', a.count ),
				a.count,
			);
			text.appendChild( count );
			card.appendChild( text );
			grid.appendChild( card );
		}
		section.appendChild( grid );
		wrap.appendChild( section );
	}

	// Recent posts in this term — reuse user-dossier styling, add
	// inline author avatar.
	if ( recent.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'Recent posts', 'desktop-mode' );
		section.appendChild( h );
		const ul = document.createElement( 'ul' );
		ul.className = 'desktop-mode-my-wordpress__user-recent';
		for ( const r of recent ) {
			const li = document.createElement( 'li' );
			const a = document.createElement( 'a' );
			a.href = r.link;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = r.title || `#${ r.id }`;
			li.appendChild( a );
			const meta = document.createElement( 'span' );
			meta.className = 'desktop-mode-my-wordpress__user-recent-meta';
			meta.textContent = `${ formatDate( r.date ) } · ${ r.status }${
				r.author?.name ? ' · ' + r.author.name : ''
			}`;
			li.appendChild( meta );
			ul.appendChild( li );
		}
		section.appendChild( ul );
		wrap.appendChild( section );
	}

	// Co-occurring terms ("Often paired with…") — chips.
	if ( coTerms.length > 0 ) {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__user-section';
		const h = document.createElement( 'h3' );
		h.textContent =
			profile.taxonomy === 'post_tag'
				? __( 'Often paired tags', 'desktop-mode' )
				: __( 'Often paired categories', 'desktop-mode' );
		section.appendChild( h );
		const chips = document.createElement( 'div' );
		chips.className = 'desktop-mode-my-wordpress__user-chips';
		for ( const co of coTerms ) {
			const chip = document.createElement( 'span' );
			chip.className =
				'desktop-mode-my-wordpress__user-chip ' +
				( profile.taxonomy === 'post_tag'
					? 'desktop-mode-my-wordpress__user-chip--tag'
					: 'desktop-mode-my-wordpress__user-chip--category' );
			const name = document.createElement( 'span' );
			name.textContent = co.name;
			chip.appendChild( name );
			const count = document.createElement( 'span' );
			count.className = 'desktop-mode-my-wordpress__user-chip-count';
			count.textContent = String( co.count );
			chip.appendChild( count );
			chips.appendChild( chip );
		}
		section.appendChild( chips );
		wrap.appendChild( section );
	}

	return wrap;
}

function appendTermHeader(
	host: HTMLElement,
	header: {
		name: string;
		taxonomyLabel: string;
		isTag: boolean;
		count: number;
		link: string;
		parentName: string;
	},
): void {
	const wrap = document.createElement( 'header' );
	wrap.className = 'desktop-mode-my-wordpress__term-header';

	const iconHost = document.createElement( 'span' );
	iconHost.className =
		'desktop-mode-my-wordpress__term-icon ' +
		( header.isTag
			? 'desktop-mode-my-wordpress__term-icon--tag'
			: 'desktop-mode-my-wordpress__term-icon--category' );
	const iconGlyph = document.createElement( 'span' );
	iconGlyph.style.cssText =
		'font-family:dashicons;font-size:32px;line-height:1;display:inline-block;';
	// dashicons "tag" () for post_tag, "category" () for category.
	iconGlyph.textContent = header.isTag ? '' : '';
	iconHost.appendChild( iconGlyph );
	wrap.appendChild( iconHost );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-my-wordpress__user-headline';

	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = header.name;
	right.appendChild( h );

	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-my-wordpress__user-roles';
	const taxBadge = document.createElement( 'span' );
	taxBadge.className =
		'desktop-mode-my-wordpress__user-role ' +
		( header.isTag
			? 'desktop-mode-my-wordpress__user-role--tag'
			: 'desktop-mode-my-wordpress__user-role--category' );
	taxBadge.textContent = header.taxonomyLabel;
	meta.appendChild( taxBadge );
	if ( header.parentName ) {
		const parent = document.createElement( 'span' );
		parent.className = 'desktop-mode-my-wordpress__user-role';
		parent.textContent = sprintf(
			// translators: %s is the name of the parent category.
			__( 'in %s', 'desktop-mode' ),
			header.parentName,
		);
		meta.appendChild( parent );
	}
	right.appendChild( meta );

	if ( header.link ) {
		const links = document.createElement( 'div' );
		links.className = 'desktop-mode-my-wordpress__user-links';
		const a = document.createElement( 'a' );
		a.href = header.link;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'View archive', 'desktop-mode' );
		links.appendChild( a );
		right.appendChild( links );
	}

	wrap.appendChild( right );
	host.appendChild( wrap );
}

function buildTermMilestonesRow(
	milestones: TermStats[ 'milestones' ],
): HTMLElement | null {
	const items: Array< { label: string; value: string } > = [];
	if ( milestones.firstPosted ) {
		items.push( {
			label: __( 'First post', 'desktop-mode' ),
			value: formatYearMonth( milestones.firstPosted ),
		} );
	}
	if ( milestones.lastPosted ) {
		items.push( {
			label: __( 'Last post', 'desktop-mode' ),
			value: formatYearMonth( milestones.lastPosted ),
		} );
	}
	if ( items.length === 0 ) {
		return null;
	}
	const dl = document.createElement( 'dl' );
	dl.className = 'desktop-mode-my-wordpress__user-milestones';
	for ( const item of items ) {
		const dt = document.createElement( 'dt' );
		dt.textContent = item.label;
		dl.appendChild( dt );
		const dd = document.createElement( 'dd' );
		dd.textContent = item.value;
		dl.appendChild( dd );
	}
	return dl;
}

function mediaToView( m: RelatedMedia ): SubItemView {
	const isImage = m.mime_type.startsWith( 'image/' );
	return {
		id: `media:${ m.id }`,
		icon: isImage ? 'dashicons-format-image' : 'dashicons-media-default',
		label: stripTags( m.title.rendered ) || `#${ m.id }`,
		date: m.date,
		preview: () => {
			const wrap = document.createElement( 'div' );
			wrap.className = 'desktop-mode-my-wordpress__article';
			const h = document.createElement( 'h2' );
			h.className = 'desktop-mode-my-wordpress__article-title';
			h.textContent = stripTags( m.title.rendered ) || `#${ m.id }`;
			wrap.appendChild( h );
			const meta = document.createElement( 'p' );
			meta.className = 'desktop-mode-my-wordpress__article-meta';
			meta.textContent = `${ m.mime_type } · ${ formatDate( m.date ) }`;
			wrap.appendChild( meta );
			if ( isImage ) {
				const img = document.createElement( 'img' );
				img.className = 'desktop-mode-my-wordpress__article-hero';
				const sizes = m.media_details?.sizes;
				img.src =
					sizes?.large?.source_url ??
					sizes?.medium?.source_url ??
					m.source_url;
				img.alt = m.alt_text ?? '';
				wrap.appendChild( img );
			} else {
				const link = document.createElement( 'p' );
				const a = document.createElement( 'a' );
				a.href = m.source_url;
				a.textContent = m.source_url;
				a.target = '_blank';
				a.rel = 'noopener noreferrer';
				link.appendChild( a );
				wrap.appendChild( link );
			}
			return wrap;
		},
	};
}

function revisionToView(
	r: RelatedRevision,
	entity: MyWordPressEntity,
	postId: number,
): SubItemView {
	const label = stripTags( r.title?.rendered ?? '' ) || formatDate( r.date );
	return {
		id: `revision:${ r.id }`,
		icon: 'dashicons-backup',
		label,
		date: r.modified || r.date,
		preview: async () => {
			// Lazy-fetch the full revision so the rendered HTML is
			// only pulled when the user actually selects it. Listing
			// stays cheap (title + dates).
			let detail: RelatedRevisionDetail | null = null;
			try {
				detail = await fetchRevision( entity, postId, r.id );
			} catch {
				detail = null;
			}

			const wrap = document.createElement( 'article' );
			wrap.className = 'desktop-mode-my-wordpress__article';

			const h = document.createElement( 'h2' );
			h.className = 'desktop-mode-my-wordpress__article-title';
			h.textContent =
				stripTags( detail?.title?.rendered ?? r.title?.rendered ?? '' ) ||
				label;
			wrap.appendChild( h );

			const meta = document.createElement( 'p' );
			meta.className = 'desktop-mode-my-wordpress__article-meta';
			meta.textContent = sprintf(
				// translators: %s is a formatted date.
				__( 'Saved %s', 'desktop-mode' ),
				formatDate( detail?.modified || detail?.date || r.modified || r.date ),
			);
			wrap.appendChild( meta );

			const html = detail?.content?.rendered ?? '';
			if ( html ) {
				const content = document.createElement( 'div' );
				content.className =
					'desktop-mode-my-wordpress__article-content';
				// `content.rendered` is sanitised server-side by
				// core's `the_content` pipeline before it reaches
				// the REST response.
				content.innerHTML = html;
				wrap.appendChild( content );
			} else {
				const empty = document.createElement( 'p' );
				empty.className = 'desktop-mode-my-wordpress__article-meta';
				empty.textContent = detail
					? __( 'This revision has no rendered content.', 'desktop-mode' )
					: __(
						'Couldn’t load the revision content. You may not have permission to view it.',
						'desktop-mode',
					);
				wrap.appendChild( empty );
			}
			return wrap;
		},
	};
}

function formatDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString();
	} catch {
		return iso;
	}
}

function openEditor(
	entity: MyWordPressEntity,
	id: number,
	title: string,
): void {
	const url = buildEditUrl( id );
	openIframeWindow( {
		id: `${ entity.id }-edit-${ id }`,
		url,
		title,
		icon: entity.icon,
	} );
}

function openTileMenu(
	state: RenderState,
	ctx: ListContext,
	entity: MyWordPressEntity,
	item: EntityListItem,
	title: string,
	pos: { x: number; y: number },
): void {
	closeAnyTileMenu();

	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'desktop-mode-my-wordpress__menu' );
	( menu as HTMLElement ).style.left = `${ pos.x }px`;
	( menu as HTMLElement ).style.top = `${ pos.y }px`;

	const addOption = (
		id: string,
		label: string,
		icon: string,
		danger = false,
	) => {
		const opt = document.createElement( 'wpd-context-menu-option' );
		// `wpd-context-menu-option` emits the pick event with
		// `detail.id = dataset.menuItemId ?? this.id ?? ''`. We MUST
		// set `dataset.menuItemId` (the `value` attribute alone shows
		// up under `detail.value`, which the handler below doesn't
		// inspect). Forgetting this gave us the silent "Navigate
		// into doesn't work" bug.
		( opt as HTMLElement ).dataset.menuItemId = id;
		opt.setAttribute( 'value', id );
		opt.setAttribute( 'icon', sanitizeClass( icon ) );
		if ( danger ) {
			opt.setAttribute( 'danger', '' );
		}
		opt.textContent = label;
		menu.appendChild( opt );
	};

	addOption(
		'open',
		__( 'Open in editor', 'desktop-mode' ),
		'dashicons-edit',
	);
	addOption(
		'navigate-into',
		__( 'Navigate into', 'desktop-mode' ),
		'dashicons-category',
	);
	addOption(
		'trash',
		__( 'Move to Trash', 'desktop-mode' ),
		'dashicons-trash',
		true,
	);

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		closeAnyTileMenu();
		if ( detail.id === 'open' ) {
			openEditor( entity, item.id, title );
			return;
		}
		if ( detail.id === 'navigate-into' ) {
			navigate( state, {
				kind: 'detail',
				entityId: entity.id,
				postId: item.id,
				postTitle: title,
			} );
			return;
		}
		if ( detail.id === 'trash' ) {
			void confirmTrash( state, ctx, entity, item.id, title );
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

	// Outside-click + Escape dismissers. Until now the only thing
	// that closed the tile menu was a pick or another right-click —
	// so a left-click on a *different* tile (which selects + previews)
	// left the menu hovering. The dismissers run on the next
	// microtask so the click that opened the menu doesn't immediately
	// close it when the event bubbles up to document.
	queueMicrotask( () => {
		const onDocPointerDown = ( ev: PointerEvent ) => {
			const target = ev.target;
			if ( target instanceof Node && menu.contains( target ) ) {
				return;
			}
			closeAnyTileMenu();
		};
		const onDocKey = ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Escape' ) {
				closeAnyTileMenu();
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

function closeAnyTileMenu(): void {
	document
		.querySelectorAll( 'wpd-context-menu.desktop-mode-my-wordpress__menu' )
		.forEach( ( n ) => {
			n.dispatchEvent( new CustomEvent( 'tile-menu-closed' ) );
			n.remove();
		} );
}

async function confirmTrash(
	state: RenderState,
	ctx: ListContext,
	entity: MyWordPressEntity,
	id: number,
	title: string,
): Promise< void > {
	const ok = await wpdConfirmGlobal( {
		title: __( 'Move to Trash', 'desktop-mode' ),
		message: sprintf(
			// translators: %s is the entry title.
			__( 'Move "%s" to Trash?', 'desktop-mode' ),
			title,
		),
		confirmLabel: __( 'Move to Trash', 'desktop-mode' ),
		cancelLabel: __( 'Cancel', 'desktop-mode' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}
	try {
		await trashEntity( entity, id );
	} catch ( err ) {
		const msg =
			err instanceof Error ? err.message : __( 'Unknown error.', 'desktop-mode' );
		showToast( msg );
		return;
	}
	const tile = ctx.tiles.querySelector< HTMLElement >(
		`[data-entry-id="${ id }"]`,
	);
	tile?.remove();
	if ( ctx.selectedId === id ) {
		ctx.selectedId = null;
		ctx.selectedTile = null;
		ctx.preview.replaceChildren();
		const empty = document.createElement( 'div' );
		empty.className = 'desktop-mode-my-wordpress__preview-empty';
		empty.textContent = __(
			'Select an entry to preview it here.',
			'desktop-mode',
		);
		ctx.preview.appendChild( empty );
	}
	// Suppress linter's "state unused" — we keep it in the signature
	// for future "navigate into" wiring that needs the state ref.
	void state;
}

function showToast( message: string ): void {
	const toast = (
		window.wp as
			| {
					desktop?: {
						toast?: ( o: { message: string } ) => void;
					};
			}
			| undefined
	)?.desktop?.toast;
	if ( typeof toast === 'function' ) {
		toast( { message } );
		return;
	}
	// Fallback: log it. Better than nothing, never noisy.
	// eslint-disable-next-line no-console
	console.info( '[my-wordpress]', message );
}

function sanitizeClass( raw: string ): string {
	return ( raw || '' ).replace( /[^a-zA-Z0-9_-]/g, '' );
}

/**
 * Pull every attachment id referenced by image markup inside a
 * rendered post body. Two patterns are matched:
 *
 *   - `<img class="… wp-image-NNN …">` — the standard Gutenberg
 *     image / gallery / cover-block markup, plus the classic
 *     editor's media-library inserts.
 *   - `[caption id="attachment_NNN"]` shortcodes — legacy classic
 *     editor uploads that didn't get expanded server-side.
 *
 * Returns deduped ids in document-encounter order so the resulting
 * sub-list paints media in the order the user wrote them. Bails
 * gracefully on empty / non-string input.
 */
function extractContentMediaIds( html: string ): number[] {
	if ( ! html || typeof html !== 'string' ) {
		return [];
	}
	const ids: number[] = [];
	const seen = new Set< number >();
	const push = ( raw: string ) => {
		const id = parseInt( raw, 10 );
		if ( Number.isFinite( id ) && id > 0 && ! seen.has( id ) ) {
			seen.add( id );
			ids.push( id );
		}
	};
	const wpImage = /\bwp-image-(\d+)\b/g;
	let m: RegExpExecArray | null;
	// eslint-disable-next-line no-cond-assign
	while ( ( m = wpImage.exec( html ) ) !== null ) {
		push( m[ 1 ] );
	}
	const captionShort = /\[caption[^\]]*id="attachment_(\d+)"/g;
	// eslint-disable-next-line no-cond-assign
	while ( ( m = captionShort.exec( html ) ) !== null ) {
		push( m[ 1 ] );
	}
	return ids;
}

/**
 * Single-tile selection tracker scoped to one canvas. Mirrors the
 * Finder/Explorer "single click selects, double click opens" model:
 * the click handler clears the previous tile's selected class and
 * applies it to the new one. A second click on the already-selected
 * tile is idempotent.
 *
 * Returns the click handler to wire into `attachTileDrag.onClick`.
 */
function createTileSelector(): ( tile: HTMLElement ) => void {
	let selected: HTMLElement | null = null;
	return ( tile: HTMLElement ) => {
		if ( selected === tile ) {
			return;
		}
		if ( selected ) {
			selected.classList.remove(
				'desktop-mode-my-wordpress__tile--selected',
			);
		}
		tile.classList.add( 'desktop-mode-my-wordpress__tile--selected' );
		selected = tile;
	};
}

/* ------------------------------------------------------------------ *
 *  Tile layout + drag — small in-window port of the wallpaper's
 *  `FilesLayer` pointer-drag pattern. Tiles are absolute-positioned
 *  inside a relatively-positioned host; positions persist per-window
 *  in `localStorage` so reopening the window keeps your arrangement.
 *
 *  We don't reuse `FilesLayer` directly because it's bound to the
 *  REST `_desktop_mode_placements` table — virtual entities don't
 *  belong there. The interaction model is the same (pointer capture,
 *  click-vs-drag threshold, `--dragging` class).
 * ------------------------------------------------------------------ */

const TILE_W = 96;
const TILE_H = 92;
const TILE_PAD = 16;

export interface TileSortable {
	/** Used by `name-asc` / `name-desc`. Compared with `localeCompare`. */
	name: string;
	/** ISO timestamp; `'date-asc'` / `'date-desc'` parse with `Date.parse`. */
	date: string;
}

interface TileEntry {
	key: string;
	tile: HTMLElement;
	sortable: TileSortable;
	/**
	 * `true` when the user has explicitly placed this tile (via drag,
	 * sort-by, or a saved-from-localStorage position). Auto-flowed
	 * tiles set this `false` so a window-resize reflow can move them
	 * into the new column count without disturbing user-placed ones.
	 */
	userPlaced: boolean;
}

interface TileLayout {
	host: HTMLElement;
	scope: string;
	place: (
		tile: HTMLElement,
		key: string,
		sortable: TileSortable,
	) => void;
	commit: ( tile: HTMLElement, key: string, x: number, y: number ) => void;
	sort: ( mode: SortMode ) => void;
	/** Re-flow auto-placed tiles to the current canvas width. */
	reflow: () => void;
	dispose: () => void;
}

function createTileLayout( host: HTMLElement, scope: string ): TileLayout {
	const positions = loadPositions( scope );
	const entries: TileEntry[] = [];
	/**
	 * Set of cell keys (`"<col>,<row>"`) currently claimed by any
	 * tile, user-placed or auto-flowed. The auto-flow walker
	 * (`nextFreeCell`) skips occupied cells so a freshly-placed
	 * tile never lands on top of one that came before it. Without
	 * this set, mixing user-placed and auto-flow tiles produced
	 * overlapping stacks at column 0 row 0.
	 */
	const occupied = new Set< string >();

	host.classList.add( 'desktop-mode-my-wordpress__canvas--positioned' );

	const cellOf = ( x: number, y: number ): { col: number; row: number } => ( {
		col: Math.max( 0, Math.round( ( x - TILE_PAD ) / TILE_W ) ),
		row: Math.max( 0, Math.round( ( y - TILE_PAD ) / TILE_H ) ),
	} );

	const occupyAt = ( x: number, y: number ): void => {
		const { col, row } = cellOf( x, y );
		occupied.add( `${ col },${ row }` );
	};

	const releaseAt = ( x: number, y: number ): void => {
		const { col, row } = cellOf( x, y );
		occupied.delete( `${ col },${ row }` );
	};

	const recomputeHostHeight = () => {
		// Grow host so absolute tiles aren't clipped by the parent
		// scroller. We track the lowest tile bottom edge.
		let maxBottom = 0;
		for ( const child of Array.from( host.children ) ) {
			if ( ! ( child instanceof HTMLElement ) ) {
				continue;
			}
			if ( ! child.classList.contains( 'desktop-mode-file-tile' ) ) {
				continue;
			}
			const top = parseFloat( child.style.top || '0' );
			maxBottom = Math.max( maxBottom, top + TILE_H );
		}
		host.style.minHeight = `${ Math.max( 0, maxBottom + TILE_PAD ) }px`;
	};

	/**
	 * First column-major cell that no tile occupies. Used by every
	 * auto-flow path (`place()` for tiles without a saved position,
	 * `reflow()` for tiles previously auto-placed).
	 */
	const nextFreeCell = ( cols: number ): { col: number; row: number } => {
		for ( let n = 0; ; n += 1 ) {
			const col = n % cols;
			const row = Math.floor( n / cols );
			if ( ! occupied.has( `${ col },${ row }` ) ) {
				return { col, row };
			}
		}
	};

	const place = (
		tile: HTMLElement,
		key: string,
		sortable: TileSortable,
	) => {
		const saved = positions[ key ];
		// Reject saved positions that don't fit the current canvas
		// width — typical case: the user's previous session was on a
		// larger display, the tile was dragged to x = 600, the new
		// canvas is only 400 wide, the tile would render off-screen.
		// Discard the stale position and auto-flow instead.
		const width =
			host.clientWidth > 0 ? host.clientWidth : TILE_PAD + 5 * TILE_W;
		const cols = Math.max(
			1,
			Math.floor( ( width - TILE_PAD ) / TILE_W ),
		);
		const fits = saved && saved.x + TILE_W <= width;
		const entry: TileEntry = {
			key,
			tile,
			sortable,
			userPlaced: !! fits,
		};
		entries.push( entry );
		let x: number;
		let y: number;
		if ( fits && saved ) {
			x = saved.x;
			y = saved.y;
		} else {
			if ( saved && ! fits ) {
				delete positions[ key ];
				savePositions( scope, positions );
			}
			const cell = nextFreeCell( cols );
			x = TILE_PAD + cell.col * TILE_W;
			y = TILE_PAD + cell.row * TILE_H;
		}
		occupyAt( x, y );
		applyTilePosition( tile, x, y );
		recomputeHostHeight();
	};

	const commit = (
		tile: HTMLElement,
		key: string,
		x: number,
		y: number,
	) => {
		// Free up the tile's current cell before claiming the new one
		// so a drag from cell A to cell B doesn't permanently mark A
		// as occupied.
		const oldX = parseFloat( tile.style.left || '0' );
		const oldY = parseFloat( tile.style.top || '0' );
		releaseAt( oldX, oldY );
		applyTilePosition( tile, x, y );
		occupyAt( x, y );
		positions[ key ] = { x, y };
		savePositions( scope, positions );
		const entry = entries.find( ( e ) => e.key === key );
		if ( entry ) {
			entry.userPlaced = true;
		}
		recomputeHostHeight();
	};

	/**
	 * Reflow auto-placed tiles into the current canvas width.
	 * User-placed tiles (dragged or restored from localStorage) keep
	 * their positions — same trade-off macOS Finder makes when you
	 * resize a folder window with both auto-arranged and manually-
	 * dragged icons.
	 *
	 * Called by the ResizeObserver below on every canvas-width change
	 * AND surfaced as an action (`desktop-mode.icon-canvas.reflow`)
	 * so plugin authors can react.
	 */
	const reflow = (): void => {
		const width =
			host.clientWidth > 0 ? host.clientWidth : TILE_PAD + 5 * TILE_W;
		const cols = Math.max(
			1,
			Math.floor( ( width - TILE_PAD ) / TILE_W ),
		);

		// Detect "saved layout no longer fits this canvas." If any
		// tile's stored position would render past the right edge
		// of the visible canvas, the user-placed positions came from
		// a wider window (or a portrait→landscape rotation, etc.)
		// and we'd otherwise leave tiles invisible off-screen. Force
		// a clean re-layout in that case AND drop the stale saved
		// positions — the next drag re-establishes a layout that
		// fits the current window.
		const overflowing = entries.some( ( entry ) => {
			const left = parseFloat( entry.tile.style.left || '0' );
			return left + TILE_W > width;
		} );
		if ( overflowing ) {
			for ( const k of Object.keys( positions ) ) {
				delete positions[ k ];
			}
			savePositions( scope, positions );
			for ( const entry of entries ) {
				entry.userPlaced = false;
			}
		}

		// Rebuild the occupied set from scratch — we're about to
		// reposition tiles, so any stale claims need to clear first.
		// Seed it with userPlaced tiles' CURRENT positions so the
		// auto-flow walker avoids them.
		occupied.clear();
		for ( const entry of entries ) {
			if ( ! entry.userPlaced ) {
				continue;
			}
			const left = parseFloat( entry.tile.style.left || '0' );
			const top = parseFloat( entry.tile.style.top || '0' );
			occupyAt( left, top );
		}

		let autoCount = 0;
		for ( const entry of entries ) {
			if ( entry.userPlaced ) {
				continue;
			}
			const cell = nextFreeCell( cols );
			const x = TILE_PAD + cell.col * TILE_W;
			const y = TILE_PAD + cell.row * TILE_H;
			applyTilePosition( entry.tile, x, y );
			occupyAt( x, y );
			autoCount += 1;
		}
		recomputeHostHeight();
		doAction( 'desktop-mode.icon-canvas.reflow', {
			scope,
			cols,
			autoCount,
			overflowing,
		} );
	};

	const sort = ( mode: SortMode ) => {
		const sorted = entries.slice().sort( ( a, b ) => {
			switch ( mode ) {
				case 'name-asc':
					return a.sortable.name.localeCompare( b.sortable.name );
				case 'name-desc':
					return b.sortable.name.localeCompare( a.sortable.name );
				case 'date-asc':
					return (
						Date.parse( a.sortable.date ) -
						Date.parse( b.sortable.date )
					);
				case 'date-desc':
					return (
						Date.parse( b.sortable.date ) -
						Date.parse( a.sortable.date )
					);
				default:
					return 0;
			}
		} );

		// Re-flow into the grid order, dropping any user-placed
		// positions for this scope. Sorting is a "reset to clean
		// flow" gesture — the same way Finder treats it.
		const width =
			host.clientWidth > 0 ? host.clientWidth : TILE_PAD + 5 * TILE_W;
		const cols = Math.max(
			1,
			Math.floor( ( width - TILE_PAD ) / TILE_W ),
		);
		for ( const k of Object.keys( positions ) ) {
			delete positions[ k ];
		}
		// Sort assigns every tile a fresh deterministic cell; clear
		// the occupied set and rebuild it as we lay tiles down.
		occupied.clear();
		sorted.forEach( ( entry, idx ) => {
			const col = idx % cols;
			const row = Math.floor( idx / cols );
			const x = TILE_PAD + col * TILE_W;
			const y = TILE_PAD + row * TILE_H;
			applyTilePosition( entry.tile, x, y );
			occupyAt( x, y );
			positions[ entry.key ] = { x, y };
			// Sort assigns deterministic positions; treat as user-
			// placed so the resize reflow doesn't undo it.
			entry.userPlaced = true;
		} );
		savePositions( scope, positions );
		// Re-append in sorted DOM order so the focus ring + tab
		// order match the visual order.
		for ( const entry of sorted ) {
			host.appendChild( entry.tile );
		}
		recomputeHostHeight();
	};

	// ResizeObserver fires whenever the canvas width changes — window
	// resize, dock collapse, parent flex reflow, anything. We track
	// the last width to skip no-op fires (height changes alone don't
	// affect column count) and the initial fire that ResizeObserver
	// emits on `observe()`.
	let lastWidth = host.clientWidth;
	let resizeObserver: ResizeObserver | null = null;
	if ( typeof ResizeObserver !== 'undefined' ) {
		resizeObserver = new ResizeObserver( () => {
			const w = host.clientWidth;
			if ( w === lastWidth ) {
				return;
			}
			lastWidth = w;
			reflow();
		} );
		resizeObserver.observe( host );
	}

	return {
		host,
		scope,
		place,
		commit,
		sort,
		reflow,
		dispose: () => {
			resizeObserver?.disconnect();
			resizeObserver = null;
		},
	};
}

function applyTilePosition( tile: HTMLElement, x: number, y: number ): void {
	// `Math.round` keeps the tile on integer device-pixel boundaries
	// — sub-pixel coordinates trigger GPU-rasterized text blur on
	// HiDPI screens, which is what was making the labels look fuzzy.
	tile.style.left = `${ Math.round( x ) }px`;
	tile.style.top = `${ Math.round( y ) }px`;
}

function loadPositions( scope: string ): Record< string, { x: number; y: number } > {
	try {
		const raw = window.localStorage.getItem( storageKey( scope ) );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw );
		return ( parsed && typeof parsed === 'object' ? parsed : {} ) as Record<
			string,
			{ x: number; y: number }
		>;
	} catch {
		return {};
	}
}

function savePositions(
	scope: string,
	positions: Record< string, { x: number; y: number } >,
): void {
	try {
		window.localStorage.setItem(
			storageKey( scope ),
			JSON.stringify( positions ),
		);
	} catch {
		// Quota exceeded / disabled — the visual position survives in
		// memory until reload. No user-facing error worth the noise.
	}
}

function storageKey( scope: string ): string {
	return `desktop-mode-my-wordpress:positions:${ scope }`;
}

interface TileDragOpts {
	tileKey: string;
	onClick: () => void;
	onDragStart?: () => void;
}

const DRAG_THRESHOLD_PX = 4;

function attachTileDrag(
	tile: HTMLElement,
	layout: TileLayout,
	opts: TileDragOpts,
): void {
	let drag: {
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null = null;

	const onPointerDown = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const originX = parseFloat( tile.style.left || '0' );
		const originY = parseFloat( tile.style.top || '0' );
		drag = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			originX,
			originY,
			moved: false,
		};
		try {
			tile.setPointerCapture( e.pointerId );
		} catch {
			// Older browsers / non-pointer-capture-friendly hosts —
			// drag still works via document-level listeners below.
		}
	};

	const onPointerMove = ( e: PointerEvent ) => {
		if ( ! drag || drag.pointerId !== e.pointerId ) {
			return;
		}
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (
			! drag.moved &&
			Math.abs( dx ) < DRAG_THRESHOLD_PX &&
			Math.abs( dy ) < DRAG_THRESHOLD_PX
		) {
			return;
		}
		if ( ! drag.moved ) {
			drag.moved = true;
			tile.classList.add( 'desktop-mode-file-tile--dragging' );
			opts.onDragStart?.();
		}
		applyTilePosition( tile, drag.originX + dx, drag.originY + dy );
	};

	const onPointerEnd = ( e: PointerEvent ) => {
		if ( ! drag || drag.pointerId !== e.pointerId ) {
			return;
		}
		const wasMoved = drag.moved;
		try {
			tile.releasePointerCapture( e.pointerId );
		} catch {
			// Already released.
		}
		tile.classList.remove( 'desktop-mode-file-tile--dragging' );
		if ( ! wasMoved ) {
			drag = null;
			opts.onClick();
			return;
		}
		// Drag is intentionally NON-rearranging inside My WordPress.
		// The tile lifts during the drag (visual feedback) but snaps
		// back to its origin on release — internal cell layout is
		// auto-flow-only and not user-arrangeable. The drag affordance
		// stays alive so a future cross-window drag-out (e.g. drag a
		// post tile onto the wallpaper to create a shortcut) has a
		// gesture to hook into. For now, no external drop target =
		// snap back.
		applyTilePosition( tile, drag.originX, drag.originY );
		drag = null;
		// `layout` is preserved in scope for future drag-out wiring.
		void layout;
		void opts.tileKey;
	};

	tile.addEventListener( 'pointerdown', onPointerDown );
	tile.addEventListener( 'pointermove', onPointerMove );
	tile.addEventListener( 'pointerup', onPointerEnd );
	tile.addEventListener( 'pointercancel', onPointerEnd );
}

/**
 * Live `RenderState` for the currently-mounted My WordPress
 * window, or `null` when it isn't open. Captured in `renderInto`
 * and cleared on close — used by the public
 * `wp.desktop.myWordpress.openDetail()` API so any other shell
 * surface (folder window CMO, plugin code) can route the My
 * WordPress window directly into a post's detail dossier without
 * duplicating the per-relation rendering.
 */
let activeState: RenderState | null = null;
/**
 * Pending route applied on next `renderInto`. When the My WordPress
 * window isn't open yet, `openDetail()` opens it AND queues a
 * navigation here; the freshly-mounted state pulls + clears the
 * queue.
 */
let pendingRoute: Route | null = null;

function renderInto( body: HTMLElement ): void {
	const root = body.querySelector< HTMLElement >( ROOT_SEL );
	if ( ! root ) {
		return;
	}
	const breadcrumbsHost = root.querySelector< HTMLElement >( BREADCRUMBS_SEL );
	const bodyHost = root.querySelector< HTMLElement >( BODY_SEL );
	const statusHost = root.querySelector< HTMLElement >( STATUS_SEL );
	if ( ! breadcrumbsHost || ! bodyHost || ! statusHost ) {
		return;
	}

	const state: RenderState = {
		route: { kind: 'root' },
		body: bodyHost,
		root,
		breadcrumbs: breadcrumbsHost,
		statusBar: statusHost,
		teardown: [],
	};
	activeState = state;

	// Back button + crumb-click handlers are wired by the shared
	// breadcrumb helper inside `updateBreadcrumbs` — no per-element
	// listener wiring here anymore.

	// Tear down on close.
	const closeHandler = ( e: Event ) => {
		const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId === WINDOW_ID ) {
			clearTeardown( state );
			closeAnyTileMenu();
			if ( activeState === state ) {
				activeState = null;
			}
			document.removeEventListener( 'desktop-mode-window-closed', closeHandler );
		}
	};
	document.addEventListener( 'desktop-mode-window-closed', closeHandler );
	state.teardown.push( () => closeAnyTileMenu() );

	// If the consumer opened the window via `openDetail` while it
	// was closed, the queued route is the actual destination.
	const initialRoute = pendingRoute ?? { kind: 'root' };
	pendingRoute = null;
	navigate( state, initialRoute );
}

const callback: RenderCallback = ( body ) => {
	try {
		renderInto( body );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[my-wordpress] render failed:', err );
	}
};

window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
window.desktopModeNativeWindows[ WINDOW_ID ] = callback;

/* ------------------------------------------------------------------ *
 *  Public API — `wp.desktop.myWordpress.openDetail( … )`.
 *
 *  Routes the My WordPress window directly into a post's detail
 *  dossier (Author / Comments / Tags / Categories / Attached
 *  media / Revisions). Any other shell surface — folder window
 *  tile CMO, plugin code, the AI Copilot — calls this single
 *  entry point so the dossier rendering lives in EXACTLY ONE
 *  place. No duplication.
 *
 *  Idempotent on re-call: if the window is already open we just
 *  navigate the live state; otherwise we open it and queue the
 *  navigation for the freshly-mounted state.
 *
 *  @public
 *  @since 0.8.0
 * ------------------------------------------------------------------ */

interface OpenDetailArgs {
	entityId: string;
	postId: number;
	postTitle: string;
}

function openDetail( args: OpenDetailArgs ): void {
	const route: Route = {
		kind: 'detail',
		entityId: args.entityId,
		postId: args.postId,
		postTitle: args.postTitle,
	};
	if ( activeState ) {
		navigate( activeState, route );
		return;
	}
	pendingRoute = route;
	const desktop = (
		window.wp as
			| {
					desktop?: {
						openWindow?: (
							id: string,
							opts?: { source?: string },
						) => boolean;
					};
			}
			| undefined
	)?.desktop;
	desktop?.openWindow?.( WINDOW_ID, { source: 'my-wordpress/open-detail' } );
}

interface MyWordpressApi {
	openDetail: ( args: OpenDetailArgs ) => void;
}

const desktopGlobal = (
	window.wp as
		| { desktop?: Record< string, unknown > & { myWordpress?: MyWordpressApi } }
		| undefined
)?.desktop;
if ( desktopGlobal ) {
	desktopGlobal.myWordpress = { openDetail };
}
