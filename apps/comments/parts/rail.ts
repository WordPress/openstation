import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import {
	NS,
	authorName,
	avatar,
	emptyState,
	normalizeStatus,
	snippet,
	statusBadge,
	timestamp,
} from './helpers';
import type { CommentCounts, CommentRow, CommentTab, Ctx, UiState } from './types';

const TABS: ReadonlyArray< { value: CommentTab; label: () => string } > = [
	{ value: 'pending', label: () => __( 'Pending' ) },
	{ value: 'all', label: () => __( 'All' ) },
	{ value: 'spam', label: () => __( 'Spam' ) },
	{ value: 'trash', label: () => __( 'Trash' ) },
	{ value: 'mine', label: () => __( 'Mine' ) },
];

function countFor( tab: CommentTab, counts: CommentCounts | undefined ): number | null {
	if ( ! counts ) {
		return null;
	}
	switch ( tab ) {
		case 'pending':
			return counts.pending;
		case 'all':
			return counts.approved + counts.pending;
		case 'spam':
			return counts.spam;
		case 'trash':
			return counts.trash;
		default:
			return null;
	}
}

export function tabs( ctx: Ctx, ui: UiState ): TemplateResult {
	const { state, data } = ctx;
	const toRail = (): void => {
		ui.pane = 'rail';
	};
	const items = TABS.map( ( tab ) => {
		const count = countFor( tab.value, data.counts );
		return {
			value: tab.value,
			label:
				count === null
					? tab.label()
					: sprintf(

						__( '%1$s (%2$s)' ),
						tab.label(),
						String( count ),
					),
		};
	} );
	return html`
		<os-tabs
			class="${ NS }__tabrow"
			value=${ state.tab }
			label=${ __( 'Comment status' ) }
			os-bind="tab"
			os-action="filter"
			@os-tab-change=${ toRail }
			data-os-comments-tabs
		>${ TABS.map( ( tab ) => {
			const count = countFor( tab.value, data.counts );
			return html`<os-tab value=${ tab.value }>${ tab.label() }${
				count === null
					? ''
					: html`<os-badge class="${ NS }__tab-count" tone="neutral" no-dot>${ count }</os-badge>`
			}</os-tab>`;
		} ) }</os-tabs>
		<os-select
			class="${ NS }__tabselect"
			aria-label=${ __( 'Comment status' ) }
			value=${ state.tab }
			.items=${ items }
			os-bind="tab"
			os-action="filter"
			@os-pick=${ toRail }
			data-os-comments-tabselect
		></os-select>
	`;
}

function filterBanner( ctx: Ctx, ui: UiState, rows: CommentRow[] ): TemplateResult {
	const title = rows[ 0 ]?.openstation_post_title;
	const clear = (): void => {
		ui.pane = 'rail';
		void ctx.dispatch( 'filter', { post: 0 } );
	};
	return html`<div class="${ NS }__rail-filter">
		<span class="${ NS }__rail-filter-label">${
			title
				? sprintf( __( 'On: %s' ), decodeHTML( title ) )
				: __( 'Comments on this post' )
		}</span>
		<os-button class="${ NS }__rail-filter-clear" variant="link" @click=${ clear }>${ __( 'Show all' ) }</os-button>
	</div>`;
}

