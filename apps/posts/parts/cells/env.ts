/**
 * Posts app — what every cell renderer works with.
 *
 * Cells build their DOM imperatively because `<os-table>` paints rows
 * inside its own shadow root, where the document's stylesheets never
 * reach: inline styles are the working contract. What a cell needs
 * from the app arrives as one {@link CellEnv} — the config extra, the
 * REST client, the shell doors (`openUrl`, `confirm`, `toast`,
 * `announce`), and the per-window caches (the parent-title roster,
 * the category tree and its live pickers) that used to be module
 * singletons and now die with the window.
 *
 * The cell cache ({@link memoCell}) keeps a row stable across the
 * table's own repaints: `<os-table>` rebuilds its body on every
 * selection / expand / sort change, and without the cache every
 * avatar and chip flashed for a frame. The app clears it on a real
 * data change.
 *
 * @public
 */

import { __ } from '@openstation/app';
import { pickAvatarUrl } from '../../../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../../../src/utils';
import type {
	OsCategoryItem,
	OsCategoryPicker,
} from '../../../../src/ui/components/os-category-picker/os-category-picker';
import type { PostsRestClient } from '../rest';
import type { ListExtra, PostListItem } from '../types';

/** The cells only one mode renders — Posts hands in its tag and category pickers. */
export interface CellRenderers {
	tags?: ( row: PostListItem, env: CellEnv ) => HTMLElement;
	categories?: ( row: PostListItem, env: CellEnv ) => HTMLElement;
}

export interface CellEnv {
	extra: ListExtra;
	client: PostsRestClient;
	cells: CellRenderers;
	/** Open an admin URL in an iframe window. */
	openUrl: ( url: string, title: string, icon: string ) => void;
	/** The shell's confirm dialog. */
	confirm: ( options: { title?: string; message: string; confirmLabel?: string; danger?: boolean } ) => Promise< boolean >;
	/** A mutation failed: say so, with the server's reason. */
	toast: ( title: string, err: unknown ) => void;
	/** A row changed — the window's own announce (its watch skips the echo). */
	announce: ( action: string, ids: number[] ) => void;
	/** In-page parent titles (Pages), refreshed on every data change. */
	parentTitles: Map< number, string >;
	/** The category tree, fetched once per window, and every live picker. */
	categories: {
		tree: Promise< OsCategoryItem[] > | null;
		pickers: Set< OsCategoryPicker >;
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

export const STATUS_LABELS: Record< string, string > = {
	publish: __( 'Published' ),
	future: __( 'Scheduled' ),
	draft: __( 'Draft' ),
	pending: __( 'Pending' ),
	private: __( 'Private' ),
	trash: __( 'Trash' ),
};

export function statusBadgeColor( status: string ): { bg: string; fg: string } {
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

/** The editor URL for a row — `post.php?post=<id>&action=edit`. */
export function buildEditPostUrl( extra: ListExtra, id: number ): string {
	const base = extra.editPostUrlBase ?? '';
	const sep = base.includes( '?' ) ? '&' : '?';
	return `${ base }${ sep }post=${ id }&action=edit`;
}

export function authorOf( row: PostListItem ): { id: number; name: string; avatar?: string } {
	const embedded = row._embedded?.author?.[ 0 ];
	if ( embedded ) {
		return {
			id: embedded.id,
			name: embedded.name,
			avatar: pickAvatarUrl( embedded.avatar_urls ) || undefined,
		};
	}
	return { id: row.author, name: __( 'Unknown' ) };
}

/** The embedded term records for a taxonomy — seed for the pickers. */
export function termRecordsOf( row: PostListItem, taxonomy: 'category' | 'post_tag' ): Array< { id: number; name: string } > {
	for ( const group of row._embedded?.[ 'wp:term' ] ?? [] ) {
		if ( group.length > 0 && group[ 0 ].taxonomy === taxonomy ) {
			return group.map( ( t ) => ( { id: t.id, name: t.name } ) );
		}
	}
	return [];
}

export function featuredMediaOf( row: PostListItem ): { url: string; alt: string } | null {
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

/** The row's title as text, entities decoded. */
export function titleOf( row: PostListItem ): string {
	return decodeHTML( row.title.rendered );
}

/**
 * A small inline pill — the lock, status and assignment badges share
 * it. `icon` is a glyph (a dashicon class, or text for a glyph the
 * shadow root cannot style through the class).
 */
export function pill(
	text: string,
	colors: { fg: string; bg: string },
	opts: { icon?: HTMLElement; uppercase?: boolean; title?: string } = {},
): HTMLElement {
	const badge = document.createElement( 'span' );
	badge.style.cssText = [
		'display:inline-flex',
		'align-items:center',
		'gap:4px',
		'padding:2px 8px',
		'border-radius:10px',
		'font-size:11px',
		'font-weight:600',
		opts.uppercase ? 'text-transform:uppercase;letter-spacing:0.04em' : '',
		`background:${ colors.bg }`,
		`color:${ colors.fg }`,
		'white-space:nowrap',
		'flex-shrink:0',
	]
		.filter( Boolean )
		.join( ';' );
	if ( opts.icon ) {
		badge.appendChild( opts.icon );
	}
	const label = document.createElement( 'span' );
	label.textContent = text;
	badge.appendChild( label );
	if ( opts.title ) {
		badge.title = opts.title;
	}
	return badge;
}
