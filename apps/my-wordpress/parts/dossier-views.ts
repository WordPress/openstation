/**
 * My WordPress — the detail and dossier panes.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. This part paints what a selection
 * SHOWS: the preview pane's dossier, the detail folder a post
 * navigates into, the relation sub-lists, and the WP Explorer stats
 * panes (term card, user dossier, comment, revision preview) behind a
 * selected sub-row.
 *
 * @public
 */

import { __, _n, formatDate, html, sprintf, type TemplateResult } from '@openstation/app';
import { openUserEditWindow } from '../../../src/open-targets/user-edit-window';
import {
	shell,
	uiOf,
	type Ctx,
	type DetailFacts,
	type SectionDef,
	type StatsRecentPost,
	type UserPreviewAction,
} from './types';
import { actionContext, opensOnTap, resolveActions, runAction } from './helpers';

/**
 * WP Explorer's dossier blocks, in its order — the default the shared
 * `os.my-wordpress.user-dossier-sections` filter starts from, so a
 * subscriber written against the original sees the list it expects.
 * The app renders `bio` and `stats` facts; the rest are the
 * original's deeper panes, harmless to keep in the vocabulary.
 */
const USER_DOSSIER_SECTIONS = [
	'bio',
	'stats',
	'activity',
	'milestones',
	'recent',
	'terms',
];

/**
 * Which dossier blocks a user pane may render, through the shared
 * `os.my-wordpress.user-dossier-sections` filter — a customer's
 * publishing stats are four zeroes above the number the merchant
 * actually came for. Null means "everything" (no subscriber, or a
 * non-user pane).
 */
function userDossierAllow(
	detail: DetailFacts,
	section: SectionDef,
): Set< string > | null {
	if ( detail.kind !== 'user' ) {
		return null;
	}
	const resolved = shell().hooks?.applyFilters(
		'os.my-wordpress.user-dossier-sections',
		USER_DOSSIER_SECTIONS,
		{ entityId: section.id, kind: section.kind, userId: detail.id },
	);
	return Array.isArray( resolved ) ? new Set( resolved as string[] ) : null;
}

/** Facts with the blocks the filter dropped removed; untagged facts always render. */
function dossierFilteredFacts(
	detail: DetailFacts,
	allow: Set< string > | null,
): DetailFacts[ 'facts' ] {
	if ( ! allow ) {
		return detail.facts;
	}
	return detail.facts.filter( ( fact ) => ! fact[ 2 ] || allow.has( fact[ 2 ] ) );
}

/**
 * The user dossier's deep blocks — WP Explorer's, 1:1: the four stat
 * tiles, the 12-month activity bars, the member/published milestones,
 * the recent posts and the top categories & tags chips. Painted from
 * the aggregated `stats` blob the dossier's own route serves, and
 * gated block by block through the shared filter.
 */
function userDossierBlocks(
	ctx: Ctx,
	detail: DetailFacts,
	allow: Set< string > | null,
): TemplateResult | '' {
	const stats = detail.kind === 'user' ? detail.stats : null;
	if ( ! stats ) {
		return '';
	}
	const show = ( id: string ): boolean => ! allow || allow.has( id );
	const posts = stats.counts?.posts ?? {};
	const pages = stats.counts?.pages ?? {};
	const published = ( bucket: Record< string, number > ): string =>
		sprintf(
			/* translators: %d: published count. */
			__( '%d published' ),
			bucket.publish ?? 0,
		);
	const milestoneRows: Array< [ string, string ] > = [];
	if ( stats.profile?.registered ) {
		milestoneRows.push( [ __( 'Member since' ), formatDate( stats.profile.registered, 'month' ) ] );
	}
	if ( stats.milestones?.firstPublished ) {
		milestoneRows.push( [ __( 'First published' ), formatDate( stats.milestones.firstPublished, 'month' ) ] );
	}
	if ( stats.milestones?.lastPublished ) {
		milestoneRows.push( [ __( 'Last published' ), formatDate( stats.milestones.lastPublished, 'month' ) ] );
	}
	const terms = stats.topTerms ?? [];
	return html`
		${ show( 'stats' )
			? html`<div class="os-mywp__stats">
				${ statTile( posts.total ?? 0, __( 'Posts' ), published( posts ) ) }
				${ statTile( pages.total ?? 0, __( 'Pages' ) ) }
				${ statTile( stats.counts?.commentsReceived ?? 0, __( 'Comments received' ) ) }
				${ statTile( stats.counts?.commentsLeft ?? 0, __( 'Comments left' ) ) }
			</div>`
			: '' }
		${ show( 'activity' ) ? activityBars( stats.activity ?? [] ) : '' }
		${ show( 'milestones' ) && milestoneRows.length > 0 ? factList( milestoneRows ) : '' }
		${ show( 'recent' ) ? recentPosts( ctx, stats.recent ?? [] ) : '' }
		${ show( 'terms' ) && terms.length > 0
			? html`
				<h3 class="os-mywp__pane-h">${ __( 'Top categories & tags' ) }</h3>
				<div class="os-mywp__chips">
					${ terms.map( ( t ) => html`<span class="os-mywp__chip os-mywp__chip--static">${ t.name } · ${ t.count }</span>` ) }
				</div>
			`
			: '' }
	`;
}

