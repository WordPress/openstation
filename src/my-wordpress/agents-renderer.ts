/**
 * WP Explorer — Agents entity-kind renderer.
 *
 * Over `/desktop-mode/v1/agents`: the cast grid as the landing view;
 * a detail view with Define / Tools / Triggers panes; a four-step
 * create flow; and a chat opener that seeds the cross-bundle chat
 * store and opens the Agent chat window.
 *
 * All state is local to the mount — the host owns routing, this
 * renderer only paints inside `host.body` for the
 * `{ kind: 'list', entityId: 'agents' }` route.
 *
 * @public
 */

import { __, _n, sprintf } from '../i18n';
import { html, render } from '../ui/core';
import { addAction, HOOKS, removeAction } from '../hooks';
import {
	renderStatusBarSegments,
	type StatusBarSegment,
} from '../desktop-files/folder-status-bar';
import { registerEntityKind } from './kind-registry';
import {
	FACE_CANDIDATES,
	faceCandidates,
	faceFromSeed,
	faceHueName,
	faceShapeName,
	faceSrc,
	hasFace,
} from './agents-face';
import type { EntityRenderHost } from './kind-registry';
import { buildEditUserUrl, getConfig } from './rest';
import type { MyWordPressConfig } from './types';
import {
	createAgent,
	deleteAgent,
	draftAgent,
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
	AgentDraft,
	AgentsSectionConfig,
	HookSuggestion,
	MioLook,
	PreviewAgent,
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
import '../ui/components/os-card/os-card';
import '../ui/components/os-chip/os-chip';
import '../ui/components/os-segmented/os-segmented';
import '../ui/components/os-steps/os-steps';
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
	/**
	 * Inline errors, each shown under the field it is about rather
	 * than in the notice at the top, which is for things no field
	 * owns.
	 */
	briefError: string;
	nameError: string;
	/** Free-text filter over the ability catalogue. */
	abilityQuery: string;
	/**
	 * Ability groups the user has explicitly opened or closed. Absent
	 * means "however {@link ABILITY_COLLAPSE_THRESHOLD} says to start".
	 */
	abilityOpen: Map< string, boolean >;
	/** Lazy catalogues — null until first fetched. */
	abilities: Ability[] | null;
	triggerKinds: TriggerKindDescriptor[] | null;
	hooks: HookSuggestion[] | null;
	roles: RoleChoice[] | null;
	/** Null while the provider probe is in flight. */
	aiReady: boolean | null;
	/** Draft edits for the Define pane, keyed by field. */
	draft: { name: string; description: string; instructions: string; role: string };
	/**
	 * Role a fresh wizard starts on. Held here rather than read off
	 * the last cast so the roles catalogue, which lands after the
	 * first paint, has somewhere to correct the default to.
	 */
	defaultRole: string;
	/** Where the flow is. See {@link WizardStep}. */
	step: WizardStep;
	/** The agent being cast. */
	cast: CastDraft;
}

/**
 * Where the create flow is: Describe, Meet, Powers, Summon, Launch.
 *
 * Summon is how the site calls the agent. It is its own station
 * because that is a different question from what the agent may touch,
 * and Powers was carrying both.
 */
type WizardStep = 0 | 1 | 2 | 3 | 4;

/** The review step, where Summon continues to. */
const STEP_LAUNCH: WizardStep = 4;

/**
 * The agent taking shape in the wizard.
 *
 * One draft, because there is now one way in. It carries its own face
 * so the picker has something to page through, and its own triggers so
 * Summon can wire the agent up before it exists rather than sending
 * people back into the detail view afterwards.
 */
interface CastDraft {
	/** The plain-language ask typed into Describe. */
	brief: string;
	name: string;
	description: string;
	vibes: string;
	instructions: string;
	role: string;
	abilities: string[];
	triggers: Trigger[];
	/** Which agent this was copied from, if any. */
	copiedFrom: string;
	faceSeed: number;
	face: MioLook;
	/** First seed of the strip the picker is showing. */
	stripSeed: number;
	/** True while the AI draft request is in flight. */
	drafting: boolean;
}

/** A blank agent, with a face already rolled so Meet has something. */
function emptyCast( role: string, seed: number ): CastDraft {
	return {
		brief: '',
		name: '',
		description: '',
		vibes: '',
		instructions: '',
		role,
		abilities: [],
		// Chat is always on; the row says so from the first paint.
		triggers: [ { kind: 'chat', config: {} } ],
		copiedFrom: '',
		faceSeed: seed,
		face: faceFromSeed( seed ),
		stripSeed: seed,
		drafting: false,
	};
}

const ENTITY_KIND_CHOICES = [ 'post', 'page', 'media', 'user', 'comment' ];

/**
 * How many abilities a site needs before the groups start closed.
 *
 * Collapsing is for the site with a shelf of plugins, each registering
 * its own dozen: the list that takes a scrollbar and a minute to
 * read. A stock install has a handful, and starting those closed would
 * hide the whole feature behind a click to solve a problem that site
 * does not have. So the default is "open", and the catalogue itself
 * says when that stops being true.
 */
const ABILITY_COLLAPSE_THRESHOLD = 12;

/**
 * A starting point for a new face.
 *
 * Random here and deterministic from there on: the seed is picked once
 * when a wizard opens and then carried, so paging the strip and coming
 * back lands on the same faces rather than a fresh throw each time.
 */
function newSeed(): number {
	return Math.floor( Math.random() * 0xffffff ) + 1;
}

/**
 * The image source for an agent's portrait.
 *
 * Prefers what the server wrote, because that file is the one thing
 * `get_avatar()` can also point at, so preferring it keeps the grid and
 * the rest of wp-admin showing the same picture.
 *
 * Falls back to rolling the seed here. That covers the window before
 * {@link backfillFaces} has stored a look, a reader who may not trigger
 * that write at all, and multisite, where the look lives on a
 * network-wide user but the file was written into one site's uploads.
 * In every one of those the seed is present and the roll is
 * deterministic, so the face is the same one the write would produce.
 */
function agentFaceSrc(
	agent: Pick< Agent, 'face' | 'faceSeed' | 'avatarUrl' >,
	size: number,
): string {
	if ( hasFace( agent.face ) && agent.avatarUrl !== '' ) {
		return agent.avatarUrl;
	}
	if ( agent.faceSeed > 0 ) {
		return faceSrc( faceFromSeed( agent.faceSeed ), size );
	}
	return agent.avatarUrl;
}

/** Per-mount sequence so multi-instance windows get unique target ids. */
let agentsMountSeq = 0;

