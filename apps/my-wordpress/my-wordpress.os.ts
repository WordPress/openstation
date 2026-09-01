/**
 * My WordPress — the client half: the body, instant.
 *
 * `my-wordpress.os.php` owns the truth (sections, queries,
 * authorization, the mutating actions); this file owns everything the
 * pointer touches, and — like its PHP twin — it is deliberately just
 * the composition: the local reducers, the frame (breadcrumbs, search
 * band, status bar), and the `defineApp()` wiring. The substance
 * lives in focused parts beside it (plain `.ts` on purpose — only
 * `*.os.ts` files are app bundle entries; see "Splitting a large app"
 * in `docs/app-framework.md`):
 *
 *   parts/types.ts         The shared contracts: payload shapes, the
 *                          state schema, the per-window UI bag, the
 *                          `wp.os` shell surface.
 *   parts/helpers.ts       Pure logic: accumulation, selection math,
 *                          preview-action scoping, menu builders.
 *   parts/list-views.ts    The root grid, the tile canvas, the
 *                          context menu, quick-edit, zoom.
 *   parts/dossier-views.ts The detail pane, the navigate-into folder,
 *                          the sub-lists and the stats panes.
 *   parts/agents.ts        Agents: character system, openers, the
 *                          cast grid and the off-state preview.
 *   parts/agents-detail.ts Agents: the detail view and its panes.
 *   parts/agents-wizard.ts Agents: the five-step create wizard.
 *   parts/wire.ts          The after-render DOM wiring: drag-out,
 *                          marquee, infinite scroll, drop targets.
 *
 * @public
 */