/**
 * The user pane's action row: WP Explorer's built-ins — the activity
 * footprint first, the profile editor demoted to a secondary button —
 * run through the shared `os.my-wordpress.user-preview-actions`
 * filter, so a section serving people who buy can swap the row for
 * one a merchant can use. The item handed to subscribers is the list
 * row under the dossier's fields, the same merge `preview-extras`
 * ships, so the Woo facts (`openstation_woo_customer`) are readable.
 */
function userPreviewActions(
	ctx: Ctx,
	section: SectionDef,
	detail: DetailFacts,
	item: Record< string, unknown > | null,
): UserPreviewAction[] {
	const base: UserPreviewAction[] = [
		{
			id: 'footprint',
			label: __( 'View activity footprint' ),
			title: __( 'Open the full activity footprint surface for this user.' ),
			variant: 'primary',
			onSelect: () =>
				void ctx.dispatch( 'footprint', { user: detail.id, name: detail.title } ),
		},
	];
	if ( detail.canEdit ) {
		base.push( {
			id: 'open-profile',
			label: __( 'Edit profile' ),
			variant: 'secondary',
			// The shared profile-window contract WP Explorer's own
			// button rides: the `desktop-mode-user-edit` singleton,
			// retargeted through the cross-bundle store — not the raw
			// `user-edit.php` iframe. The dispatch is only the
			// legacy fallback for sites without the native window.
			onSelect: () =>
				openUserEditWindow( detail.id, {
					source: 'my-wordpress-app/user-pane',
					fallback: () => void ctx.dispatch( 'edit', { item: detail.id } ),
				} ),
		} );
	}
	const merged = shell().hooks?.applyFilters(
		'os.my-wordpress.user-preview-actions',
		base,
		{
			entityId: section.id,
			kind: section.kind,
			item: { ...( item ?? {} ), ...detail } as Record< string, unknown >,
		},
	);
	const actions = Array.isArray( merged ) ? ( merged as UserPreviewAction[] ) : base;
	return actions.filter( ( a ) => !! a && typeof a.onSelect === 'function' );
}

/**
 * A named plugin slot on the preview article — the container the
 * shared `os.my-wordpress.preview-extras` action paints into (fired
 * from `wire.ts` after render, once per item). `os-preserve` keeps
 * the morph's hands off whatever a plugin appended; the class names
 * are WP Explorer's, so plugin CSS written for its slots applies.
 */
function extrasSlot( slot: 'header' | 'meta' | 'footer', itemId: number ): TemplateResult {
	return html`<div
		class="os-my-wordpress__article-slot os-my-wordpress__article-slot--${ slot }"
		data-mywp-slot=${ slot }
		data-mywp-extras-item=${ String( itemId ) }
		os-preserve
	></div>`;
}