function agentsConfig(): AgentsSectionConfig {
	const cfg = getConfig() as MyWordPressConfig & {
		agents?: AgentsSectionConfig;
	};
	return (
		cfg.agents ?? {
			enabled: false,
			canEnable: false,
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
 * Open OpenStation Preferences on the Features tab, where the `agents`
 * extended option lives. Resolved off `wp.os` at call time — the
 * shell bundle owns the opener and this bundle must not import it.
 */
function openAgentsFeatureSetting(): void {
	const api = ( window as unknown as {
		wp?: { os?: { openOsSettings?: ( opts?: { tabId?: string } ) => void } };
	} ).wp?.os;
	api?.openOsSettings?.( { tabId: 'features' } );
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
	deriveWindowId?: ( url: string ) => string;
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
 * Open the Connectors settings screen as a desktop window.
 *
 * The notice used to carry a plain `target="_blank"` link, which is
 * wrong twice over. In a browser tab it threw the settings screen out
 * of the shell; and once OpenStation is installed as a PWA, a `_blank`
 * navigation to a same-origin admin URL is in the app's scope, so the
 * click LAUNCHED THE INSTALLED APP. The WooCommerce integration hit the
 * same thing and routes its admin links the same way.
 *
 * `wp.os.deriveWindowId` is the shell's own slug derivation, the one
 * the dock uses, so the screen lands on the window the dock would open
 * rather than a private duplicate. The `window.open` fallback is a
 * genuine last resort: with the shell missing there is nowhere else to
 * put a window.
 */
function openConnectorsWindow( url: string ): void {
	const desktop = openStation();
	if ( ! desktop?.windowManager?.open ) {
		window.open( url, '_blank', 'noopener,noreferrer' );
		return;
	}
	const id =
		typeof desktop.deriveWindowId === 'function'
			? desktop.deriveWindowId( url )
			: 'options-connectors';
	desktop.windowManager.open( {
		id,
		url,
		title: __( 'Connectors', 'desktop-mode' ),
		icon: 'dashicons-admin-settings',
	} );
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
	// The framework is opt-in, but the section is always listed. With
	// the option off the whole surface paints disabled: nothing to
	// load, nothing to probe, and every control inert.
	const off = ! cfg.enabled;
	const root = document.createElement( 'div' );
	root.className = 'dm-agents' + ( off ? ' is-disabled' : '' );
	host.body.replaceChildren( root );

	const state: AgentsState = {
		agents: [],
		loading: ! off,
		error: '',
		selectedId: null,
		pane: 'define',
		creating: false,
		saving: false,
		notice: '',
		briefError: '',
		nameError: '',
		abilityQuery: '',
		abilityOpen: new Map(),
		abilities: null,
		triggerKinds: null,
		hooks: null,
		roles: null,
		aiReady: cfg.aiAvailable ? null : false,
		draft: draftFromAgent( null ),
		defaultRole: 'author',
		step: 0,
		cast: emptyCast( 'author', newSeed() ),
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

	// Agents can be switched off in Preferences while this very window
	// is open. When that happens the server unregisters the section's
	// REST routes, so a view that carried on as if nothing had changed
	// answered its next request with "No route was found matching the
	// URL and request method": a raw REST error where the off-state's
	// own explanation and its "Turn on Agents" button should be.
	//
	// Re-navigating to the route we are already on is the re-mount:
	// `navigate()` tears down and re-runs the renderer either way, and
	// the renderer reads the flag fresh, so the same call handles both
	// directions of the toggle.
	// The window's status bar, found the same way the media list finds
	// it. Until now this section never wrote to it, so it kept whatever
	// the view before it had left there: the root folder's own
	// "11 folders", still sitting under a screen with no folders on it.
	// A detached element when the chrome is absent (test harness),
	// which `renderStatusBarSegments` tolerates.
	const statusBar =
		host.body
			.closest( '[data-os-my-wordpress-root]' )
			?.querySelector< HTMLElement >( '[data-os-my-wordpress-status]' ) ??
		document.createElement( 'div' );

	const paintStatusBar = (): void => {
		const segments: StatusBarSegment[] = [];
		// The count is of the cast, whichever of the three views is on
		// screen: it is the section's size, not the view's, and a
		// number that vanished when you opened someone would read as
		// the crew having shrunk.
		if ( ! off && ! state.loading && state.error === '' ) {
			segments.push( {
				id: 'count',
				label: sprintf(
					/* translators: %d: number of agents on the site. */
					_n( '%d agent', '%d agents', state.agents.length, 'desktop-mode' ),
					state.agents.length,
				),
				align: 'start',
				sort: 10,
			} );
		}
		renderStatusBarSegments( statusBar, segments );
	};

	const optionsNamespace = `desktop-mode/agents/${ mountId }`;
	addAction(
		HOOKS.EXTENDED_OPTIONS_CHANGED,
		optionsNamespace,
		( payload ) => {
			const next = ( payload as { options?: Record< string, boolean > } )
				?.options;
			if ( ! next || typeof next.agents !== 'boolean' ) {
				return;
			}
			const live = agentsConfig();
			if ( live.enabled === next.agents ) {
				return;
			}
			live.enabled = next.agents;
			if ( ! disposed ) {
				host.navigate( host.route );
			}
		},
	);
	host.addTeardown( () => {
		removeAction( HOOKS.EXTENDED_OPTIONS_CHANGED, optionsNamespace );
	} );
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
			// The cards carry the id now that the sidebar rows are gone.
			// Both the drag-out source and the drop target are the tile
			// the agent's face is on, which is also the thing a person
			// would aim at.
			.querySelectorAll< HTMLElement >(
				'.dm-agents__cast-card[data-agent-id]',
			)
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
			// The cast is the landing view, so nothing auto-selects.
			// Opening straight into the first agent made sense beside a
			// permanent sidebar, where the list stayed on screen either
			// way; with the grid as the home screen it would mean the
			// crew is the one thing you never see.
			//
			// An id that arrived from elsewhere (the chat window's
			// avatar) still opens, and one that no longer exists falls
			// back to the grid rather than to somebody else's page.
			if ( ! state.agents.some( ( a ) => a.id === state.selectedId ) ) {
				state.selectedId = null;
			}
			state.draft = draftFromAgent( selected() );
		} catch ( err ) {
			state.error = err instanceof Error ? err.message : String( err );
		}
		state.loading = false;
		if ( ! disposed ) {
			paint();
		}
		void backfillFaces();
	};

	/**
	 * Give a face to every agent that has a seed but no look.
	 *
	 * An agent can reach the grid faceless two ways: it predates faces
	 * entirely, or it was made by something that never offered a
	 * picker (a plugin registering its own crew, or `wp user create`).
	 * Both cases still have a seed, because `openstation_agent_create()`
	 * derives one from the login when nobody supplies one, precisely so
	 * this roll is available later.
	 *
	 * Rolling it here rather than in PHP keeps one implementation of
	 * the randomizer. Storing the result rather than deriving it on
	 * every paint is what makes it stick: the write is what gets the
	 * portrait onto disk, which is the only way `get_avatar()` ever
	 * sees it: the Users list, the comment rows, the chat window.
	 *
	 * Needs write access, so a read-only user's grid stays on the
	 * derived face drawn client-side by {@link agentFaceSrc} and the
	 * first editor to open the section makes it permanent for everyone.
	 */
	const backfillFaces = async (): Promise< void > => {
		if ( ! cfg.canManage ) {
			return;
		}
		const faceless = state.agents.filter(
			( agent ) => ! hasFace( agent.face ) && agent.faceSeed > 0,
		);
		let wrote = false;
		for ( const agent of faceless ) {
			if ( disposed ) {
				return;
			}
			try {
				const updated = await updateAgent( agent.id, {
					face: faceFromSeed( agent.faceSeed ),
					faceSeed: agent.faceSeed,
				} );
				state.agents = state.agents.map( ( a ) =>
					a.id === updated.id ? updated : a,
				);
				wrote = true;
			} catch {
				// A backfill is a courtesy, not the point of the view.
				// One agent the server refuses to write must not take
				// the grid down with it: the rest still get faces, and
				// this one keeps the look drawn client-side.
			}
		}
		if ( wrote && ! disposed ) {
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
				! state.roles.some( ( r ) => r.slug === state.defaultRole )
			) {
				state.defaultRole = state.roles[ 0 ].slug;
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

	/**
	 * Silent while the framework is off: a connector is the SECOND
	 * thing to fix, and the empty state is already saying what the
	 * first one is. Two warnings and neither reads as the actionable
	 * one.
	 */
	const aiNotice = () => {
		if ( off || state.aiReady === true || state.aiReady === null ) {
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
		// The href stays real so middle-click, cmd-click and "copy link"
		// still behave; only the plain click is claimed for the shell.
		const connectorsLink = html`
			<a
				href=${ cfg.connectorsUrl }
				rel="noreferrer"
				@click=${ ( event: MouseEvent ) => {
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					) {
						return;
					}
					event.preventDefault();
					openConnectorsWindow( cfg.connectorsUrl );
				} }
			>
				${ __( 'Open Connectors settings', 'desktop-mode' ) }
			</a>
		`;
		return html`
			<os-notice tone="warning" class="dm-agents__ai-notice">
				${ cfg.aiAvailable ? html`${ noProvider } ${ connectorsLink }` : noClient }
			</os-notice>
		`;
	};

	/**
	 * The crew you would get, while the framework is off.
	 *
	 * The five shipped agents are seeded when the flag is flipped, so a
	 * site that has never turned Agents on genuinely has none, and this
	 * state used to be a paragraph explaining that. Faces make a better
	 * argument than a paragraph: these are the same cards the grid
	 * draws once the flag is on, greyed and inert above the button that
	 * flips it.
	 *
	 * Inert all the way down, not just visually. No `interactive`, no
	 * click handler, no `data-agent-id`: there is nothing to select,
	 * because none of these are users yet.
	 *
	 * Inert is not the same as hidden, though, and this strip is
	 * deliberately NOT `aria-hidden`. It is the argument this state
	 * makes: five names, five voices and five jobs. Hiding it would
	 * hand a screen reader the button and none of the reasons to press
	 * it, which is the paragraph-of-text state this replaced, only
	 * worse. It reads as the same list the real cast is, with the faces
	 * marked decorative — the name is right underneath each one.
	 *
	 * Faces are drawn client-side from the shipped look, the same way
	 * the wizard draws its candidates: nothing has been rendered to
	 * disk, because rendering happens on save and nothing has saved.
	 */
	const previewCast = () => {
		const cast: PreviewAgent[] = cfg.preview ?? [];
		if ( cast.length === 0 ) {
			return null;
		}
		return html`
			<div class="dm-agents__cast-head">
				<h3>${ __( 'The crew you would get', 'desktop-mode' ) }</h3>
				<span class="dm-agents__cast-count">${ cast.length }</span>
			</div>
			<div class="dm-agents__cast dm-agents__cast--preview" role="list">
				${ cast.map(
					( member ) => html`
						<os-card class="dm-agents__cast-card" role="listitem">
							<div class="dm-agents__cast-inner">
								<img
									class="dm-agents__cast-face"
									src=${ faceSrc( member.face, 88 ) }
									alt=""
									width="88"
									height="88"
								/>
								<span class="dm-agents__cast-name">
									${ member.name }
								</span>
								${ member.vibes
									? html`<span class="dm-agents__cast-vibes">
											${ member.vibes }
									  </span>`
									: html`` }
								<span class="dm-agents__cast-good">
									${ member.description }
								</span>
								<os-badge>${ member.roleLabel }</os-badge>
							</div>
						</os-card>
					`,
				) }
			</div>
		`;
	};

	// The door is the LAST card, as designed: a grid wraps, so it
	// stays in view with the cast around it and reads as the crew's
	// next empty slot, the way an app grid ends in an add tile. (The
	// old create button lived ABOVE its scrolling sidebar because a
	// column's last row drifts off-screen; that reasoning was about a
	// column, and does not carry to a grid.)
	/**
	 * The cast.
	 *
	 * This replaces a 260px sidebar of rows, and the reason is not
	 * that a grid is prettier. Five agents ship with the plugin, each
	 * with a real job and its own abilities, and as rows they read as
	 * a list of settings. As faces they read as a crew, which is what
	 * they are, and which is what makes a sixth one feel worth making.
	 */
	const castGrid = () => {
		// The off-state and the empty state belong to this view now:
		// it is what renders when no agent is open, which is exactly
		// when there is something to explain.
		if ( off ) {
			const offDescription = cfg.canEnable
				? __(
					'Turn the Agents framework on in OpenStation Preferences → Features to hire this crew, or cast your own.',
					'desktop-mode',
				)
				: __(
					'Ask an administrator to turn the Agents framework on in OpenStation Preferences → Features.',
					'desktop-mode',
				);
			const enableButton = cfg.canEnable
				? html`
						<os-button
							slot="cta"
							class="dm-agents__enable"
							variant="primary"
							@click=${ () => openAgentsFeatureSetting() }
						>
							${ __( 'Turn on Agents', 'desktop-mode' ) }
						</os-button>
				  `
				: html``;
			const cast = previewCast();
			// With a crew to show, the explanation shrinks to a bar and
			// the faces become the body of the state. The bar goes
			// ABOVE them, which is the one place this departs from the
			// mockup and it departs for a measured reason: five cards
			// are taller than the window, so a CTA underneath them
			// starts off-screen. "Dimming the way out is how a disabled
			// screen becomes a dead end" — scrolling it out of sight is
			// the same dead end by a different route. A one-line bar is
			// not the paragraph the cast was meant to replace, and the
			// crew is still the first thing worth looking at.
			//
			// With no crew — a payload from a PHP side that doesn't
			// send one — there is nothing to argue with and the full
			// empty state carries the message on its own.
			if ( cast === null ) {
				return html`
					<os-empty-state
						icon="superhero"
						heading=${ __( 'Agents are turned off', 'desktop-mode' ) }
						description=${ offDescription }
					>
						${ enableButton }
					</os-empty-state>
				`;
			}
			return html`
				<div class="dm-agents__off-head">
					<div class="dm-agents__off-copy">
						<h3>${ __( 'Agents are turned off', 'desktop-mode' ) }</h3>
						<p>${ offDescription }</p>
					</div>
					${ enableButton }
				</div>
				${ cast }
			`;
		}
		if ( state.agents.length === 0 ) {
			let emptyDescription = __(
				'An administrator has not created any agents on this site yet.',
				'desktop-mode',
			);
			if ( cfg.canManage ) {
				emptyDescription = __(
					'Cast your first agent: describe what it should do, give it a face and a voice, then pick the abilities it may use.',
					'desktop-mode',
				);
			}
			return html`
				<os-empty-state
					icon="superhero"
					heading=${ __( 'No agents yet', 'desktop-mode' ) }
					description=${ emptyDescription }
				>
					${ cfg.canManage
						? html`
								<os-button
									slot="cta"
									class="dm-agents__create"
									variant="primary"
									?disabled=${ state.saving }
									@click=${ () => startCreate() }
								>
									${ __( 'Cast an agent', 'desktop-mode' ) }
								</os-button>
						  `
						: html`` }
				</os-empty-state>
			`;
		}
		return html`
		<div class="dm-agents__cast-head">
			<h3>${ __( 'Your cast', 'desktop-mode' ) }</h3>
			<span class="dm-agents__cast-count">
				${ state.agents.length }
			</span>
		</div>
		<div class="dm-agents__cast" role="list">
			${ state.agents.map(
				( agent ) => html`
					<os-card
						class="dm-agents__cast-card"
						role="listitem"
						interactive
						data-agent-id=${ String( agent.id ) }
						?selected=${ agent.id === state.selectedId }
						@os-card-click=${ () => select( agent.id ) }
					>
						<div class="dm-agents__cast-inner">
							<img
								class="dm-agents__cast-face"
								src=${ agentFaceSrc( agent, 88 ) }
								alt=""
								width="88"
								height="88"
							/>
							<span class="dm-agents__cast-name">${ agent.name }</span>
							${ agent.vibes
								? html`<span class="dm-agents__cast-vibes">
										${ agent.vibes }
								  </span>`
								: html`` }
							<span class="dm-agents__cast-good">
								${ agent.description ||
								__( 'No description yet.', 'desktop-mode' ) }
							</span>
							<os-badge>${ roleLabel( agent.role ) }</os-badge>
						</div>
					</os-card>
				`,
			) }
			${ cfg.canManage
				? html`
						<os-card
							class="dm-agents__cast-new"
							role="listitem"
							interactive
							?disabled=${ state.saving || off }
							@os-card-click=${ () => startCreate() }
						>
							<div class="dm-agents__cast-inner">
								<span class="dm-agents__cast-plus" aria-hidden="true">+</span>
								<span class="dm-agents__cast-name">
									${ __( 'Cast a new agent', 'desktop-mode' ) }
								</span>
								<span class="dm-agents__cast-good">
									${ __(
										'Start from one of these, or from scratch.',
										'desktop-mode',
									) }
								</span>
							</div>
						</os-card>
				  `
				: html`` }
		</div>
	`;
	};

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

	/**
	 * The ability checklist: a filter, then collapsible groups.
	 *
	 * One implementation for both surfaces that show it, the Tools
	 * pane of an existing agent and the wizard's Powers step, because
	 * they were already the same list drawn twice, and a search box
	 * added to one of them would have been a difference nobody meant.
	 *
	 * Abilities are open-ended: every plugin on the site may register
	 * its own, so this is the one list in the section whose length is
	 * decided by somebody else. On a site with a few dozen it was a
	 * flat wall to scroll, with the group headings the only landmarks
	 * and no way to jump. Hence the filter, which searches the
	 * description and the slug as well as the label. Plugin authors
	 * name abilities for themselves, and "the one that reads custom
	 * fields" is easier to remember than whatever it is called.
	 *
	 * @param picked        What is ticked right now.
	 * @param toggle        Called with the slug and its new state.
	 * @param opts          Display options.
	 * @param opts.disabled Greys every checkbox: a read-only viewer,
	 *                      or a save in flight.
	 */
	const abilityChecklist = (
		picked: readonly string[],
		toggle: ( slug: string, on: boolean ) => void,
		opts: { disabled?: boolean } = {},
	) => {
		const all = state.abilities ?? [];
		const query = state.abilityQuery.trim().toLowerCase();
		const matches = ( ability: Ability ): boolean =>
			query === '' ||
			ability.label.toLowerCase().includes( query ) ||
			ability.description.toLowerCase().includes( query ) ||
			ability.slug.toLowerCase().includes( query );

		const groups = new Map< string, Ability[] >();
		for ( const ability of all.filter( matches ) ) {
			const key = ability.category || __( 'Other', 'desktop-mode' );
			groups.set( key, [ ...( groups.get( key ) ?? [] ), ability ] );
		}

		// A group opens by default when there is little to hide, or
		// when it holds something already ticked. A checked box
		// folded out of sight is how someone loses track of what they
		// granted.
		const long = all.length > ABILITY_COLLAPSE_THRESHOLD;
		const isOpen = ( category: string, list: Ability[] ): boolean => {
			// While filtering, everything that survived is shown: a
			// search that returns matches and then hides them behind a
			// closed group has answered the question and kept the
			// answer.
			if ( query !== '' ) {
				return true;
			}
			return (
				state.abilityOpen.get( category ) ??
				( ! long || list.some( ( a ) => picked.includes( a.slug ) ) )
			);
		};

		return html`
			${ long || query !== ''
				? html`
						<os-text-field
							class="dm-agents__ability-search"
							type="search"
							label=${ __( 'Search abilities', 'desktop-mode' ) }
							value=${ state.abilityQuery }
							placeholder=${ __( 'custom fields, orders, media…', 'desktop-mode' ) }
							@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
								state.abilityQuery = e.detail?.value ?? '';
								paint();
							} }
						></os-text-field>
				  `
				: html`` }
			${ groups.size === 0
				? html`<p class="dm-agents__hint">
						${ sprintf(
							/* translators: %s: the text typed into the ability filter. */
							__( 'No ability matches "%s".', 'desktop-mode' ),
							state.abilityQuery.trim(),
						) }
				  </p>`
				: html`` }
			${ [ ...groups.entries() ].map( ( [ category, abilities ] ) => {
				const chosen = abilities.filter( ( a ) =>
					picked.includes( a.slug ),
				).length;
				// "3 of 12" when some are ticked, otherwise just the
				// size of the group: the count is what keeps a closed
				// group informative.
				const count =
					chosen > 0
						? sprintf(
							/* translators: 1: ticked abilities in this group, 2: abilities in the group. */
							__( '%1$d of %2$d', 'desktop-mode' ),
							chosen,
							abilities.length,
						)
						: String( abilities.length );
				return html`
					<details
						class="dm-agents__ability-group"
						?open=${ isOpen( category, abilities ) }
						@toggle=${ ( e: Event ) => {
							// Remembered, not repainted: the disclosure
							// has already opened itself, and this is
							// only so the next paint agrees with it.
							state.abilityOpen.set(
								category,
								( e.target as HTMLDetailsElement ).open,
							);
						} }
					>
						<summary class="dm-agents__category">
							<span class="dm-agents__category-name">${ category }</span>
							<span class="dm-agents__category-count">${ count }</span>
						</summary>
						${ abilities.map(
							( ability ) => html`
								<div class="dm-agents__ability">
									<os-checkbox-label
										label=${ ability.label }
										?checked=${ picked.includes( ability.slug ) }
										?disabled=${ opts.disabled === true }
										@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
											toggle( ability.slug, e.detail?.checked === true ) }
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
					</details>
				`;
			} ) }
		`;
	};

	const toolsPane = ( agent: Agent ) => {
		if ( state.abilities === null ) {
			return html`<div class="dm-agents__pane dm-agents__pane--loading">
				<os-spinner></os-spinner>
			</div>`;
		}
		return html`
			<div class="dm-agents__pane">
				<p class="dm-agents__hint">
					${ __(
						'The agent may only call abilities ticked here — and every call is still gated by the ability\'s own permission check against the agent\'s role.',
						'desktop-mode',
					) }
				</p>
				${ abilityChecklist(
					agent.abilities,
					( slug, on ) => toggleAbility( agent, slug, on ),
					{ disabled: ! cfg.canManage || state.saving },
				) }
			</div>
		`;
	};

	/** Where a kind's row sits in the list, or -1. */
	const rowIndex = ( triggers: Trigger[], slug: string ): number =>
		triggers.findIndex( ( t ) => t.kind === slug );

	/**
	 * Whether a kind is one of the entity-kind doors.
	 *
	 * Send to and Drag & drop configure the same thing, which entity
	 * kinds the door accepts, and the catalogue says so through the
	 * schema rather than the slug, so a plugin kind shaped the same way
	 * gets the same card.
	 */
	const takesEntityKinds = ( kind: TriggerKindDescriptor ): boolean => {
		const schema = kind.config_schema as
			| { properties?: Record< string, unknown > }
			| undefined;
		return !! schema?.properties && 'entityKinds' in schema.properties;
	};

	/**
	 * Commit with the one invariant the cards promise: chat is always
	 * on. Rows for kinds the cards do not draw (unwired kinds, or a
	 * plugin's own) ride through untouched; a card only ever writes
	 * its own row.
	 */
	const commitTriggers = (
		commit: ( next: Trigger[] ) => void,
		next: Trigger[],
	): void => {
		commit(
			rowIndex( next, 'chat' ) === -1
				? [ { kind: 'chat', config: {} }, ...next ]
				: next,
		);
	};

	/**
	 * Extra configuration for a door that is open.
	 *
	 * Only kinds with something beyond "on" reach here: hook wants a
	 * hook name, endpoint a capability. Both are unwired today, so this
	 * renders for a plugin that wires one through the filter.
	 */
	const triggerEditor = (
		triggers: Trigger[],
		index: number,
		commit: ( next: Trigger[] ) => void,
	) => {
		const trigger = triggers[ index ];
		const patchConfig = ( patch: Record< string, unknown > ): void => {
			commitTriggers(
				commit,
				triggers.map( ( t, i ) =>
					i === index
						? { kind: t.kind, config: { ...t.config, ...patch } }
						: t,
				),
			);
		};
		if ( trigger.kind === 'hook' ) {
			const names = ( state.hooks ?? [] ).map( ( h ) => h.hook );
			return html`
				<div class="dm-agents__trigger-config">
					<os-text-field
						label=${ __( 'Hook name', 'desktop-mode' ) }
						value=${ String( trigger.config.hook ?? '' ) }
						?readonly=${ ! cfg.canManage }
						@os-input-commit=${ ( e: CustomEvent< { value: string } > ) =>
							patchConfig( { hook: e.detail.value } ) }
					></os-text-field>
					${ names.length > 0
						? html`<p class="dm-agents__hint">
								${ sprintf(
									/* translators: %s: comma-separated list of WordPress hook names. */
									__( 'Suggestions: %s', 'desktop-mode' ),
									names.join( ', ' ),
								) }
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

	/**
	 * One door, as a fixed card.
	 *
	 * Chat is always on and says so. An entity-kind door is the row of
	 * kinds to tick, and nothing ticked is the door closed, which is
	 * what "no trigger row" always meant on the server. Any other
	 * wired kind gets an On switch and, once on, its editor.
	 */
	const triggerCard = (
		kind: TriggerKindDescriptor,
		triggers: Trigger[],
		commit: ( next: Trigger[] ) => void,
	) => {
		const index = rowIndex( triggers, kind.slug );
		const row = index === -1 ? null : triggers[ index ];
		const locked = ! cfg.canManage || state.saving;
		const without = () => triggers.filter( ( t ) => t.kind !== kind.slug );
		let body = html``;
		if ( kind.slug === 'chat' ) {
			body = html``;
		} else if ( takesEntityKinds( kind ) ) {
			const raw = row?.config.entityKinds;
			const picked = Array.isArray( raw )
				? raw.filter( ( k ): k is string => typeof k === 'string' )
				: [];
			const toggle = ( entity: string, on: boolean ): void => {
				const kinds = on
					? [ ...new Set( [ ...picked, entity ] ) ]
					: picked.filter( ( k ) => k !== entity );
				const rest = without();
				if ( kinds.length > 0 ) {
					rest.push( {
						kind: kind.slug,
						config: { ...( row?.config ?? {} ), entityKinds: kinds },
					} );
				}
				commitTriggers( commit, rest );
			};
			body = html`
				<div class="dm-agents__trigger-config">
					${ ENTITY_KIND_CHOICES.map(
						( entity ) => html`
							<os-checkbox-label
								label=${ entity }
								?checked=${ picked.includes( entity ) }
								?disabled=${ locked }
								@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
									toggle( entity, e.detail?.checked === true ) }
							></os-checkbox-label>
						`,
					) }
				</div>
			`;
		} else {
			body = html`
				<div class="dm-agents__trigger-config">
					<os-checkbox-label
						label=${ __( 'On', 'desktop-mode' ) }
						?checked=${ row !== null }
						?disabled=${ locked }
						@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
							commitTriggers(
								commit,
								e.detail?.checked === true
									? [ ...without(), { kind: kind.slug, config: {} } ]
									: without(),
							) }
					></os-checkbox-label>
				</div>
				${ row ? triggerEditor( triggers, index, commit ) : html`` }
			`;
		}
		return html`
			<div class="dm-agents__trigger">
				<div class="dm-agents__trigger-head">
					<strong>${ kind.label }</strong>
					${ kind.slug === 'chat'
						? html`<os-badge tone="neutral">
								${ __( 'Always on', 'desktop-mode' ) }
						  </os-badge>`
						: html`` }
				</div>
				${ kind.description
					? html`<p class="dm-agents__trigger-desc">${ kind.description }</p>`
					: html`` }
				${ body }
			</div>
		`;
	};

	/**
	 * The doors, as fixed cards, one per wired kind.
	 *
	 * Shared by the detail pane's Triggers tab and the wizard's Summon
	 * step. Agnostic about where the rows live: the detail pane hands
	 * it an agent's stored triggers and a commit that saves, Summon
	 * hands it the draft's and a commit that only writes into the
	 * draft. It used to be a list of added rows behind an "Add
	 * trigger" select; with three wired kinds and chat always on there
	 * was nothing left to add, only doors to open.
	 */
	const triggersList = (
		triggers: Trigger[],
		commit: ( next: Trigger[] ) => void,
	) => {
		if ( state.triggerKinds === null ) {
			return html`<div class="dm-agents__pane dm-agents__pane--loading">
				<os-spinner></os-spinner>
			</div>`;
		}
		const kinds = state.triggerKinds.filter( ( k ) => k.wired !== false );
		return html`
			<div class="dm-agents__pane">
				<p class="dm-agents__hint">
					${ __(
						'Chat is always on. Tick where else this site should reach the agent; a door with nothing ticked stays closed.',
						'desktop-mode',
					) }
				</p>
				${ kinds.map( ( kind ) => triggerCard( kind, triggers, commit ) ) }
			</div>
		`;
	};

	// -----------------------------------------------------------------
	// The wizard
	//
	// Five steps, and a door before them. The door is the part that
	// matters most: five complete, well-written agents already ship
	// with the plugin, and until now the create flow showed them to
	// nobody. Starting from someone is the cheapest good idea here.
	//
	// **One way in.** There used to be a second: an Expert segment
	// holding a flat form. Keeping it cost more than it gave. It was
	// the only door that could mint an agent with no face and no
	// voice, because it had no picker and no Vibes field, so choosing
	// it quietly opted out of the character system the rest of this
	// screen exists to serve. And it was never the complete surface
	// its name promised: triggers were only ever reachable after
	// creation, so "expert" meant fewer fields, not more.
	//
	// So the door closed, and what it had went where it belonged. Its
	// instructions field is gone rather than moved: the brief typed
	// into Describe already is the system prompt, and the label says
	// so. Its triggers, which it never had, get a station of their own,
	// Summon, because how the site calls an agent is a different
	// question from what the agent may touch. What was
	// the expert form's only real advantage, not being walked through
	// several screens, is answered by every earlier step being
	// reachable by clicking its number in the trail.
	// -----------------------------------------------------------------

	const STEP_LABELS = (): string[] => [
		__( 'Describe', 'desktop-mode' ),
		__( 'Meet', 'desktop-mode' ),
		__( 'Powers', 'desktop-mode' ),
		__( 'Summon', 'desktop-mode' ),
		__( 'Launch', 'desktop-mode' ),
	];

	const roleLabel = ( slug: string ): string =>
		state.roles?.find( ( r ) => r.slug === slug )?.label ?? slug;

	const startCreate = ( from: Agent | null = null ): void => {
		state.creating = true;
		state.selectedId = null;
		state.notice = '';
		state.abilityQuery = '';
		const seed = newSeed();
		state.cast = emptyCast( state.defaultRole, seed );
		if ( from ) {
			// A copy takes the work but not the face. Two agents wearing
			// one portrait is exactly the confusion the faces exist to
			// remove, so the copy rolls its own.
			state.cast.name = sprintf(
				/* translators: %s: name of the agent being copied. */
				__( '%s copy', 'desktop-mode' ),
				from.name,
			);
			state.cast.description = from.description;
			state.cast.vibes = from.vibes;
			state.cast.instructions = from.instructions;
			state.cast.role = from.role;
			state.cast.abilities = [ ...from.abilities ];
			state.cast.triggers = from.triggers.map( ( t ) => ( {
				kind: t.kind,
				config: { ...t.config },
			} ) );
			state.cast.copiedFrom = from.name;
			state.step = 1;
		} else {
			state.step = 0;
		}
		void ensureRoles();
		void ensureCatalogues();
		paint();
	};

	const goStep = ( step: WizardStep ): void => {
		state.step = step;
		state.notice = '';
		paint();
	};

	/** Whether Meet has the one thing it insists on: a name. */
	const meetReady = (): boolean => state.cast.name.trim() !== '';

	/**
	 * Edit a field the step gates on, repainting only when the gate
	 * moves.
	 *
	 * Typing into Name used to write `state` and stop there, so
	 * `Continue` kept whatever `?disabled` it was last painted with: a
	 * filled-in form with a dead button until some unrelated control,
	 * picking a face, repainted and let it through. Repainting per
	 * keystroke would fix that and re-render the wizard once per
	 * letter; repainting on the edge fixes it once, when the step
	 * actually goes from blocked to allowed or back.
	 */
	const editGate = (
		gate: () => boolean,
		write: ( value: string ) => void,
	) => ( e: CustomEvent< { value: string } > ): void => {
		const before = gate();
		write( e.detail?.value ?? '' );
		if ( before !== gate() ) {
			paint();
		}
	};

	/**
	 * Fold a draft into the cast.
	 *
	 * The server already filtered it against the catalogues; this side
	 * checks again because the wizard's own copies of them are what the
	 * chips and the checklist read, and an empty answer for a field
	 * keeps whatever was there.
	 */
	const applyDraft = ( parsed: AgentDraft ): void => {
		const str = ( v: unknown ): string | undefined =>
			typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
		const c = state.cast;
		c.name = str( parsed.name ) ?? c.name;
		c.description = str( parsed.description ) ?? c.description;
		c.vibes = ( str( parsed.vibes ) ?? c.vibes ).slice( 0, 120 );
		c.instructions = str( parsed.instructions ) ?? c.instructions;
		// The model's suggestion is a suggestion. The catalogue is the
		// authority, so a role or an ability this site does not have is
		// dropped rather than trusted.
		const role = str( parsed.role );
		if ( role && ( state.roles ?? [] ).some( ( r ) => r.slug === role ) ) {
			c.role = role;
		}
		if ( Array.isArray( parsed.abilities ) ) {
			const known = new Set( ( state.abilities ?? [] ).map( ( a ) => a.slug ) );
			c.abilities = parsed.abilities.filter(
				( x ): x is string => typeof x === 'string' && known.has( x ),
			);
		}
	};

	/**
	 * Draft the agent from the brief.
	 *
	 * One call to the draft route, which runs a single generate with a
	 * strict answer schema. It used to ride the Copilot's search route,
	 * whose own answer schema and search-shaped prompt left the draft
	 * wrapped in a chat message when it arrived at all. A draft that
	 * fails keeps the user on Describe with the reason under the brief:
	 * the way forward is still open, since the brief seeds the
	 * instructions on its own.
	 */
	const draftWithAi = async (): Promise< void > => {
		if ( state.cast.brief.trim() === '' ) {
			state.briefError = __(
				'Describe the agent first. A sentence is enough.',
				'desktop-mode',
			);
			paint();
			return;
		}
		state.cast.drafting = true;
		state.briefError = '';
		state.notice = '';
		paint();
		// The draft is filtered against both catalogues, so settle them.
		await Promise.all( [ ensureCatalogues(), ensureRoles() ] );
		try {
			applyDraft( await draftAgent( state.cast.brief.trim() ) );
			// Filled in, Meet is a review.
			state.step = 1;
		} catch ( err ) {
			state.briefError = err instanceof Error ? err.message : String( err );
		}
		state.cast.drafting = false;
		if ( ! disposed ) {
			paint();
		}
	};

	/** Their words are already a first draft of the instructions. */
	const seedFromBrief = (): void => {
		if (
			state.cast.instructions === '' &&
			state.cast.brief.trim() !== ''
		) {
			state.cast.instructions = state.cast.brief.trim();
		}
	};

	const stepTrail = () => html`
		<os-steps horizontal class="dm-agents__trail">
			${ STEP_LABELS().map(
				( label, i ) => html`
					<os-step
						title=${ label }
						?done=${ i < state.step }
						?current=${ i === state.step }
						?interactive=${ i < state.step }
						@os-step-click=${ () => {
							if ( i < state.step ) {
								goStep( i as WizardStep );
							}
						} }
					></os-step>
				`,
			) }
		</os-steps>
	`;

	/** Step 0 — the door, then the brief. */
	const describeStep = () => html`
		${ state.agents.length > 0
			? html`
					<h4 class="dm-agents__wiz-heading">
						${ __( 'Start from someone', 'desktop-mode' ) }
					</h4>
					<p class="dm-agents__hint">
						${ __(
							'Copies their instructions and abilities, and rolls a new face. Nothing you pick is changed.',
							'desktop-mode',
						) }
					</p>
					<div class="dm-agents__starters">
						${ state.agents.map(
							( agent ) => html`
								<os-card
									class="dm-agents__starter"
									interactive
									@os-card-click=${ () => startCreate( agent ) }
								>
									<img
										class="dm-agents__starter-face"
										src=${ agentFaceSrc( agent, 76 ) }
										alt=""
										width="76"
										height="76"
									/>
									<span class="dm-agents__starter-name">${ agent.name }</span>
									<span class="dm-agents__starter-vibes">
										${ agent.vibes || agent.description }
									</span>
								</os-card>
							`,
						) }
					</div>
					<h4 class="dm-agents__wiz-heading">
						${ __( 'Or describe a new one', 'desktop-mode' ) }
					</h4>
			  `
			: html`` }
		<os-field-row
			class="dm-agents__brief-row"
			hint=${ __(
				'Plain words are fine: what it should watch, what it should write, where it may act. This is what the agent reads before every run; drafting rewrites it into proper instructions, filling it in yourself keeps it as written.',
				'desktop-mode',
			) }
			error=${ state.briefError }
		>
			<os-textarea
				os-field-control
				class="dm-agents__brief"
				label=${ __( 'What should this agent do? (system prompt)', 'desktop-mode' ) }
				value=${ state.cast.brief }
				rows="5"
				placeholder=${ __(
					'Go through my drafts once a week and tell me which ones are closest to finished.',
					'desktop-mode',
				) }
				?invalid=${ state.briefError !== '' }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					state.cast.brief = e.detail?.value ?? '';
					if ( state.briefError !== '' ) {
						// Typing is the fix; the error goes as soon as
						// it starts rather than after the next click.
						state.briefError = '';
						paint();
					}
				} }
			></os-textarea>
		</os-field-row>
		<div class="dm-agents__actions">
			${ state.aiReady
				? html`
						<os-button
							variant="holo"
							?busy=${ state.cast.drafting }
							@click=${ () => void draftWithAi() }
						>
							${ __( 'Draft it for me', 'desktop-mode' ) }
						</os-button>
				  `
				: html`` }
			<os-button
				variant=${ state.aiReady ? 'ghost' : 'primary' }
				?disabled=${ state.cast.drafting }
				@click=${ () => {
					seedFromBrief();
					goStep( 1 );
				} }
			>
				${ state.aiReady
					? __( 'I will fill it in myself', 'desktop-mode' )
					: __( 'Continue', 'desktop-mode' ) }
			</os-button>
			<span class="dm-agents__spacer"></span>
			${ cancelButton() }
		</div>
	`;

	/** Step 1 — meet them: the face, the name, the voice. */
	const meetStep = () => {
		const strip = faceCandidates( state.cast.stripSeed, FACE_CANDIDATES );
		return html`
			<div class="dm-agents__meet">
				<div class="dm-agents__portrait">
					<img
						class="dm-agents__portrait-face"
						src=${ faceSrc( state.cast.face, 176 ) }
						alt=""
						width="176"
						height="176"
					/>
					<div class="dm-agents__faces" role="radiogroup"
						aria-label=${ __( 'Face', 'desktop-mode' ) }>
						${ strip.map(
							( candidate ) => html`
								<button
									type="button"
									class="dm-agents__face-pick ${ candidate.seed ===
									state.cast.faceSeed
										? 'is-picked'
										: '' }"
									role="radio"
									aria-checked=${ candidate.seed === state.cast.faceSeed
										? 'true'
										: 'false' }
									@click=${ () => {
										state.cast.faceSeed = candidate.seed;
										state.cast.face = candidate.look;
										paint();
									} }
								>
									<img src=${ faceSrc( candidate.look, 44 ) } alt="" width="44" height="44" />
								</button>
							`,
						) }
					</div>
					<os-button
						variant="secondary"
						@click=${ () => {
							state.cast.stripSeed += FACE_CANDIDATES;
							paint();
						} }
					>
						${ __( 'Surprise me', 'desktop-mode' ) }
					</os-button>
					<div class="dm-agents__portrait-chips">
						<os-chip
							size="compact"
							label=${ faceShapeName( state.cast.face ) }
						></os-chip>
						<os-chip
							size="compact"
							label=${ faceHueName( state.cast.face ) }
						></os-chip>
					</div>
				</div>
				<div class="dm-agents__meet-fields">
					${ state.cast.copiedFrom
						? html`<os-notice tone="info">
								${ sprintf(
									/* translators: %s: name of the agent this one was copied from. */
									__( 'Copied from %s, with a face of its own.', 'desktop-mode' ),
									state.cast.copiedFrom,
								) }
						  </os-notice>`
						: html`` }
					<os-field-row error=${ state.nameError }>
						<os-text-field
							os-field-control
							label=${ __( 'Name', 'desktop-mode' ) }
							value=${ state.cast.name }
							?invalid=${ state.nameError !== '' }
							@os-input-change=${ editGate( meetReady, ( value ) => {
								state.cast.name = value;
								// The gate flips on the first letter, and
								// that repaint is what clears the error.
								state.nameError = '';
							} ) }
						></os-text-field>
					</os-field-row>
					<os-text-field
						label=${ __( 'Vibes', 'desktop-mode' ) }
						value=${ state.cast.vibes }
						maxlength="120"
						placeholder=${ __(
							'blunt, precise, no sugarcoating',
							'desktop-mode',
						) }
						@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
							state.cast.vibes = e.detail?.value ?? '';
						} }
					></os-text-field>
					<p class="dm-agents__hint">
						${ __(
							'One line of voice. It goes into the agent\'s instructions, so it is how the agent sounds rather than a label on a card.',
							'desktop-mode',
						) }
					</p>
					<os-text-field
						label=${ __( 'When to use', 'desktop-mode' ) }
						value=${ state.cast.description }
						@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
							state.cast.description = e.detail?.value ?? '';
						} }
					></os-text-field>
				</div>
			</div>
			<div class="dm-agents__actions">
				<os-button variant="ghost" @click=${ () => goStep( 0 ) }>
					${ __( 'Back', 'desktop-mode' ) }
				</os-button>
				<span class="dm-agents__spacer"></span>
				<os-button
					variant="primary"
					?disabled=${ ! meetReady() }
					@click=${ () => goStep( 2 ) }
				>
					${ __( 'Continue', 'desktop-mode' ) }
				</os-button>
				${ cancelButton() }
			</div>
		`;
	};

	/**
	 * Step 2, powers.
	 *
	 * Named for what is actually being decided. "Refine" describes what
	 * you do to a form; what this step decides is what the agent is
	 * allowed to touch, which is the one thing in the flow worth
	 * slowing down for.
	 *
	 * The heading carries both names, the plain one and the one the
	 * docs and the detail panes use in parentheses, so someone who
	 * knows what an ability is finds it as fast as someone who does not.
	 */
	const powersStep = () => html`
		<os-select
			class="dm-agents__role-select"
			label=${ __( 'Role', 'desktop-mode' ) }
			value=${ state.cast.role }
			@os-pick=${ ( e: CustomEvent< { value: string } > ) => {
				state.cast.role = e.detail?.value ?? state.cast.role;
				paint();
			} }
		>
			${ state.roles === null
				? html`<os-option value=${ state.cast.role }>
						${ state.cast.role }
				  </os-option>`
				: roleOptions( state.roles, state.cast.role ) }
		</os-select>
		<p class="dm-agents__hint">
			${ __(
				"The agent acts with this role's capabilities. Pick the least privilege that still lets it do its job.",
				'desktop-mode',
			) }
		</p>
		<h4 class="dm-agents__wiz-heading">
			${ __( 'What it may call (abilities)', 'desktop-mode' ) }
		</h4>
		${ abilityPicker() }
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => goStep( 1 ) }>
				${ __( 'Back', 'desktop-mode' ) }
			</os-button>
			<span class="dm-agents__spacer"></span>
			<os-button variant="primary" @click=${ () => goStep( 3 ) }>
				${ __( 'Continue', 'desktop-mode' ) }
			</os-button>
			${ cancelButton() }
		</div>
	`;

	/**
	 * The Powers step's checklist.
	 *
	 * The same widget the Tools pane uses, on purpose: a guided flow
	 * that showed a flat, undescribed list would be giving less help
	 * than the expert surface it is meant to be gentler than.
	 */
	const abilityPicker = () => {
		if ( state.abilities === null ) {
			return html`<os-spinner></os-spinner>`;
		}
		if ( state.abilities.length === 0 ) {
			return html``;
		}
		return html`
			${ abilityChecklist( state.cast.abilities, ( slug, on ) => {
				const next = new Set( state.cast.abilities );
				if ( on ) {
					next.add( slug );
				} else {
					next.delete( slug );
				}
				state.cast.abilities = [ ...next ];
				paint();
			} ) }
			<p class="dm-agents__hint">
				${ __(
					"The agent may only call abilities ticked here, and every call is still gated by the ability's own permission check against the agent's role.",
					'desktop-mode',
				) }
			</p>
		`;
	};

	/**
	 * Step 3, summon: how the site calls the agent.
	 *
	 * Named for the act rather than the mechanism. "Trigger" is what
	 * the store and the docs call it, and the detail pane keeps that
	 * name in its tab; here the question is put the way the person
	 * casting the agent would put it.
	 */
	const summonStep = () => html`
		${ triggersList( state.cast.triggers, ( next ) => {
			state.cast.triggers = next;
			paint();
		} ) }
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => goStep( 2 ) }>
				${ __( 'Back', 'desktop-mode' ) }
			</os-button>
			<span class="dm-agents__spacer"></span>
			<os-button variant="primary" @click=${ () => goStep( STEP_LAUNCH ) }>
				${ __( 'Continue', 'desktop-mode' ) }
			</os-button>
			${ cancelButton() }
		</div>
	`;

	/** Step 4, launch. */
	const launchStep = () => {
		const canChat = cfg.canInvoke && state.aiReady === true;
		const abilityLabel = ( slug: string ): string =>
			state.abilities?.find( ( a ) => a.slug === slug )?.label ?? slug;
		const triggerLabel = ( kind: string ): string =>
			state.triggerKinds?.find( ( k ) => k.slug === kind )?.label ?? kind;
		const triggerLine =
			state.cast.triggers.length === 0
				? __( 'No triggers configured: reachable in chat.', 'desktop-mode' )
				: sprintf(
					/* translators: %s: comma-separated list of trigger kind labels. */
					__( 'Starts from: %s.', 'desktop-mode' ),
					state.cast.triggers
						.map( ( t ) => triggerLabel( t.kind ) )
						.join( ', ' ),
				);
		return html`
			<os-card class="dm-agents__summary">
				<img
					class="dm-agents__summary-face"
					src=${ faceSrc( state.cast.face, 96 ) }
					alt=""
					width="96"
					height="96"
				/>
				<div class="dm-agents__summary-text">
					<h4>${ state.cast.name }</h4>
					${ state.cast.vibes
						? html`<p class="dm-agents__summary-vibes">${ state.cast.vibes }</p>`
						: html`` }
					<p class="dm-agents__summary-desc">
						${ state.cast.description ||
						__( 'No description yet.', 'desktop-mode' ) }
					</p>
					<div class="dm-agents__chips">
						<os-chip size="compact" label=${ roleLabel( state.cast.role ) }></os-chip>
						${ state.cast.abilities.map(
							( slug ) => html`<os-chip
								size="compact"
								label=${ abilityLabel( slug ) }
							></os-chip>`,
						) }
					</div>
					${ state.cast.instructions === ''
						? html`<p class="dm-agents__hint">
								${ __(
									'No instructions yet: the agent will improvise. You can add them any time in Define.',
									'desktop-mode',
								) }
						  </p>`
						: html`<p class="dm-agents__summary-instr">
								${ state.cast.instructions }
						  </p>` }
					${ state.cast.abilities.length === 0
						? html`<p class="dm-agents__hint">
								${ __(
									'No abilities ticked: the agent can talk, but not touch the site.',
									'desktop-mode',
								) }
						  </p>`
						: html`` }
					<p class="dm-agents__hint">${ triggerLine }</p>
				</div>
			</os-card>
			<div class="dm-agents__actions">
				<os-button variant="ghost" @click=${ () => goStep( 3 ) }>
					${ __( 'Back', 'desktop-mode' ) }
				</os-button>
				<span class="dm-agents__spacer"></span>
				<os-button
					variant=${ canChat ? 'secondary' : 'primary' }
					?disabled=${ state.saving }
					@click=${ () => void castCreate( false ) }
				>
					${ __( 'Create agent', 'desktop-mode' ) }
				</os-button>
				${ canChat
					? html`
							<os-button
								variant="primary"
								?disabled=${ state.saving }
								@click=${ () => void castCreate( true ) }
							>
								${ __( 'Create and chat', 'desktop-mode' ) }
							</os-button>
					  `
					: html`` }
				${ cancelButton() }
			</div>
		`;
	};

	const cancelButton = () => html`
		<os-button
			variant="ghost"
			?disabled=${ state.saving || state.cast.drafting }
			@click=${ () => {
				state.creating = false;
				state.notice = '';
				paint();
			} }
		>
			${ __( 'Cancel', 'desktop-mode' ) }
		</os-button>
	`;

	/**
	 * Create the agent.
	 *
	 * One request. Abilities go in the create call, which the route has
	 * always accepted; a second patch to attach them would leave a
	 * half-made agent on the server whenever it failed.
	 */
	const castCreate = async ( thenChat: boolean ): Promise< void > => {
		const c = state.cast;
		if ( c.name.trim() === '' ) {
			state.nameError = __( 'Agent name is required.', 'desktop-mode' );
			state.step = 1;
			paint();
			return;
		}
		state.saving = true;
		state.notice = '';
		paint();
		try {
			const created = await createAgent( {
				name: c.name.trim(),
				role: c.role,
				description: c.description.trim(),
				instructions: c.instructions,
				abilities: c.abilities,
				triggers: c.triggers,
				vibes: c.vibes.trim(),
				face: c.face,
				faceSeed: c.faceSeed,
			} );
			state.agents = [ ...state.agents, created ].sort( ( a, b ) =>
				a.name.localeCompare( b.name ),
			);
			state.creating = false;
			state.selectedId = created.id;
			state.pane = 'define';
			state.draft = draftFromAgent( created );
			refreshSendToAgents();
			if ( thenChat ) {
				openChatWindow( created );
			}
		} catch ( err ) {
			state.notice = err instanceof Error ? err.message : String( err );
		}
		state.saving = false;
		if ( ! disposed ) {
			paint();
		}
	};

	/** The wizard frame: heading, trail, and the current step. */
	const wizardPane = () => html`
		<div class="dm-agents__wizard">
			<div class="dm-agents__wiz-head">
				<h3>${ __( 'New agent', 'desktop-mode' ) }</h3>
			</div>
			${ stepTrail() }
			${ state.step === 0 ? describeStep() : html`` }
			${ state.step === 1 ? meetStep() : html`` }
			${ state.step === 2 ? powersStep() : html`` }
			${ state.step === 3 ? summonStep() : html`` }
			${ state.step === 4 ? launchStep() : html`` }
		</div>
	`;

	const detailPane = () => {
		const agent = selected();
		if ( ! agent ) {
			// Unreachable: the view switch only reaches here with an
			// agent open. Kept as a type guard rather than a branch.
			return html``;
		}
		return html`
			<os-button
				class="dm-agents__back"
				variant="link"
				@click=${ () => select( null ) }
			>
				${ __( '\u2039 Your cast', 'desktop-mode' ) }
			</os-button>
			<div class="dm-agents__detail-head">
				<img
					class="dm-agents__detail-avatar"
					src=${ agentFaceSrc( agent, 96 ) }
					alt=""
				/>
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
			${ state.pane === 'triggers'
				? triggersList( agent.triggers, ( next ) => {
					setTriggers( agent, next );
				} )
				: html`` }
		`;
	};

	const paint = (): void => {
		if ( disposed ) {
			return;
		}
		paintStatusBar();
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
		// Three views, one at a time, rather than a sidebar next to a
		// pane. The cast is the home screen; opening someone replaces
		// it and a crumb comes back. A grid of faces and a detail form
		// side by side would leave neither enough room, and the whole
		// point of the grid is that the faces are big enough to tell
		// apart.
		let view;
		if ( state.creating ) {
			view = wizardPane();
		} else if ( selected() ) {
			view = html`<div class="dm-agents__detail">${ detailPane() }</div>`;
		} else {
			view = castGrid();
		}

		render(
			html`
				${ aiNotice() }
				${ state.notice
					? html`<os-notice class="dm-agents__notice">${ state.notice }</os-notice>`
					: html`` }
				<div class="dm-agents__view">${ view }</div>
			`,
			root,
		);
		syncRowDropTargets();
	};

	paint();
	if ( ! off ) {
		void load();
		void probeAi();
		// The Define pane's role picker needs the catalogue as soon as
		// an agent is selected, which happens the moment the list
		// resolves — fetch alongside the list rather than on the first
		// click.
		void ensureRoles();
	}
}

registerEntityKind( 'agent', renderAgents );
