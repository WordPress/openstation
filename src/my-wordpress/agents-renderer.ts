/**
 * WP Explorer — Agents entity-kind renderer.
 *
 * Master-detail over `/desktop-mode/v1/agents`: agent list on the
 * left; Define / Tools / Triggers panes on the right; create flow;
 * chat opener that seeds the cross-bundle chat store and opens the
 * Agent chat window.
 *
 * All state is local to the mount — the host owns routing, this
 * renderer only paints inside `host.body` for the
 * `{ kind: 'list', entityId: 'agents' }` route.
 *
 * @public
 */

import { __ } from '../i18n';
import { html, render } from '../ui/core';
import { registerEntityKind } from './kind-registry';
import type { EntityRenderHost } from './kind-registry';
import { buildEditUserUrl, getConfig } from './rest';
import type { MyWordPressConfig } from './types';
import {
	createAgent,
	deleteAgent,
	fetchAbilitiesCatalogue,
	fetchAiStatus,
	fetchHooksCatalogue,
	fetchRoles,
	fetchTriggerKinds,
	listAgents,
	updateAgent,
} from './agents-rest';
import type {
	Ability,
	Agent,
	AgentsSectionConfig,
	HookSuggestion,
	RoleChoice,
	Trigger,
	TriggerKindDescriptor,
} from './agents-types';
import { createSharedStore } from '../shared-store';
import { refreshSendToAgents } from './agents-send-to';
import { openAgentChat } from '../agents-chat-store';
import {
	clearAgentEditorTarget,
	readAgentEditorTarget,
} from '../agents-editor-target';
import {
	agentAcceptsDrop,
	describeDragEntity,
	dispatchAgentDrop,
	dragKindsFromTriggers,
} from '../agents-dispatch';
import { getDragManager } from './dom-utils';
import { attachTileDragOut } from '../desktop-files/tile-spec';
import { osConfirm } from '../ui/components/os-confirm-dialog/os-confirm-dialog';
import '../ui/components/os-badge/os-badge';
import '../ui/components/os-button/os-button';
import '../ui/components/os-checkbox-label/os-checkbox-label';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-notice/os-notice';
import '../ui/components/os-select/os-select';
import '../ui/components/os-spinner/os-spinner';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-textarea/os-textarea';

type Pane = 'define' | 'tools' | 'triggers';

interface AgentsState {
	agents: Agent[];
	loading: boolean;
	error: string;
	selectedId: number | null;
	pane: Pane;
	creating: boolean;
	saving: boolean;
	notice: string;
	/** Lazy catalogues — null until first fetched. */
	abilities: Ability[] | null;
	triggerKinds: TriggerKindDescriptor[] | null;
	hooks: HookSuggestion[] | null;
	roles: RoleChoice[] | null;
	/** Null while the provider probe is in flight. */
	aiReady: boolean | null;
	/** Draft edits for the Define pane, keyed by field. */
	draft: { name: string; description: string; instructions: string; role: string };
	/** Draft for the create form. */
	createDraft: { name: string; description: string; instructions: string; role: string };
}

const ENTITY_KIND_CHOICES = [ 'post', 'page', 'media', 'user', 'comment' ];

/** Per-mount sequence so multi-instance windows get unique target ids. */
let agentsMountSeq = 0;

function agentsConfig(): AgentsSectionConfig {
	const cfg = getConfig() as MyWordPressConfig & {
		agents?: AgentsSectionConfig;
	};
	return (
		cfg.agents ?? {
			canManage: false,
			canInvoke: false,
			aiAvailable: false,
			aiStatusUrl: '',
			connectorsUrl: '',
			runWindowId: 'desktop-mode-agent-run',
		}
	);
}

/**
 * Whether WP Explorer still exposes a Users section. The
 * GitHub-style contributions view is a route under it, so the
 * "View contributions" button hides when a filter dropped the entity.
 */
function hasUsersEntity(): boolean {
	const { entities } = getConfig();
	return (
		Array.isArray( entities ) && entities.some( ( e ) => e.id === 'users' )
	);
}

function openChatWindow( agent: Agent ): void {
	openAgentChat( {
		id: agent.id,
		name: agent.name,
		description: agent.description,
		avatarUrl: agent.avatarUrl,
	} );
	const openWindow = (
		window as unknown as {
			wp?: {
				os?: {
					openWindow?: ( id: string, opts?: { source?: string } ) => boolean;
				};
			};
		}
	).wp?.os?.openWindow;
	if ( typeof openWindow === 'function' ) {
		openWindow( agentsConfig().runWindowId, { source: 'agents' } );
	} else {
		// eslint-disable-next-line no-console
		console.warn(
			'[desktop-mode/agents] wp.os.openWindow is missing — desktop shell may not be ready.',
		);
	}
}