export function renderDetail( ctx: Ctx, section: SectionDef ): TemplateResult {
	const { data } = ctx;
	const detail = data.detail;
	if ( ! detail ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	const item = ( data.list?.items ?? [] ).find( ( i ) => i.id === detail.id );
	const actions = item
		? resolveActions( data.previewActions, actionContext( section, item, 'pane' ), shell().hooks )
		: [];
	const dossierAllow = userDossierAllow( detail, section );
	const facts = dossierFilteredFacts( detail, dossierAllow );
	// The identity line WP Explorer puts under a person's name: their
	// role as a badge, and the author archive one click away. Not part
	// of the filterable dossier — an identity header without identity
	// is not a dossier.
	const roleLabel = detail.kind === 'user' ? detail.stats?.profile?.roleLabels?.[ 0 ] ?? '' : '';
	const archiveUrl = detail.kind === 'user' ? detail.stats?.profile?.link ?? '' : '';
	// The edit half of the action row: a user's runs through the
	// shared filter; everything else keeps the plain editor button.
	let editRow: TemplateResult | TemplateResult[] | '' = '';
	if ( detail.kind === 'user' ) {
		editRow = userPreviewActions(
			ctx,
			section,
			detail,
			( item as unknown as Record< string, unknown > ) ?? null,
		).map( ( a ) => html`
			<os-button
				variant=${ a.variant ?? 'secondary' }
				title=${ a.title ?? '' }
				@click=${ () => a.onSelect() }
			>${ a.label }</os-button>
		` );
	} else if ( detail.canEdit ) {
		editRow = html`<os-button variant="primary" @click=${ () => void ctx.dispatch( 'edit', { item: detail.id } ) }>
			${ __( 'Open in editor' ) }
		</os-button>`;
	}
	return html`
		<article class="os-mywp__detail">
			<os-button
				variant="ghost"
				class="os-mywp__pane-close"
				aria-label=${ __( 'Close details' ) }
				@click=${ () => void ctx.dispatch( 'open', { item: 0 } ) }
			>✕</os-button>
			${ detail.avatar ? html`<os-avatar src=${ detail.avatar } name=${ detail.title } size="xl"></os-avatar>` : '' }
			${ detail.image
				? html`<img
					class="os-mywp__hero ${ detail.kind === 'media' ? 'is-zoomable' : '' }"
					src=${ detail.image }
					alt=${ detail.title }
					@click=${ () => {
						if ( detail.kind === 'media' ) {
							uiOf( ctx ).zoom = true;
							ctx.repaint();
						}
					} }
				/>`
				: '' }
			<h2 class="os-mywp__detail-title">${ detail.title }</h2>
			${ roleLabel || archiveUrl
				? html`<p class="os-mywp__user-meta">
					${ roleLabel ? html`<os-badge no-dot>${ roleLabel.toUpperCase() }</os-badge>` : '' }
					${ archiveUrl
						? html`<a class="os-mywp__crumb-link" href=${ archiveUrl } target="_blank" rel="noreferrer">${ __( 'Author archive' ) }</a>`
						: '' }
				</p>`
				: '' }
			${ extrasSlot( 'header', detail.id ) }
			${ detail.lockedBy
				? html`<os-notice tone="warning" not-dismissible>${ sprintf(
					/* translators: %s: user display name. */
					__( '%s is editing this right now.' ),
					detail.lockedBy,
				) }</os-notice>`
				: '' }
			${ factList( facts ) }
			${ usedInList( detail.usedIn ) }
			${ detail.content !== undefined
				? html`
					<h3 class="os-mywp__pane-h">${ __( 'Preview' ) }</h3>
					<div class="os-mywp__content" data-mywp-content="detail" os-preserve></div>
				`
				: '' }
			${ extrasSlot( 'meta', detail.id ) }
			${ userDossierBlocks( ctx, detail, dossierAllow ) }
			<div class="os-mywp__actions">
				${ detail.kind === 'post' && ! section.flat
					? html`<os-button
						variant="secondary"
						title=${ __(
							'See author, comments, categories, tags, attached media, and revisions for this entry.',
						) }
						@click=${ () => void ctx.dispatch( 'into', { item: detail.id } ) }
					>${ __( 'Explore details' ) }</os-button>`
					: '' }
				${ editRow }
				${ actions.map( ( action ) => html`
					<os-button variant="secondary" @click=${ () => item && runAction( action, actionContext( section, item, 'pane' ) ) }>
						${ action.label }
					</os-button>
				` ) }
				${ detail.kind === 'post' && detail.canDelete
					? html`<os-button
						variant="danger"
						os-action="trash"
						os-arg-item=${ String( detail.id ) }
						os-confirm=${ __( 'Move this to the Trash?' ) }
						os-confirm-label=${ __( 'Trash' ) }
						os-confirm-danger
					>${ __( 'Trash' ) }</os-button>`
					: '' }
			</div>
			${ extrasSlot( 'footer', detail.id ) }
		</article>
	`;
}

/**
 * The detail FOLDER view a post navigates into: relation folder tiles
 * on the left (Author, Contributors, Comments · N, Categories, Tags,
 * Attached media, Revisions), the rendered article on the right.
 * Double-click a folder to drill into its rows, like the original.
 */
export function renderFolder( ctx: Ctx ): TemplateResult {
	const folder = ctx.data.folder;
	if ( ! folder ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">
				<div class="os-mywp__tiles" role="list">
					${ folder.folders.map( ( sub ) => html`
						<div class="os-mywp__cell ${ sub.disabled ? 'is-disabled' : '' }" role="listitem">
							<span class="os-mywp__tilebox">
								<os-tile
									kind="folder"
									type="relation"
									ref=${ sub.relation }
									label=${ `${ sub.label } · ${ sub.count }` }
									icon=${ sub.icon }
									?selected=${ uiOf( ctx ).folderSel === `relation:${ sub.relation }` }
									@click=${ () => {
										// A tap opens the folder where a
										// double tap is not to be had.
										if ( opensOnTap() ) {
											if ( ! sub.disabled ) {
												uiOf( ctx ).folderSel = null;
												void ctx.dispatch( 'relation', { relation: sub.relation } );
											}
											return;
										}
										uiOf( ctx ).folderSel = `relation:${ sub.relation }`;
										ctx.repaint();
									} }
									@dblclick=${ () => {
										if ( ! sub.disabled ) {
											uiOf( ctx ).folderSel = null;
											void ctx.dispatch( 'relation', { relation: sub.relation } );
										}
									} }
								></os-tile>
							</span>
						</div>
					` ) }
				</div>
			</div>
			<aside class="os-mywp__detail-pane">
				<article class="os-mywp__detail">
					<h2 class="os-mywp__detail-title">${ folder.title }</h2>
					<div class="os-mywp__content" data-mywp-content="folder" os-preserve></div>
					${ extrasSlot( 'meta', folder.id ) }
				</article>
			</aside>
		</div>
	`;
}

/** One stat tile — the kit's `<os-stat>` carries the typography. */
function statTile( value: number, label: string, note = '' ): TemplateResult {
	return html`<os-stat value=${ String( value ) } label=${ label } caption=${ note }></os-stat>`;
}

/** The 12-month activity bar row, zero months included. */
function activityBars( activity: Array< { ym: string; count: number } > ): TemplateResult {
	const byYm = new Map( activity.map( ( a ) => [ a.ym, a.count ] ) );
	const months: Array< { ym: string; label: string; count: number } > = [];
	const cursor = new Date();
	cursor.setDate( 1 );
	cursor.setMonth( cursor.getMonth() - 11 );
	for ( let i = 0; i < 12; i++ ) {
		const ym = `${ cursor.getFullYear() }-${ String( cursor.getMonth() + 1 ).padStart( 2, '0' ) }`;
		months.push( {
			ym,
			label: cursor.toLocaleDateString( undefined, { month: 'short' } ),
			count: byYm.get( ym ) ?? 0,
		} );
		cursor.setMonth( cursor.getMonth() + 1 );
	}
	const max = Math.max( 1, ...months.map( ( m ) => m.count ) );
	return html`
		<h3 class="os-mywp__pane-h">${ __( 'Activity (last 12 months)' ) }</h3>
		<div class="os-mywp__activity" role="img" aria-label=${ __( 'Posts per month' ) }>
			${ months.map( ( m ) => html`
				<div class="os-mywp__activity-col" title="${ m.label } · ${ m.count }">
					<span class="os-mywp__activity-bar" style="block-size:${ Math.round( ( m.count / max ) * 100 ) }%"></span>
					<span class="os-mywp__activity-label">${ m.label }</span>
				</div>
			` ) }
		</div>
	`;
}

/** The clickable recent-posts list every stats pane ends with. */
function recentPosts( ctx: Ctx, recent: StatsRecentPost[] ): TemplateResult | '' {
	if ( recent.length === 0 ) {
		return '';
	}
	return html`
		<h3 class="os-mywp__pane-h">${ __( 'Recent posts' ) }</h3>
		<div class="os-mywp__recent">
			${ recent.slice( 0, 6 ).map( ( post ) => html`
				<button
					type="button"
					class="os-mywp__recent-row"
					@click=${ () => void ctx.dispatch( 'sub-open-post', { post: post.id } ) }
				>
					<span class="os-mywp__recent-title">${ post.title }</span>
					<span class="os-mywp__subtitle">${ new Date( post.date ).toLocaleString() }${ post.status ? ` · ${ post.status }` : '' }</span>
				</button>
			` ) }
		</div>
	`;
}

/**
 * The label/value fact list every detail pane ends with. A row may
 * carry the server's third element (the dossier-section tag); only
 * label and value render.
 */
function factList( rows: Array< [ string, string ] | [ string, string, string ] > ): TemplateResult {
	return html`
		<dl class="os-mywp__facts">
			${ rows.map( ( [ label, value ] ) => html`
				<div class="os-mywp__fact"><dt>${ label }</dt><dd>${ value }</dd></div>
			` ) }
		</dl>
	`;
}

/** The media "Used in" block — list of placements, or the empty line. */
function usedInList( usedIn: DetailFacts[ 'usedIn' ] ): TemplateResult | '' {
	if ( ! usedIn ) {
		return '';
	}
	return html`
		<h3 class="os-mywp__pane-h">${ __( 'Used in' ) }</h3>
		${ usedIn.length > 0
			? html`<ul class="os-mywp__used-in">
				${ usedIn.map( ( u ) => html`<li>${ u.title } <span class="os-mywp__subtitle">${ u.usedAs }</span></li>` ) }
			</ul>`
			: html`<p class="os-mywp__subtitle">${ __( 'Not used anywhere yet.' ) }</p>` }
	`;
}

/** Facts + hero, shared by the user and media sub-panes. */
function dossierFacts( detail: DetailFacts ): TemplateResult {
	return html`
		${ detail.avatar ? html`<os-avatar src=${ detail.avatar } name=${ detail.title } size="xl"></os-avatar>` : '' }
		${ detail.image ? html`<img class="os-mywp__hero" src=${ detail.image } alt=${ detail.title } />` : '' }
		<h2 class="os-mywp__detail-title">${ detail.title }</h2>
		${ factList( detail.facts ) }
		${ usedInList( detail.usedIn ) }
	`;
}

/** The right pane behind a selected sub-list row, per relation kind. */
function renderSubDetail( ctx: Ctx ): TemplateResult {
	const picked = ctx.data.subDetail;
	if ( ! picked ) {
		return html`<p class="os-mywp__pane-empty">${ __( 'Select an entry to preview it here.' ) }</p>`;
	}
	if ( picked.kind === 'term' ) {
		const stats = picked.stats;
		const posts = stats.counts?.posts ?? {};
		const published = posts.publish ?? 0;
		return html`
			<article class="os-mywp__detail">
				<header class="os-mywp__term-head">
					<span class="os-mywp__term-swatch" aria-hidden="true"></span>
					<div>
						<h2 class="os-mywp__detail-title">${ stats.profile?.name ?? '' }</h2>
						<os-badge no-dot>${ ( stats.profile?.taxonomyLabel ?? '' ).toUpperCase() }</os-badge>
						${ stats.profile?.link
							? html`<a class="os-mywp__crumb-link" href=${ stats.profile.link } target="_blank" rel="noreferrer">${ __( 'View archive' ) }</a>`
							: '' }
					</div>
				</header>
				<div class="os-mywp__stats">
					${ statTile( posts.total ?? 0, __( 'Posts' ), sprintf(
						/* translators: %d: published count. */
						__( '%d published' ),
						published,
					) ) }
					${ statTile( stats.counts?.commentsReceived ?? 0, __( 'Comments' ) ) }
					${ statTile( stats.counts?.distinctAuthors ?? 0, __( 'Authors' ) ) }
				</div>
				${ activityBars( stats.activity ?? [] ) }
				${ factList( [
					...( stats.milestones?.firstPosted
						? [ [ __( 'First post' ), formatDate( stats.milestones.firstPosted, 'month' ) ] as [ string, string ] ]
						: [] ),
					...( stats.milestones?.lastPosted
						? [ [ __( 'Last post' ), formatDate( stats.milestones.lastPosted, 'month' ) ] as [ string, string ] ]
						: [] ),
				] ) }
				${ ( stats.topAuthors ?? [] ).length > 0
					? html`
						<h3 class="os-mywp__pane-h">${ __( 'Top contributors' ) }</h3>
						<div class="os-mywp__people">
							${ ( stats.topAuthors ?? [] ).map( ( person ) => html`
								<div class="os-mywp__person">
									<os-avatar src=${ person.userAvatarUrl } name=${ person.userName } size="sm"></os-avatar>
									<span class="os-mywp__person-name">${ person.userName }</span>
									<span class="os-mywp__subtitle">${ sprintf(
										/* translators: %d: post count. */
										_n( '%d post', '%d posts', person.count ),
										person.count,
									) }</span>
								</div>
							` ) }
						</div>
					`
					: '' }
				${ ( stats.coTerms ?? [] ).length > 0
					? html`
						<h3 class="os-mywp__pane-h">${ __( 'Often paired with' ) }</h3>
						<div class="os-mywp__chips">
							${ ( stats.coTerms ?? [] ).map( ( co ) => html`
								<button
									type="button"
									class="os-mywp__chip"
									@click=${ () => void ctx.dispatch( 'open', { item: co.id } ) }
								>${ co.name } · ${ co.count }</button>
							` ) }
						</div>
					`
					: '' }
				${ recentPosts( ctx, stats.recent ?? [] ) }
			</article>
		`;
	}
	if ( picked.kind === 'user' ) {
		return html`
			<article class="os-mywp__detail">
				${ dossierFacts( picked.detail ) }
				${ activityBars( picked.stats?.activity ?? [] ) }
				${ recentPosts( ctx, picked.stats?.recent ?? [] ) }
			</article>
		`;
	}
	if ( picked.kind === 'comment' ) {
		const stats = picked.stats;
		return html`
			<article class="os-mywp__detail">
				<h2 class="os-mywp__detail-title">${ stats.author?.name ?? __( 'Comment' ) }</h2>
				${ stats.comment?.date ? html`<p class="os-mywp__subtitle">${ new Date( String( stats.comment.date ) ).toLocaleString() }${ stats.comment?.status ? ` · ${ stats.comment.status }` : '' }</p>` : '' }
				<div class="os-mywp__content" data-mywp-content="sub" os-preserve></div>
				${ stats.post?.id
					? html`<os-button variant="secondary" @click=${ () => void ctx.dispatch( 'sub-open-post', { post: stats.post?.id } ) }>
						${ __( 'Open the post' ) }
					</os-button>`
					: '' }
			</article>
		`;
	}
	if ( picked.kind === 'media' ) {
		return html`<article class="os-mywp__detail">${ dossierFacts( picked.detail ) }</article>`;
	}
	return html`
		<article class="os-mywp__detail">
			<h2 class="os-mywp__detail-title">${ picked.title }</h2>
			<p class="os-mywp__subtitle">${ picked.author }${ picked.date ? ` · ${ picked.date }` : '' }</p>
			<h3 class="os-mywp__pane-h">${ __( 'Preview' ) }</h3>
			<div class="os-mywp__content" data-mywp-content="sub" os-preserve></div>
		</article>
	`;
}

/** One relation's rows — the sub-list behind a detail folder tile. */
export function renderSub( ctx: Ctx ): TemplateResult {
	const sub = ctx.data.sub;
	if ( ! sub ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">
				${ sub.rows.length === 0
					? html`<os-empty-state>${ __( 'Nothing here yet.' ) }</os-empty-state>`
					: html`
						<div class="os-mywp__tiles" role="list">
							${ sub.rows.map( ( row ) => html`
								<div
									class="os-mywp__cell ${ ctx.state.item === row.id ? 'is-open' : '' }"
									role="listitem"
									title=${ row.subtitle }
								>
									<span class="os-mywp__tilebox">
										<os-tile
											kind="entry"
											type="relation-row"
											ref=${ String( row.id ) }
											label=${ row.title }
											icon=${ row.thumb ? '' : ( row.icon ?? 'dashicons-media-default' ) }
											thumbnail=${ row.thumb ?? '' }
											?selected=${ ctx.state.item === row.id }
											@click=${ () => {
												// A tap opens the editor where a double
												// tap is not to be had; a row with no
												// editor still opens its pane.
												if ( opensOnTap() && row.editUrl ) {
													void ctx.dispatch( 'sub-open', { row: row.id } );
													return;
												}
												void ctx.dispatch( 'open', { item: row.id } );
											} }
											@dblclick=${ () => row.editUrl && void ctx.dispatch( 'sub-open', { row: row.id } ) }
										></os-tile>
									</span>
								</div>
							` ) }
						</div>
					` }
			</div>
			<aside class="os-mywp__detail-pane">${ renderSubDetail( ctx ) }</aside>
		</div>
	`;
}
