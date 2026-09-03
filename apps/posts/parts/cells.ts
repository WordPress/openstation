/**
 * Posts app — the cell renderers.
 *
 * Every cell builds its DOM imperatively because `<os-table>` paints
 * rows inside its own shadow root, where the document's stylesheets
 * never reach: inline styles are the working contract, and the cells
 * that need a component (`<os-avatar>`, `<os-tag-input>`,
 * `<os-category-picker>`, `<os-relative-time>`) register it here via
 * a leaf side-effect import, since the framework's lazy loader only
 * scans the light DOM.
 *
 * The cell cache (`memoCell`) is what keeps a row stable across the
 * table's own repaints: `<os-table>` rebuilds its body on every
 * selection / expand / sort change, and without the cache every
 * avatar and chip flashed for a frame. The app clears it on a real
 * data change.
 *
 * @public
 */

import { __, _n, sprintf } from '../../../src/i18n';
import { applyAvatarSrc } from '../../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../../src/utils';
import '../../../src/ui/components/os-avatar/os-avatar';
import '../../../src/ui/components/os-tag-input/os-tag-input';
import '../../../src/ui/components/os-category-picker/os-category-picker';
import '../../../src/ui/components/os-relative-time/os-relative-time';
import type { OsTagInput, OsTagItem } from '../../../src/ui/components/os-tag-input/os-tag-input';
import type {
	OsCategoryItem,
	OsCategoryPicker,
} from '../../../src/ui/components/os-category-picker/os-category-picker';
import type { PostsRestClient } from './rest';
import type { CategoryTerm, ListExtra, PostListItem, TagTerm } from './types';

/** What a cell needs from the app: the config, the client, two shell doors. */
export interface CellEnv {
	extra: ListExtra;
	client: PostsRestClient;
	/** Open an admin URL in an iframe window. */
	openUrl: ( url: string, title: string, icon: string ) => void;
	/** The shell's confirm dialog. */
	confirm: ( options: { title?: string; message: string; confirmLabel?: string; danger?: boolean } ) => Promise< boolean >;
}

const STATUS_LABELS: Record< string, string > = {
	publish: __( 'Published' ),
	future: __( 'Scheduled' ),
	draft: __( 'Draft' ),
	pending: __( 'Pending' ),
	private: __( 'Private' ),
	trash: __( 'Trash' ),
};

function statusBadgeColor( status: string ): { bg: string; fg: string } {
	switch ( status ) {
		case 'publish':
			return { bg: '#e6f4ea', fg: '#1d6f42' };
		case 'draft':
			return { bg: '#fdecea', fg: '#a02622' };
		case 'pending':
			return { bg: '#fef7e0', fg: '#8a6d00' };
		case 'private':
			return { bg: '#e8f0fe', fg: '#1a52a8' };
		case 'future':
			return { bg: '#ede7f6', fg: '#5b3aa0' };
		default:
			return { bg: '#f1f1f2', fg: '#50575e' };
	}
}

export function decodeTitle( raw: string ): string {
	return decodeHTML( raw );
}

/** The editor URL for a row — `post.php?post=<id>&action=edit`. */
export function buildEditPostUrl( extra: ListExtra, id: number ): string {
	const base = extra.editPostUrlBase ?? '';
	const sep = base.includes( '?' ) ? '&' : '?';
	return `${ base }${ sep }post=${ id }&action=edit`;
}

function authorOf( row: PostListItem ): { id: number; name: string; avatar?: string } {
	const embedded = row._embedded?.author?.[ 0 ];
	if ( embedded ) {
		const avatars = embedded.avatar_urls ?? {};
		return {
			id: embedded.id,
			name: embedded.name,
			avatar: avatars[ '48' ] ?? avatars[ '96' ] ?? avatars[ '24' ],
		};
	}
	return { id: row.author, name: __( 'Unknown' ) };
}

/** The embedded term records for a taxonomy — seed for the pickers. */
function termRecordsOf( row: PostListItem, taxonomy: 'category' | 'post_tag' ): Array< { id: number; name: string } > {
	for ( const group of row._embedded?.[ 'wp:term' ] ?? [] ) {
		if ( group.length > 0 && group[ 0 ].taxonomy === taxonomy ) {
			return group.map( ( t ) => ( { id: t.id, name: t.name } ) );
		}
	}
	return [];
}