interface OpenStationSurface {
	openWindow?: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;
	windowManager?: {
		open: ( opts: {
			id: string;
			url: string;
			title: string;
			icon: string;
		} ) => unknown;
	};
	files?: {
		rest?: {
			createPlacement?: ( body: {
				type: string;
				ref: string;
				x: number;
				y: number;
			} ) => Promise< Record< string, unknown > >;
		};
		store?: {
			getState?: () => {
				placementsByFolder?: Map< number, unknown[] >;
			};
			upsertPlacement?: ( placement: Record< string, unknown > ) => void;
		};
	};
}

function openStation(): OpenStationSurface | undefined {
	return ( window as unknown as { wp?: { os?: OpenStationSurface } } ).wp
		?.os;
}

/**
 * Open the agent's USER profile — same three-step hand-off the users
 * grid uses: seed the user-edit target store, open the native window,
 * fall back to the iframe profile.
 */
function openAgentProfile( agent: Agent ): void {
	const target = createSharedStore< {
		userId: number | null;
		requestedAt: number;
		tabRequested: boolean;
	} >( 'desktop-mode/user-edit/target', () => ( {
		userId: null,
		requestedAt: 0,
		tabRequested: false,
	} ) );
	target.state.userId = agent.id;
	target.state.requestedAt = Date.now();
	target.state.tabRequested = true;
	target.notify();

	const desktop = openStation();
	const opened = desktop?.openWindow?.( 'desktop-mode-user-edit', {
		source: 'agents/profile',
		// Survives a reload; the shared store above does not.
		params: { userId: agent.id },
	} );
	if ( ! opened ) {
		desktop?.windowManager?.open( {
			id: `user-edit-${ agent.id }`,
			url: buildEditUserUrl( agent.id ),
			title: agent.name,
			icon: 'dashicons-admin-users',
		} );
	}
}

/**
 * Create a wallpaper tile for the agent (a user placement — the same
 * thing dragging the agent out of the Users grid produces).
 */
async function sendAgentToDesktop( agent: Agent ): Promise< string > {
	const files = openStation()?.files;
	if ( ! files?.rest?.createPlacement ) {
		return __(
			'The desktop files API is not available in this context.',
			'desktop-mode',
		);
	}
	let roots: Array< { x?: number; y?: number } > = [];
	try {
		const got = files.store?.getState?.()?.placementsByFolder?.get( 0 );
		if ( Array.isArray( got ) ) {
			roots = got as Array< { x?: number; y?: number } >;
		}
	} catch {
		// No store — scan still starts from the first cell.
	}
	// First FREE cell in the same row-major grid the Trash restore flow
	// uses. Count-based slotting collides with tiles the user has
	// dragged around (and for an agent already on the desktop the
	// server MOVES its tile, so a collision buries an existing icon).
	let x = 16;
	let y = 16;
	for ( let n = 0; n < 200; n++ ) {
		x = 16 + ( n % 5 ) * 96;
		y = 16 + Math.floor( n / 5 ) * 110;
		const occupied = roots.some(
			( p ) =>
				Math.abs( ( p.x ?? -9999 ) - x ) < 48 &&
				Math.abs( ( p.y ?? -9999 ) - y ) < 55,
		);
		if ( ! occupied ) {
			break;
		}
	}
	try {
		const placement = await files.rest.createPlacement( {
			type: 'user',
			ref: String( agent.id ),
			x,
			y,
		} );
		files.store?.upsertPlacement?.( placement );
		return __( 'Agent added to the desktop.', 'desktop-mode' );
	} catch ( err ) {
		return err instanceof Error ? err.message : String( err );
	}
}

/**
 * `<os-option>` list for a role picker. A role the agent already
 * carries but the site no longer registers (a plugin that shipped it
 * was deactivated) is appended so the select shows the truth instead
 * of silently reading as the first registered role.
 */
function roleOptions( roles: RoleChoice[], current: string ) {
	const known = roles.some( ( r ) => r.slug === current );
	return html`
		${ roles.map(
			( role ) => html`
				<os-option value=${ role.slug }>${ role.label }</os-option>
			`,
		) }
		${ current && ! known
			? html`<os-option value=${ current }>${ current }</os-option>`
			: html`` }
	`;
}

function draftFromAgent( agent: Agent | null ): AgentsState[ 'draft' ] {
	return {
		name: agent?.name ?? '',
		description: agent?.description ?? '',
		instructions: agent?.instructions ?? '',
		role: agent?.role ?? '',
	};
}