import { __, _n, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import type { Agent } from '../../src/my-wordpress/agents-types';
import {
	uiOf,
	type AppData,
	type AppState,
	type Ctx,
	type ListItem,
	type SectionDef,
} from './parts/types';
import {
	accumulate,
	applySelection,
	listKey,
	sectionOf,
} from './parts/helpers';
import {
	renderList,
	renderMenu,
	renderQuickEdit,
	renderRoot,
	renderZoom,
} from './parts/list-views';
import { renderDetail, renderFolder, renderSub } from './parts/dossier-views';
import { agentDefaultRole, emptyCast, newSeed } from './parts/agents';
import { renderAgents } from './parts/agents-wizard';
import { afterRender, wire } from './parts/wire';

// The public surface, re-exported from the parts so the tests (and
// any plugin reading this bundle's types) keep one import path.
export {
	accumulate,
	applySelection,
	listKey,
	resolveActions,
	resolveBanding,
	buildMenuOptions,
	withSendToHeading,
} from './parts/helpers';
export {
	agentDefaultRole,
	agentFaceSrc,
	agentsRosterStamp,
	emptyCast,
} from './parts/agents';
export type {
	AgentsPayload,
	AppAgent,
	AppData,
	AppState,
	CastDraft,
	DetailFacts,
	FolderPayload,
	GroupDef,
	ListItem,
	ListPage,
	MenuOption,
	PreviewAction,
	PreviewActionContext,
	RelationFolder,
	SectionDef,
	StatsPayload,
	StatsRecentPost,
	SubDetail,
	SubPayload,
	SubRow,
	UiState,
} from './parts/types';

/** Which body the current navigation depth paints. */
function renderBody(
	ctx: Ctx,
	section: SectionDef | null,
	inFolder: boolean,
	inSub: boolean,
	items: ListItem[],
): TemplateResult {
	if ( ! section ) {
		return renderRoot( ctx );
	}
	if ( section.kind === 'agent' ) {
		return renderAgents( ctx );
	}
	if ( inSub ) {
		return renderSub( ctx );
	}
	if ( inFolder ) {
		return renderFolder( ctx );
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">${ renderList( ctx, section, items ) }</div>
			<aside class="os-mywp__detail-pane">
				${ ctx.state.item > 0
					? renderDetail( ctx, section )
					: html`<p class="os-mywp__pane-empty">${ __( 'Select an entry to preview it here.' ) }</p>` }
			</aside>
		</div>
	`;
}

// ---------------------------------------------------------------- app

export default defineApp< AppState, AppData >( 'my-wordpress', {
	local: {
		select: ( state, args ) => {
			const order = Array.isArray( args.order ) ? ( args.order as number[] ) : [];
			state.selected = applySelection( state.selected, order, Number( args.item ), {
				ctrl: !! args.ctrl,
				shift: !! args.shift,
			} );
		},
		'select-set': ( state, args ) => {
			state.selected = ( Array.isArray( args.ids ) ? ( args.ids as number[] ) : [] ).slice();
		},
		'clear-select': ( state ) => {
			state.selected = [];
		},
		'set-sort': ( state, args ) => {
			state.sort = String( args.sort ?? '' );
		},
		// Transient UI (context menu, zoom) lives in the per-root
		// UiState — handlers mutate it directly and dispatch this
		// no-op so the runtime repaints. Nothing travels to the server.
		repaint: ( state ) => void state,
		// ------------------------------------------------- agents
		// The wizard's navigation and every field of the cast are
		// local: no request until the server is asked to draft or
		// create. The cast is DECLARED state, so the next dispatch
		// carries it up and `agent-draft` / `agent-create` read it.
		'agent-start': ( state, args, data ) => {
			const from = ( args.from ?? null ) as Agent | null;
			const seed = newSeed();
			const cast = emptyCast( agentDefaultRole( data.agents?.roles ?? null ), seed );
			if ( from ) {
				// A copy takes the work but not the face. Two agents
				// wearing one portrait is exactly the confusion the
				// faces exist to remove, so the copy rolls its own.
				cast.name = sprintf(
					/* translators: %s: name of the agent being copied. */
					__( '%s copy' ),
					from.name,
				);
				cast.description = from.description;
				cast.vibes = from.vibes;
				cast.instructions = from.instructions;
				cast.role = from.role;
				cast.abilities = [ ...from.abilities ];
				cast.triggers = from.triggers.map( ( t ) => ( {
					kind: t.kind,
					config: { ...t.config },
				} ) );
				cast.copiedFrom = from.name;
			}
			state.casting = true;
			state.item = 0;
			state.wstep = from ? 1 : 0;
			state.cast = cast;
			state.agentNotice = '';
			state.briefError = '';
		},
		'agent-cancel': ( state ) => {
			state.casting = false;
			state.wstep = 0;
			state.cast = null;
			state.agentNotice = '';
			state.briefError = '';
		},
		'agent-step': ( state, args ) => {
			state.wstep = Math.max( 0, Math.min( 4, Number( args.step ) ) ) as AppState[ 'wstep' ];
			state.agentNotice = '';
		},
		'agent-pane': ( state, args ) => {
			const pane = String( args.pane ?? 'define' );
			state.pane = ( [ 'define', 'tools', 'triggers' ].includes( pane )
				? pane
				: 'define' ) as AppState[ 'pane' ];
			state.agentNotice = '';
		},
		'agent-wiz': ( state, args ) => {
			state.cast = { ...( state.cast ?? {} ), ...args } as AppState[ 'cast' ];
		},
		'agent-brief-error': ( state, args ) => {
			state.briefError = String( args.msg ?? '' );
		},
		'agent-notice': ( state, args ) => {
			state.agentNotice = String( args.notice ?? '' );
		},
	},

	view: ( ctx ) => {
		const { state, data: payload } = ctx;
		const section = sectionOf( payload, state.section );
		const group = payload.groups.find( ( g ) => g.id === state.group ) ?? null;
		const depth = !! ( group || section );

		// The trail: ancestors are links, the current segment is plain
		// bold text — the desktop-files breadcrumb shape.
		const link = ( label: string, go: () => void ): TemplateResult =>
			html`<button type="button" class="os-mywp__crumb-link" @click=${ go }>${ label }</button>`;
		const current = ( label: string ): TemplateResult =>
			html`<span class="os-mywp__crumb-current" aria-current="page">${ label }</span>`;
		const sep = (): TemplateResult => html`<span class="os-mywp__sep" aria-hidden="true">›</span>`;
		const inFolder = section && state.into > 0;
		const inSub = inFolder && state.relation !== '';
		const crumbs: Array< TemplateResult > = [];
		if ( ! depth ) {
			crumbs.push( current( payload.siteName ) );
		} else {
			crumbs.push( link( payload.siteName, () => void ctx.dispatch( 'go' ) ) );
			if ( group ) {
				crumbs.push( sep() );
				crumbs.push(
					section
						? link( group.label, () => void ctx.dispatch( 'go', { group: group.id } ) )
						: current( group.label ),
				);
			}
			if ( section ) {
				crumbs.push( sep() );
				crumbs.push(
					inFolder
						? link( section.label, () => void ctx.dispatch( 'go', { group: state.group, section: section.id } ) )
						: current( section.label ),
				);
			}
			if ( inFolder && payload.folder ) {
				crumbs.push( sep() );
				crumbs.push(
					inSub
						? link( payload.folder.title, () => void ctx.dispatch( 'relation', { relation: '' } ) )
						: current( payload.folder.title ),
				);
			}
			if ( inSub && payload.sub ) {
				crumbs.push( sep() );
				crumbs.push( current( payload.sub.label ) );
			}
		}

		const items = section && ! inFolder
			? accumulate( uiOf( ctx.root ), listKey( state ), payload.list )
			: [];
		const loaded = items.length;
		let folderStatus: [ string, string ] | null = null;
		if ( inSub && payload.sub ) {
			folderStatus = [
				sprintf(
					/* translators: %d: item count. */
					_n( '%d item', '%d items', payload.sub.rows.length ),
					payload.sub.rows.length,
				),
				'',
			];
		} else if ( inFolder && payload.folder ) {
			folderStatus = [
				sprintf(
					/* translators: %d: folder count. */
					__( '%d folders' ),
					payload.folder.folders.length,
				),
				payload.folder.status,
			];
		}
		const isAgents = section?.kind === 'agent';
		if ( isAgents ) {
			folderStatus = payload.agents?.enabled
				? [
					sprintf(
						/* translators: %d: number of agents on the site. */
						_n( '%d agent', '%d agents', payload.agents.list.length ),
						payload.agents.list.length,
					),
					'',
				]
				: [ '', '' ];
		}
		const statusLeft = section && ! inFolder
			? `${ sprintf(
				/* translators: 1: loaded count, 2: total count. */
				__( '%1$d of %2$d items' ),
				loaded,
				payload.list?.total ?? 0,
			) }${ state.selected.length > 0
				? ' — ' + sprintf(
					/* translators: %d: selected count. */
					__( '%d selected' ),
					state.selected.length,
				)
				: '' }`
			: sprintf(
				/* translators: %d: folder count. */
				__( '%d folders' ),
				state.group
					? payload.sections.filter( ( s ) => s.group === state.group ).length
					: payload.sections.filter( ( s ) => ! s.group ).length + payload.groups.length,
			);
		const statusRight = section && ! inFolder
			? sprintf(
				/* translators: 1: current page, 2: page count. */
				__( 'Page %1$d of %2$d' ),
				payload.list?.page ?? 1,
				payload.list?.pages ?? 1,
			)
			: '';

		return html`
			<div class="os-mywp" tabindex="-1">
				<header class="os-mywp__header">
					${ depth
						? html`<button type="button" class="os-mywp__back" aria-label=${ __( 'Back' ) } @click=${ () => void ctx.dispatch( 'back' ) }>‹</button>`
						: '' }
					<nav class="os-mywp__crumbs">${ crumbs }</nav>
				</header>
				${ section && ! inFolder && ! isAgents
					? html`<div class="os-mywp__search">
						<os-text-field
							value=${ state.query }
							placeholder=${ sprintf(
								/* translators: %s: section label, lowercased. */
								__( 'Search %s…' ),
								section.label.toLowerCase(),
							) }
							clearable
							os-bind="query"
							os-action="search"
						></os-text-field>
					</div>`
					: '' }
				<div class="os-mywp__body">
					${ renderBody( ctx, section, !! inFolder, !! inSub, items ) }
				</div>
				<footer class="os-mywp__status">
					<span>${ folderStatus ? folderStatus[ 0 ] : statusLeft }</span>
					<span>${ folderStatus ? folderStatus[ 1 ] : statusRight }</span>
				</footer>
				${ section && ! isAgents ? renderMenu( ctx, section ) : '' }
				${ renderQuickEdit( ctx, section ) }
				${ renderZoom( ctx ) }
			</div>
		`;
	},

	mounted: ( ctx ) => wire( ctx ),

	updated: ( ctx ) => afterRender( ctx ),
} );