function featuredMediaOf( row: PostListItem ): { url: string; alt: string } | null {
	const media = row._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	if ( ! media ) {
		return null;
	}
	const sizes = media.media_details?.sizes ?? {};
	return {
		url: sizes.thumbnail?.source_url ?? sizes.medium?.source_url ?? media.source_url,
		alt: media.alt_text ?? '',
	};
}

/** Per-(rowId, columnKey) cell-node cache. */
export type CellCache = Map< string, HTMLElement >;

export function memoCell( cache: CellCache, rowId: number, columnKey: string, build: () => HTMLElement ): HTMLElement {
	const key = `${ rowId }|${ columnKey }`;
	const cached = cache.get( key );
	if ( cached ) {
		return cached;
	}
	const built = build();
	cache.set( key, built );
	return built;
}

/**
 * Surface a mutation error. Prefers the shell's toast surface,
 * falls back to the console.
 */
export function showTagError( title: string, err: unknown ): void {
	const reason = err instanceof Error ? err.message : String( err );
	const api = window.wp?.os;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( { message: `${ title } ${ reason }`.trim(), duration: 6000 } );
		return;
	}
	// eslint-disable-next-line no-console
	console.error( title, err );
}

/** Cross-window broadcast so other listeners can resync. */
function broadcastPostChange( action: string, ids: number[] ): void {
	const api = window.wp?.os;
	if ( api && typeof api.broadcast === 'function' ) {
		api.broadcast( 'os.post.changed', { source: 'posts-window', action, ids } );
	}
}

// ---------------------------------------------------------------- title

export function buildTitleCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;';

	const titleRow = document.createElement( 'span' );
	titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

	const link = document.createElement( 'a' );
	link.href = buildEditPostUrl( env.extra, row.id );
	link.setAttribute( 'data-noclick', '' );
	const title = decodeTitle( row.title.rendered ) || __( '(no title)' );
	link.textContent = title;
	link.title = title;
	link.style.cssText =
		'font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;';
	link.addEventListener( 'mouseenter', () => {
		link.style.textDecoration = 'underline';
	} );
	link.addEventListener( 'mouseleave', () => {
		link.style.textDecoration = 'none';
	} );
	link.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		env.openUrl( link.href, title, 'dashicons-admin-post' );
	} );
	titleRow.appendChild( link );

	// Lock badge — another user is editing this row right now (the
	// `openstation_lock` REST field My WordPress' `lock.php` registers).
	const lock = row.openstation_lock ?? null;
	if ( lock ) {
		const lockBadge = document.createElement( 'span' );
		lockBadge.style.cssText = [
			'display:inline-flex',
			'align-items:center',
			'gap:4px',
			'padding:2px 8px',
			'border-radius:10px',
			'font-size:11px',
			'font-weight:600',
			'background:rgba(179, 45, 46, 0.1)',
			'color:#b32d2e',
			'white-space:nowrap',
			'flex-shrink:0',
		].join( ';' );
		const lockIcon = document.createElement( 'span' );
		lockIcon.setAttribute( 'aria-hidden', 'true' );
		// Document-level dashicon rules do not pierce the table's shadow
		// root, but the @font-face is document-wide: set the family
		// inline and emit the glyph (U+F160, "lock") as text.
		lockIcon.style.cssText = [
			'font-family:dashicons',
			'font-size:14px',
			'line-height:1',
			'display:inline-block',
			'speak:none',
			'-webkit-font-smoothing:antialiased',
		].join( ';' );
		lockIcon.textContent = '';
		lockBadge.appendChild( lockIcon );
		const lockText = document.createElement( 'span' );
		lockText.textContent = lock.userName;
		lockBadge.appendChild( lockText );
		/* translators: %s is the user name currently editing the post. */
		lockBadge.title = sprintf( __( '%s is currently editing' ), lock.userName );
		titleRow.appendChild( lockBadge );
	}

	// Pages mode: "Front page" / "Posts page" badges on the rows the
	// reading settings point at.
	const isPages = env.extra.mode === 'pages';
	if ( isPages ) {
		if ( typeof env.extra.frontPageId === 'number' && env.extra.frontPageId === row.id ) {
			titleRow.appendChild(
				buildAssignmentBadge( __( 'Front page' ), 'dashicons-admin-home', '#0a4b78', 'rgba(34,113,177,0.12)' ),
			);
		}
		if ( typeof env.extra.postsPageId === 'number' && env.extra.postsPageId === row.id ) {
			titleRow.appendChild(
				buildAssignmentBadge( __( 'Posts page' ), 'dashicons-admin-post', '#5b3aa0', 'rgba(91,58,160,0.12)' ),
			);
		}
	}

	if ( row.status && row.status !== 'publish' ) {
		const badge = document.createElement( 'span' );
		const colors = statusBadgeColor( row.status );
		badge.textContent = STATUS_LABELS[ row.status ] ?? row.status;
		badge.style.cssText = [
			'display:inline-flex',
			'align-items:center',
			'padding:2px 8px',
			'border-radius:10px',
			'font-size:11px',
			'font-weight:600',
			'text-transform:uppercase',
			'letter-spacing:0.04em',
			`background:${ colors.bg }`,
			`color:${ colors.fg }`,
			'white-space:nowrap',
			'flex-shrink:0',
		].join( ';' );
		titleRow.appendChild( badge );
	}

	// Pages mode: a small "View" link to the public URL, in a new tab
	// so the user keeps the table state.
	if ( isPages && typeof row.link === 'string' && row.link && row.status === 'publish' ) {
		const view = document.createElement( 'a' );
		view.href = row.link;
		view.target = '_blank';
		view.rel = 'noreferrer noopener';
		view.textContent = __( 'View' );
		view.title = row.link;
		view.setAttribute( 'data-noclick', '' );
		view.style.cssText = [
			'font-size:11px',
			'color:var(--wp-admin-theme-color, #2271b1)',
			'text-decoration:none',
			'flex-shrink:0',
		].join( ';' );
		view.addEventListener( 'click', ( e ) => e.stopPropagation() );
		view.addEventListener( 'mouseenter', () => {
			view.style.textDecoration = 'underline';
		} );
		view.addEventListener( 'mouseleave', () => {
			view.style.textDecoration = 'none';
		} );
		titleRow.appendChild( view );
	}

	cell.appendChild( titleRow );
	return cell;
}