export function renderAgents( host: EntityRenderHost ): void {
	const cfg = agentsConfig();
	const root = document.createElement( 'div' );
	root.className = 'dm-agents';
	host.body.replaceChildren( root );

	const state: AgentsState = {
		agents: [],
		loading: true,
		error: '',
		selectedId: null,
		pane: 'define',
		creating: false,
		saving: false,
		notice: '',
		abilities: null,
		triggerKinds: null,
		hooks: null,
		roles: null,
		aiReady: cfg.aiAvailable ? null : false,
		draft: draftFromAgent( null ),
		createDraft: { name: '', description: '', instructions: '', role: 'author' },
	};

	// Arriving from an agent avatar in the chat window: preselect that
	// agent. Consumed HERE rather than in the router because this
	// renderer runs synchronously inside `navigate()` — the target is
	// guaranteed to still be set, and clearing it here means a later
	// plain open of the section lands wherever the user left it.
	const pendingEditor = readAgentEditorTarget();
	if ( pendingEditor.agentId && pendingEditor.agentId > 0 ) {
		state.selectedId = pendingEditor.agentId;
		clearAgentEditorTarget();
	}

	let disposed = false;
	const mountId = ++agentsMountSeq;
	const rowDropDeregisters: Map< number, () => void > = new Map();
	host.addTeardown( () => {
		disposed = true;
		for ( const deregister of rowDropDeregisters.values() ) {
			deregister();
		}
		rowDropDeregisters.clear();
	} );

	/**
	 * (Re)register every agent row as a drop target, and prune targets
	 * whose agent left the list. Runs after every paint — re-registering
	 * the same id replaces the element binding in place, so repaints
	 * never leak targets.
	 */
	const syncRowDropTargets = (): void => {
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		const seen = new Set< number >();
		root
			.querySelectorAll< HTMLElement >( '.dm-agents__row[data-agent-id]' )
			.forEach( ( row ) => {
				const agentId = Number.parseInt( row.dataset.agentId ?? '', 10 );
				const agent = state.agents.find( ( a ) => a.id === agentId );
				if ( ! agent ) {
					return;
				}
				seen.add( agentId );
				// Drag-out: lifting a row drops the agent anywhere the
				// files layer accepts a `'user'` shortcut — the desktop
				// creates the same tile the Users grid drag produces.
				// Guarded per element: the row may survive a repaint,
				// and a second listener would double-start the drag.
				if ( ! row.dataset.dmAgentDragOut ) {
					row.dataset.dmAgentDragOut = '1';
					attachTileDragOut( row, {
						kind: 'user',
						ref: String( agentId ),
						title: agent.name,
						icon: 'dashicons-admin-users',
						entityId: 'agents',
					} );
				}
				rowDropDeregisters.set(
					agentId,
					dragManager.registerDropTarget( {
						id: `dm-agents-row-${ mountId }-${ agentId }`,
						element: row,
						accept: ( payload ) =>
							agentAcceptsDrop(
								dragKindsFromTriggers( agent.triggers ),
								describeDragEntity( payload ),
								agent.id,
							),
						acceptLabel: __( 'Send to agent', 'desktop-mode' ),
						onDrop: ( session ) => {
							const entity = describeDragEntity( session.payload );
							if ( ! entity ) {
								return;
							}
							void dispatchAgentDrop(
								{
									id: agent.id,
									name: agent.name,
									description: agent.description,
									avatarUrl: agent.avatarUrl,
								},
								entity,
								{
									restRoot: getConfig().restRoot,
									restNonce: getConfig().restNonce,
								},
							);
						},
					} ),
				);
			} );
		for ( const [ agentId, deregister ] of rowDropDeregisters ) {
			if ( ! seen.has( agentId ) ) {
				deregister();
				rowDropDeregisters.delete( agentId );
			}
		}
	};

	const selected = (): Agent | null =>
		state.agents.find( ( a ) => a.id === state.selectedId ) ?? null;

	const select = ( id: number | null ): void => {
		state.selectedId = id;
		state.creating = false;
		state.pane = 'define';
		state.notice = '';
		state.draft = draftFromAgent( selected() );
		paint();
	};

	const load = async (): Promise< void > => {
		state.loading = true;
		state.error = '';
		paint();
		try {
			state.agents = await listAgents();
			if ( state.selectedId === null && state.agents.length > 0 ) {
				state.selectedId = state.agents[ 0 ].id;
			}
			if ( ! state.agents.some( ( a ) => a.id === state.selectedId ) ) {
				state.selectedId = state.agents[ 0 ]?.id ?? null;
			}
			state.draft = draftFromAgent( selected() );
		} catch ( err ) {
			state.error = err instanceof Error ? err.message : String( err );
		}
		state.loading = false;
		if ( ! disposed ) {
			paint();
		}
	};

	const probeAi = async (): Promise< void > => {
		if ( ! cfg.aiAvailable || ! cfg.aiStatusUrl ) {
			return;
		}
		const status = await fetchAiStatus( cfg.aiStatusUrl );
		state.aiReady = status !== null && status.providerConfigured;
		if ( ! disposed ) {
			paint();
		}
	};

	const ensureCatalogues = async (): Promise< void > => {
		try {
			if ( state.abilities === null ) {
				state.abilities = await fetchAbilitiesCatalogue();
			}
			if ( state.triggerKinds === null ) {
				state.triggerKinds = await fetchTriggerKinds();
			}
			if ( state.hooks === null ) {
				state.hooks = await fetchHooksCatalogue();
			}
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		if ( ! disposed ) {
			paint();
		}
	};

	const ensureRoles = async (): Promise< void > => {
		if ( state.roles !== null || ! cfg.canManage ) {
			return;
		}
		try {
			state.roles = await fetchRoles();
			if (
				state.roles.length > 0 &&
				! state.roles.some( ( r ) => r.slug === state.createDraft.role )
			) {
				state.createDraft.role = state.roles[ 0 ].slug;
			}
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		if ( ! disposed ) {
			paint();
		}
	};

	const applyPatch = async (
		id: number,
		patch: Parameters< typeof updateAgent >[ 1 ],
		successNotice: string,
	): Promise< void > => {
		state.saving = true;
		state.notice = '';
		paint();
		try {
			const updated = await updateAgent( id, patch );
			refreshSendToAgents();
			state.agents = state.agents.map( ( a ) =>
				a.id === updated.id ? updated : a,
			);
			state.draft = draftFromAgent( selected() );
			state.notice = successNotice;
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		state.saving = false;
		if ( ! disposed ) {
			paint();
		}
	};

	const onCreate = async (): Promise< void > => {
		if ( state.createDraft.name.trim() === '' ) {
			state.notice = __( 'Agent name is required.', 'desktop-mode' );
			paint();
			return;
		}
		state.saving = true;
		state.notice = '';
		paint();
		try {
			const created = await createAgent( {
				name: state.createDraft.name.trim(),
				role: state.createDraft.role,
				description: state.createDraft.description,
				instructions: state.createDraft.instructions,
			} );
			refreshSendToAgents();
			state.agents = [ ...state.agents, created ].sort( ( a, b ) =>
				a.name.localeCompare( b.name ),
			);
			state.createDraft = { name: '', description: '', instructions: '', role: state.createDraft.role };
			state.creating = false;
			state.selectedId = created.id;
			state.draft = draftFromAgent( created );
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		state.saving = false;
		if ( ! disposed ) {
			paint();
		}
	};

	const onDelete = async ( agent: Agent ): Promise< void > => {
		const ok = await osConfirm( {
			title: __( 'Delete agent?', 'desktop-mode' ),
			message: __(
				'The agent user is deleted permanently. Content it authored is not reassigned.',
				'desktop-mode',
			),
			confirmLabel: __( 'Delete', 'desktop-mode' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		state.saving = true;
		paint();
		try {
			await deleteAgent( agent.id );
			refreshSendToAgents();
			state.agents = state.agents.filter( ( a ) => a.id !== agent.id );
			state.selectedId = state.agents[ 0 ]?.id ?? null;
			state.draft = draftFromAgent( selected() );
			state.notice = '';
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		state.saving = false;
		if ( ! disposed ) {
			paint();
		}
	};

	const toggleAbility = ( agent: Agent, slug: string, on: boolean ): void => {
		const abilities = on
			? Array.from( new Set( [ ...agent.abilities, slug ] ) )
			: agent.abilities.filter( ( s ) => s !== slug );
		void applyPatch(
			agent.id,
			{ abilities },
			__( 'Abilities saved.', 'desktop-mode' ),
		);
	};

	const setTriggers = ( agent: Agent, triggers: Trigger[] ): void => {
		void applyPatch(
			agent.id,
			{ triggers },
			__( 'Triggers saved.', 'desktop-mode' ),
		);
	};

	// -----------------------------------------------------------------
	// Templates
	// -----------------------------------------------------------------

	const aiNotice = () => {
		if ( state.aiReady === true || state.aiReady === null ) {
			return html``;
		}
		const noProvider = __(
			'No AI provider is configured — agents cannot run until a connector is set up.',
			'desktop-mode',
		);
		const noClient = __(
			'This WordPress does not ship the AI Client (WordPress 7.0+). Agents can be defined but not run.',
			'desktop-mode',
		);
		const connectorsLink = html`
			<a href=${ cfg.connectorsUrl } target="_blank" rel="noreferrer">
				${ __( 'Open Connectors settings', 'desktop-mode' ) }
			</a>
		`;
		return html`
			<os-notice tone="warning" class="dm-agents__ai-notice">
				${ cfg.aiAvailable ? html`${ noProvider } ${ connectorsLink }` : noClient }
			</os-notice>
		`;
	};

	// "Create agent" lives ABOVE the list, not after the last row: at
	// the bottom of a scrolling column it drifts off-screen exactly on
	// the sites that have enough agents to need it.
	const listPane = () => html`
		<div class="dm-agents__sidebar">
			${ cfg.canManage
				? html`
						<div class="dm-agents__list-toolbar">
							<os-button
								class="dm-agents__create"
								variant="primary"
								?disabled=${ state.saving }
								@click=${ () => {
									state.creating = true;
									state.notice = '';
									void ensureRoles();
									paint();
								} }
							>
								${ __( '+ Create agent', 'desktop-mode' ) }
							</os-button>
						</div>
				  `
				: html`` }
			<div class="dm-agents__list" role="listbox" aria-label=${ __( 'Agents', 'desktop-mode' ) }>
			${ state.agents.map(
				( agent ) => html`
					<div
						class="dm-agents__row ${ agent.id === state.selectedId && ! state.creating
							? 'is-selected'
							: '' }"
						role="option"
						tabindex="0"
						data-agent-id=${ String( agent.id ) }
						aria-selected=${ agent.id === state.selectedId ? 'true' : 'false' }
						@click=${ () => select( agent.id ) }
						@keydown=${ ( e: KeyboardEvent ) => {
							if ( e.key === 'Enter' || e.key === ' ' ) {
								e.preventDefault();
								select( agent.id );
							}
						} }
					>
						<img class="dm-agents__row-avatar" src=${ agent.avatarUrl } alt="" />
						<span class="dm-agents__row-text">
							<span class="dm-agents__row-name">${ agent.name }</span>
							<span class="dm-agents__row-desc">
								${ agent.description || __( 'No description yet.', 'desktop-mode' ) }
							</span>
						</span>
						<os-badge>${ agent.role }</os-badge>
					</div>
				`,
			) }
			</div>
		</div>
	`;

	const paneTabs = ( agent: Agent ) => html`
		<div class="dm-agents__tabs" role="tablist">
			${ ( [
				[ 'define', __( 'Define', 'desktop-mode' ) ],
				[ 'tools', __( 'Tools', 'desktop-mode' ) ],
				[ 'triggers', __( 'Triggers', 'desktop-mode' ) ],
			] as Array< [ Pane, string ] > ).map(
				( [ pane, label ] ) => html`
					<button
						type="button"
						role="tab"
						class="dm-agents__tab ${ state.pane === pane ? 'is-active' : '' }"
						aria-selected=${ state.pane === pane ? 'true' : 'false' }
						@click=${ () => {
							state.pane = pane;
							state.notice = '';
							if ( pane !== 'define' ) {
								void ensureCatalogues();
							} else {
								state.draft = draftFromAgent( agent );
							}
							paint();
						} }
					>
						${ label }
					</button>
				`,
			) }
		</div>
	`;

	const definePane = ( agent: Agent ) => {
		const readOnly = ! cfg.canManage;
		const dirty =
			state.draft.name !== agent.name ||
			state.draft.description !== agent.description ||
			state.draft.instructions !== agent.instructions ||
			state.draft.role !== agent.role;
		return html`
			<div class="dm-agents__pane">
				<os-text-field
					label=${ __( 'Name', 'desktop-mode' ) }
					value=${ state.draft.name }
					?readonly=${ readOnly }
					@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
						state.draft.name = e.detail.value;
						paint();
					} }
				></os-text-field>
				<os-text-field
					label=${ __( 'When to use (description)', 'desktop-mode' ) }
					value=${ state.draft.description }
					?readonly=${ readOnly }
					@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
						state.draft.description = e.detail.value;
						paint();
					} }
				></os-text-field>
				<os-textarea
					label=${ __( 'Instructions (system prompt)', 'desktop-mode' ) }
					value=${ state.draft.instructions }
					rows="10"
					?readonly=${ readOnly }
					@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
						state.draft.instructions = e.detail.value;
						paint();
					} }
				></os-textarea>
				${ readOnly
					? html`<p class="dm-agents__hint">
							${ __( 'Role', 'desktop-mode' ) }: ${ agent.role }
					  </p>`
					: html`
							${ state.roles
								? html`
										<os-select
											label=${ __( 'Role', 'desktop-mode' ) }
											value=${ state.draft.role }
											@os-pick=${ ( e: CustomEvent< { value: string } > ) => {
												state.draft.role =
													e.detail?.value ?? state.draft.role;
												paint();
											} }
										>
											${ roleOptions( state.roles, state.draft.role ) }
										</os-select>
								  `
								: html`
										<os-select
											label=${ __( 'Role', 'desktop-mode' ) }
											value=${ state.draft.role }
											disabled
										>
											<os-option value=${ state.draft.role }>
												${ state.draft.role }
											</os-option>
										</os-select>
								  ` }
							<p class="dm-agents__hint">
								${ __(
									'The agent acts with this role\'s capabilities — pick the least privilege that still lets it do its job.',
									'desktop-mode',
								) }
							</p>
							<os-button
								?disabled=${ state.saving || ! dirty }
								@click=${ () =>
									void applyPatch(
										agent.id,
										{
											name: state.draft.name,
											description: state.draft.description,
											instructions: state.draft.instructions,
											role: state.draft.role,
										},
										__( 'Agent saved.', 'desktop-mode' ),
									) }
							>
								${ __( 'Save', 'desktop-mode' ) }
							</os-button>
					  ` }
			</div>
		`;
	};

	const toolsPane = ( agent: Agent ) => {
		if ( state.abilities === null ) {
			return html`<div class="dm-agents__pane dm-agents__pane--loading">
				<os-spinner></os-spinner>
			</div>`;
		}
		const byCategory = new Map< string, Ability[] >();
		for ( const ability of state.abilities ) {
			const key = ability.category || __( 'Other', 'desktop-mode' );
			const bucket = byCategory.get( key ) ?? [];
			bucket.push( ability );
			byCategory.set( key, bucket );
		}
		return html`
			<div class="dm-agents__pane">
				<p class="dm-agents__hint">
					${ __(
						'The agent may only call abilities ticked here — and every call is still gated by the ability\'s own permission check against the agent\'s role.',
						'desktop-mode',
					) }
				</p>
				${ Array.from( byCategory.entries() ).map(
					( [ category, abilities ] ) => html`
						<h4 class="dm-agents__category">${ category }</h4>
						${ abilities.map(
							( ability ) => html`
								<div class="dm-agents__ability">
									<os-checkbox-label
										label=${ ability.label }
										?checked=${ agent.abilities.includes( ability.slug ) }
										?disabled=${ ! cfg.canManage || state.saving }
										@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
											toggleAbility(
												agent,
												ability.slug,
												e.detail?.checked === true,
											) }
									></os-checkbox-label>
									<os-badge tone=${ ability.readonly ? 'neutral' : 'warning' }>
										${ ability.readonly
											? __( 'read-only', 'desktop-mode' )
											: __( 'can modify', 'desktop-mode' ) }
									</os-badge>
									<p class="dm-agents__ability-desc">${ ability.description }</p>
								</div>
							`,
						) }
					`,
				) }
			</div>
		`;
	};

	const triggerSummary = ( trigger: Trigger ): string => {
		const kinds = ( trigger.config.entityKinds as string[] | undefined ) ?? [];
		if ( trigger.kind === 'hook' ) {
			return String( trigger.config.hook ?? '' );
		}
		if ( kinds.length > 0 ) {
			return kinds.join( ', ' );
		}
		return '';
	};

	const triggerEditor = ( agent: Agent, trigger: Trigger, index: number ) => {
		const patchConfig = ( config: Record< string, unknown > ): void => {
			const next = agent.triggers.map( ( t, i ) =>
				i === index ? { ...t, config: { ...t.config, ...config } } : t,
			);
			setTriggers( agent, next );
		};
		if ( trigger.kind === 'send-to' || trigger.kind === 'drag' ) {
			const active = ( trigger.config.entityKinds as string[] | undefined ) ?? [];
			return html`
				<div class="dm-agents__trigger-config">
					${ ENTITY_KIND_CHOICES.map(
						( kind ) => html`
							<os-checkbox-label
								label=${ kind }
								?checked=${ active.includes( kind ) }
								?disabled=${ ! cfg.canManage || state.saving }
								@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) => {
									const on = e.detail?.checked === true;
									const next = on
										? Array.from( new Set( [ ...active, kind ] ) )
										: active.filter( ( k ) => k !== kind );
									patchConfig( { entityKinds: next } );
								} }
							></os-checkbox-label>
						`,
					) }
				</div>
			`;
		}
		if ( trigger.kind === 'hook' ) {
			return html`
				<div class="dm-agents__trigger-config">
					<os-text-field
						label=${ __( 'Hook name', 'desktop-mode' ) }
						value=${ String( trigger.config.hook ?? '' ) }
						?readonly=${ ! cfg.canManage }
						@os-input-commit=${ ( e: CustomEvent< { value: string } > ) =>
							patchConfig( { hook: e.detail.value } ) }
					></os-text-field>
					${ state.hooks && state.hooks.length > 0
						? html`<p class="dm-agents__hint">
								${ __( 'Suggestions', 'desktop-mode' ) }:
								${ state.hooks.map( ( h ) => h.hook ).join( ', ' ) }
						  </p>`
						: html`` }
				</div>
			`;
		}
		if ( trigger.kind === 'endpoint' ) {
			return html`
				<div class="dm-agents__trigger-config">
					<os-text-field
						label=${ __( 'Required capability', 'desktop-mode' ) }
						value=${ String( trigger.config.capability ?? '' ) }
						?readonly=${ ! cfg.canManage }
						@os-input-commit=${ ( e: CustomEvent< { value: string } > ) =>
							patchConfig( { capability: e.detail.value } ) }
					></os-text-field>
				</div>
			`;
		}
		return html``;
	};

	const triggersPane = ( agent: Agent ) => {
		if ( state.triggerKinds === null ) {
			return html`<div class="dm-agents__pane dm-agents__pane--loading">
				<os-spinner></os-spinner>
			</div>`;
		}
		const kindLabel = ( slug: string ): string =>
			state.triggerKinds?.find( ( k ) => k.slug === slug )?.label ?? slug;
		const unusedKinds = state.triggerKinds.filter(
			( kind ) => ! agent.triggers.some( ( t ) => t.kind === kind.slug ),
		);
		return html`
			<div class="dm-agents__pane">
				<p class="dm-agents__hint">
					${ __(
						'Triggers describe how this site reaches the agent. Chat, drag & drop, and Send to work today; kinds marked "coming soon" can be configured but are not wired yet.',
						'desktop-mode',
					) }
				</p>
				${ agent.triggers.length === 0
					? html`<p class="dm-agents__hint">
							${ __( 'No triggers configured yet.', 'desktop-mode' ) }
					  </p>`
					: html`` }
				${ agent.triggers.map(
					( trigger, index ) => html`
						<div class="dm-agents__trigger">
							<div class="dm-agents__trigger-head">
								<strong>${ kindLabel( trigger.kind ) }</strong>
								<span class="dm-agents__trigger-summary">
									${ triggerSummary( trigger ) }
								</span>
								${ cfg.canManage
									? html`
											<os-button
												?disabled=${ state.saving }
												@click=${ () =>
													setTriggers(
														agent,
														agent.triggers.filter( ( _, i ) => i !== index ),
													) }
											>
												${ __( 'Remove', 'desktop-mode' ) }
											</os-button>
									  `
									: html`` }
							</div>
							${ triggerEditor( agent, trigger, index ) }
						</div>
					`,
				) }
				${ cfg.canManage && unusedKinds.length > 0
					? html`
							<os-select
								label=${ __( 'Add trigger', 'desktop-mode' ) }
								value=""
								@os-pick=${ ( e: CustomEvent< { value: string } > ) => {
									const slug = e.detail?.value;
									const kind = state.triggerKinds?.find(
										( k ) => k.slug === slug,
									);
									// Unwired kinds are disabled in the list;
									// the guard covers keyboard/native paths.
									if ( ! slug || kind?.wired === false ) {
										return;
									}
									setTriggers( agent, [
										...agent.triggers,
										{ kind: slug, config: {} },
									] );
								} }
							>
								<os-option value="">
									${ __( 'Pick a trigger kind…', 'desktop-mode' ) }
								</os-option>
								${ unusedKinds.map( ( kind ) =>
									kind.wired === false
										? html`
												<os-option value=${ kind.slug } disabled>
													${ kind.label }
													${ __( '(coming soon)', 'desktop-mode' ) }
												</os-option>
										  `
										: html`
												<os-option value=${ kind.slug }>
													${ kind.label }
												</os-option>
										  `,
								) }
							</os-select>
					  `
					: html`` }
			</div>
		`;
	};

	const createPane = () => html`
		<div class="dm-agents__pane dm-agents__pane--create">
			<h3>${ __( 'Create agent', 'desktop-mode' ) }</h3>
			<os-text-field
				label=${ __( 'Name', 'desktop-mode' ) }
				value=${ state.createDraft.name }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					state.createDraft.name = e.detail.value;
				} }
			></os-text-field>
			${ state.roles
				? html`
						<os-select
							label=${ __( 'Role', 'desktop-mode' ) }
							value=${ state.createDraft.role }
							@os-pick=${ ( e: CustomEvent< { value: string } > ) => {
								state.createDraft.role = e.detail?.value ?? state.createDraft.role;
							} }
						>
							${ roleOptions( state.roles, state.createDraft.role ) }
						</os-select>
				  `
				: html`<os-spinner></os-spinner>` }
			<os-text-field
				label=${ __( 'When to use (description)', 'desktop-mode' ) }
				value=${ state.createDraft.description }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					state.createDraft.description = e.detail.value;
				} }
			></os-text-field>
			<os-textarea
				label=${ __( 'Instructions (system prompt)', 'desktop-mode' ) }
				value=${ state.createDraft.instructions }
				rows="8"
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					state.createDraft.instructions = e.detail.value;
				} }
			></os-textarea>
			<div class="dm-agents__actions">
				<os-button ?disabled=${ state.saving } @click=${ () => void onCreate() }>
					${ __( 'Create', 'desktop-mode' ) }
				</os-button>
				<os-button
					?disabled=${ state.saving }
					@click=${ () => {
						state.creating = false;
						state.notice = '';
						paint();
					} }
				>
					${ __( 'Cancel', 'desktop-mode' ) }
				</os-button>
			</div>
		</div>
	`;

	const detailPane = () => {
		if ( state.creating ) {
			return createPane();
		}
		const agent = selected();
		if ( ! agent ) {
			let emptyDescription = __(
				'An administrator has not created any agents on this site yet.',
				'desktop-mode',
			);
			if ( cfg.canManage ) {
				emptyDescription = __(
					'Create your first agent: give it a name, a role, and instructions, then pick the abilities it may use.',
					'desktop-mode',
				);
			}
			return html`
				<os-empty-state
					icon="superhero"
					heading=${ __( 'No agents yet', 'desktop-mode' ) }
					description=${ emptyDescription }
				></os-empty-state>
			`;
		}
		return html`
			<div class="dm-agents__detail-head">
				<img class="dm-agents__detail-avatar" src=${ agent.avatarUrl } alt="" />
				<div class="dm-agents__detail-title">
					<h3>${ agent.name }</h3>
					<span class="dm-agents__detail-slug">@agent-${ agent.slug }</span>
				</div>
			</div>
			<div class="dm-agents__detail-actions">
				<os-button @click=${ () => openAgentProfile( agent ) }>
					${ __( 'Open profile', 'desktop-mode' ) }
				</os-button>
				${ hasUsersEntity()
					? html`
							<os-button
								@click=${ () =>
									host.navigate( {
										kind: 'user-footprint',
										entityId: 'users',
										userId: agent.id,
										userName: agent.name,
									} ) }
							>
								${ __( 'View contributions', 'desktop-mode' ) }
							</os-button>
					  `
					: html`` }
				${ cfg.canManage
					? html`
							<os-button
								?disabled=${ state.saving }
								@click=${ () =>
									void sendAgentToDesktop( agent ).then(
										( notice ) => {
											state.notice = notice;
											paint();
										},
									) }
							>
								${ __( 'Send to Desktop', 'desktop-mode' ) }
							</os-button>
					  `
					: html`` }
				${ cfg.canInvoke
					? html`
							<os-button
								variant="primary"
								?disabled=${ state.aiReady === false }
								@click=${ () => openChatWindow( agent ) }
							>
								${ __( 'Chat', 'desktop-mode' ) }
							</os-button>
					  `
					: html`` }
				${ cfg.canManage
					? html`
							<os-button
								?disabled=${ state.saving }
								@click=${ () => void onDelete( agent ) }
							>
								${ __( 'Delete', 'desktop-mode' ) }
							</os-button>
					  `
					: html`` }
			</div>
			${ paneTabs( agent ) }
			${ state.pane === 'define' ? definePane( agent ) : html`` }
			${ state.pane === 'tools' ? toolsPane( agent ) : html`` }
			${ state.pane === 'triggers' ? triggersPane( agent ) : html`` }
		`;
	};

	const paint = (): void => {
		if ( disposed ) {
			return;
		}
		if ( state.loading ) {
			render(
				html`<div class="dm-agents__loading"><os-spinner></os-spinner></div>`,
				root,
			);
			syncRowDropTargets();
			return;
		}
		if ( state.error ) {
			render(
				html`<os-notice tone="error">${ state.error }</os-notice>`,
				root,
			);
			syncRowDropTargets();
			return;
		}
		render(
			html`
				${ aiNotice() }
				${ state.notice
					? html`<os-notice class="dm-agents__notice">${ state.notice }</os-notice>`
					: html`` }
				<div class="dm-agents__layout">
					${ listPane() }
					<div class="dm-agents__detail">${ detailPane() }</div>
				</div>
			`,
			root,
		);
		syncRowDropTargets();
	};

	paint();
	void load();
	void probeAi();
	// The Define pane's role picker needs the catalogue as soon as an
	// agent is selected, which happens the moment the list resolves —
	// fetch alongside the list rather than on the first click.
	void ensureRoles();
}

registerEntityKind( 'agent', renderAgents );
