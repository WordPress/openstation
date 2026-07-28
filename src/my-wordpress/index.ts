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
import { attachTileDragOut, buildTileFromSpec } from '../desktop-files/tile-spec';
import { getDragManager, stripTags } from './dom-utils';
import {
	getEntityRenderer,
	registerEntityKind,
	type EntityRenderHost,
	type EntityRenderer,
} from './kind-registry';
import { renderListToolbar } from './list-toolbar';
import { renderMediaList } from './media-list';
import { renderMediaDetail } from './media-detail';
import {
	clearFootprintTarget,
	openUserFootprintWindow,
	readFootprintTarget,
	subscribeFootprintTarget,
} from './footprint-target';
import {
	renderBreadcrumbs,
	type BreadcrumbSegment,
} from '../desktop-files/breadcrumbs';
import {
	buildEditUrl,
	buildEditUserUrl,
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
	fetchUserFootprint,
	fetchUserList,
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
	UserFootprint,
	UserListItem,
} from './types';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-context-menu/wpd-context-menu';
import '../ui/components/wpd-spinner/wpd-spinner';

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
	/**
	 * Navigation history stack. Every `navigate()` call (except
	 * "back") pushes the route it's leaving onto this stack; the
	 * breadcrumb back button pops. Lets the user retrace cross-
	 * hierarchy jumps (Media-detail → referenced post → back to
	 * Media-detail), not just walk up the static folder tree.
	 */
	history: Route[];
}

interface StatusContext {
	view: 'root' | 'list' | 'detail' | 'sub-list' | 'user-footprint';
	entityId?: string;
	postId?: number;
	/**
	 * Target user id. Only set on the `'user-footprint'` view — kept
	 * distinct from `postId` so `desktop-mode.my-wordpress.status-bar`
	 * filters can tell a user surface apart from a post surface
	 * instead of mistaking a user id for a post id.
	 */
	userId?: number;
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

function navigate(
	state: RenderState,
	route: Route,
	opts: { fromBack?: boolean } = {},
): void {
	// Push the route we're leaving onto the history stack so the
	// back button can retrace cross-hierarchy jumps (e.g. Media
	// → Media-detail → referenced post → back lands on Media-detail,
	// not on the post's parent folder). Skipped on back-pops (we'd
	// just re-add what we just removed) and on no-op re-navigations.
	const sameRoute = routesEqual( state.route, route );
	if ( ! opts.fromBack && ! sameRoute ) {
		state.history.push( state.route );
	}
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
		const renderer = getEntityRenderer( entity.kind );
		if ( renderer ) {
			const host = makeRenderHost( state );
			renderer( host, entity );
			return;
		}
		// Unknown kind — fall back to the post renderer so older
		// plugins that ship entities without a `kind` field keep
		// working as they did before the registry.
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
		return;
	}
	if ( route.kind === 'user-footprint' ) {
		renderUserFootprint( state, entity, route.userId, route.userName );
		return;
	}
	if ( route.kind === 'media-detail' ) {
		void renderMediaDetail( makeRenderHost( state ), route.mediaId );
		// Defensive: every other branch in this switch ends with an
		// explicit `return`. Keeping the symmetry means a new route
		// kind added below won't silently fall through after a
		// successful media-detail dispatch.
		// eslint-disable-next-line no-useless-return
		return;
	}
}

/**
 * Adapt the internal `RenderState` to the public `EntityRenderHost`
 * contract consumed by registry-installed renderers. Hides the
 * internal teardown / breadcrumb plumbing.
 */
function makeRenderHost( state: RenderState ): EntityRenderHost {
	return {
		body: state.body,
		route: state.route,
		navigate: ( route ) => navigate( state, route ),
		addTeardown: ( fn ) => state.teardown.push( fn ),
	};
}

/**
 * Structural equality for `Route` discriminated-union values. Used
 * to drop no-op re-navigations from the history stack — clicking
 * the same tile twice shouldn't poison the back button.
 */