function buildAssignmentBadge( label: string, dashicon: string, fg: string, bg: string ): HTMLElement {
	const badge = document.createElement( 'span' );
	badge.style.cssText = [
		'display:inline-flex',
		'align-items:center',
		'gap:4px',
		'padding:2px 8px',
		'border-radius:10px',
		'font-size:11px',
		'font-weight:600',
		`background:${ bg }`,
		`color:${ fg }`,
		'white-space:nowrap',
		'flex-shrink:0',
	].join( ';' );
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ dashicon }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	icon.style.cssText = 'font-size:13px;width:13px;height:13px;line-height:1;';
	const text = document.createElement( 'span' );
	text.textContent = label;
	badge.appendChild( icon );
	badge.appendChild( text );
	return badge;
}

// --------------------------------------------------------------- author

export function buildAuthorCell( row: PostListItem ): HTMLElement {
	const a = authorOf( row );
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;min-width:0;';

	// `<os-avatar>`: initials fallback, hue-by-name, the hover effect.
	// The Gravatar URL is probed through the shared helper so an email
	// with no registered avatar drops to initials without a 404.
	const avatar = document.createElement( 'os-avatar' );
	avatar.setAttribute( 'size', '24' );
	if ( a.name ) {
		avatar.setAttribute( 'name', a.name );
	}
	if ( a.id > 0 ) {
		avatar.setAttribute( 'user-id', String( a.id ) );
	}
	if ( a.avatar ) {
		applyAvatarSrc( avatar, a.avatar );
	}
	wrap.appendChild( avatar );

	const name = document.createElement( 'span' );
	name.textContent = a.name;
	name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	wrap.appendChild( name );
	return wrap;
}

// ----------------------------------------------------------------- date

