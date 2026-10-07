import { __, _n, applySelection, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import type { Agent } from '../../src/agents-types';
import { isMobileStamped } from '../../src/mode/stamp';
import {
	uiOf,
	type AppData,
	type AppState,
	type Ctx,
	type ListItem,
	type SectionDef,
} from './parts/types';
import { explorerItemTrashing, openPreview, previewContext, visibleExplorerItems, watchExplorerTrash } from './parts/optimistic';
import { listKey, sectionOf } from './parts/helpers';
import {
	renderList,
	renderMenu,
	renderQuickEdit,
	renderRoot,
	renderZoom,
} from './parts/list-views';
import { renderDetail, renderFolder, renderSub, splitView } from './parts/dossier-views';
import { hiddenStatus, renderColumnsMenu, sortStatus } from './parts/list-table';
import { footprintStatus, renderFootprint } from './parts/footprint';
import { agentDefaultRole, emptyCast, newSeed } from './parts/agents';
import { renderAgents } from './parts/agents-wizard';
import { afterRender, wire } from './parts/wire';

export {
	listKey,
	resolveActions,
	resolveBanding,
	buildMenuOptions,
	withSendToHeading,
} from './parts/helpers';
export { columnsFor, hiddenFor, nextSort } from './parts/list-table';

export { applySelection } from '@openstation/app';
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
	ListColumn,
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

function renderBody(
	ctx: Ctx,
	section: SectionDef | null,
	inFolder: boolean,
	inSub: boolean,
	items: ListItem[],
): TemplateResult {
	if ( ctx.state.footprint > 0 ) {
		return renderFootprint( ctx );
	}
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

	if ( ctx.state.item > 0 && ! explorerItemTrashing( section, ctx.state.item ) && isMobileStamped() ) {
		return html`<div class="os-mywp__detail-page">${ renderDetail( ctx, section ) }</div>`;
	}

	return splitView(
		renderList( ctx, section, items ),
		ctx.state.item > 0 && ! explorerItemTrashing( section, ctx.state.item ) ? renderDetail( ctx, section ) : null,
	);
}

function renderViewSwitch( ctx: Ctx ): TemplateResult {
	const { state } = ctx;
	const pick = ( e: Event ): void => {
		const view = String( ( e as CustomEvent< { value?: string } > ).detail?.value ?? '' );
		if ( ( view !== 'icons' && view !== 'list' ) || view === state.view ) {
			return;
		}

		uiOf( ctx ).revealSelection = true;
		ctx.local( 'set-view', { view } );
		void ctx.dispatch( 'view' );
	};
	return html`
		<os-segmented
			class="os-mywp__view-switch"
			value=${ state.view }
			label=${ __( 'View as' ) }
			@os-pick=${ pick }
		>
			<os-segment value="icons" title=${ __( 'Icons' ) }>
				<span class="dashicons dashicons-grid-view" aria-hidden="true"></span>
				<span class="os-mywp__view-label">${ __( 'Icons' ) }</span>
			</os-segment>
			<os-segment value="list" title=${ __( 'List' ) }>
				<span class="dashicons dashicons-list-view" aria-hidden="true"></span>
				<span class="os-mywp__view-label">${ __( 'List' ) }</span>
			</os-segment>
		</os-segmented>
	`;
}

export default defineApp< AppState, AppData >( 'my-wordpress', {
	local: {
		'search-query': ( state, args ) => {
			state.query = String( args.value ?? '' );
			state.page = 1;
			state.item = 0;
			state.selected = [];
		},
		preview: ( state, args ) => {
			state.item = Number( args.item ) || 0;
			state.pane = 'define';
			state.agentNotice = '';
		},
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

		'set-view': ( state, args ) => {
			state.view = args.view === 'list' ? 'list' : 'icons';

			if ( state.view === 'list' && state.sort === '' ) {
				state.sort = 'id-desc';
				state.page = 1;
			}
		},

		'agent-start': ( state, args, data ) => {
			const from = ( args.from ?? null ) as Agent | null;
			const seed = newSeed();
			const cast = emptyCast( agentDefaultRole( data.agents?.roles ?? null ), seed );
			if ( from ) {
				cast.name = sprintf(

					__( '%s copy' ),
					from.name,
				);
				cast.description = from.description;
				cast.vibes = from.vibes;
				cast.instructions = from.instructions;

				cast.brief = from.instructions;
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
			const next = Math.max( 0, Math.min( 4, Number( args.step ) ) ) as AppState[ 'wstep' ];

			if ( state.wstep === 0 && next !== 0 && state.cast ) {
				state.cast = {
					...state.cast,
					instructions: String( state.cast.brief ?? '' ).trim(),
				};
			}
			state.wstep = next;
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
		ctx = previewContext( ctx );
		const { state, data: payload } = ctx;
		const section = sectionOf( payload, state.section );
		const group = payload.groups.find( ( g ) => g.id === state.group ) ?? null;
		const inFootprint = state.footprint > 0;
		const depth = !! ( group || section ) || inFootprint;

		const link = ( label: string, go: () => void ): TemplateResult =>
			html`<button type="button" class="os-mywp__crumb-link" @click=${ go }>${ label }</button>`;
		const current = ( label: string ): TemplateResult =>
			html`<span class="os-mywp__crumb-current" aria-current="page">${ label }</span>`;
		const sep = (): TemplateResult => html`<span class="os-mywp__sep" aria-hidden="true">›</span>`;
		const inFolder = section && state.into > 0;
		const inSub = inFolder && state.relation !== '';

		const onItemPage =
			!! section && ! inFolder && section.kind !== 'agent' && state.item > 0 && isMobileStamped();
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
					inFolder || inFootprint || onItemPage
						? link( section.label, () => void ctx.dispatch( 'go', { group: state.group, section: section.id } ) )
						: current( section.label ),
				);
			}
			if ( onItemPage && payload.detail ) {
				crumbs.push( sep() );
				crumbs.push( current( payload.detail.title ) );
			}
			if ( inFootprint ) {
				crumbs.push( sep() );
				crumbs.push( current( state.fpName || __( 'Activity footprint' ) ) );
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
			? visibleExplorerItems( ctx, section, uiOf( ctx ).list.accumulate( listKey( state ), payload.list ) )
			: [];
		const loaded = items.length;
		const selectedCount = section ? state.selected.filter( ( id ) => ! explorerItemTrashing( section, id ) ).length : state.selected.length;
		let folderStatus: [ string, string ] | null = null;
		if ( inSub && payload.sub ) {
			folderStatus = [
				sprintf(

					_n( '%d item', '%d items', payload.sub.rows.length ),
					payload.sub.rows.length,
				),
				'',
			];
		} else if ( inFolder && payload.folder ) {
			folderStatus = [
				sprintf(

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

						_n( '%d agent', '%d agents', payload.agents.list.length ),
						payload.agents.list.length,
					),
					'',
				]
				: [ '', '' ];
		}
		if ( inFootprint ) {
			folderStatus = footprintStatus( ctx );
		}
		const statusLeft = section && ! inFolder
			? `${ sprintf(

				__( '%1$d of %2$d items' ),
				loaded,
				payload.list?.total ?? 0,
			) }${ selectedCount > 0
				? ' — ' + sprintf(

					__( '%d selected' ),
					selectedCount,
				)
				: '' }`
			: sprintf(

				__( '%d folders' ),
				state.group
					? payload.sections.filter( ( s ) => s.group === state.group ).length
					: payload.sections.filter( ( s ) => ! s.group ).length + payload.groups.length,
			);
		let statusRight = section && ! inFolder
			? sprintf(

				__( 'Page %1$d of %2$d' ),
				payload.list?.page ?? 1,
				payload.list?.pages ?? 1,
			)
			: '';
		if ( section && ! inFolder && ! isAgents && state.view === 'list' ) {
			statusRight = [ hiddenStatus( ctx, section ), sortStatus( ctx ), statusRight ]
				.filter( Boolean )
				.join( ' · ' );
		}

		return html`
			<div class="os-mywp" tabindex="-1">
				<header class="os-mywp__header">
					${ depth
						? html`<button
							type="button"
							class="os-mywp__back"
							aria-label=${ __( 'Back' ) }
							@click=${ () =>
								onItemPage ? openPreview( ctx, 0 ) : void ctx.dispatch( 'back' ) }
						>‹</button>`
						: '' }
					<nav class="os-mywp__crumbs">${ crumbs }</nav>
				</header>
				${ section && ! inFolder && ! isAgents && ! inFootprint
					? html`<div class="os-mywp__search">
						<os-text-field
							label=${ __( 'Search this section' ) }
							hide-label
							value=${ state.query }
							placeholder=${ sprintf(

								__( 'Search %s…' ),
								section.label.toLowerCase(),
							) }
							clearable
							@os-input-change=${ ( event: CustomEvent< { value: string } > ) => ctx.local( 'search-query', event.detail ) }
							os-action="refresh"
						></os-text-field>
						${ renderViewSwitch( ctx ) }
						${ section.kind === 'user' && section.canAdd
							? html`<os-button
									variant="secondary"
									class="os-mywp__add-user"
									@click=${ () => void ctx.dispatch( 'add-user' ) }
								>
									${ __( 'Add user' ) }
								</os-button>`
							: '' }
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
				${ renderColumnsMenu( ctx, section ) }
				${ renderQuickEdit( ctx, section ) }
				${ renderZoom( ctx ) }
			</div>
		`;
	},

	mounted: ( ctx ) => {
		const unwire = wire( ctx );
		const unwatchTrash = watchExplorerTrash( ctx );

		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			unwatchTrash();
			unwire();
			document.removeEventListener( 'os-mode-changed', onModeChange );
		};
	},

	updated: ( ctx ) => afterRender( ctx ),
} );
