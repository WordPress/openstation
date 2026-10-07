import { __ } from '@openstation/app';
import { pickAvatarUrl } from '../../../../src/ui/util/avatar-resolve';
import { decodeHTML } from '../../../../src/utils';
import type {
	OsCategoryItem,
	OsCategoryPicker,
} from '../../../../src/ui/components/os-category-picker/os-category-picker';
import type { PostsRestClient } from '../rest';
import type { ListExtra, PostListItem } from '../types';

export interface CellRenderers {
	tags?: ( row: PostListItem, env: CellEnv ) => HTMLElement;
	categories?: ( row: PostListItem, env: CellEnv ) => HTMLElement;
}

export interface CellEnv {
	extra: ListExtra;
	client: PostsRestClient;
	cells: CellRenderers;

	openUrl: ( url: string, title: string, icon: string ) => void;

	confirm: ( options: { title?: string; message: string; confirmLabel?: string; danger?: boolean } ) => Promise< boolean >;

	toast: ( title: string, err: unknown ) => void;

	announce: ( action: string, ids: number[] ) => void;

	parentTitles: Map< number, string >;

	categories: {
		tree: Promise< OsCategoryItem[] > | null;
		pickers: Set< OsCategoryPicker >;
	};
}

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
			return { bg: 'var(--os-ui-surface-raised, #e6f4ea)', fg: 'var(--os-ui-success-fg, #1d6f42)' };
		case 'draft':
			return { bg: 'var(--os-ui-surface-raised, #fdecea)', fg: 'var(--os-ui-danger, #a02622)' };
		case 'pending':
			return { bg: 'var(--os-ui-warning-bg, #fef7e0)', fg: 'var(--os-ui-warning-fg, #8a6d00)' };
		case 'private':
			return { bg: 'var(--os-ui-info-bg, #e8f0fe)', fg: 'var(--os-ui-info-fg, #1a52a8)' };
		case 'future':
			return { bg: 'var(--os-ui-surface-raised, #ede7f6)', fg: 'var(--os-ui-accent, #5b3aa0)' };
		default:
			return { bg: 'var(--os-ui-surface-raised, #f1f1f2)', fg: 'var(--os-ui-fg-muted, #50575e)' };
	}
}

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
			name: decodeHTML( embedded.name ?? '' ),
			avatar: pickAvatarUrl( embedded.avatar_urls ) || undefined,
		};
	}
	return { id: row.author, name: __( 'Unknown' ) };
}

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

export function titleOf( row: PostListItem ): string {
	return decodeHTML( row.title.rendered );
}

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