export function buildDateCell( row: PostListItem ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:flex;flex-direction:column;line-height:1.2;';
	const time = document.createElement( 'os-relative-time' );
	// `date_gmt`, not `date`: neither carries a designator and
	// `<os-relative-time>` reads an undesignated value as UTC.
	time.setAttribute( 'datetime', row.date_gmt || row.date );
	wrap.appendChild( time );
	if ( row.modified_gmt && row.modified_gmt !== row.date_gmt ) {
		const meta = document.createElement( 'span' );
		meta.textContent = __( 'modified' );
		meta.style.cssText = 'font-size:11px;color:#646970;';
		wrap.appendChild( meta );
	}
	return wrap;
}

// ---------------------------------------------------------- pages cells

/**
 * In-page parent titles, refreshed from the page's rows on every data
 * change. Pages outside the roster show "↳ #42".
 */
export const parentTitleRoster: Map< number, string > = new Map();

export function refreshParentTitleRoster( rows: PostListItem[] ): void {
	parentTitleRoster.clear();
	for ( const row of rows ) {
		parentTitleRoster.set( row.id, decodeTitle( row.title.rendered ) );
	}
}

export function buildParentCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'os-posts__parent';
	const pid = typeof row.parent === 'number' ? row.parent : 0;
	if ( pid === 0 ) {
		cell.classList.add( 'os-posts__parent--top' );
		cell.textContent = '—';
		cell.setAttribute( 'aria-label', __( 'Top-level page' ) );
		return cell;
	}
	cell.classList.add( 'os-posts__parent--child' );
	const known = parentTitleRoster.get( pid );
	/* translators: %d is the numeric id of a parent page whose title isn't on the current page roster. */
	cell.textContent = known ? `↳ ${ known }` : sprintf( __( '↳ #%d' ), pid );
	return cell;
}

export function buildTemplateCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'os-posts__template';
	const slug = typeof row.template === 'string' ? row.template : '';
	const map = env.extra.pageTemplates ?? {};
	cell.textContent = map[ slug ] ?? ( slug === '' ? __( 'Default template' ) : slug );
	if ( slug !== '' ) {
		cell.title = slug;
	}
	return cell;
}

/** The URL slug with a click-to-copy affordance. */
export function buildSlugCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'button' );
	cell.type = 'button';
	cell.className = 'os-posts__slug';
	const slug = typeof row.slug === 'string' ? row.slug : '';
	cell.textContent = slug || '—';
	cell.disabled = slug === '';
	cell.title = slug ? __( 'Click to copy slug' ) : '';
	Object.assign( cell.style, {
		appearance: 'none',
		background: 'transparent',
		border: 'none',
		padding: '2px 6px',
		font: 'inherit',
		color: 'inherit',
		cursor: slug ? 'copy' : 'default',
		textAlign: 'left',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
		fontSize: '12px',
		borderRadius: '4px',
		maxWidth: '100%',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	} as Partial< CSSStyleDeclaration > );
	cell.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( ! slug ) {
			return;
		}
		void navigator.clipboard
			?.writeText( slug )
			.then( () => {
				cell.textContent = __( 'Copied!' );
				cell.style.color = 'var(--wp-admin-theme-color, #2271b1)';
				setTimeout( () => {
					cell.textContent = slug;
					cell.style.color = '';
				}, 1200 );
			} )
			.catch( () => {
				/* clipboard blocked; no-op */
			} );
	} );
	return cell;
}

/** The `openstation_comment_count` REST field with a small icon. */
export function buildCommentsCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'os-posts__comments';
	Object.assign( cell.style, {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		fontVariantNumeric: 'tabular-nums',
	} as Partial< CSSStyleDeclaration > );

	const count = typeof row.openstation_comment_count === 'number' ? row.openstation_comment_count : null;
	if ( count === null ) {
		cell.textContent = '—';
		cell.style.color = 'var(--os-ui-fg-muted, #8c8f94)';
		return cell;
	}

	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-admin-comments';
	icon.setAttribute( 'aria-hidden', 'true' );
	Object.assign( icon.style, {
		fontSize: '16px',
		width: '16px',
		height: '16px',
		color: count > 0 ? 'var(--wp-admin-theme-color, #2271b1)' : 'var(--os-ui-fg-muted, #8c8f94)',
	} as Partial< CSSStyleDeclaration > );

	const label = document.createElement( 'span' );
	label.textContent = String( count );
	if ( count === 0 ) {
		label.style.color = 'var(--os-ui-fg-muted, #8c8f94)';
	}

	cell.appendChild( icon );
	cell.appendChild( label );
	/* translators: %d is the comment count for a row. */
	cell.setAttribute( 'aria-label', sprintf( _n( '%d comment', '%d comments', count ), count ) );
	return cell;
}