function threadItem( ctx: Ctx, ui: UiState, row: CommentRow ): TemplateResult {
	const selected = ctx.state.selected === row.id;
	const pick = (): void => {
		ui.pane = 'convo';
		if ( selected && ui.thread ) {
			ctx.repaint();
			return;
		}
		void ctx.dispatch( 'select', { id: row.id } );
	};
	const replies = row.openstation_replies_count ?? 0;

	return html`<div role="listitem" class="${ NS }__thread-slot">
		<button
			type="button"
			class="${ NS }__thread${ selected ? ' is-selected' : '' }${ ui.busy.startsWith( `${ row.id }:` ) ? ' is-busy' : '' }"
			data-id=${ row.id }
			aria-current=${ selected ? 'true' : '' }
			@click=${ pick }
		>
			${ avatar( row, 36 ) }
			<div class="${ NS }__thread-main">
				<div class="${ NS }__thread-name">${ authorName( row ) }${ statusBadge( normalizeStatus( row ), true ) }</div>
				<div class="${ NS }__thread-snip">${ snippet( row ) }</div>
				<div class="${ NS }__thread-post">${ decodeHTML( row.openstation_post_title || '' ) }</div>
			</div>
			<div class="${ NS }__thread-meta">
				${ timestamp( row.date_gmt, `${ NS }__thread-time`, true ) }
				${ replies > 0
					? html`<os-badge class="${ NS }__reply-count" tone="neutral" no-dot>${ replies }<span class="screen-reader-text">${ sprintf(

						__( '%d replies' ),
						replies,
					) }</span></os-badge>`
					: '' }
			</div>
		</button>
	</div>`;
}

const GHOST_ROWS = 6;

function ghostItem(): TemplateResult {
	return html`<div class="${ NS }__thread-slot ${ NS }__thread-slot--ghost" aria-hidden="true">
		<div class="${ NS }__thread">
			<span class="${ NS }__ghost ${ NS }__ghost--disc"></span>
			<div class="${ NS }__thread-main">
				<span class="${ NS }__ghost ${ NS }__ghost--line"></span>
				<span class="${ NS }__ghost ${ NS }__ghost--line ${ NS }__ghost--short"></span>
			</div>
		</div>
	</div>`;
}

function loadMoreRow( ctx: Ctx, ui: UiState ): TemplateResult {
	const more = (): void => {
		ui.loadingMore = true;
		ctx.repaint();
		void ctx.dispatch( 'page', { page: ctx.state.page + 1 } ).finally( () => {
			ui.loadingMore = false;
			ctx.repaint();
		} );
	};
	return html`<div class="${ NS }__load-more">
		<os-button variant="ghost" ?busy=${ ui.loadingMore } ?disabled=${ ui.loadingMore } @click=${ more }>${ __( 'Load more' ) }</os-button>
	</div>`;
}

export function rail( ctx: Ctx, ui: UiState, rows: CommentRow[], error: string ): TemplateResult {
	const { state } = ctx;
	const scoped = state.post > 0;
	let body: TemplateResult | TemplateResult[];
	if ( error ) {
		body = emptyState(
			'warning',
			__( 'Could not load comments' ),
			__( 'Check your connection and try another tab.' ),
		);
	} else if ( ctx.loading ) {
		body = Array.from( { length: GHOST_ROWS }, ghostItem );
	} else if ( rows.length === 0 ) {
		body = scoped
			? emptyState(
				'admin-comments',
				__( 'Nothing on this post here' ),
				__( 'This post has no comments in this view — try another tab.' ),
			)
			: emptyState(
				'admin-comments',
				__( 'No conversations yet' ),
				__( 'Comments in this view will show up here.' ),
			);
	} else {
		body = rows.map( ( row ) => threadItem( ctx, ui, row ) );
	}
	return html`<aside slot="start" class="${ NS }__rail" aria-label=${ __( 'Conversations' ) }>
		<div class="${ NS }__search">
			<os-text-field
				label=${ __( 'Search comments' ) }
				hide-label
				placeholder=${ __( 'Search comments…' ) }
				os-bind="search"
				os-action="filter"
				os-debounce="300"
				data-os-comments-search
			></os-text-field>
		</div>
		<div class="${ NS }__list" role="list" aria-label=${ __( 'Conversations' ) } data-os-comments-list>
			${ scoped && ! error ? filterBanner( ctx, ui, rows ) : '' }
			${ body }
			${ ! error && rows.length > 0 && ui.list.hasMore() ? loadMoreRow( ctx, ui ) : '' }
		</div>
	</aside>`;
}