function routesEqual( a: Route, b: Route ): boolean {
	if ( a.kind !== b.kind ) {
		return false;
	}
	switch ( a.kind ) {
		case 'root':
			return true;
		case 'list':
			return a.entityId === ( b as { entityId: string } ).entityId;
		case 'detail': {
			const o = b as Extract< Route, { kind: 'detail' } >;
			return a.entityId === o.entityId && a.postId === o.postId;
		}
		case 'sub-list': {
			const o = b as Extract< Route, { kind: 'sub-list' } >;
			return (
				a.entityId === o.entityId &&
				a.postId === o.postId &&
				a.relation === o.relation
			);
		}
		case 'user-footprint': {
			const o = b as Extract< Route, { kind: 'user-footprint' } >;
			return a.entityId === o.entityId && a.userId === o.userId;
		}
		case 'media-detail': {
			const o = b as Extract< Route, { kind: 'media-detail' } >;
			return a.entityId === o.entityId && a.mediaId === o.mediaId;
		}
		default:
			return false;
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
		case 'user-footprint':
			return { kind: 'list', entityId: route.entityId };
		case 'media-detail':
			return { kind: 'list', entityId: route.entityId };
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
	if ( route.kind === 'user-footprint' ) {
		segments.push( {
			label: sprintf(
				// translators: %s is a user display name.
				__( '%s — activity footprint', 'desktop-mode' ),
				route.userName,
			),
		} );
	}
	if ( route.kind === 'media-detail' ) {
		segments.push( { label: route.mediaTitle } );
	}

	renderBreadcrumbs( state.breadcrumbs, segments, {
		onBack: () => {
			// Prefer history (navigation back) over hierarchy
			// (parent folder) so cross-tree jumps unwind in the
			// order the user made them. The breadcrumb "My
			// WordPress" jump lands at root WITH history non-empty
			// — we mustn't early-return on `route.kind === 'root'`
			// or that lands as a visually-enabled-but-no-op back
			// button. `backDisabled` below gates the empty-history-
			// at-root case, and the parent-route fallback collapses
			// to a same-route no-op (routesEqual short-circuits
			// the history push).
			const previous = state.history.pop();
			if ( previous ) {
				navigate( state, previous, { fromBack: true } );
				return;
			}
			navigate( state, parentRoute( state.route ), { fromBack: true } );
		},
		backDisabled: isRoot && state.history.length === 0,
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

	const tilesByEntity = new Map< string, HTMLElement >();

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
		// Folder tiles use Finder-style semantics: single click
		// selects (visual highlight only — no navigation, so a fast
		// double-click can't race the tile out of the DOM), double
		// click navigates. No drag-out: folder tiles aren't filed as
		// shortcuts — only entity tiles are.
		tile.addEventListener( 'click', () => select( tile ) );
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
} ): HTMLElement {
	// Adapter onto the canonical `buildTileFromSpec` — same visual
	// chrome the desktop / folder windows use. The My WordPress
	// `__tile` modifier stays in the class list so the section-
	// specific CSS (selection ring, locked, status ribbon) keeps
	// applying.
	return buildTileFromSpec( {
		type: spec.role === 'folder' ? 'folder' : '__my-wordpress-entry',
		ref: spec.label,
		label: spec.label,
		icon: sanitizeClass( spec.icon ),
		role: spec.role,
		extraClasses: [
			'desktop-mode-my-wordpress__tile',
			spec.role === 'folder'
				? 'desktop-mode-my-wordpress__tile--folder'
				: 'desktop-mode-my-wordpress__tile--entry',
		],
	} );
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
	/**
	 * Current debounced search query — empty string means no filter.
	 * Threaded into `fetchEntityList` as the `search` param.
	 */
	query: string;
	/**
	 * Aborts the in-flight page fetch when a new search query
	 * supersedes it. Replaced on every `loadMore()` call so the
	 * latest in-flight request is the only one that can paint.
	 */
	abort: AbortController | null;
}

/**
 * Per-entity remembered search query. Survives a click-into-post-
 * and-back round-trip (renderEntityList re-mounts on every list
 * navigation; reading from this map at the top restores the prior
 * query without baking it into the Route schema). Keyed by
 * `entity.id` so switching Posts → Pages clears the field — see
 * the user-facing rationale for that in the plan.
 */
const lastQueryByEntity = new Map< string, string >();

function renderEntityList(
	state: RenderState,
	entity: MyWordPressEntity,
): void {
	const cfg = getConfig();
	const initialQuery = lastQueryByEntity.get( entity.id ) ?? '';

	const toolbar = renderListToolbar( {
		placeholder: sprintf(
			// translators: %s is a lowercased entity-type label (e.g. "posts", "pages").
			__( 'Search %s…', 'desktop-mode' ),
			entity.label.toLowerCase(),
		),
		ariaLabel: sprintf(
			// translators: %s is an entity-type label (e.g. "Posts", "Pages").
			__( 'Search %s', 'desktop-mode' ),
			entity.label,
		),
		initialValue: initialQuery,
		onSearchChange: ( q ) => {
			lastQueryByEntity.set( entity.id, q );
			void resetForSearch( q );
		},
	} );
	state.body.appendChild( toolbar.host );
	state.teardown.push( () => toolbar.destroy() );

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
		query: initialQuery,
		abort: null,
	};
	state.teardown.push( () => tileLayout.dispose() );
	// Cancel any in-flight page fetch on teardown — keeps the
	// activity bus / loading spinner from showing a never-resolving
	// pulse after the user navigates away.
	state.teardown.push( () => ctx.abort?.abort() );

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
		const queryAtFetchTime = ctx.query;
		showLoadingSkeleton( tiles, ctx.layout, isFirst );
		const controller = new AbortController();
		ctx.abort = controller;
		try {
			const result = await fetchEntityList( entity, {
				page: nextPage,
				perPage: cfg.perPage,
				search: queryAtFetchTime || undefined,
				signal: controller.signal,
			} );
			// Race guard: a fresh search may have started while this
			// page was in flight. The new request resets ctx.query
			// AND aborts this controller — but if the abort lost the
			// race (response already buffered) we'd paint stale
			// tiles into a freshly-cleared grid.
			if ( ctx.query !== queryAtFetchTime ) {
				return;
			}
			ctx.page = nextPage;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			hideLoadingSkeleton( tiles );
			if ( result.items.length === 0 && isFirst ) {
				renderListEmpty( tiles, entity, queryAtFetchTime );
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
			if ( isAbortError( err ) ) {
				// Search query changed mid-flight. The new query's
				// loadMore() will repaint; nothing to do here, and
				// we explicitly avoid painting an error message.
				return;
			}
			hideLoadingSkeleton( tiles );
			const msg =
				err instanceof Error ? err.message : __( 'Unknown error.', 'desktop-mode' );
			renderListError( tiles, msg );
			ctx.done = true;
		} finally {
			ctx.loading = false;
			if ( ctx.abort === controller ) {
				ctx.abort = null;
			}
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

	const resetForSearch = async ( q: string ): Promise< void > => {
		// Cancel any in-flight page so the prior query can't paint
		// after the swap.
		ctx.abort?.abort();
		ctx.abort = null;
		ctx.query = q;

		// Critical UX: do NOT clear tiles + paint a skeleton up front.
		// Search runs on every debounced keystroke; ripping the grid
		// down to placeholders before the response lands shows the
		// user an "intermediate page" that flashes between every
		// refinement. Instead keep the previous results visible (the
		// `--searching` class dims them so the change-in-progress is
		// visible), do the fetch, then atomically swap when the new
		// page lands.
		tiles.classList.add(
			'desktop-mode-my-wordpress__tiles--searching',
		);
		hideLoadingSkeleton( tiles );

		const controller = new AbortController();
		ctx.abort = controller;
		ctx.loading = true;

		try {
			const result = await fetchEntityList( entity, {
				page: 1,
				perPage: cfg.perPage,
				search: q || undefined,
				signal: controller.signal,
			} );
			// Stale guard — a later query may have superseded us.
			if ( ctx.query !== q ) {
				return;
			}

			// Atomic swap. Up to this point the user has been looking
			// at the prior result set (dimmed); the next few lines
			// replace it with the new one in one frame.
			tiles.replaceChildren();
			ctx.layout.clear();
			tiles.classList.remove(
				'desktop-mode-my-wordpress__tiles--searching',
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
				'Select an entry to preview it here.',
				'desktop-mode',
			);
			ctx.preview.appendChild( emptyPreview );

			if ( result.items.length === 0 ) {
				renderListEmpty( tiles, entity, q );
				ctx.done = true;
			} else {
				for ( const item of result.items ) {
					tiles.appendChild(
						buildEntityTile( state, ctx, entity, item ),
					);
					ctx.loaded += 1;
				}
			}
			repaintListStatus();
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				return;
			}
			tiles.classList.remove(
				'desktop-mode-my-wordpress__tiles--searching',
			);
			tiles.replaceChildren();
			ctx.layout.clear();
			const msg =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderListError( tiles, msg );
			ctx.done = true;
		} finally {
			ctx.loading = false;
			if ( ctx.abort === controller ) {
				ctx.abort = null;
			}
		}

		// Chain — keep pulling pages while the sentinel is still
		// within the rootMargin slack. The first page is in; let
		// the regular `loadMore` pipeline drive any follow-ups.
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

function isAbortError( err: unknown ): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

function renderListEmpty(
	host: HTMLElement,
	entity: MyWordPressEntity,
	query?: string,
): void {
	const empty = document.createElement( 'div' );
	empty.className = 'desktop-mode-my-wordpress__empty';
	if ( query ) {
		empty.textContent = sprintf(
			// translators: 1: search query, 2: lowercased entity-type label.
			__( 'No %2$s match "%1$s".', 'desktop-mode' ),
			query,
			entity.label.toLowerCase(),
		);
	} else {
		empty.textContent = sprintf(
			// translators: %s is an entity-type label (e.g. "Posts", "Pages").
			__( 'No %s yet.', 'desktop-mode' ),
			entity.label.toLowerCase(),
		);
	}
	host.appendChild( empty );
}

function renderListError( host: HTMLElement, message: string ): void {
	const err = document.createElement( 'div' );
	err.className = 'desktop-mode-my-wordpress__error';
	err.textContent = message;
	host.appendChild( err );
}

/**
 * Build a single placeholder tile that mirrors the real
 * `.desktop-mode-file-tile` silhouette (icon block + label rect).
 * The icon and label fill animate as a shimmering gradient — see
 * `desktop-mode-my-wordpress-skeleton-shimmer` in
 * `assets/css/my-wordpress.css`.
 */
function buildSkeletonTile( variant: 'first' | 'more' ): HTMLElement {
	const tile = document.createElement( 'div' );
	tile.className = 'desktop-mode-my-wordpress__skeleton-tile';
	tile.dataset.loadingSkeleton = variant;
	tile.setAttribute( 'aria-hidden', 'true' );
	const icon = document.createElement( 'div' );
	icon.className = 'desktop-mode-my-wordpress__skeleton-icon';
	tile.appendChild( icon );
	const label = document.createElement( 'div' );
	label.className = 'desktop-mode-my-wordpress__skeleton-label';
	tile.appendChild( label );
	return tile;
}

/**
 * Paint placeholder tiles into the same column-major slots the next
 * batch of real tiles will fill. Two contexts share the helper:
 *
 *   - `first` — empty canvas, first page about to land. Eight
 *     placeholders cover the top rows of the pane so the user sees
 *     a partial grid forming rather than a single floating mark.
 *   - `more` — infinite-scroll, a few more pages coming. Four
 *     placeholders extend the existing grid from the next free
 *     cell, so the user can scroll past the real tiles and see
 *     exactly where the next ones will arrive.
 *
 * Each placeholder is `position: absolute` at the layout-derived
 * (x, y) and carries `data-loading-skeleton="<variant>"`, both for
 * dedup-on-show and bulk removal in `hideLoadingSkeleton`. We also
 * bump the canvas's `min-height` so any skeleton placed past the
 * last real tile is reachable by the scroll container — without
 * this, "more"-variant skeletons painted into the next row sit in
 * unscrollable territory and the user never sees them.
 *
 * Label widths and shimmer delays vary across a small palette so a
 * row of placeholders reads as a soft cascade, not a uniform pulse.
 */
const SKELETON_LABEL_WIDTHS = [ 72, 60, 82, 48, 70 ];
const SKELETON_DELAY_STEPS = [ 0, 0.18, 0.36, 0.54, 0.12 ];

function showLoadingSkeleton(
	host: HTMLElement,
	layout: TileLayout,
	isFirst: boolean,
): void {
	const variant: 'first' | 'more' = isFirst ? 'first' : 'more';
	if ( host.querySelector( `[data-loading-skeleton="${ variant }"]` ) ) {
		return;
	}
	const count = isFirst ? 8 : 4;
	const cells = layout.peekNextCells( count );
	let maxBottom = parseFloat( host.style.minHeight || '0' );
	cells.forEach( ( cell, i ) => {
		const tile = buildSkeletonTile( variant );
		tile.style.left = `${ cell.x }px`;
		tile.style.top = `${ cell.y }px`;
		tile.style.setProperty(
			'--desktop-mode-skeleton-delay',
			`${ SKELETON_DELAY_STEPS[ i % SKELETON_DELAY_STEPS.length ] }s`,
		);
		const label = tile.querySelector< HTMLElement >(
			'.desktop-mode-my-wordpress__skeleton-label',
		);
		if ( label ) {
			label.style.width = `${
				SKELETON_LABEL_WIDTHS[ i % SKELETON_LABEL_WIDTHS.length ]
			}%`;
		}
		host.appendChild( tile );
		maxBottom = Math.max( maxBottom, cell.y + TILE_H );
	} );
	host.style.minHeight = `${ maxBottom + TILE_PAD }px`;
}

function hideLoadingSkeleton( host: HTMLElement ): void {
	host.querySelectorAll( '[data-loading-skeleton]' ).forEach( ( n ) =>
		n.remove(),
	);
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
	if ( item.status ) {
		// `<wpd-tile>` reads the `status` attribute and slots a
		// `<wpd-ribbon>` for non-publish values, honoring the
		// `showPostStatusRibbons` OS-setting.
		tile.setAttribute( 'status', item.status );
	}

	// Drag-out: the user picks up an entity tile and drops it on the
	// wallpaper, a folder icon, or inside an open folder window. The
	// shared `attachTileDragOut` helper owns the pointerdown ->
	// DragManager dance — every tile-emitting surface (desktop,
	// folders, My WordPress) uses it.
	attachTileDragOut(
		tile,
		{
			kind: 'post',
			ref: String( item.id ),
			title: titleText,
			icon: entity.icon,
			// Source entity id (`'posts'` / `'pages'` / future
			// CPT-backed entities). Lets the recycle bin's drop
			// handler resolve the right REST endpoint when the user
			// drags this tile to the bin to trash it.
			entityId: entity.id,
			// Cross-frame bridge payload — the Gutenberg drop-receiver
			// turns this into a `core/paragraph` with an `<a href>` to
			// the permalink. Tiles without a `link` (very old REST
			// shapes / private posts) still drag-out for placement
			// purposes; the receiver no-ops on an empty url.
			bridgePayload: {
				kind: 'post',
				id: item.id,
				postType: entity.id,
				url: item.link ?? '',
				title: titleText,
			},
		},
		() => hideTooltip(),
	);

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
	// Click-to-select. The pointerdown handler above already routes
	// drags through the DragManager, so a sub-threshold gesture
	// (pointer-down, no movement, pointer-up) flows naturally:
	// pointerdown fires manager.start(); manager treats it as a
	// click on pointerup; the browser dispatches `click`; this
	// listener selects.
	tile.addEventListener( 'click', () => {
		selectTile( state, ctx, tile, entity, item.id );
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
			'desktop-mode-file-tile--selected',
		);
	}
	tile.classList.add( 'desktop-mode-file-tile--selected' );
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
 *
 * Size is driven by the `--wpd-spinner-size` custom property on
 * `.desktop-mode-my-wordpress__preview-loading wpd-spinner` (see
 * `assets/css/my-wordpress.css`) so a single CSS knob retunes
 * every preview spinner without rebuilding the JS bundle.
 */
function showPreviewLoading( host: HTMLElement ): void {
	host.replaceChildren();
	const loading = document.createElement( 'div' );
	loading.className = 'desktop-mode-my-wordpress__preview-loading';
	const spinner = document.createElement( 'wpd-spinner' );
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

	// Tile-grid skeleton while we load the post. Same `first`
	// treatment the entity-list view uses for its first page load:
	// placeholder tiles fill the slots the related-entity folder
	// tiles are about to land in, so the user sees the spatial
	// shape of what's coming instead of a disembodied spinner mark.
	showLoadingSkeleton( tiles, layout, true );

	void ( async () => {
		let detail: EntityDetail;
		try {
			detail = await fetchEntityDetail( entity, postId );
		} catch ( err ) {
			hideLoadingSkeleton( tiles );
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

		hideLoadingSkeleton( tiles );

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
			// Sub-folder tiles use the same Finder-style semantics as
			// the root folder tiles: single click selects (visual
			// only), double click navigates. Disabled tiles still
			// receive the selection so the user has a hover/focus
			// affordance, but no dblclick listener below.
			tile.addEventListener( 'click', () => select( tile ) );
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

	// Empty-canvas skeleton for the sub-list pane — same `first`
	// treatment the entity-list and detail views use, so every
	// "tiles are about to appear" state reads with the same shape.
	showLoadingSkeleton( tiles, layout, true );

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
			hideLoadingSkeleton( tiles );
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

		hideLoadingSkeleton( tiles );

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
			tile.addEventListener( 'click', () => {
				if ( selectedTile ) {
					selectedTile.classList.remove(
						'desktop-mode-file-tile--selected',
					);
				}
				tile.classList.add(
					'desktop-mode-file-tile--selected',
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
		// Prefer the authoritative server-computed list when present
		// — it includes `<img src>` URL→id resolution that catches
		// images inserted via the cross-window drag-bridge or other
		// paths that emit raw `<img>` without `wp-image-N` classes.
		// Fall back to the client-side regex on older API responses.
		const serverList = detail.desktop_mode_attached_media;
		if ( Array.isArray( serverList ) && serverList.length > 0 ) {
			for ( const id of serverList ) {
				if ( typeof id === 'number' && id > 0 ) {
					ids.add( id );
				}
			}
		} else {
			extractContentMediaIds( detail.content?.rendered ?? '' ).forEach(
				( id ) => ids.add( id ),
			);
		}

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

	interface TileMenuOption {
		id: string;
		label: string;
		icon: string;
		danger?: boolean;
		/**
		 * Plugin-supplied click handler. Built-ins set this to null
		 * so the static `wpd-context-menu-pick` switch below routes
		 * them — keeps the existing semantics.
		 */
		onSelect?: ( () => void ) | null;
	}

	const baseOptions: TileMenuOption[] = [
		{
			id: 'open',
			label: __( 'Open in editor', 'desktop-mode' ),
			icon: 'dashicons-edit',
		},
		{
			id: 'navigate-into',
			label: __( 'Navigate into', 'desktop-mode' ),
			icon: 'dashicons-category',
		},
		{
			id: 'trash',
			label: __( 'Move to Trash', 'desktop-mode' ),
			icon: 'dashicons-trash',
			danger: true,
		},
	];

	/**
	 * Let plugins add / remove / reorder context-menu entries
	 * uniformly across every section. Plugin-added entries must
	 * supply an `onSelect` handler (built-ins are dispatched by
	 * the static switch below).
	 */
	const ctxFilter = {
		entityId: entity.id,
		kind: entity.kind ?? 'post',
		item: item as unknown as Record< string, unknown >,
	};
	const options = applyFilters<
		TileMenuOption[],
		[ typeof ctxFilter ]
	>(
		'desktop-mode.my-wordpress.tile-context-menu',
		baseOptions,
		ctxFilter,
	);
	const finalOptions = Array.isArray( options ) ? options : baseOptions;
	for ( const o of finalOptions ) {
		addOption( o.id, o.label, o.icon, o.danger );
	}

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
			return;
		}
		// Plugin-supplied entry — dispatch its `onSelect`.
		const match = finalOptions.find( ( o ) => o.id === detail.id );
		if ( match && typeof match.onSelect === 'function' ) {
			try {
				match.onSelect();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error(
					`[my-wordpress] tile-context-menu '${ detail.id }' onSelect threw:`,
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

/**
 * Derive the desktop broadcast topic for an entity.
 *
 * Reads `entity.post_type` (shipped from PHP for all entities
 * that support trash/restore, e.g. posts, pages, media). Returns
 * `null` if the entity has no broadcast channel (e.g. Users).
 *
 * @param entity The My WordPress entity configuration.
 * @return Broadcast topic string, or null if not applicable.
 */
function getBroadcastTopicForEntity( entity: MyWordPressEntity ): string | null {
	if ( entity.post_type ) {
		return `desktop-mode.${ entity.post_type }.changed`;
	}
	return null;
}

/**
 * Programmatic trash entry-point. Looks up the entity by id from the
 * shell config, calls the REST DELETE, and broadcasts
 * `desktop-mode-my-wordpress-entity-trashed` so every live list view
 * can drop the tile reactively. Does NOT show a confirm dialog — that
 * UX layer belongs to the caller (the right-click `confirmTrash` adds
 * its own; the recycle-bin drag-to-trash doesn't, matching macOS).
 *
 * Also broadcasts to the cross-window bus so external subscribers
 * (like the Recycle Bin) can refresh immediately.
 *
 * Exposed on `wp.desktop.myWordpress.trashEntity(entityId, id)` so
 * cross-bundle drop targets (notably the recycle bin) can trash an
 * entity without depending on this bundle's internals.
 *
 * @public
 */
async function trashEntityById(
	entityId: string,
	id: number,
): Promise< void > {
	const cfg = getConfig();
	const entity = cfg.entities.find( ( e ) => e.id === entityId );
	if ( ! entity ) {
		throw new Error(
			sprintf(
				// translators: %s is the entity id (e.g. 'posts').
				__( 'Unknown My WordPress entity: %s', 'desktop-mode' ),
				entityId,
			),
		);
	}
	await trashEntity( entity, id );
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-my-wordpress-entity-trashed', {
			detail: { entityId, id },
		} ),
	);

	// Broadcast the deletion to the cross-window bus so external windows
	// (like the Recycle Bin and the dock badge) refresh reactively.
	const topic = getBroadcastTopicForEntity( entity );
	if ( topic ) {
		window.wp?.desktop?.broadcast( topic, {
			source: 'my-wordpress',
			action: 'trashed',
			ids: [ id ],
		} );
	}
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

/* =================================================================== *
 *  USERS ENTITY — list, tile, preview, context menu, double-click.
 *
 *  The Users folder mirrors the post/page folder shell (two-pane
 *  split, infinite scroll, status bar, tile canvas) but everything
 *  inside the tiles + the preview is reshaped around user identity:
 *  big avatar tiles, role chips, the rich dossier in the right
 *  pane, and a dedicated "activity footprint" surface that
 *  replaces the body when the user picks it from the context menu.
 *
 * =================================================================== */

interface UserListContext {
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
	query: string;
	abort: AbortController | null;
}

function renderUserEntityList(
	state: RenderState,
	entity: MyWordPressEntity,
): void {
	const cfg = getConfig();
	const initialQuery = lastQueryByEntity.get( entity.id ) ?? '';

	const toolbar = renderListToolbar( {
		placeholder: __( 'Search users…', 'desktop-mode' ),
		ariaLabel: __( 'Search users', 'desktop-mode' ),
		initialValue: initialQuery,
		onSearchChange: ( q ) => {
			lastQueryByEntity.set( entity.id, q );
			void resetForSearch( q );
		},
	} );
	state.body.appendChild( toolbar.host );
	state.teardown.push( () => toolbar.destroy() );

	const split = document.createElement( 'div' );
	split.className = 'desktop-mode-my-wordpress__split';

	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-my-wordpress__list';
	const tiles = document.createElement( 'div' );
	tiles.className =
		'desktop-mode-my-wordpress__tiles desktop-mode-my-wordpress__canvas desktop-mode-my-wordpress__canvas--users';
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
		'Select a user to see their profile here.',
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

	const ctx: UserListContext = {
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
		query: initialQuery,
		abort: null,
	};
	state.teardown.push( () => tileLayout.dispose() );
	state.teardown.push( () => ctx.abort?.abort() );

	const repaintListStatus = () => {
		let itemLabel: string;
		if ( ctx.total === 0 && ctx.loaded === 0 ) {
			itemLabel = pluralLabel( 0, 'user', 'users' );
		} else if ( ctx.total > ctx.loaded && ctx.loaded > 0 ) {
			itemLabel = sprintf(
				// translators: 1: visible user count, 2: total user count.
				__( '%1$d of %2$d users', 'desktop-mode' ),
				ctx.loaded,
				ctx.total,
			);
		} else {
			itemLabel = pluralLabel(
				Math.max( ctx.total, ctx.loaded ),
				'user',
				'users',
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
		const queryAtFetchTime = ctx.query;
		showLoadingSkeleton( tiles, ctx.layout, isFirst );
		const controller = new AbortController();
		ctx.abort = controller;
		try {
			const result = await fetchUserList( entity, {
				page: nextPage,
				perPage: cfg.perPage,
				search: queryAtFetchTime || undefined,
				signal: controller.signal,
			} );
			if ( ctx.query !== queryAtFetchTime ) {
				return;
			}
			ctx.page = nextPage;
			ctx.totalPages = result.totalPages;
			ctx.total = result.total;
			hideLoadingSkeleton( tiles );
			if ( result.items.length === 0 && isFirst ) {
				renderListEmptyMessage(
					tiles,
					queryAtFetchTime
						? sprintf(
							// translators: %s is the user-entered search query.
							__( 'No users match "%s".', 'desktop-mode' ),
							queryAtFetchTime,
						)
						: __( 'No users to show.', 'desktop-mode' ),
				);
				ctx.done = true;
				repaintListStatus();
				return;
			}
			for ( const item of result.items ) {
				tiles.appendChild(
					buildUserTile( state, ctx, entity, item ),
				);
				ctx.loaded += 1;
			}
			if ( ctx.page >= ctx.totalPages ) {
				ctx.done = true;
			}
			repaintListStatus();
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				return;
			}
			hideLoadingSkeleton( tiles );
			const msg =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderListError( tiles, msg );
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
		// See `renderEntityList`'s `resetForSearch` for the full
		// rationale — short version: don't rip the grid down to a
		// skeleton on every keystroke; keep the old tiles visible
		// (dimmed via the `--searching` class), fetch, then swap.
		ctx.abort?.abort();
		ctx.abort = null;
		ctx.query = q;

		tiles.classList.add(
			'desktop-mode-my-wordpress__tiles--searching',
		);
		hideLoadingSkeleton( tiles );

		const controller = new AbortController();
		ctx.abort = controller;
		ctx.loading = true;

		try {
			const result = await fetchUserList( entity, {
				page: 1,
				perPage: cfg.perPage,
				search: q || undefined,
				signal: controller.signal,
			} );
			if ( ctx.query !== q ) {
				return;
			}

			tiles.replaceChildren();
			ctx.layout.clear();
			tiles.classList.remove(
				'desktop-mode-my-wordpress__tiles--searching',
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
				'Select a user to see their profile here.',
				'desktop-mode',
			);
			ctx.preview.appendChild( emptyPreview );

			if ( result.items.length === 0 ) {
				renderListEmptyMessage(
					tiles,
					q
						? sprintf(
							// translators: %s is the user-entered search query.
							__( 'No users match "%s".', 'desktop-mode' ),
							q,
						)
						: __( 'No users to show.', 'desktop-mode' ),
				);
				ctx.done = true;
			} else {
				for ( const item of result.items ) {
					tiles.appendChild(
						buildUserTile( state, ctx, entity, item ),
					);
					ctx.loaded += 1;
				}
			}
			repaintListStatus();
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				return;
			}
			tiles.classList.remove(
				'desktop-mode-my-wordpress__tiles--searching',
			);
			tiles.replaceChildren();
			ctx.layout.clear();
			const msg =
				err instanceof Error
					? err.message
					: __( 'Unknown error.', 'desktop-mode' );
			renderListError( tiles, msg );
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

/**
 * Build a user tile — same canvas-friendly element as the post tile
 * but with an avatar image where the post tile shows a dashicon.
 * The class list keeps `desktop-mode-file-tile` so the existing
 * selection + canvas pointer plumbing applies unchanged.
 */
function buildUserTile(
	state: RenderState,
	ctx: UserListContext,
	entity: MyWordPressEntity,
	item: UserListItem,
): HTMLElement {
	const displayName = item.name || item.slug || `#${ item.id }`;

	const avatarUrl = pickAvatar( item.avatar_urls ) ?? '';
	const tile = buildTileFromSpec( {
		type: 'user',
		ref: String( item.id ),
		label: displayName,
		thumbnail: avatarUrl || undefined,
		// No avatar: fall back to a generic users dashicon so the
		// tile still has a visual. The initials block below
		// replaces that icon as a richer fallback.
		icon: avatarUrl ? undefined : 'dashicons-admin-users',
		role: 'entry',
		dataset: { userId: item.id, role: 'user' },
		extraClasses: [
			'desktop-mode-my-wordpress__tile',
			'desktop-mode-my-wordpress__tile--user',
		],
	} );

	if ( ! avatarUrl ) {
		// Identity-shaped fallback: replace the generic dashicon
		// with the user's initials so the tile reads as a person,
		// not "any user".
		const iconHost = tile.querySelector(
			'.desktop-mode-file-tile__visual',
		);
		if ( iconHost ) {
			iconHost.replaceChildren();
			const initials = document.createElement( 'span' );
			initials.className = 'desktop-mode-my-wordpress__user-tile-initials';
			initials.textContent = initialsOf( displayName );
			iconHost.appendChild( initials );
		}
	}

	const summary = item.desktop_mode_summary;
	const postCount = summary?.postCount ?? 0;
	const roleLabel = ( summary?.roleLabels ?? [] )[ 0 ] ?? '';
	if ( roleLabel || postCount > 0 ) {
		const sub = document.createElement( 'span' );
		sub.className = 'desktop-mode-my-wordpress__user-tile-sub';
		const parts: string[] = [];
		if ( roleLabel ) {
			parts.push( roleLabel );
		}
		if ( postCount > 0 ) {
			parts.push(
				sprintf(
					// translators: %d is a count of posts authored.
					_n( '%d post', '%d posts', postCount ),
					postCount,
				),
			);
		}
		sub.textContent = parts.join( ' · ' );
		tile.appendChild( sub );
	}

	const tooltip = buildUserTooltip( displayName, item );
	let tooltipNode: HTMLElement | null = null;
	const showTooltip = ( ev: MouseEvent ) => {
		if ( ! tooltipNode ) {
			tooltipNode = tooltip;
		}
		document.body.appendChild( tooltipNode );
		positionTooltip( tooltipNode, ev );
	};
	const moveTooltip = ( ev: MouseEvent ) => {
		if ( tooltipNode && tooltipNode.isConnected ) {
			positionTooltip( tooltipNode, ev );
		}
	};
	const hideTooltip = () => {
		if ( tooltipNode && tooltipNode.isConnected ) {
			tooltipNode.remove();
		}
	};
	tile.addEventListener( 'mouseenter', showTooltip );
	tile.addEventListener( 'mousemove', moveTooltip );
	tile.addEventListener( 'mouseleave', hideTooltip );
	state.teardown.push( hideTooltip );

	// Drag-out via the shared `attachTileDragOut`. The `'user'`
	// file type's resolver + opener are already registered
	// server-side (`Desktop_Mode_User_File`), so a drop on any
	// FilesLayer target POSTs a placement carrying
	// `kind: 'user', ref: '<id>'` — no extra wiring needed here.
	attachTileDragOut(
		tile,
		{
			kind: 'user',
			ref: String( item.id ),
			title: displayName,
			icon: 'dashicons-admin-users',
			// Cross-frame bridge payload — receiver inserts a
			// `core/paragraph` with `<a href>` pointing at the
			// author archive (`item.link`). Falls back to empty
			// string when the REST shape omitted the link; the
			// receiver gates on a truthy URL.
			bridgePayload: {
				kind: 'user',
				id: item.id,
				url: item.link ?? '',
				title: displayName,
			},
		},
		() => hideTooltip(),
	);

	const tileKey = `entry:${ item.id }`;
	ctx.layout.place( tile, tileKey, {
		name: displayName,
		// Order users by post count by default — the most active
		// surface first. Authoring date isn't available per-user,
		// so we synthesize a date that ranks more-prolific users
		// earlier when the canvas sort-by-date is selected.
		date: postCount > 0
			? new Date( 2100, 0, 1 - postCount ).toISOString()
			: new Date( 0 ).toISOString(),
	} );

	tile.addEventListener( 'click', () => {
		selectUserTile( state, ctx, tile, item );
	} );

	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		hideTooltip();
		// Double-click on a user opens the activity footprint — the
		// at-a-glance surface we want users to land on first. The
		// classic profile editor is one click away from the preview
		// pane / context menu / shortcut.
		navigate( state, {
			kind: 'user-footprint',
			entityId: entity.id,
			userId: item.id,
			userName: displayName,
		} );
	} );

	tile.addEventListener( 'contextmenu', ( e ) => {
		e.preventDefault();
		hideTooltip();
		openUserTileMenu( state, entity, item, displayName, {
			x: e.clientX,
			y: e.clientY,
		} );
	} );

	return tile;
}

function buildUserTooltip(
	name: string,
	item: UserListItem,
): HTMLElement {
	const tip = document.createElement( 'div' );
	tip.className = 'desktop-mode-my-wordpress__tooltip';
	tip.setAttribute( 'role', 'tooltip' );

	const heading = document.createElement( 'div' );
	heading.className = 'desktop-mode-my-wordpress__tooltip-title';
	heading.textContent = name;
	tip.appendChild( heading );

	const summary = item.desktop_mode_summary;
	const roleLabel = ( summary?.roleLabels ?? [] )[ 0 ];
	const postCount = summary?.postCount ?? 0;
	const lastActive = summary?.lastActive ?? '';
	const lines: string[] = [];
	if ( roleLabel ) {
		lines.push( roleLabel );
	}
	if ( postCount > 0 ) {
		lines.push(
			sprintf(
				// translators: %d is a count of posts authored by a user.
				_n( '%d post', '%d posts', postCount ),
				postCount,
			),
		);
	}
	if ( lastActive ) {
		lines.push(
			sprintf(
				// translators: %s is a relative or absolute date.
				__( 'Last published %s', 'desktop-mode' ),
				formatDate( lastActive ),
			),
		);
	}
	for ( const ln of lines ) {
		const p = document.createElement( 'p' );
		p.className = 'desktop-mode-my-wordpress__tooltip-excerpt';
		p.textContent = ln;
		tip.appendChild( p );
	}

	const bio = ( item.description ?? '' ).trim();
	if ( bio ) {
		const p = document.createElement( 'p' );
		p.className = 'desktop-mode-my-wordpress__tooltip-excerpt';
		p.textContent =
			bio.length > 200 ? bio.slice( 0, 197 ) + '…' : bio;
		tip.appendChild( p );
	}
	return tip;
}

function selectUserTile(
	state: RenderState,
	ctx: UserListContext,
	tile: HTMLElement,
	item: UserListItem,
): void {
	if ( ctx.selectedTile ) {
		ctx.selectedTile.classList.remove(
			'desktop-mode-file-tile--selected',
		);
	}
	tile.classList.add( 'desktop-mode-file-tile--selected' );
	ctx.selectedTile = tile;
	ctx.selectedId = item.id;
	void renderUserPreviewPane( state, ctx, item );
}

async function renderUserPreviewPane(
	state: RenderState,
	ctx: UserListContext,
	item: UserListItem,
): Promise< void > {
	const fallbackName = item.name || item.slug || `#${ item.id }`;
	const fallbackAvatar = pickAvatar( item.avatar_urls ) ?? '';
	const userId = item.id;

	showPreviewLoading( ctx.preview );

	let node: HTMLElement;
	try {
		node = await renderUserDossier( {
			userId,
			fallbackName,
			fallbackAvatar,
			fallbackDescription: item.description ?? '',
		} );
	} catch ( err ) {
		if ( ctx.selectedId !== userId ) {
			return;
		}
		showPreviewError( ctx.preview, err );
		return;
	}

	if ( ctx.selectedId !== userId ) {
		return;
	}

	// Append "open profile" / "view footprint" actions so the
	// preview pane doubles as the launch point for both deep
	// actions. The dossier itself doesn't carry these because it's
	// also reused inside post-detail sub-folders (author / contrib).
	const footer = document.createElement( 'footer' );
	footer.className = 'desktop-mode-my-wordpress__article-footer';

	// Primary action matches the double-click affordance — activity
	// footprint first, the classic profile editor demoted to a
	// secondary button.
	const footprintBtn = document.createElement( 'wpd-button' );
	footprintBtn.setAttribute( 'variant', 'primary' );
	footprintBtn.textContent = __( 'View activity footprint', 'desktop-mode' );
	footprintBtn.title = __(
		'Open the full activity footprint surface for this user.',
		'desktop-mode',
	);
	footprintBtn.addEventListener( 'click', () => {
		navigate( state, {
			kind: 'user-footprint',
			entityId: 'users',
			userId,
			userName: fallbackName,
		} );
	} );
	footer.appendChild( footprintBtn );

	const editBtn = document.createElement( 'wpd-button' );
	editBtn.setAttribute( 'variant', 'secondary' );
	editBtn.textContent = __( 'Show profile', 'desktop-mode' );
	editBtn.title = __(
		'Open this user’s profile editor in a new window.',
		'desktop-mode',
	);
	editBtn.addEventListener( 'click', () => {
		openUserEditWindow( userId );
	} );
	footer.appendChild( editBtn );

	node.appendChild( footer );

	ctx.preview.replaceChildren( node );
}

function openUserTileMenu(
	state: RenderState,
	entity: MyWordPressEntity,
	item: UserListItem,
	name: string,
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
	) => {
		const opt = document.createElement( 'wpd-context-menu-option' );
		( opt as HTMLElement ).dataset.menuItemId = id;
		opt.setAttribute( 'value', id );
		opt.setAttribute( 'icon', sanitizeClass( icon ) );
		opt.textContent = label;
		menu.appendChild( opt );
	};

	// Footprint is the primary (double-click) action; profile is the
	// classic editor, demoted to "Show profile" to mirror the preview
	// pane's button labels.
	addOption(
		'footprint',
		__( 'View activity footprint', 'desktop-mode' ),
		'dashicons-chart-area',
	);
	addOption(
		'open-profile',
		__( 'Show profile', 'desktop-mode' ),
		'dashicons-id-alt',
	);
	if ( item.link ) {
		addOption(
			'author-archive',
			__( 'View author archive', 'desktop-mode' ),
			'dashicons-external',
		);
	}

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		closeAnyTileMenu();
		if ( detail.id === 'footprint' ) {
			navigate( state, {
				kind: 'user-footprint',
				entityId: entity.id,
				userId: item.id,
				userName: name,
			} );
			return;
		}
		if ( detail.id === 'open-profile' ) {
			openUserEditWindow( item.id );
			return;
		}
		if ( detail.id === 'author-archive' && item.link ) {
			window.open( item.link, '_blank', 'noopener,noreferrer' );
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

/**
 * Open the native `desktop-mode-user-edit` window for a specific
 * user id. Cross-bundle hand-off uses the same shared-store key
 * (`desktop-mode/user-edit/target`) the posts-window bundle's
 * `user-edit-target.ts` reads from — that's the canonical
 * "which user are we editing" channel.
 *
 * Falls back to the classic admin user-edit URL inside an iframe
 * window when the native window isn't registered (sites that have
 * trimmed the registration via filter, primarily).
 */
function openUserEditWindow( userId: number ): void {
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return;
	}

	interface SharedStoreApi< T > {
		state: T;
		notify(): void;
		subscribe( cb: ( state: T ) => void ): () => void;
	}
	interface DesktopFacade {
		createSharedStore?: < T >(
			key: string,
			initial: () => T,
		) => SharedStoreApi< T >;
		openWindow?: (
			id: string,
			opts?: { source?: string },
		) => boolean | undefined;
	}
	interface UserEditTarget {
		userId: number | null;
		requestedAt: number;
		tabRequested: boolean;
	}

	const desktop = (
		window.wp as { desktop?: DesktopFacade } | undefined
	)?.desktop;

	const createSharedStore = desktop?.createSharedStore;
	if ( typeof createSharedStore === 'function' ) {
		const store = createSharedStore< UserEditTarget >(
			'desktop-mode/user-edit/target',
			() => ( { userId: null, requestedAt: 0, tabRequested: false } ),
		);
		store.state.userId = userId;
		store.state.requestedAt = Date.now();
		store.state.tabRequested = true;
		store.notify();
	}

	const opened = desktop?.openWindow?.( 'desktop-mode-user-edit', {
		source: 'my-wordpress/user-tile',
	} );

	if ( ! opened ) {
		// Native window not registered — open the classic admin
		// user-edit page in an iframe window. Same shape as the
		// post fallback in `openEditor()`.
		openIframeWindow( {
			id: `user-edit-${ userId }`,
			url: buildEditUserUrl( userId ),
			title: __( 'Edit user', 'desktop-mode' ),
			icon: 'dashicons-admin-users',
		} );
	}
}

function initialsOf( name: string ): string {
	const parts = name
		.trim()
		.split( /\s+/ )
		.filter( ( s ) => s.length > 0 );
	if ( parts.length === 0 ) {
		return '?';
	}
	if ( parts.length === 1 ) {
		return parts[ 0 ].slice( 0, 2 ).toUpperCase();
	}
	return ( parts[ 0 ][ 0 ] + parts[ parts.length - 1 ][ 0 ] ).toUpperCase();
}

/* ------------------------------------------------------------------ *
 *  User activity footprint — full-body surface that replaces the
 *  split list/preview when the user picks "View activity footprint"
 *  from a user tile's context menu (or the dossier's footer button).
 *
 *  Sections:
 *    1. Hero header  — big avatar, name, role chips, member-since.
 *    2. Stat strip   — totals + current/longest streak callouts.
 *    3. Calendar     — 52-week × 7-day GitHub-style heatmap of daily
 *                       activity (posts + comments folded into a
 *                       single intensity score).
 *    4. Rhythm       — weekday distribution + hour-of-day distribution.
 *    5. Most-prolific month callout.
 *    6. Recent timeline.
 *    7. Action footer.
 *
 *  All data comes from one round-trip to
 *  `/desktop-mode/v1/user-footprint/<id>`.
 * ------------------------------------------------------------------ */

function renderUserFootprint(
	state: RenderState,
	entity: MyWordPressEntity,
	userId: number,
	userName: string,
): void {
	const host = document.createElement( 'div' );
	host.className = 'desktop-mode-my-wordpress__footprint';
	state.body.appendChild( host );

	// Spinner while the payload lands.
	showPreviewLoading( host );

	paintStatus(
		state,
		[
			{
				id: 'loading',
				label: __( 'Loading footprint…', 'desktop-mode' ),
				align: 'start',
				sort: 10,
			},
		],
		{ view: 'user-footprint', entityId: entity.id, userId },
	);

	void ( async () => {
		let payload: UserFootprint;
		try {
			payload = await fetchUserFootprint( userId );
		} catch ( err ) {
			showPreviewError( host, err );
			paintStatus(
				state,
				[
					{
						id: 'error',
						label: __( 'Could not load footprint.', 'desktop-mode' ),
						align: 'start',
						sort: 10,
					},
				],
				{ view: 'user-footprint', entityId: entity.id, userId },
			);
			return;
		}

		// Guard against late arrivals after the user navigated away.
		if (
			state.route.kind !== 'user-footprint' ||
			state.route.userId !== userId
		) {
			return;
		}

		host.replaceChildren();
		host.appendChild( buildFootprintHero( payload ) );
		host.appendChild( buildFootprintHeadlineStats( payload ) );
		host.appendChild( buildFootprintCalendar( payload ) );
		host.appendChild( buildFootprintRhythm( payload ) );
		const monthCallout = buildFootprintMonthCallout( payload );
		if ( monthCallout ) {
			host.appendChild( monthCallout );
		}
		host.appendChild( buildFootprintTimeline( payload ) );
		host.appendChild(
			buildFootprintFooter( payload, userId, userName ),
		);

		paintStatus(
			state,
			[
				{
					id: 'count',
					label: sprintf(
						// translators: 1: post total, 2: comment total.
						__(
							'%1$d posts · %2$d comments tracked',
							'desktop-mode',
						),
						payload.totals.posts + payload.totals.pages,
						payload.totals.comments,
					),
					align: 'start',
					sort: 10,
				},
				{
					id: 'range',
					label: sprintf(
						// translators: 1: window-start date, 2: window-end date.
						__(
							'Window %1$s → %2$s',
							'desktop-mode',
						),
						formatShortDate( payload.range.from ),
						formatShortDate( payload.range.to ),
					),
					align: 'end',
					sort: 10,
				},
			],
			{ view: 'user-footprint', entityId: entity.id, userId },
		);
	} )();
}

function buildFootprintHero( payload: UserFootprint ): HTMLElement {
	const hero = document.createElement( 'header' );
	hero.className = 'desktop-mode-my-wordpress__footprint-hero';

	const avatar = document.createElement( 'div' );
	avatar.className = 'desktop-mode-my-wordpress__footprint-avatar';
	if ( payload.profile.avatarUrl ) {
		const img = document.createElement( 'img' );
		img.src = payload.profile.avatarUrl;
		img.alt = '';
		avatar.appendChild( img );
	} else {
		const span = document.createElement( 'span' );
		span.className = 'desktop-mode-my-wordpress__user-tile-initials';
		span.textContent = initialsOf( payload.profile.name );
		avatar.appendChild( span );
	}
	hero.appendChild( avatar );

	const text = document.createElement( 'div' );
	text.className = 'desktop-mode-my-wordpress__footprint-headline';

	const h = document.createElement( 'h1' );
	h.className = 'desktop-mode-my-wordpress__footprint-title';
	h.textContent = payload.profile.name;
	text.appendChild( h );

	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-my-wordpress__footprint-meta';

	const roles = payload.profile.roleLabels ?? [];
	for ( const r of roles ) {
		const chip = document.createElement( 'span' );
		chip.className = 'desktop-mode-my-wordpress__user-role';
		chip.textContent = r;
		meta.appendChild( chip );
	}
	if ( payload.profile.registered ) {
		const since = document.createElement( 'span' );
		since.className =
			'desktop-mode-my-wordpress__user-role desktop-mode-my-wordpress__footprint-since';
		since.textContent = sprintf(
			// translators: %s is a year-month label like "January 2023".
			__( 'Member since %s', 'desktop-mode' ),
			formatYearMonth( payload.profile.registered ),
		);
		meta.appendChild( since );
	}
	text.appendChild( meta );

	if ( payload.profile.link ) {
		const links = document.createElement( 'div' );
		links.className = 'desktop-mode-my-wordpress__user-links';
		const a = document.createElement( 'a' );
		a.href = payload.profile.link;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = __( 'Author archive', 'desktop-mode' );
		links.appendChild( a );
		text.appendChild( links );
	}

	hero.appendChild( text );
	return hero;
}

function buildFootprintHeadlineStats(
	payload: UserFootprint,
): HTMLElement {
	const wrap = document.createElement( 'section' );
	wrap.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-stats-row';

	const totalContent = payload.totals.posts + payload.totals.pages;
	wrap.appendChild(
		buildStatCard(
			totalContent.toLocaleString(),
			__( 'Total content', 'desktop-mode' ),
			payload.totals.posts > 0 && payload.totals.pages > 0
				? sprintf(
					// translators: 1: post count, 2: page count.
					__(
						'%1$d posts · %2$d pages',
						'desktop-mode',
					),
					payload.totals.posts,
					payload.totals.pages,
				)
				: '',
		),
	);
	wrap.appendChild(
		buildStatCard(
			payload.totals.comments.toLocaleString(),
			__( 'Comments left', 'desktop-mode' ),
			'',
		),
	);
	// Lifetime saves on existing content — the editor counterpart to
	// "Total content" / "Comments left". Skipped when zero so a
	// brand-new author doesn't see an empty card.
	const updateCount = payload.totals.updates ?? 0;
	if ( updateCount > 0 ) {
		wrap.appendChild(
			buildStatCard(
				updateCount.toLocaleString(),
				__( 'Updates', 'desktop-mode' ),
				__( 'Saves on existing posts', 'desktop-mode' ),
			),
		);
	}

	const longestRange = payload.streak.longestRange;
	const longestCaption =
		longestRange.from && longestRange.to
			? sprintf(
				// translators: 1: start date, 2: end date.
				__( '%1$s → %2$s', 'desktop-mode' ),
				formatShortDate( longestRange.from ),
				formatShortDate( longestRange.to ),
			)
			: '';
	wrap.appendChild(
		buildStatCard(
			sprintf(
				// translators: %d is the length in days of the user's longest publishing streak.
				_n(
					'%d day',
					'%d days',
					payload.streak.longest,
				),
				payload.streak.longest,
			),
			__( 'Longest streak', 'desktop-mode' ),
			longestCaption,
		),
	);
	wrap.appendChild(
		buildStatCard(
			sprintf(
				// translators: %d is the length in days of the user's current active streak.
				_n( '%d day', '%d days', payload.streak.current ),
				payload.streak.current,
			),
			__( 'Current streak', 'desktop-mode' ),
			payload.streak.current === 0
				? __( 'No activity today', 'desktop-mode' )
				: __( 'Including today', 'desktop-mode' ),
		),
	);

	return wrap;
}

/**
 * Build the GitHub-style 52-week × 7-day calendar heatmap. Each cell
 * shades by activity intensity (posts + comments folded into one
 * score) — we use 5 buckets so the gradient reads at a glance.
 *
 * Each cell carries a `title` attribute with the exact date + counts
 * so the user can hover for the detail; the legend strip below the
 * grid explains what the colors mean.
 */
function buildFootprintCalendar(
	payload: UserFootprint,
): HTMLElement {
	const section = document.createElement( 'section' );
	section.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-calendar-section';

	const h = document.createElement( 'h3' );
	h.textContent = __( 'A year of activity', 'desktop-mode' );
	section.appendChild( h );

	const calendar = document.createElement( 'div' );
	calendar.className = 'desktop-mode-my-wordpress__footprint-calendar';

	// Bucket each day by intensity. Max intensity in the window
	// drives the scale so a sparse poster's pattern still reads.
	// Update saves count toward the intensity alongside fresh posts
	// and comments — same shape as GitHub, where edits to existing
	// content paint the calendar just as boldly as net-new work.
	const dayIntensity = ( d: UserFootprint[ 'daily' ][ number ] ): number =>
		d.posts + d.comments + ( d.updates ?? 0 );
	const maxIntensity = payload.daily.reduce( ( m, d ) => {
		const v = dayIntensity( d );
		return v > m ? v : m;
	}, 0 );
	const bucketize = ( v: number ): number => {
		if ( v <= 0 ) {
			return 0;
		}
		if ( maxIntensity <= 0 ) {
			return 0;
		}
		const ratio = v / maxIntensity;
		if ( ratio > 0.75 ) {
			return 4;
		}
		if ( ratio > 0.5 ) {
			return 3;
		}
		if ( ratio > 0.25 ) {
			return 2;
		}
		return 1;
	};

	// Build a `Date` for each entry once.
	const dates = payload.daily.map( ( d ) => new Date( d.date + 'T00:00:00Z' ) );
	if ( dates.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-my-wordpress__article-meta';
		empty.textContent = __(
			'No activity recorded in the last year.',
			'desktop-mode',
		);
		section.appendChild( empty );
		return section;
	}

	// Pad the leading week so column 0 starts on Sunday — keeps
	// the weekday rows aligned the way GitHub does it.
	const firstDow = dates[ 0 ].getUTCDay(); // 0..6 (Sun..Sat)
	const grid = document.createElement( 'div' );
	grid.className = 'desktop-mode-my-wordpress__footprint-grid';

	// The grid has two non-cell tracks reserved at the start:
	//   - row 1 holds month labels above the data,
	//   - col 1 holds weekday labels (Mon / Wed / Fri) to the left.
	// Data cells start at (row 2, col 2). Compute (row, col) from a
	// linear day offset so the math stays the same as the legacy
	// auto-flow rendering. `dataCol` advances by 1 every 7 days.
	const placeCell = (
		el: HTMLElement,
		linearDayOffset: number,
	): void => {
		const dow = linearDayOffset % 7; // 0..6 (Sun..Sat)
		const week = Math.floor( linearDayOffset / 7 );
		el.style.gridRow = String( dow + 2 );
		el.style.gridColumn = String( week + 2 );
	};

	// Weekday labels — Mon / Wed / Fri only, matching the GitHub
	// pattern. Derived from a known-Monday date so the locale
	// formatter does the translation. The Sun/Tue/Thu/Sat rows are
	// intentionally blank so the label column reads as a column of
	// every-other-row text.
	const weekdaySource = [
		// 2024-12-02 was a Monday (UTC).
		new Date( Date.UTC( 2024, 11, 2 ) ), // Mon
		new Date( Date.UTC( 2024, 11, 4 ) ), // Wed
		new Date( Date.UTC( 2024, 11, 6 ) ), // Fri
	];
	const weekdayRows = [ 2, 4, 6 ]; // Mon=row 3, Wed=row 5, Fri=row 7 (1-indexed + header)
	for ( let i = 0; i < weekdaySource.length; i += 1 ) {
		const lbl = document.createElement( 'span' );
		lbl.className = 'desktop-mode-my-wordpress__footprint-weekday';
		lbl.textContent = weekdaySource[ i ].toLocaleDateString( undefined, {
			weekday: 'short',
		} );
		lbl.style.gridColumn = '1';
		lbl.style.gridRow = String( weekdayRows[ i ] + 1 ); // +1 → row 3 / 5 / 7
		grid.appendChild( lbl );
	}

	// Padding cells for the leading week so the first real day lands
	// on its actual weekday row. Positioned explicitly so the grid's
	// 2D placement stays deterministic regardless of source order.
	for ( let i = 0; i < firstDow; i += 1 ) {
		const blank = document.createElement( 'span' );
		blank.className =
			'desktop-mode-my-wordpress__footprint-cell desktop-mode-my-wordpress__footprint-cell--pad';
		blank.setAttribute( 'aria-hidden', 'true' );
		placeCell( blank, i );
		grid.appendChild( blank );
	}
	// Month labels — one per month transition, positioned above the
	// first week that contains a day in that month. Append before the
	// data cells so painters don't have to fight overlapping z-order.
	let lastMonth = -1;
	for ( let i = 0; i < payload.daily.length; i += 1 ) {
		const d = dates[ i ];
		const m = d.getUTCMonth();
		if ( m === lastMonth ) {
			continue;
		}
		lastMonth = m;
		const linear = firstDow + i;
		const week = Math.floor( linear / 7 );
		// Skip a month label that would land in the very first column
		// when its first visible day is mid-week — the label would
		// half-overhang the weekday-label gutter. The next month over
		// already carries the visual anchor for the year boundary.
		if ( week === 0 && linear % 7 !== 0 ) {
			continue;
		}
		const lbl = document.createElement( 'span' );
		lbl.className = 'desktop-mode-my-wordpress__footprint-month';
		lbl.textContent = d.toLocaleDateString( undefined, { month: 'short' } );
		lbl.style.gridRow = '1';
		lbl.style.gridColumn = String( week + 2 );
		grid.appendChild( lbl );
	}
	for ( let i = 0; i < payload.daily.length; i += 1 ) {
		const d = payload.daily[ i ];
		const intensity = bucketize( dayIntensity( d ) );
		const cell = document.createElement( 'span' );
		cell.className = `desktop-mode-my-wordpress__footprint-cell desktop-mode-my-wordpress__footprint-cell--l${ intensity }`;
		cell.title = sprintf(
			// translators: 1: date, 2: post count, 3: comment count, 4: update (re-save) count.
			__(
				'%1$s — %2$d posts, %3$d comments, %4$d updates',
				'desktop-mode',
			),
			formatLongDate( d.date ),
			d.posts,
			d.comments,
			d.updates ?? 0,
		);
		cell.dataset.date = d.date;
		placeCell( cell, firstDow + i );
		grid.appendChild( cell );
	}
	calendar.appendChild( grid );

	// Legend.
	const legend = document.createElement( 'div' );
	legend.className = 'desktop-mode-my-wordpress__footprint-legend';
	const less = document.createElement( 'span' );
	less.className = 'desktop-mode-my-wordpress__footprint-legend-label';
	less.textContent = __( 'Less', 'desktop-mode' );
	legend.appendChild( less );
	for ( let i = 0; i <= 4; i += 1 ) {
		const sw = document.createElement( 'span' );
		sw.className = `desktop-mode-my-wordpress__footprint-cell desktop-mode-my-wordpress__footprint-cell--l${ i }`;
		legend.appendChild( sw );
	}
	const more = document.createElement( 'span' );
	more.className = 'desktop-mode-my-wordpress__footprint-legend-label';
	more.textContent = __( 'More', 'desktop-mode' );
	legend.appendChild( more );
	calendar.appendChild( legend );

	section.appendChild( calendar );
	return section;
}

function buildFootprintRhythm( payload: UserFootprint ): HTMLElement {
	const section = document.createElement( 'section' );
	section.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-rhythm';

	const h = document.createElement( 'h3' );
	h.textContent = __( 'Publishing rhythm', 'desktop-mode' );
	section.appendChild( h );

	const grid = document.createElement( 'div' );
	grid.className = 'desktop-mode-my-wordpress__footprint-rhythm-grid';

	// Weekday chart.
	const weekdayWrap = document.createElement( 'div' );
	weekdayWrap.className = 'desktop-mode-my-wordpress__footprint-chart';
	const weekdayCap = document.createElement( 'div' );
	weekdayCap.className = 'desktop-mode-my-wordpress__footprint-chart-caption';
	weekdayCap.textContent = __( 'By weekday', 'desktop-mode' );
	weekdayWrap.appendChild( weekdayCap );
	const weekdayLabels = [
		__( 'S', 'desktop-mode' ),
		__( 'M', 'desktop-mode' ),
		__( 'T', 'desktop-mode' ),
		__( 'W', 'desktop-mode' ),
		__( 'T', 'desktop-mode' ),
		__( 'F', 'desktop-mode' ),
		__( 'S', 'desktop-mode' ),
	];
	const weekdayFull = [
		__( 'Sunday', 'desktop-mode' ),
		__( 'Monday', 'desktop-mode' ),
		__( 'Tuesday', 'desktop-mode' ),
		__( 'Wednesday', 'desktop-mode' ),
		__( 'Thursday', 'desktop-mode' ),
		__( 'Friday', 'desktop-mode' ),
		__( 'Saturday', 'desktop-mode' ),
	];
	weekdayWrap.appendChild(
		buildBarChart( payload.weekday, weekdayLabels, weekdayFull ),
	);
	grid.appendChild( weekdayWrap );

	// Hour chart.
	const hourWrap = document.createElement( 'div' );
	hourWrap.className = 'desktop-mode-my-wordpress__footprint-chart';
	const hourCap = document.createElement( 'div' );
	hourCap.className = 'desktop-mode-my-wordpress__footprint-chart-caption';
	hourCap.textContent = __( 'By hour of day (site time)', 'desktop-mode' );
	hourWrap.appendChild( hourCap );
	const hourLabels = [
		'0',
		'',
		'',
		'3',
		'',
		'',
		'6',
		'',
		'',
		'9',
		'',
		'',
		'12',
		'',
		'',
		'15',
		'',
		'',
		'18',
		'',
		'',
		'21',
		'',
		'',
	];
	const hourFull = Array.from( { length: 24 }, ( _, i ) =>
		sprintf(
			// translators: %d is an hour of the day (0-23).
			__( '%d:00', 'desktop-mode' ),
			i,
		),
	);
	hourWrap.appendChild(
		buildBarChart( payload.hour, hourLabels, hourFull ),
	);
	grid.appendChild( hourWrap );

	section.appendChild( grid );
	return section;
}

function buildBarChart(
	values: number[],
	labels: string[],
	titles: string[],
): HTMLElement {
	const chart = document.createElement( 'div' );
	chart.className = 'desktop-mode-my-wordpress__footprint-bars';
	const max = Math.max( 1, ...values );
	values.forEach( ( v, i ) => {
		const col = document.createElement( 'div' );
		col.className = 'desktop-mode-my-wordpress__footprint-bar-col';
		const bar = document.createElement( 'div' );
		bar.className = 'desktop-mode-my-wordpress__footprint-bar';
		bar.style.height = `${ Math.round( ( v / max ) * 100 ) }%`;
		bar.title = sprintf(
			// translators: 1: bucket label, 2: count.
			__(
				'%1$s · %2$d',
				'desktop-mode',
			),
			titles[ i ] ?? labels[ i ] ?? String( i ),
			v,
		);
		if ( v === 0 ) {
			bar.classList.add(
				'desktop-mode-my-wordpress__footprint-bar--empty',
			);
		}
		col.appendChild( bar );
		const lbl = document.createElement( 'span' );
		lbl.className = 'desktop-mode-my-wordpress__footprint-bar-label';
		lbl.textContent = labels[ i ] ?? '';
		col.appendChild( lbl );
		chart.appendChild( col );
	} );
	return chart;
}

function buildFootprintMonthCallout(
	payload: UserFootprint,
): HTMLElement | null {
	const m = payload.totals.mostProlificMonth;
	if ( ! m ) {
		return null;
	}
	const section = document.createElement( 'section' );
	section.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-callout';

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-my-wordpress__footprint-callout-label';
	label.textContent = __( 'Most prolific month', 'desktop-mode' );
	section.appendChild( label );

	const value = document.createElement( 'h3' );
	value.className = 'desktop-mode-my-wordpress__footprint-callout-value';
	value.textContent = formatYearMonth( m.ym + '-01T00:00:00Z' );
	section.appendChild( value );

	const detail = document.createElement( 'p' );
	detail.className = 'desktop-mode-my-wordpress__footprint-callout-detail';
	detail.textContent = sprintf(
		// translators: %d is a post count.
		_n(
			'%d post published — their personal record.',
			'%d posts published — their personal record.',
			m.n,
		),
		m.n,
	);
	section.appendChild( detail );

	return section;
}

function buildFootprintTimeline(
	payload: UserFootprint,
): HTMLElement {
	const section = document.createElement( 'section' );
	section.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-timeline-section';

	const h = document.createElement( 'h3' );
	h.textContent = __( 'Recent activity', 'desktop-mode' );
	section.appendChild( h );

	if ( payload.timeline.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-my-wordpress__article-meta';
		empty.textContent = __( 'Nothing to show yet.', 'desktop-mode' );
		section.appendChild( empty );
		return section;
	}

	const list = document.createElement( 'ul' );
	list.className = 'desktop-mode-my-wordpress__footprint-timeline';

	for ( const ev of payload.timeline ) {
		const li = document.createElement( 'li' );
		li.className = `desktop-mode-my-wordpress__footprint-event desktop-mode-my-wordpress__footprint-event--${ ev.kind }`;

		const dot = document.createElement( 'span' );
		dot.className = 'desktop-mode-my-wordpress__footprint-dot';
		const icon = document.createElement( 'span' );
		let iconClass = 'dashicons-admin-post';
		if ( ev.kind === 'comment' ) {
			iconClass = 'dashicons-admin-comments';
		} else if ( ev.kind === 'post-update' ) {
			iconClass = 'dashicons-edit';
		}
		icon.className = 'dashicons ' + iconClass;
		icon.setAttribute( 'aria-hidden', 'true' );
		dot.appendChild( icon );
		li.appendChild( dot );

		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__footprint-event-body';

		const title = ev.title || __( '(no title)', 'desktop-mode' );
		const titleNode: HTMLElement = ev.link
			? document.createElement( 'a' )
			: document.createElement( 'span' );
		titleNode.className =
			'desktop-mode-my-wordpress__footprint-event-title';
		if ( ev.kind === 'comment' ) {
			titleNode.textContent = sprintf(
				// translators: %s is a post title the user commented on.
				__( 'Commented on “%s”', 'desktop-mode' ),
				title,
			);
		} else if ( ev.kind === 'post-update' ) {
			titleNode.textContent = sprintf(
				// translators: %s is the post title the user re-saved.
				__( 'Updated “%s”', 'desktop-mode' ),
				title,
			);
		} else {
			titleNode.textContent = title;
		}
		if ( ev.link && titleNode instanceof HTMLAnchorElement ) {
			titleNode.href = ev.link;
			titleNode.target = '_blank';
			titleNode.rel = 'noopener noreferrer';
		}
		body.appendChild( titleNode );

		const meta = document.createElement( 'span' );
		meta.className = 'desktop-mode-my-wordpress__footprint-event-meta';
		const parts: string[] = [ formatLongDate( ev.date ) ];
		if ( ev.status && ev.status !== 'publish' && ev.status !== 'approved' ) {
			parts.push( ev.status );
		}
		meta.textContent = parts.join( ' · ' );
		body.appendChild( meta );

		li.appendChild( body );
		list.appendChild( li );
	}
	section.appendChild( list );
	return section;
}

function buildFootprintFooter(
	payload: UserFootprint,
	userId: number,
	userName: string,
): HTMLElement {
	const footer = document.createElement( 'footer' );
	footer.className =
		'desktop-mode-my-wordpress__footprint-section desktop-mode-my-wordpress__footprint-footer';

	const archiveBtn = document.createElement( 'wpd-button' );
	archiveBtn.setAttribute( 'variant', 'ghost' );
	archiveBtn.textContent = __( 'View author archive', 'desktop-mode' );
	archiveBtn.addEventListener( 'click', () => {
		if ( payload.profile.link ) {
			window.open( payload.profile.link, '_blank', 'noopener,noreferrer' );
		}
	} );
	if ( ! payload.profile.link ) {
		archiveBtn.setAttribute( 'disabled', '' );
	}
	footer.appendChild( archiveBtn );

	const editBtn = document.createElement( 'wpd-button' );
	editBtn.setAttribute( 'variant', 'primary' );
	editBtn.textContent = __( 'Show profile', 'desktop-mode' );
	editBtn.addEventListener( 'click', () => {
		openUserEditWindow( userId );
	} );
	footer.appendChild( editBtn );

	// Reserve `userName` for future extension (e.g. "Share this
	// footprint with…" copy paths) without changing the signature
	// downstream.
	void userName;
	return footer;
}

function formatShortDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleDateString( undefined, {
			month: 'short',
			day: 'numeric',
		} );
	} catch {
		return iso;
	}
}

function formatLongDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleDateString( undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		} );
	} catch {
		return iso;
	}
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
 * Returns the click handler to wire into a tile's `click` listener.
 */
function createTileSelector(): ( tile: HTMLElement ) => void {
	let selected: HTMLElement | null = null;
	return ( tile: HTMLElement ) => {
		if ( selected === tile ) {
			return;
		}
		if ( selected ) {
			selected.classList.remove(
				'desktop-mode-file-tile--selected',
			);
		}
		tile.classList.add( 'desktop-mode-file-tile--selected' );
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
 *  REST `desktop_mode_file_placements` table — virtual entities don't
 *  belong there. The interaction model is the same (pointer capture,
 *  click-vs-drag threshold, `--dragging` class).
 * ------------------------------------------------------------------ */

// Cell pitch for the in-window absolute-positioned tile canvas used
// by Posts / Pages / users / plugin sections. Tile visual is 88px
// wide; the previous 96×92 cell pitch left only ~4px per side
// between neighbours, so the selected tile's background ring abutted
// adjacent corner ribbons and read as "spillover" (regression
// surfaced once `<wpd-ribbon>` started rendering DRAFT/PENDING
// banners). Widen the cell so the selection ring has
// breathing room — and so wrapped 2-line labels don't push the next
// row's tile into the cell above. Tile label is clamped to 2 lines
// via CSS in `my-wordpress.css`; if you change that clamp, raise
// `TILE_H` to match.
const TILE_W = 108;
const TILE_H = 112;
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
	/**
	 * Compute the next N column-major free cells in canvas-pixel
	 * coords WITHOUT claiming them in the layout's occupied set.
	 * Used by the loading skeleton so placeholders land in the same
	 * slots the next batch of real tiles will fill — keeping the
	 * "where the next icons go" promise honest.
	 */
	peekNextCells: ( count: number ) => Array< { x: number; y: number } >;
	/**
	 * Drop every tracked tile entry and clear the occupied set so the
	 * same layout instance can be reused for a fresh result set. The
	 * persisted-positions map on disk stays intact — when a previously-
	 * placed tile's key reappears (e.g. user clears the search field),
	 * its remembered position is restored.
	 */
	clear: () => void;
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

	/**
	 * Walk the same column-major auto-flow `place()` uses, starting
	 * from the cells the layout already considers occupied, and
	 * return the next `count` (x, y) coordinates without recording
	 * a claim. The loading-skeleton helper uses this so a 4-page
	 * "load more" run paints 4 placeholders into the four cells the
	 * next four real tiles will actually fill — wrapping to the
	 * next row when the current one runs out.
	 */
	const peekNextCells = (
		count: number,
	): Array< { x: number; y: number } > => {
		const width =
			host.clientWidth > 0
				? host.clientWidth
				: TILE_PAD + 5 * TILE_W;
		const cols = Math.max(
			1,
			Math.floor( ( width - TILE_PAD ) / TILE_W ),
		);
		const taken = new Set< string >( occupied );
		const out: Array< { x: number; y: number } > = [];
		for ( let i = 0; i < count; i += 1 ) {
			for ( let n = 0; ; n += 1 ) {
				const col = n % cols;
				const row = Math.floor( n / cols );
				const key = `${ col },${ row }`;
				if ( taken.has( key ) ) {
					continue;
				}
				taken.add( key );
				out.push( {
					x: TILE_PAD + col * TILE_W,
					y: TILE_PAD + row * TILE_H,
				} );
				break;
			}
		}
		return out;
	};

	const clear = (): void => {
		entries.length = 0;
		occupied.clear();
		host.style.minHeight = '';
	};

	return {
		host,
		scope,
		place,
		commit,
		sort,
		reflow,
		peekNextCells,
		clear,
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

// `attachTileDrag` was a snap-back pointer-event drag with no real
// rearrange or drag-out function. It existed as a placeholder for
// future cross-window drag-out, but it set `setPointerCapture` on the
// tile which BROKE HTML5 `dragstart` detection on the `draggable=true`
// post tiles — the long-standing "I can lift the tile but no drop
// target sees it" bug. Removed; entity tiles now use the
// centralized DragManager (`pointerdown` -> `dragManager.start()`)
// for drag-out and a plain `click` listener for selection.

/**
 * The most-recently-mounted My WordPress window's `RenderState`, or
 * `null` when none is open. Used by the public
 * `wp.desktop.myWordpress.openDetail()` API so any other shell
 * surface (folder window CMO, plugin code) can route the My
 * WordPress window directly into a post's detail dossier without
 * duplicating the per-relation rendering. When multiple instances
 * are open (a duplicate spawned via `wp.desktop.openNewWindow`, or a
 * second copy on another virtual desktop) this points at the
 * latest mount — that's the one the user just acted on, so a
 * fresh `openDetail()` navigates it in place rather than spawning
 * another window.
 */
let activeState: RenderState | null = null;
/**
 * Every currently-mounted `RenderState`, keyed by its body host
 * element. Multi-instance support: the kind-registry renderers
 * receive an opaque `EntityRenderHost` derived from a specific
 * window's state, and we need to recover the matching state even
 * when it isn't the most recently focused one. Without this map,
 * navigating inside a NON-latest instance threw — `asRenderState`
 * fell back to the singleton `activeState` and rejected the call
 * because the bodies didn't match.
 */
const liveStates = new Map< HTMLElement, RenderState >();
/**
 * Pending route applied on next `renderInto`. When the My WordPress
 * window isn't open yet, `openDetail()` opens it AND queues a
 * navigation here; the freshly-mounted state pulls + clears the
 * queue.
 */
let pendingRoute: Route | null = null;
/**
 * Monotonic counter for the per-instance drop-target id. Multiple
 * My WordPress windows can coexist (duplicate via the dock peek,
 * a second copy on another virtual desktop), so the claimant id
 * has to be unique per render — otherwise the second registration
 * silently replaces the first's element binding in the drag
 * registry and instance 1's body stops rejecting drops.
 */
let rejectIdCounter = 0;

function renderInto( body: HTMLElement ): ( () => void ) | undefined {
	const root = body.querySelector< HTMLElement >( ROOT_SEL );
	if ( ! root ) {
		return undefined;
	}
	const breadcrumbsHost = root.querySelector< HTMLElement >( BREADCRUMBS_SEL );
	const bodyHost = root.querySelector< HTMLElement >( BODY_SEL );
	const statusHost = root.querySelector< HTMLElement >( STATUS_SEL );
	if ( ! breadcrumbsHost || ! bodyHost || ! statusHost ) {
		return undefined;
	}

	const state: RenderState = {
		route: { kind: 'root' },
		body: bodyHost,
		root,
		breadcrumbs: breadcrumbsHost,
		statusBar: statusHost,
		teardown: [],
		history: [],
	};
	activeState = state;
	liveStates.set( bodyHost, state );

	// Window-lifetime teardowns — tracked OUTSIDE `state.teardown`
	// because `navigate()` flushes the latter on every route change.
	// Putting drop-target deregistration and tile-menu cleanup in
	// `state.teardown` (the previous shape) meant the first
	// `navigate( state, root )` call below ran them immediately, so
	// the window's drop-rejection claimant never survived past the
	// initial paint. These run exclusively from the returned
	// teardown.
	const windowTeardowns: Array< () => void > = [];

	// Register a CLAIMANT drop target on the window body that rejects
	// every payload. My WordPress is a read-only directory listing
	// over the WP REST API — dropping a desktop tile, a placement,
	// or a shortcut onto it has no defined semantic. Without this
	// claimant, the drag manager's hit-test walks past the window
	// boundary and silently `cancel('no-target')`s — from the user's
	// perspective the ghost just disappears with no feedback.
	//
	// Returning `accept: false` paints the no-drop cursor + reject
	// snap-back animation, so users get visible "this surface
	// doesn't take drops" feedback instead of guessing. The
	// claimant ALSO blocks the drag from falling through to the
	// wallpaper canvas under the window (registry.hitTest stops at
	// the first registered target it finds in the walk-up).
	//
	const dragManager = getDragManager();
	if ( dragManager ) {
		rejectIdCounter += 1;
		const deregister = dragManager.registerDropTarget( {
			id: `${ WINDOW_ID }-reject-${ rejectIdCounter }`,
			element: body,
			accept: () => false,
			onDrop: () => {
				// Unreachable — `accept: false` short-circuits the
				// commit path. Defined for the type contract.
			},
		} );
		windowTeardowns.push( deregister );
	}

	// Back button + crumb-click handlers are wired by the shared
	// breadcrumb helper inside `updateBreadcrumbs` — no per-element
	// listener wiring here anymore.

	windowTeardowns.push( () => closeAnyTileMenu() );

	// If the consumer opened the window via `openDetail` while it
	// was closed, the queued route is the actual destination.
	//
	// A pending footprint target (set cross-bundle by
	// `openUserFootprintWindow` — e.g. the chromeless `users.php`
	// row action routed through the window-system bridge) wins over
	// the queued `pendingRoute` and the root fallback: it is the most
	// recent, explicit user intent and survives the lazy-bundle load
	// because it lives in a shared store rather than this module's
	// `pendingRoute`. Consume + clear so a later plain open lands on
	// root.
	const footprint = readFootprintTarget();
	let initialRoute: Route;
	if ( footprint.userId && footprint.userId > 0 ) {
		initialRoute = footprintRouteFor(
			footprint.userId,
			footprint.userName,
		);
		clearFootprintTarget();
	} else {
		initialRoute = pendingRoute ?? { kind: 'root' };
	}
	pendingRoute = null;
	navigate( state, initialRoute );

	// Subscribe to cross-window broadcast change signals so the list
	// refreshes reactively when any post, page, media, or CPT is mutated
	// elsewhere in the shell (like the Recycle Bin).
	const api = window.wp?.desktop;
	if ( api && typeof api.subscribe === 'function' ) {
		let domainRefreshTimer: number | null = null;
		const onDomainChanged = ( payload: unknown, meta: { topic: string } ): void => {
			const detail = payload as { source?: string } | null;
			// Skip our own emissions to avoid loop
			if ( detail?.source === 'my-wordpress' ) {
				return;
			}
			// Only refresh if the topic matches the active list's entity topic.
			const currentRoute = state.route;
			if ( currentRoute.kind === 'list' ) {
				const activeEntity = getConfig().entities.find( ( e ) => e.id === currentRoute.entityId );
				const activeTopic = activeEntity && getBroadcastTopicForEntity( activeEntity );
				if ( activeTopic && meta.topic === activeTopic ) {
					if ( domainRefreshTimer !== null ) {
						window.clearTimeout( domainRefreshTimer );
					}
					domainRefreshTimer = window.setTimeout( () => {
						domainRefreshTimer = null;
						if ( state.route.kind === 'list' && state.route.entityId === currentRoute.entityId ) {
							navigate( state, state.route );
						}
					}, 150 );
				}
			}
		};

		for ( const entity of getConfig().entities ) {
			const topic = getBroadcastTopicForEntity( entity );
			if ( ! topic ) {
				continue; // Non-post-type entities (e.g. Users) have no broadcast bus.
			}
			const unsub = api.subscribe( topic, onDomainChanged );
			windowTeardowns.push( unsub );
		}

		windowTeardowns.push( () => {
			if ( domainRefreshTimer !== null ) {
				window.clearTimeout( domainRefreshTimer );
				domainRefreshTimer = null;
			}
		} );
	}

	// Return a teardown the framework invokes when THIS specific
	// window closes. The framework wires it to the per-window
	// lifecycle (see `Window.hydrateNative`), so a duplicate
	// instance closing only tears down its OWN state — the previous
	// implementation listened for `desktop-mode-window-closed`
	// globally and matched on the base WINDOW_ID, which fired for
	// every sibling's close event and clobbered live instances.
	return () => {
		clearTeardown( state );
		for ( const fn of windowTeardowns ) {
			try {
				fn();
			} catch {
				/* swallow — teardown best-effort */
			}
		}
		windowTeardowns.length = 0;
		liveStates.delete( bodyHost );
		if ( activeState === state ) {
			// Promote whichever sibling is still alive to active so
			// `openDetail` / `openMedia` keep routing to an open
			// instance instead of spawning a fresh window.
			const next = liveStates.size > 0
				? Array.from( liveStates.values() ).pop()!
				: null;
			activeState = next;
		}
	};
}

const callback: RenderCallback = ( body ) => {
	try {
		return renderInto( body );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[my-wordpress] render failed:', err );
		return undefined;
	}
};

window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
window.desktopModeNativeWindows[ WINDOW_ID ] = callback;

// Built-in entity-kind renderers. Third-party plugins can register
// their own via `wp.desktop.myWordpress.registerEntityKind()`.
registerEntityKind( 'post', ( host, entity ) => {
	renderEntityList( asRenderState( host ), entity );
} );
registerEntityKind( 'user', ( host, entity ) => {
	renderUserEntityList( asRenderState( host ), entity );
} );
registerEntityKind( 'media', renderMediaList );

/**
 * Recover the internal `RenderState` from an `EntityRenderHost`.
 * Only the legacy renderers (`renderEntityList`,
 * `renderUserEntityList`) still take the internal state directly;
 * the registry passes the public host shape so plugins can call
 * `host.navigate` / `host.addTeardown`. This shim bridges the
 * two during the gradual rewrite.
 *
 * Looks up `host.body` in the live-states map (instead of
 * comparing against the singleton `activeState`) so navigating
 * inside a NON-latest instance still resolves to the correct
 * state. Without the map lookup, every kind-registry render
 * (Posts list, Users list, …) in a backgrounded duplicate threw
 * with "host body does not match active state" — the symptom the
 * user saw as "the second window won't load" once they tried to
 * drill in.
 */
function asRenderState( host: EntityRenderHost ): RenderState {
	const found = liveStates.get( host.body );
	if ( found ) {
		return found;
	}
	if ( activeState && host.body === activeState.body ) {
		return activeState;
	}
	throw new Error(
		'[my-wordpress] asRenderState: host body does not match any live render state.',
	);
}

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
 * ------------------------------------------------------------------ */

/**
 * Build a `user-footprint` route for a target user. `entityId` is the
 * built-in `'users'` entity (registered server-side in
 * `includes/my-wordpress/window.php`); `getEntity( 'users' )` resolves
 * it inside `navigate()`. A missing entity renders the in-window
 * "Unknown entity type" error rather than throwing.
 */
function footprintRouteFor( userId: number, userName: string ): Route {
	return {
		kind: 'user-footprint',
		entityId: 'users',
		userId,
		userName,
	};
}

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

interface OpenMediaArgs {
	mediaId: number;
	mediaTitle?: string;
}

/**
 * Route the My WordPress window directly into the media drill-in
 * view for the given attachment. Mirrors `openDetail()` for posts.
 *
 * @public
 */
function openMedia( args: OpenMediaArgs ): void {
	const route: Route = {
		kind: 'media-detail',
		entityId: 'media',
		mediaId: args.mediaId,
		mediaTitle: args.mediaTitle ?? `#${ args.mediaId }`,
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
	desktop?.openWindow?.( WINDOW_ID, { source: 'my-wordpress/open-media' } );
}

interface OpenUserFootprintArgs {
	userId: number;
	userName?: string;
}

/**
 * Route the My WordPress window directly into a user's activity
 * footprint. Cross-bundle and cold-start safe: delegates to the shared
 * `openUserFootprintWindow` helper, which stashes the target in a
 * shared store and opens-or-focuses the window so the freshly-mounted
 * (or already-live) bundle navigates to the footprint route. Mirrors
 * `openDetail()` / `openMedia()`, for users.
 *
 * @public
 *
 * @param args Footprint target (`userId` required, `userName` optional).
 */
function openUserFootprint( args: OpenUserFootprintArgs ): void {
	openUserFootprintWindow( args );
}

interface MyWordpressApi {
	openDetail: ( args: OpenDetailArgs ) => void;
	openMedia: ( args: OpenMediaArgs ) => void;
	openUserFootprint: ( args: OpenUserFootprintArgs ) => void;
	registerEntityKind: ( kind: string, renderer: EntityRenderer ) => () => void;
	/**
	 * Trash an entity by its My WordPress entity id (`'posts'`,
	 * `'pages'`, `'users'`, plugin-defined). Returns a Promise that
	 * resolves when the REST DELETE succeeds and broadcasts
	 * `desktop-mode-my-wordpress-entity-trashed` so every live list
	 * view drops the tile reactively.
	 *
	 * Does NOT show a confirm dialog — UX layer is the caller's
	 * responsibility. The right-click "Move to Trash" menu wraps this
	 * with its own confirm; the recycle-bin drag-to-trash calls it
	 * directly (macOS pattern: drag is the deliberate gesture, no
	 * extra confirm).
	 */
	trashEntity: ( entityId: string, id: number ) => Promise< void >;
}

interface PendingEntry {
	kind: string;
	renderer: EntityRenderer;
	slot: { unregister: ( () => void ) | null };
}

const desktopGlobal = (
	window.wp as
		| { desktop?: Record< string, unknown > & {
				myWordpress?: MyWordpressApi & {
					__pendingKinds?: PendingEntry[];
				};
			} }
		| undefined
)?.desktop;
if ( desktopGlobal ) {
	// Drain the early-registration queue installed by
	// `src/my-wordpress/early-api.ts` (which ships in the main
	// `desktop.min.js` bundle). Lets plugin scripts that load
	// before this lazy bundle register kinds without timing
	// guards. We write the real `unregister` closure back into
	// each queued entry's `slot` so any stub-unregister that the
	// plugin already cached still works after the swap.
	const pending = desktopGlobal.myWordpress?.__pendingKinds;
	if ( Array.isArray( pending ) ) {
		for ( const entry of pending ) {
			try {
				entry.slot.unregister = registerEntityKind(
					entry.kind,
					entry.renderer,
				);
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error(
					`[my-wordpress] queued registerEntityKind('${ entry.kind }') failed:`,
					err,
				);
			}
		}
		pending.length = 0;
	}
	desktopGlobal.myWordpress = {
		openDetail,
		openMedia,
		openUserFootprint,
		registerEntityKind,
		trashEntity: trashEntityById,
	};

	// Warm re-target. When a footprint open arrives while a My
	// WordPress window is already mounted, `openWindow()` just focuses
	// the existing instance (no remount), so `renderInto`'s mount-read
	// never runs. Navigate the most-recently-active instance to the
	// requested footprint instead. The cold case (window closed, or
	// the bundle not yet loaded) is handled by the mount-read in
	// `renderInto`, so the `! activeState` guard here intentionally
	// no-ops — the store stays set for that mount to consume.
	subscribeFootprintTarget( ( next ) => {
		if ( ! next.userId || next.userId <= 0 || ! activeState ) {
			return;
		}
		navigate(
			activeState,
			footprintRouteFor( next.userId, next.userName ),
		);
		clearFootprintTarget();
	} );

	// Live-tile pruning on trash. Every live My WordPress list body
	// listens for the broadcast — `trashEntityById` fires this after
	// a successful REST DELETE; the right-click `confirmTrash` path
	// removes the tile inline first, so the query here finds nothing
	// and no-ops. Lets the drag-to-trash flow share the same UI
	// cleanup as the CMO without duplicating the tile-removal logic.
	document.addEventListener(
		'desktop-mode-my-wordpress-entity-trashed',
		( e: Event ) => {
			const detail = (
				e as CustomEvent< { entityId: string; id: number } >
			).detail;
			if ( ! detail || typeof detail.id !== 'number' ) {
				return;
			}
			for ( const state of liveStates.values() ) {
				const tile = state.body.querySelector< HTMLElement >(
					`[data-entry-id="${ detail.id }"]`,
				);
				tile?.remove();
			}
		},
	);
}