// ----------------------------------------------------------------- tags

/**
 * The Tags cell — a `<os-tag-input>` per row with autocomplete,
 * free-form creation and optimistic persistence to the post's `tags`.
 * Suggestions are debounced and cancelled with an `AbortController`;
 * adds and removes roll back on failure with a toast.
 */
export function buildTagsCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const { client } = env;
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:inline-flex;align-items:center;width:100%;min-width:0;';

	const picker = document.createElement( 'os-tag-input' ) as OsTagInput;
	picker.setAttribute( 'creatable', '' );
	picker.setAttribute( 'removable', '' );
	picker.setAttribute( 'min-query', '0' );
	picker.setAttribute( 'placeholder', __( 'Add tag…' ) );
	picker.setAttribute( 'add-label', __( 'Tag' ) );
	picker.setAttribute( 'data-noclick', '' );

	const seed: OsTagItem[] = termRecordsOf( row, 'post_tag' ).map( ( t ) => ( { id: t.id, label: t.name } ) );
	picker.value = seed;

	const cellState = {
		// Optimistic mirror of `picker.value` — one source of truth when
		// two events fire in the same tick.
		tags: seed.slice(),
		suggestAbort: null as AbortController | null,
		suggestDebounce: null as number | null,
		lastQuery: '',
	};

	const setValue = ( next: OsTagItem[] ): void => {
		cellState.tags = next.slice();
		picker.value = next;
	};

	picker.addEventListener( 'os-tag-suggest', ( e: Event ) => {
		const q = ( e as CustomEvent< { query: string } > ).detail?.query ?? '';
		cellState.lastQuery = q;
		if ( cellState.suggestDebounce !== null ) {
			window.clearTimeout( cellState.suggestDebounce );
		}
		cellState.suggestDebounce = window.setTimeout( async () => {
			cellState.suggestDebounce = null;
			cellState.suggestAbort?.abort();
			const ac = new AbortController();
			cellState.suggestAbort = ac;
			try {
				const matches = await client.searchTags( q, ac.signal );
				if ( cellState.lastQuery !== q ) {
					return;
				}
				const existingIds = new Set( cellState.tags.map( ( t ) => t.id ) );
				picker.suggestions = matches
					.filter( ( m ) => ! existingIds.has( m.id ) )
					.map( ( m ) => ( { id: m.id, label: m.name } ) );
			} catch ( err ) {
				if ( ( err as Error )?.name === 'AbortError' ) {
					return;
				}
				picker.suggestions = [];
				// eslint-disable-next-line no-console
				console.warn( '[posts-window] tag search failed', err );
			} finally {
				picker.suggestionsLoading = false;
			}
		}, 200 );
	} );

	picker.addEventListener( 'os-tag-add', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: OsTagItem; isNew: boolean } > ).detail;
		if ( ! detail?.tag ) {
			return;
		}
		setValue( [ ...cellState.tags, { id: detail.tag.id, label: detail.tag.label, pending: true } ] );
		try {
			const resolved: TagTerm =
				detail.isNew || typeof detail.tag.id !== 'number'
					? await client.createTag( detail.tag.label )
					: { id: Number( detail.tag.id ), name: detail.tag.label, slug: '' };
			const desiredIds = [
				...cellState.tags.filter( ( t ) => ! t.pending ).map( ( t ) => Number( t.id ) ),
				resolved.id,
			];
			await client.updatePostTags( row.id, desiredIds );
			// Replace the pending placeholder with the canonical term.
			setValue(
				cellState.tags.map( ( t ) =>
					t.label.toLowerCase() === detail.tag.label.toLowerCase()
						? { id: resolved.id, label: resolved.name }
						: t,
				),
			);
			broadcastPostChange( 'tagged', [ row.id ] );
		} catch ( err ) {
			setValue( cellState.tags.filter( ( t ) => t.label.toLowerCase() !== detail.tag.label.toLowerCase() ) );
			/* translators: %s: tag label */
			showTagError( sprintf( __( 'Couldn’t add tag "%s".' ), detail.tag.label ), err );
		}
	} );

	picker.addEventListener( 'os-tag-remove', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: OsTagItem } > ).detail;
		if ( ! detail?.tag ) {
			return;
		}
		const removed = detail.tag;
		const previous = cellState.tags.slice();
		setValue( cellState.tags.map( ( t ) => ( t.label === removed.label ? { ...t, pending: true } : t ) ) );
		try {
			const desiredIds = previous
				.filter( ( t ) => t.label !== removed.label )
				.map( ( t ) => Number( t.id ) )
				.filter( ( n ) => Number.isFinite( n ) );
			await client.updatePostTags( row.id, desiredIds );
			setValue( previous.filter( ( t ) => t.label !== removed.label ) );
			broadcastPostChange( 'untagged', [ row.id ] );
		} catch ( err ) {
			setValue( previous );
			/* translators: %s: tag label */
			showTagError( sprintf( __( 'Couldn’t remove tag "%s".' ), removed.label ), err );
		}
	} );

	wrap.appendChild( picker );
	return wrap;
}

// ----------------------------------------------------------- categories

/**
 * The category tree, fetched once per window-open and shared by every
 * row's picker. Cleared on close and on an `os.term.changed`
 * broadcast, so a category created elsewhere shows up without an F5.
 */
let categoryTreePromise: Promise< OsCategoryItem[] > | null = null;

function getCategoriesTree( client: PostsRestClient ): Promise< OsCategoryItem[] > {
	if ( ! categoryTreePromise ) {
		categoryTreePromise = client
			.fetchAllCategories()
			.then( ( terms: CategoryTerm[] ) => terms.map( ( t ) => ( { id: t.id, name: t.name, parent: t.parent } ) ) );
	}
	return categoryTreePromise;
}

export function clearCategoryTreeCache(): void {
	categoryTreePromise = null;
}

/** Every mounted picker; a fresh tree is pushed to all of them. */
const activePickers = new Set< OsCategoryPicker >();

/**
 * Re-fetch the tree and push it onto every live picker — without
 * this a category created in the mind map is not draggable from any
 * cell, since a chain cannot render a segment for an id the picker
 * does not know about.
 */
export function broadcastFreshCategoryTreeToPickers( client: PostsRestClient ): void {
	void getCategoriesTree( client )
		.then( ( tree ) => {
			for ( const picker of activePickers ) {
				if ( picker.isConnected ) {
					picker.items = tree;
				} else {
					activePickers.delete( picker );
				}
			}
		} )
		.catch( () => {
			// Pickers keep their existing items; the next open retries.
		} );
}

/**
 * The Categories cell — a `<os-category-picker>` per row over the
 * shared tree cache with optimistic UX, REST roll-back on failure,
 * inline term creation, confirmed deletion, and a drag-and-drop
 * breadcrumb chain that merges into another row's set.
 */
export function buildCategoriesCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const { client } = env;
	const wrap = document.createElement( 'span' );
	wrap.className = 'os-cat-cell-dropzone';
	wrap.style.cssText =
		'display:inline-flex;align-items:center;width:100%;min-width:0;border-radius:6px;transition:background-color 0.12s ease, box-shadow 0.12s ease;';

	const picker = document.createElement( 'os-category-picker' ) as OsCategoryPicker;
	picker.setAttribute( 'placeholder', __( 'Search categories…' ) );
	picker.setAttribute( 'add-label', __( 'Categorize' ) );
	picker.setAttribute( 'data-noclick', '' );
	activePickers.add( picker );

	picker.value = row.categories ?? [];
	// Seed from the embedded terms so the first paint has names before
	// the tree fetch resolves.
	picker.items = termRecordsOf( row, 'category' ).map( ( t ) => ( { id: t.id, name: t.name, parent: 0 } ) );

	const cellState = { categoryIds: ( row.categories ?? [] ).slice() };
	const setValue = ( next: number[] ): void => {
		cellState.categoryIds = next.slice();
		picker.value = next;
	};

	// Eager tree load so the in-cell breadcrumb chains render full
	// hierarchy paths from the first paint; one round-trip per open.
	void getCategoriesTree( client )
		.then( ( tree ) => {
			if ( picker.isConnected ) {
				picker.items = tree;
			}
		} )
		.catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.warn( '[posts-window] category tree fetch failed', err );
		} );

	picker.addEventListener( 'os-categories-open', () => {
		if ( categoryTreePromise ) {
			void categoryTreePromise.then( ( tree ) => {
				picker.items = tree;
			} ).catch( () => undefined );
		}
	} );

	picker.addEventListener( 'os-categories-create', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { name: string; parent: number } > ).detail;
		const parent = detail?.parent ?? 0;
		if ( ! detail || ! detail.name ) {
			picker.failCreating( parent );
			return;
		}
		try {
			const created = await client.createCategory( detail.name, parent );
			clearCategoryTreeCache();
			picker.items = [ ...picker.items, { id: created.id, name: created.name, parent: created.parent } ];
			const nextValue = [ ...cellState.categoryIds, created.id ];
			setValue( nextValue );
			picker.endCreating( parent );
			try {
				await client.updatePostCategories( row.id, nextValue );
				broadcastPostChange( 'categorized', [ row.id ] );
			} catch ( err ) {
				setValue( cellState.categoryIds.filter( ( id ) => id !== created.id ) );
				showTagError( __( 'Couldn’t assign new category.' ), err );
			}
		} catch ( err ) {
			picker.failCreating( parent, err instanceof Error ? err.message : String( err ) );
			showTagError( __( 'Couldn’t create category.' ), err );
		}
	} );

	picker.addEventListener( 'os-categories-change', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: number[] } > ).detail;
		if ( ! detail || ! Array.isArray( detail.value ) ) {
			return;
		}
		const previous = cellState.categoryIds.slice();
		const next = detail.value.slice();
		setValue( next );
		try {
			await client.updatePostCategories( row.id, next );
			broadcastPostChange( 'categorized', [ row.id ] );
		} catch ( err ) {
			setValue( previous );
			showTagError( __( 'Couldn’t update categories.' ), err );
		}
	} );

	picker.addEventListener( 'os-categories-delete', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: number; name: string } > ).detail;
		if ( ! detail || typeof detail.id !== 'number' ) {
			return;
		}
		const ok = await env.confirm( {
			title: __( 'Delete category?' ),
			message: sprintf(
				/* translators: %s: category name. */
				__( 'Delete the category "%s"? Posts assigned only to it will fall back to Uncategorized.' ),
				detail.name,
			),
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await client.deleteTerm( 'categories', detail.id );
			if ( cellState.categoryIds.includes( detail.id ) ) {
				const next = cellState.categoryIds.filter( ( id ) => id !== detail.id );
				setValue( next );
				try {
					await client.updatePostCategories( row.id, next );
				} catch ( err ) {
					showTagError( __( 'Couldn’t update post categories after delete.' ), err );
				}
			}
		} catch ( err ) {
			showTagError( __( 'Couldn’t delete category.' ), err );
		}
	} );

	// Drag a chain segment (+ its descendants) to another row.
	picker.addEventListener( 'os-chain-segment-dragstart', ( e: Event ) => {
		const detail = ( e as CustomEvent< { segments: Array< { id?: number | string } >; dragEvent: DragEvent } > ).detail;
		if ( ! detail?.dragEvent?.dataTransfer ) {
			return;
		}
		const ids = detail.segments.map( ( seg ) => seg.id ).filter( ( id ): id is number => typeof id === 'number' );
		if ( ids.length === 0 ) {
			return;
		}
		const dt = detail.dragEvent.dataTransfer;
		dt.setData( 'application/x-os-categories', JSON.stringify( { ids, source: 'posts-window', sourcePostId: row.id } ) );
		dt.setData( 'text/plain', ids.join( ',' ) );
		dt.effectAllowed = 'copy';
	} );

	// Drop target on the cell — an enter counter dodges the "dragleave
	// fires when entering every child" gotcha.
	let dropEnterCount = 0;
	const setDropTargetActive = ( on: boolean ): void => {
		wrap.style.backgroundColor = on ? 'color-mix(in srgb, var(--wp-admin-theme-color, #2271b1) 12%, transparent)' : '';
		wrap.style.boxShadow = on ? 'inset 0 0 0 2px var(--wp-admin-theme-color, #2271b1)' : '';
	};
	const acceptsCategoriesDrag = ( e: DragEvent ): boolean =>
		Array.from( e.dataTransfer?.types ?? [] ).includes( 'application/x-os-categories' );
	wrap.addEventListener( 'dragenter', ( e: DragEvent ) => {
		if ( acceptsCategoriesDrag( e ) ) {
			e.preventDefault();
			dropEnterCount++;
			setDropTargetActive( true );
		}
	} );
	wrap.addEventListener( 'dragover', ( e: DragEvent ) => {
		if ( acceptsCategoriesDrag( e ) ) {
			e.preventDefault();
			if ( e.dataTransfer ) {
				e.dataTransfer.dropEffect = 'copy';
			}
		}
	} );
	wrap.addEventListener( 'dragleave', () => {
		if ( dropEnterCount > 0 ) {
			dropEnterCount--;
		}
		if ( dropEnterCount === 0 ) {
			setDropTargetActive( false );
		}
	} );
	wrap.addEventListener( 'drop', async ( e: DragEvent ) => {
		dropEnterCount = 0;
		setDropTargetActive( false );
		if ( ! acceptsCategoriesDrag( e ) ) {
			return;
		}
		e.preventDefault();
		let parsed: { ids?: unknown; sourcePostId?: number } | null = null;
		try {
			parsed = JSON.parse( e.dataTransfer?.getData( 'application/x-os-categories' ) ?? '' );
		} catch {
			return;
		}
		if ( ! parsed || ! Array.isArray( parsed.ids ) ) {
			return;
		}
		const incoming = parsed.ids.filter( ( v ): v is number => typeof v === 'number' && Number.isFinite( v ) );
		if ( incoming.length === 0 ) {
			return;
		}
		if ( parsed.sourcePostId === row.id && incoming.every( ( id ) => cellState.categoryIds.includes( id ) ) ) {
			return;
		}
		const merged = Array.from( new Set( [ ...cellState.categoryIds, ...incoming ] ) );
		if ( merged.length === cellState.categoryIds.length ) {
			return;
		}
		const previous = cellState.categoryIds.slice();
		setValue( merged );
		try {
			await client.updatePostCategories( row.id, merged );
			broadcastPostChange( 'categorized', [ row.id ] );
		} catch ( err ) {
			setValue( previous );
			showTagError( __( 'Couldn’t add category.' ), err );
		}
	} );

	wrap.appendChild( picker );
	return wrap;
}

// -------------------------------------------------------------- sub-row

/** The expanded sub-row: featured image + plain-text excerpt. */
export function buildSubRow( row: PostListItem ): Node {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = 'display:flex;gap:16px;padding:12px 16px;background:#fafafa;align-items:flex-start;';

	const featured = featuredMediaOf( row );
	if ( featured ) {
		const img = document.createElement( 'img' );
		img.src = featured.url;
		img.alt = featured.alt;
		img.loading = 'lazy';
		img.style.cssText = 'width:96px;height:96px;border-radius:6px;object-fit:cover;flex-shrink:0;';
		wrap.appendChild( img );
	}

	const text = document.createElement( 'div' );
	text.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;';
	const heading = document.createElement( 'div' );
	heading.style.cssText = 'font-size:13px;color:#646970;text-transform:uppercase;letter-spacing:0.04em;';
	heading.textContent = __( 'Excerpt' );
	text.appendChild( heading );

	const excerpt = document.createElement( 'div' );
	excerpt.style.cssText = 'color:#1d2327;line-height:1.5;';
	const raw = row.excerpt?.rendered ?? '';
	if ( raw ) {
		excerpt.textContent = decodeHTML( raw.replace( /<[^>]+>/g, '' ).trim() ) || __( '(no excerpt)' );
	} else {
		excerpt.textContent = __( '(no excerpt)' );
		excerpt.style.color = '#a7aaad';
	}
	text.appendChild( excerpt );
	wrap.appendChild( text );
	return wrap;
}
