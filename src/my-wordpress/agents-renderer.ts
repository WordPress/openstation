/**
 * My WordPress — Agents kind renderer.
 *
 * Real CRUD over `wp_guideline`-backed agents via the
 * `/desktop-mode/v1/agents` REST surface. The renderer paints three
 * states:
 *
 *   1. Soft-gate empty state — Gutenberg / Guidelines experiment
 *      missing. One-click "Enable Guidelines experiment" button calls
 *      the AJAX endpoint and reloads the window on success.
 *   2. Empty-list state — substrate available, no agents yet. Big
 *      "+ Create agent" call-to-action.
 *   3. List + detail — substrate available, ≥1 agent. Tile list on the
 *      left, full editable detail panel on the right.
 *
 * The detail panel writes every field through `agents-rest.ts`. No
 * mock data, no "coming soon" stubs.
 *
 * @public
 * @since 0.23.0
 */

import { __, sprintf } from '../i18n';
import type { EntityRenderer } from './kind-registry';
import {
	BOT_ICON_DATA_URI,
	DEFAULT_AGENT_ROLE_CHOICES,
} from './agents-abilities';
import {
	createAgent,
	deleteAgent,
	enableGuidelinesExperiment,
	fetchAbilitiesCatalogue,
	fetchAgentDossier,
	fetchHooksCatalogue,
	fetchTriggerKinds,
	invokeAgent,
	listAgents,
	setAbilities,
	setRole,
	setTriggers,
	updateAgent,
	type AgentDossier,
	type AgentToolCall,
} from './agents-rest';
import type {
	Ability,
	Agent,
	HookSuggestion,
	Trigger,
	TriggerKindDescriptor,
} from './agents-types';
import { buildTriggersPanel } from './agents-triggers-ui';
import {
	pushAgentToCache,
	removeAgentFromCache,
} from '../agents-send-to';
import { getConfig } from './rest';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-checkbox/wpd-checkbox';
import '../ui/components/wpd-chip/wpd-chip';
import '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-notice/wpd-notice';
import '../ui/components/wpd-select/wpd-select';
import '../ui/components/wpd-spinner/wpd-spinner';
import '../ui/components/wpd-text-field/wpd-text-field';
import '../ui/components/wpd-textarea/wpd-textarea';
import '../ui/components/wpd-tile/wpd-tile';

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

interface ToastOptions {
	message: string;
}

function wpdConfirm( opts: ConfirmOptions ): Promise< boolean > {
	const fn = (
		window.wp as
			| {
					desktop?: {
						confirm?: ( o: ConfirmOptions ) => Promise< boolean >;
					};
				}
			| undefined
	)?.desktop?.confirm;
	if ( typeof fn === 'function' ) {
		return fn( opts );
	}
	// Fallback — synchronous browser confirm so flows still work in
	// non-shell test contexts. Renderer integration tests stub
	// `wp.desktop.confirm`.
	return Promise.resolve( window.confirm( opts.message ) ); // eslint-disable-line no-restricted-syntax, no-alert
}

function showToast( message: string ): void {
	const toast = (
		window.wp as
			| {
					desktop?: {
						toast?: ( o: ToastOptions ) => void;
					};
				}
			| undefined
	)?.desktop?.toast;
	if ( typeof toast === 'function' ) {
		toast( { message } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[my-wordpress/agents]', message );
}

interface RendererCaches {
	abilities?: Ability[];
	hooks?: HookSuggestion[];
	triggerKinds?: TriggerKindDescriptor[];
}

/**
 * Render the Agents section into the My WordPress window body.
 * Registered against the `'agents'` entity kind by `index.ts`.
 *
 * @public
 */
export const renderAgentsKind: EntityRenderer = ( host ) => {
	const cfg = getConfig();
	const agentsCfg = cfg.agentsConfig ?? {
		enabled: false,
		gutenbergActive: false,
		skillTermId: 0,
		restNamespace: 'desktop-mode/v1',
		enableExperimentNonce: '',
		gutenbergInstallUrl: '',
	};

	// Paint directly into `host.body` (no wrapper) so `__split`'s
	// `height: 100%` resolves against the window-body flex item the
	// host owns — the other kinds (media, posts) do this the same way.
	host.body.replaceChildren();

	const paint = (): void => {
		if ( ! agentsCfg.enabled ) {
			paintSoftGate( host.body, agentsCfg, () => {
				// Live transition out of the soft-gate after the
				// experiment is flipped. Mutating `agentsCfg.enabled`
				// also updates `cfg.agentsConfig.enabled` (same ref),
				// so subsequent renders see the new state without an
				// F5.
				agentsCfg.enabled = true;
				host.body.replaceChildren();
				paint();
			} );
			return;
		}
		// Detail route — drilled INTO a specific agent. Renders the
		// dossier surface (identity, behaviour, bindings, activity,
		// chat panel) instead of the list+edit pane.
		if (
			host.route.kind === 'detail' &&
			host.route.entityId === 'agents'
		) {
			paintDossier( host, host.route.postId );
			return;
		}
		paintActive( host );
	};

	paint();
};

function paintSoftGate(
	host: HTMLElement,
	agentsCfg: NonNullable< ReturnType< typeof getConfig >[ 'agentsConfig' ] >,
	onEnabled: () => void,
): void {
	host.replaceChildren();

	const empty = document.createElement( 'wpd-empty-state' );
	empty.classList.add( 'desktop-mode-my-wordpress__agents-soft-gate' );
	empty.setAttribute( 'icon', 'dashicons-superhero' );
	empty.setAttribute(
		'heading',
		__( 'Agents need the Guidelines experiment', 'desktop-mode' ),
	);

	if ( agentsCfg.gutenbergActive ) {
		empty.setAttribute(
			'description',
			__(
				'Desktop Mode agents are stored as Guidelines (the Gutenberg-experimental wp_guideline CPT). Enable the experiment to start creating agents — your existing skills become editable here too.',
				'desktop-mode',
			),
		);

		const enableBtn = document.createElement( 'wpd-button' );
		enableBtn.setAttribute( 'variant', 'primary' );
		enableBtn.textContent = __(
			'Enable Guidelines experiment',
			'desktop-mode',
		);
		enableBtn.addEventListener( 'click', async () => {
			enableBtn.setAttribute( 'disabled', '' );
			enableBtn.textContent = __( 'Enabling…', 'desktop-mode' );
			try {
				await enableGuidelinesExperiment(
					agentsCfg.enableExperimentNonce,
				);
				showToast(
					__( 'Guidelines experiment enabled.', 'desktop-mode' ),
				);
				// Hand control back to the caller so the section
				// can swap into the active layout without an F5 —
				// Gutenberg's `wp_guideline` is registered on
				// `init` of the NEXT request, which our REST calls
				// trigger fresh anyway.
				onEnabled();
			} catch ( error ) {
				enableBtn.removeAttribute( 'disabled' );
				enableBtn.textContent = __(
					'Enable Guidelines experiment',
					'desktop-mode',
				);
				const message =
					error instanceof Error
						? error.message
						: __(
							'Could not enable the experiment.',
							'desktop-mode',
						);
				showToast( message );
			}
		} );
		empty.appendChild( enableBtn );
	} else {
		empty.setAttribute(
			'description',
			__(
				'Install and activate the Gutenberg plugin, then enable the Guidelines experiment to start creating agents.',
				'desktop-mode',
			),
		);

		const installBtn = document.createElement( 'wpd-button' );
		installBtn.setAttribute( 'variant', 'primary' );
		installBtn.textContent = __( 'Install Gutenberg', 'desktop-mode' );
		installBtn.addEventListener( 'click', () => {
			if ( agentsCfg.gutenbergInstallUrl ) {
				window.open( agentsCfg.gutenbergInstallUrl, '_blank' );
			}
		} );
		empty.appendChild( installBtn );
	}

	host.appendChild( empty );
}

function paintActive( host: Parameters< EntityRenderer >[ 0 ] ): void {
	const split = document.createElement( 'div' );
	split.className = 'desktop-mode-my-wordpress__split';

	const left = document.createElement( 'div' );
	left.className =
		'desktop-mode-my-wordpress__list desktop-mode-my-wordpress__agents-list';

	const createRow = document.createElement( 'div' );
	createRow.className = 'desktop-mode-my-wordpress__agents-create';
	const createBtn = document.createElement( 'wpd-button' );
	createBtn.setAttribute( 'variant', 'primary' );
	createBtn.textContent = __( '+ Create agent', 'desktop-mode' );
	createRow.appendChild( createBtn );

	const listWrap = document.createElement( 'div' );
	listWrap.className = 'desktop-mode-my-wordpress__agents-tiles';
	listWrap.setAttribute( 'role', 'list' );

	left.appendChild( createRow );
	left.appendChild( listWrap );

	const right = document.createElement( 'div' );
	right.className =
		'desktop-mode-my-wordpress__preview desktop-mode-my-wordpress__agents-preview';
	const detail = document.createElement( 'div' );
	detail.className = 'desktop-mode-my-wordpress__agents-detail';
	right.appendChild( detail );

	split.appendChild( left );
	split.appendChild( right );
	host.body.replaceChildren( split );

	const state: {
		agents: Agent[];
		selectedId: number | null;
		mode: 'idle' | 'creating';
	} = {
		agents: [],
		selectedId: null,
		mode: 'idle',
	};
	const caches: RendererCaches = {};

	function paintList(): void {
		listWrap.replaceChildren();
		if ( state.agents.length === 0 && state.mode !== 'creating' ) {
			const empty = document.createElement( 'p' );
			empty.className = 'desktop-mode-my-wordpress__agents-empty';
			empty.textContent = __(
				'No agents yet. Click + Create agent to start.',
				'desktop-mode',
			);
			listWrap.appendChild( empty );
			return;
		}
		for ( const agent of state.agents ) {
			const tile = document.createElement( 'wpd-tile' );
			tile.setAttribute( 'type', '__my-wordpress-agent' );
			tile.setAttribute( 'ref', String( agent.id ) );
			tile.setAttribute( 'label', agent.name );
			tile.setAttribute( 'icon', BOT_ICON_DATA_URI );
			tile.setAttribute( 'kind', 'entry' );
			tile.classList.add(
				'desktop-mode-my-wordpress__tile',
				'desktop-mode-my-wordpress__tile--entry',
				'desktop-mode-my-wordpress__agent-tile',
			);
			tile.dataset.agentId = String( agent.id );

			// HTML5 drag — the desktop-files layer accepts shortcut
			// payloads of any type and creates a placement keyed on
			// `ref`. Dropping an agent tile onto the wallpaper /
			// inside a folder spawns an "agent" placement that opens
			// the dossier when clicked.
			tile.setAttribute( 'draggable', 'true' );
			tile.addEventListener( 'dragstart', ( ev: DragEvent ) => {
				if ( ! ev.dataTransfer ) {
					return;
				}
				try {
					ev.dataTransfer.setData(
						'application/x-desktop-mode-shortcut+json',
						JSON.stringify( {
							type: 'agent',
							ref: String( agent.id ),
							title: agent.name,
							icon: BOT_ICON_DATA_URI,
						} ),
					);
					ev.dataTransfer.setData( 'text/plain', agent.name );
					ev.dataTransfer.effectAllowed = 'copy';
				} catch {
					// Browsers throw on `setData` mid-drag in rare
					// edge cases; ignore — the drag still fires.
				}
			} );

			if ( agent.id === state.selectedId && state.mode === 'idle' ) {
				tile.setAttribute( 'selected', '' );
			}
			tile.addEventListener( 'click', () => {
				if ( state.selectedId === agent.id && state.mode === 'idle' ) {
					return;
				}
				// Selection-only update — toggle the `selected`
				// attribute on the previous + new tile instead of
				// rebuilding the whole list. Re-rendering the list
				// remounted every `<wpd-tile>` and reloaded each bot
				// SVG, causing the visible flicker the user saw on
				// every click.
				const prevId = state.selectedId;
				state.selectedId = agent.id;
				state.mode = 'idle';
				if ( prevId !== null && prevId !== agent.id ) {
					const prev = listWrap.querySelector(
						`wpd-tile[data-agent-id="${ prevId }"]`,
					);
					prev?.removeAttribute( 'selected' );
				}
				tile.setAttribute( 'selected', '' );
				paintDetail();
			} );
			// Double-click = navigate into the dossier — same gesture
			// users have everywhere else in My WordPress for "open in
			// full view."
			tile.addEventListener( 'dblclick', ( ev: Event ) => {
				ev.preventDefault();
				host.navigate( {
					kind: 'detail',
					entityId: 'agents',
					postId: agent.id,
					postTitle: agent.name,
				} );
			} );
			// Right-click — discrete context menu with the
			// agent-specific actions ("View activity" jumps into the
			// dossier's Activity section, "Open dossier" navigates
			// without scrolling, "Delete" runs the same flow as the
			// Danger Zone button). The send-to entry is omitted —
			// you don't "send an agent TO another agent" yet.
			tile.addEventListener( 'contextmenu', ( ev: Event ) => {
				ev.preventDefault();
				const mouseEv = ev as MouseEvent;
				openAgentContextMenu( agent, host, {
					x: mouseEv.clientX,
					y: mouseEv.clientY,
				}, async () => {
					try {
						await deleteAgent( agent.id );
						removeAgentFromCache( agent.id );
						state.agents = state.agents.filter(
							( a ) => a.id !== agent.id,
						);
						if ( state.selectedId === agent.id ) {
							state.selectedId = null;
						}
						paintList();
						paintDetail();
						showToast(
							sprintf(
								// translators: %s is the agent's name.
								__( 'Deleted %s.', 'desktop-mode' ),
								agent.name,
							),
						);
					} catch ( err ) {
						showToast(
							err instanceof Error
								? err.message
								: __(
									'Could not delete agent.',
									'desktop-mode',
								),
						);
					}
				} );
			} );
			listWrap.appendChild( tile );
		}
	}

	function paintDetail(): void {
		detail.replaceChildren();
		if ( state.mode === 'creating' ) {
			detail.appendChild( buildCreateForm() );
			return;
		}
		if ( state.selectedId === null ) {
			const empty = document.createElement( 'wpd-empty-state' );
			empty.setAttribute( 'icon', 'dashicons-superhero' );
			empty.setAttribute(
				'heading',
				__( 'Pick an agent', 'desktop-mode' ),
			);
			empty.setAttribute(
				'description',
				__(
					'Select an agent on the left to inspect or edit its definition.',
					'desktop-mode',
				),
			);
			detail.appendChild( empty );
			return;
		}
		const agent = state.agents.find( ( a ) => a.id === state.selectedId );
		if ( ! agent ) {
			detail.appendChild( buildErrorBlock( __( 'Agent disappeared. Refresh the window.', 'desktop-mode' ) ) );
			return;
		}
		detail.appendChild( buildEditPanel( agent ) );
	}

	createBtn.addEventListener( 'click', () => {
		state.mode = 'creating';
		state.selectedId = null;
		paintList();
		paintDetail();
	} );

	async function loadAgents(): Promise< void > {
		paintLoading( detail );
		try {
			state.agents = await listAgents();
		} catch ( error ) {
			detail.replaceChildren();
			detail.appendChild(
				buildErrorBlock(
					error instanceof Error
						? error.message
						: __(
							'Could not load agents.',
							'desktop-mode',
						),
				),
			);
			return;
		}
		if ( state.selectedId !== null ) {
			const exists = state.agents.some(
				( a ) => a.id === state.selectedId,
			);
			if ( ! exists ) {
				state.selectedId = null;
			}
		}
		paintList();
		paintDetail();
	}

	async function loadCaches(): Promise< void > {
		try {
			const [ abilities, hooks, triggerKinds ] = await Promise.all( [
				fetchAbilitiesCatalogue(),
				fetchHooksCatalogue(),
				fetchTriggerKinds(),
			] );
			caches.abilities = abilities;
			caches.hooks = hooks;
			caches.triggerKinds = triggerKinds;
		} catch ( _err ) {
			caches.abilities = [];
			caches.hooks = [];
			caches.triggerKinds = [];
		}
	}

	function buildCreateForm(): HTMLElement {
		const form = document.createElement( 'form' );
		form.className = 'desktop-mode-my-wordpress__agent-create-form';

		const h2 = document.createElement( 'h2' );
		h2.textContent = __( 'Create a new agent', 'desktop-mode' );
		form.appendChild( h2 );

		const nameField = document.createElement( 'wpd-text-field' );
		nameField.setAttribute( 'label', __( 'Name', 'desktop-mode' ) );
		nameField.setAttribute(
			'placeholder',
			__( 'e.g. Remove BG', 'desktop-mode' ),
		);
		nameField.setAttribute( 'required', '' );
		form.appendChild( nameField );

		const descField = document.createElement( 'wpd-text-field' );
		descField.setAttribute(
			'label',
			__( 'Description', 'desktop-mode' ),
		);
		descField.setAttribute(
			'placeholder',
			__( 'When should this agent be used?', 'desktop-mode' ),
		);
		form.appendChild( descField );

		const roleLabel = document.createElement( 'label' );
		roleLabel.textContent = __( 'Role', 'desktop-mode' );
		form.appendChild( roleLabel );

		const roleSelect = document.createElement( 'wpd-select' );
		for ( const role of DEFAULT_AGENT_ROLE_CHOICES ) {
			const opt = document.createElement( 'wpd-option' );
			opt.setAttribute( 'value', role.slug );
			opt.textContent = role.label;
			roleSelect.appendChild( opt );
		}
		roleSelect.setAttribute( 'value', 'editor' );
		form.appendChild( roleSelect );

		const instrLabel = document.createElement( 'label' );
		instrLabel.textContent = __(
			'Instructions (system prompt)',
			'desktop-mode',
		);
		form.appendChild( instrLabel );
		const instr = document.createElement( 'wpd-textarea' );
		instr.setAttribute( 'rows', '6' );
		instr.setAttribute(
			'placeholder',
			__(
				'You are an image-processing agent…',
				'desktop-mode',
			),
		);
		form.appendChild( instr );

		const actions = document.createElement( 'div' );
		actions.className = 'desktop-mode-my-wordpress__agent-form-actions';

		const cancelBtn = document.createElement( 'wpd-button' );
		cancelBtn.setAttribute( 'variant', 'secondary' );
		cancelBtn.setAttribute( 'type', 'button' );
		cancelBtn.textContent = __( 'Cancel', 'desktop-mode' );
		cancelBtn.addEventListener( 'click', () => {
			state.mode = 'idle';
			paintList();
			paintDetail();
		} );

		const submitBtn = document.createElement( 'wpd-button' );
		submitBtn.setAttribute( 'variant', 'primary' );
		submitBtn.textContent = __( 'Create agent', 'desktop-mode' );

		actions.appendChild( cancelBtn );
		actions.appendChild( submitBtn );
		form.appendChild( actions );

		const submit = async (): Promise< void > => {
			const name = readFieldValue( nameField ).trim();
			if ( name === '' ) {
				showToast(
					__( 'Agent name is required.', 'desktop-mode' ),
				);
				return;
			}
			const role = readSelectValue( roleSelect ) || 'editor';
			submitBtn.setAttribute( 'disabled', '' );
			submitBtn.textContent = __( 'Creating…', 'desktop-mode' );
			try {
				const created = await createAgent( {
					name,
					role,
					description: readFieldValue( descField ),
					instructions: readTextareaValue( instr ),
				} );
				state.agents = [ ...state.agents, created ].sort( ( a, b ) =>
					a.name.localeCompare( b.name ),
				);
				state.selectedId = created.id;
				state.mode = 'idle';
				paintList();
				paintDetail();
				showToast(
					sprintf(
						// translators: %s is the agent's name.
						__( 'Created %s.', 'desktop-mode' ),
						created.name,
					),
				);
			} catch ( error ) {
				submitBtn.removeAttribute( 'disabled' );
				submitBtn.textContent = __( 'Create agent', 'desktop-mode' );
				const message =
					error instanceof Error
						? error.message
						: __( 'Could not create agent.', 'desktop-mode' );
				showToast( message );
			}
		};

		// `<wpd-button>` is a custom element, so `type="submit"` is
		// inert — wire the click directly. The native `submit` event
		// also wouldn't fire from inside shadow-DOM inputs, so we
		// don't depend on it.
		submitBtn.addEventListener( 'click', ( ev ) => {
			ev.preventDefault();
			void submit();
		} );
		// Pressing Enter inside any text field commits the form too —
		// `<wpd-text-field>` emits `wpd-submit` on Enter.
		form.addEventListener( 'wpd-submit', ( ev ) => {
			ev.preventDefault();
			void submit();
		} );

		return form;
	}

	function buildEditPanel( agent: Agent ): HTMLElement {
		const root = document.createElement( 'div' );
		root.className = 'desktop-mode-my-wordpress__agent-panel';
		root.dataset.agentId = String( agent.id );

		root.appendChild( buildEditHeader( agent ) );

		// "Open dossier" call-to-action — sits above the edit
		// sections so the user can navigate into the agent without
		// scrolling.
		const openRow = document.createElement( 'div' );
		openRow.className = 'desktop-mode-my-wordpress__agent-open-dossier';
		const openBtn = document.createElement( 'wpd-button' );
		openBtn.setAttribute( 'variant', 'secondary' );
		openBtn.textContent = __( 'Open dossier · view full record + chat', 'desktop-mode' );
		openBtn.addEventListener( 'click', () => {
			host.navigate( {
				kind: 'detail',
				entityId: 'agents',
				postId: agent.id,
				postTitle: agent.name,
			} );
		} );
		openRow.appendChild( openBtn );
		root.appendChild( openRow );

		root.appendChild( buildIdentitySection( agent ) );
		root.appendChild( buildInstructionsSection( agent ) );
		root.appendChild( buildAbilitiesSection( agent ) );
		root.appendChild( buildTriggersSection( agent ) );
		root.appendChild( buildAdvancedSection( agent ) );
		root.appendChild( buildDangerZone( agent ) );

		return root;
	}

	function buildEditHeader( agent: Agent ): HTMLElement {
		const header = document.createElement( 'header' );
		header.className = 'desktop-mode-my-wordpress__agent-header';

		const iconHost = document.createElement( 'img' );
		iconHost.className = 'desktop-mode-my-wordpress__agent-header-icon';
		iconHost.src = agent.avatarUrl || BOT_ICON_DATA_URI;
		iconHost.alt = '';
		iconHost.setAttribute( 'aria-hidden', 'true' );
		header.appendChild( iconHost );

		const titleWrap = document.createElement( 'div' );
		titleWrap.className =
			'desktop-mode-my-wordpress__agent-header-title';

		const h2 = document.createElement( 'h2' );
		h2.textContent = agent.name;
		titleWrap.appendChild( h2 );

		if ( agent.description ) {
			const desc = document.createElement( 'p' );
			desc.textContent = agent.description;
			titleWrap.appendChild( desc );
		}
		header.appendChild( titleWrap );

		if ( agent.role ) {
			const chip = document.createElement( 'wpd-chip' );
			chip.setAttribute( 'tone', 'accent' );
			chip.setAttribute( 'size', 'compact' );
			chip.setAttribute( 'label', agent.role );
			header.appendChild( chip );
		}

		return header;
	}

	function buildSection( title: string, body: HTMLElement ): HTMLElement {
		const section = document.createElement( 'section' );
		section.className = 'desktop-mode-my-wordpress__agent-section';
		const h3 = document.createElement( 'h3' );
		h3.textContent = title;
		section.appendChild( h3 );
		section.appendChild( body );
		return section;
	}

	function buildIdentitySection( agent: Agent ): HTMLElement {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-identity';

		const nameField = document.createElement( 'wpd-text-field' );
		nameField.setAttribute( 'label', __( 'Name', 'desktop-mode' ) );
		nameField.setAttribute( 'value', agent.name );
		nameField.addEventListener( 'wpd-input-commit', async ( ev ) => {
			const value = (
				ev as CustomEvent< { value: string } >
			).detail.value.trim();
			if ( value === '' || value === agent.name ) {
				return;
			}
			await commitPatch( agent.id, { name: value } );
		} );
		body.appendChild( nameField );

		const descField = document.createElement( 'wpd-text-field' );
		descField.setAttribute(
			'label',
			__( 'Description', 'desktop-mode' ),
		);
		descField.setAttribute( 'value', agent.description );
		descField.addEventListener( 'wpd-input-commit', async ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			if ( value === agent.description ) {
				return;
			}
			await commitPatch( agent.id, { description: value } );
		} );
		body.appendChild( descField );

		const roleLabel = document.createElement( 'label' );
		roleLabel.textContent = __( 'Role', 'desktop-mode' );
		body.appendChild( roleLabel );

		const roleSelect = document.createElement( 'wpd-select' );
		for ( const role of DEFAULT_AGENT_ROLE_CHOICES ) {
			const opt = document.createElement( 'wpd-option' );
			opt.setAttribute( 'value', role.slug );
			opt.textContent = role.label;
			roleSelect.appendChild( opt );
		}
		roleSelect.setAttribute( 'value', agent.role || 'editor' );
		roleSelect.addEventListener( 'wpd-pick', async ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			if ( value === agent.role ) {
				return;
			}
			try {
				const next = await setRole( agent.id, value );
				replaceAgentInState( next );
			} catch ( error ) {
				showToast(
					error instanceof Error
						? error.message
						: __( 'Could not update role.', 'desktop-mode' ),
				);
			}
		} );
		body.appendChild( roleSelect );

		return buildSection( __( 'Identity', 'desktop-mode' ), body );
	}

	function buildInstructionsSection( agent: Agent ): HTMLElement {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-define';
		const textarea = document.createElement( 'wpd-textarea' );
		textarea.setAttribute( 'rows', '8' );
		textarea.setAttribute( 'value', agent.instructions );
		textarea.addEventListener( 'wpd-input-commit', async ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			if ( value === agent.instructions ) {
				return;
			}
			await commitPatch( agent.id, { instructions: value } );
		} );
		body.appendChild( textarea );

		return buildSection(
			__( 'Instructions (system prompt)', 'desktop-mode' ),
			body,
		);
	}

	function buildAbilitiesSection( agent: Agent ): HTMLElement {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-tools';

		const meta = document.createElement( 'p' );
		meta.className = 'desktop-mode-my-wordpress__agent-tools-meta';
		body.appendChild( meta );

		const ul = document.createElement( 'ul' );
		ul.className = 'desktop-mode-my-wordpress__agent-tools-list';
		body.appendChild( ul );

		const abilities = caches.abilities ?? [];
		const enabled = new Set( agent.abilities );

		const updateMeta = (): void => {
			meta.textContent = sprintf(
				// translators: 1: count of enabled abilities, 2: total abilities.
				__( '%1$d of %2$d abilities enabled', 'desktop-mode' ),
				enabled.size,
				abilities.length,
			);
		};

		if ( abilities.length === 0 ) {
			updateMeta();
			const empty = document.createElement( 'p' );
			empty.textContent = __(
				'No abilities registered on this site. Register one with wp_register_ability() (WordPress 6.9 Abilities API), or filter desktop_mode_agent_abilities_catalogue.',
				'desktop-mode',
			);
			ul.appendChild( empty );
			return buildSection( __( 'Abilities', 'desktop-mode' ), body );
		}

		// Build the list ONCE. Toggling an ability mutates only the
		// affected row (class + checked attribute + meta count) — we
		// no longer rebuild the entire <ul>, because that destroyed
		// the focused checkbox and triggered a scroll-to-top.
		for ( const ability of abilities ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-my-wordpress__agent-tools-row';
			if ( enabled.has( ability.slug ) ) {
				li.classList.add(
					'desktop-mode-my-wordpress__agent-tools-row--on',
				);
			}
			const checkbox = document.createElement( 'wpd-checkbox' );
			if ( enabled.has( ability.slug ) ) {
				checkbox.setAttribute( 'checked', '' );
			}
			checkbox.addEventListener( 'wpd-checkbox-change', async () => {
				const checked =
					checkbox.getAttribute( 'checked' ) !== null;
				const prev = new Set( enabled );
				// Optimistic flip — UI updates before round-trip.
				if ( checked ) {
					enabled.add( ability.slug );
				} else {
					enabled.delete( ability.slug );
				}
				li.classList.toggle(
					'desktop-mode-my-wordpress__agent-tools-row--on',
					checked,
				);
				updateMeta();
				try {
					const updated = await setAbilities(
						agent.id,
						Array.from( enabled ),
					);
					// Re-sync to the server's canonical answer in
					// case a filter rewrote the list. No DOM rebuild.
					enabled.clear();
					updated.abilities.forEach( ( s ) =>
						enabled.add( s ),
					);
					replaceAgentInState( updated );
				} catch ( error ) {
					// Roll back optimistic flip + visual state.
					enabled.clear();
					prev.forEach( ( s ) => enabled.add( s ) );
					checkbox.toggleAttribute( 'checked', ! checked );
					li.classList.toggle(
						'desktop-mode-my-wordpress__agent-tools-row--on',
						! checked,
					);
					updateMeta();
					showToast(
						error instanceof Error
							? error.message
							: __(
								'Could not update abilities.',
								'desktop-mode',
							),
					);
				}
			} );
			li.appendChild( checkbox );

			const block = document.createElement( 'div' );
			block.className =
				'desktop-mode-my-wordpress__agent-tools-body';
			const code = document.createElement( 'code' );
			code.textContent = ability.slug;
			const help = document.createElement( 'small' );
			help.textContent = ability.description;
			block.appendChild( code );
			block.appendChild( help );
			li.appendChild( block );

			ul.appendChild( li );
		}
		updateMeta();

		return buildSection( __( 'Abilities', 'desktop-mode' ), body );
	}

	function buildTriggersSection( agent: Agent ): HTMLElement {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-triggers-host';

		const notice = document.createElement( 'wpd-notice' );
		notice.setAttribute( 'tone', 'info' );
		notice.textContent = __(
			'Triggers are stored, not yet invoked — runtime wiring ships in a later iteration.',
			'desktop-mode',
		);
		body.appendChild( notice );

		const panel = buildTriggersPanel( {
			triggers: agent.triggers.slice(),
			kinds: caches.triggerKinds ?? [],
			hooks: caches.hooks ?? [],
			onChange: async ( triggers: Trigger[] ) => {
				try {
					const updated = await setTriggers( agent.id, triggers );
					replaceAgentInState( updated );
				} catch ( error ) {
					showToast(
						error instanceof Error
							? error.message
							: __(
								'Could not update triggers.',
								'desktop-mode',
							),
					);
				}
			},
		} );
		body.appendChild( panel );

		return buildSection( __( 'Triggers', 'desktop-mode' ), body );
	}

	function buildAdvancedSection( agent: Agent ): HTMLElement {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-advanced';

		// Visibility — maps to `wp_guideline.post_status`. `publish`
		// is the default and the only status pushmd projects into
		// the synthetic Git tree, so this is THE switch for
		// "share my agent across the ecosystem" vs "keep it on this
		// site only." Aligns with PR #78296's per-row `read_post`
		// gate.
		const statusLabel = document.createElement( 'label' );
		statusLabel.textContent = __( 'Visibility', 'desktop-mode' );
		body.appendChild( statusLabel );

		const statusSelect = document.createElement( 'wpd-select' );
		for ( const opt of [
			{
				value: 'publish',
				label: __(
					'Published — visible to other agent runtimes (Dolly, pushmd, Claude Code).',
					'desktop-mode',
				),
			},
			{
				value: 'private',
				label: __(
					'Private — only this site can read; pushmd skips.',
					'desktop-mode',
				),
			},
			{
				value: 'draft',
				label: __( 'Draft — same visibility as private.', 'desktop-mode' ),
			},
		] ) {
			const option = document.createElement( 'wpd-option' );
			option.setAttribute( 'value', opt.value );
			option.textContent = opt.label;
			statusSelect.appendChild( option );
		}
		statusSelect.setAttribute( 'value', agent.status || 'publish' );
		statusSelect.addEventListener( 'wpd-pick', async ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			if ( value === agent.status ) {
				return;
			}
			await commitPatch( agent.id, { status: value } );
		} );
		body.appendChild( statusSelect );

		const modelField = document.createElement( 'wpd-text-field' );
		modelField.setAttribute(
			'label',
			__( 'Model override (optional)', 'desktop-mode' ),
		);
		modelField.setAttribute( 'value', agent.model );
		modelField.setAttribute(
			'placeholder',
			__(
				'Empty = use the site default',
				'desktop-mode',
			),
		);
		modelField.addEventListener( 'wpd-input-commit', async ( ev ) => {
			const value = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			if ( value === agent.model ) {
				return;
			}
			await commitPatch( agent.id, { model: value } );
		} );
		body.appendChild( modelField );

		const rateField = document.createElement( 'wpd-text-field' );
		rateField.setAttribute( 'type', 'number' );
		rateField.setAttribute(
			'label',
			__( 'Rate limit (invocations / hour)', 'desktop-mode' ),
		);
		rateField.setAttribute( 'value', String( agent.rateLimit || '' ) );
		rateField.setAttribute(
			'placeholder',
			__( '0 = unlimited', 'desktop-mode' ),
		);
		rateField.addEventListener( 'wpd-input-commit', async ( ev ) => {
			const raw = ( ev as CustomEvent< { value: string } > ).detail
				.value;
			const parsed = Number.parseInt( raw, 10 );
			const value = Number.isFinite( parsed ) && parsed > 0 ? parsed : 0;
			if ( value === agent.rateLimit ) {
				return;
			}
			await commitPatch( agent.id, { rateLimit: value } );
		} );
		body.appendChild( rateField );

		return buildSection( __( 'Advanced', 'desktop-mode' ), body );
	}

	function buildDangerZone( agent: Agent ): HTMLElement {
		const dangerBody = document.createElement( 'div' );
		dangerBody.className = 'desktop-mode-my-wordpress__agent-danger';

		const desc = document.createElement( 'p' );
		desc.textContent = __(
			'Deleting an agent removes the synthetic user and its linked guideline. This cannot be undone.',
			'desktop-mode',
		);
		dangerBody.appendChild( desc );

		const deleteBtn = document.createElement( 'wpd-button' );
		deleteBtn.setAttribute( 'variant', 'danger' );
		deleteBtn.textContent = __( 'Delete agent', 'desktop-mode' );
		deleteBtn.addEventListener( 'click', async () => {
			const confirmed = await wpdConfirm( {
				title: __( 'Delete agent?', 'desktop-mode' ),
				message: sprintf(
					// translators: %s is the agent's name.
					__(
						'Delete %s? Its user account and guideline will be removed.',
						'desktop-mode',
					),
					agent.name,
				),
				confirmLabel: __( 'Delete', 'desktop-mode' ),
				cancelLabel: __( 'Cancel', 'desktop-mode' ),
				danger: true,
			} );
			if ( ! confirmed ) {
				return;
			}
			deleteBtn.setAttribute( 'disabled', '' );
			try {
				await deleteAgent( agent.id );
				removeAgentFromCache( agent.id );
				state.agents = state.agents.filter(
					( a ) => a.id !== agent.id,
				);
				state.selectedId = null;
				paintList();
				paintDetail();
				showToast(
					sprintf(
						// translators: %s is the agent's name.
						__( 'Deleted %s.', 'desktop-mode' ),
						agent.name,
					),
				);
			} catch ( error ) {
				deleteBtn.removeAttribute( 'disabled' );
				showToast(
					error instanceof Error
						? error.message
						: __(
							'Could not delete agent.',
							'desktop-mode',
						),
				);
			}
		} );
		dangerBody.appendChild( deleteBtn );

		return buildSection( __( 'Danger zone', 'desktop-mode' ), dangerBody );
	}

	async function commitPatch(
		id: number,
		patch: Parameters< typeof updateAgent >[ 1 ],
	): Promise< void > {
		try {
			const updated = await updateAgent( id, patch );
			replaceAgentInState( updated );
		} catch ( error ) {
			showToast(
				error instanceof Error
					? error.message
					: __( 'Could not update agent.', 'desktop-mode' ),
			);
		}
	}

	function replaceAgentInState( next: Agent ): void {
		// Keep the send-to context-menu cache in sync. Any trigger
		// change (including add / remove of `send-to`) round-trips
		// the full agent through here, so this is the single point
		// of truth for the cache after CRUD.
		pushAgentToCache( next );

		const index = state.agents.findIndex( ( a ) => a.id === next.id );
		const prev = index >= 0 ? state.agents[ index ] : null;

		if ( index >= 0 ) {
			state.agents[ index ] = next;
		} else {
			state.agents.push( next );
			state.agents.sort( ( a, b ) => a.name.localeCompare( b.name ) );
			paintList();
			return;
		}

		// Most field changes (instructions, abilities, triggers,
		// description, model, rate limit) don't affect anything the
		// LEFT tile list renders — the tile shows only the agent's
		// name + bot glyph. Skip the full repaint to stop the bot
		// icon from flickering on every keystroke. Only rebuild the
		// tile list when the visible field — the name — actually
		// changes, or when sort order would shift.
		if ( ! prev || prev.name === next.name ) {
			return;
		}

		// Name changed — try a surgical attribute update on the
		// existing tile, then rebuild only if sort order needs to
		// shift.
		const tile = listWrap.querySelector< HTMLElement >(
			`wpd-tile[data-agent-id="${ next.id }"]`,
		);
		if ( tile ) {
			tile.setAttribute( 'label', next.name );
		}
		const sorted = state.agents
			.slice()
			.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		const reorder = sorted.some(
			( a, i ) => a.id !== state.agents[ i ].id,
		);
		if ( reorder ) {
			state.agents = sorted;
			paintList();
		}
	}

	// Kick off load.
	void ( async (): Promise< void > => {
		await loadCaches();
		await loadAgents();
	} )();
}

/**
 * "Navigate into" — full-page agent dossier with identity, behaviour,
 * bindings, recent revisions / authored content, plus a chat panel
 * that invokes the agent via OpenAI.
 *
 * @internal
 */
function paintDossier(
	host: Parameters< EntityRenderer >[ 0 ],
	agentId: number,
): void {
	host.body.replaceChildren();

	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-dossier';
	host.body.appendChild( wrap );

	// Loading host — a self-centering container so the WP-logo
	// spinner sits in the middle of the panel during the dossier
	// REST fetch instead of pinned at the top-left.
	const loadingHost = document.createElement( 'div' );
	loadingHost.className =
		'desktop-mode-my-wordpress__agent-dossier-loading';
	const loading = document.createElement( 'wpd-spinner' );
	loading.setAttribute( 'size', 'large' );
	loadingHost.appendChild( loading );
	wrap.appendChild( loadingHost );

	void ( async (): Promise< void > => {
		let dossier: AgentDossier;
		try {
			dossier = await fetchAgentDossier( agentId );
		} catch ( error ) {
			wrap.replaceChildren();
			wrap.appendChild(
				buildErrorBlock(
					error instanceof Error
						? error.message
						: __(
							'Could not load this agent.',
							'desktop-mode',
						),
				),
			);
			return;
		}
		wrap.replaceChildren();
		const node = renderDossier( host, dossier );
		wrap.appendChild( node );
		// If the user opened the dossier via "View activity" in the
		// tile context menu, scroll the Activity section into view
		// after layout settles.
		const focus = consumeAgentDossierFocus();
		if ( focus === 'activity' ) {
			const activitySection = node.querySelector(
				'.desktop-mode-my-wordpress__agent-dossier-section--activity',
			);
			activitySection?.scrollIntoView( {
				behavior: 'smooth',
				block: 'start',
			} );
		}
	} )();
}

function renderDossier(
	host: Parameters< EntityRenderer >[ 0 ],
	dossier: AgentDossier,
): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'desktop-mode-my-wordpress__agent-dossier-content';

	// Header — back button, avatar, name, status badge.
	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__agent-dossier-header';

	const back = document.createElement( 'wpd-button' );
	back.setAttribute( 'variant', 'tertiary' );
	back.setAttribute( 'size', 'compact' );
	back.textContent = __( '← Back to agents', 'desktop-mode' );
	back.addEventListener( 'click', () => {
		host.navigate( { kind: 'list', entityId: 'agents' } );
	} );
	header.appendChild( back );

	const iconImg = document.createElement( 'img' );
	iconImg.className =
		'desktop-mode-my-wordpress__agent-dossier-avatar';
	iconImg.src = dossier.avatarUrl || BOT_ICON_DATA_URI;
	iconImg.alt = '';
	header.appendChild( iconImg );

	const titleBlock = document.createElement( 'div' );
	titleBlock.className =
		'desktop-mode-my-wordpress__agent-dossier-title-block';
	const h1 = document.createElement( 'h1' );
	h1.textContent = dossier.name;
	titleBlock.appendChild( h1 );
	const sub = document.createElement( 'p' );
	sub.className = 'desktop-mode-my-wordpress__agent-dossier-sub';
	sub.textContent = [
		dossier.identity.login,
		dossier.role || __( 'no role', 'desktop-mode' ),
		dossier.status,
	].join( ' · ' );
	titleBlock.appendChild( sub );
	header.appendChild( titleBlock );

	root.appendChild( header );

	if ( dossier.description ) {
		const desc = document.createElement( 'p' );
		desc.className = 'desktop-mode-my-wordpress__agent-dossier-desc';
		desc.textContent = dossier.description;
		root.appendChild( desc );
	}

	root.appendChild( buildChatPanel( dossier ) );

	const grid = document.createElement( 'div' );
	grid.className = 'desktop-mode-my-wordpress__agent-dossier-grid';

	grid.appendChild(
		buildDossierSection(
			__( 'Identity', 'desktop-mode' ),
			[
				row( __( 'Display name', 'desktop-mode' ), dossier.name ),
				row( __( 'Username', 'desktop-mode' ), dossier.identity.login ),
				row( __( 'Email', 'desktop-mode' ), dossier.identity.email ),
				row( __( 'Role', 'desktop-mode' ), dossier.role ),
				row(
					__( 'Registered', 'desktop-mode' ),
					formatDate( dossier.identity.registered ),
				),
				row(
					__( 'Login', 'desktop-mode' ),
					dossier.identity.loginBlocked
						? __( '🔒 blocked (agent users cannot sign in)', 'desktop-mode' )
						: __( 'allowed', 'desktop-mode' ),
				),
				row(
					__( 'Password reset', 'desktop-mode' ),
					dossier.identity.pwResetBlocked
						? __( '🔒 disabled', 'desktop-mode' )
						: __( 'enabled', 'desktop-mode' ),
				),
			],
		),
	);

	grid.appendChild(
		buildDossierSection(
			__( 'Behaviour (wp_guideline)', 'desktop-mode' ),
			dossier.guideline
				? [
					row( __( 'Slug', 'desktop-mode' ), dossier.guideline.slug ),
					row(
						__( 'Status', 'desktop-mode' ),
						dossier.guideline.status,
					),
					row(
						__( 'Guideline id', 'desktop-mode' ),
						String( dossier.guideline.id ),
					),
					row(
						__( 'guideline_source', 'desktop-mode' ),
						dossier.guideline.source,
					),
					row(
						__( 'Created', 'desktop-mode' ),
						formatDate( dossier.guideline.created ),
					),
					row(
						__( 'Last modified', 'desktop-mode' ),
						formatDate( dossier.guideline.modified ),
					),
				]
				: [
					row(
						__( 'Guideline', 'desktop-mode' ),
						__( '(missing — broken link)', 'desktop-mode' ),
					),
				],
		),
	);

	const instr = document.createElement( 'section' );
	instr.className = 'desktop-mode-my-wordpress__agent-dossier-section';
	const instrH = document.createElement( 'h3' );
	instrH.textContent = __( 'Instructions (system prompt)', 'desktop-mode' );
	instr.appendChild( instrH );
	const instrPre = document.createElement( 'pre' );
	instrPre.className =
		'desktop-mode-my-wordpress__agent-dossier-instructions';
	instrPre.textContent =
		dossier.instructions || __( '(empty)', 'desktop-mode' );
	instr.appendChild( instrPre );
	grid.appendChild( instr );

	const abilitiesSec = document.createElement( 'section' );
	abilitiesSec.className =
		'desktop-mode-my-wordpress__agent-dossier-section';
	const aH = document.createElement( 'h3' );
	aH.textContent = sprintf(
		// translators: %d is the count of enabled abilities.
		__( 'Abilities (%d enabled)', 'desktop-mode' ),
		dossier.enabledAbilities.length,
	);
	abilitiesSec.appendChild( aH );
	if ( dossier.enabledAbilities.length === 0 ) {
		const none = document.createElement( 'p' );
		none.className = 'desktop-mode-my-wordpress__agent-dossier-empty';
		none.textContent = __(
			'No abilities enabled — the agent cannot call tools.',
			'desktop-mode',
		);
		abilitiesSec.appendChild( none );
	} else {
		const ul = document.createElement( 'ul' );
		ul.className =
			'desktop-mode-my-wordpress__agent-dossier-abilities';
		for ( const ab of dossier.enabledAbilities ) {
			const li = document.createElement( 'li' );
			const code = document.createElement( 'code' );
			code.textContent = ab.slug;
			li.appendChild( code );
			const small = document.createElement( 'small' );
			small.textContent = ab.description || ab.label;
			li.appendChild( small );
			ul.appendChild( li );
		}
		abilitiesSec.appendChild( ul );
	}
	grid.appendChild( abilitiesSec );

	const triggersSec = document.createElement( 'section' );
	triggersSec.className =
		'desktop-mode-my-wordpress__agent-dossier-section';
	const tH = document.createElement( 'h3' );
	tH.textContent = sprintf(
		// translators: %d is the count of triggers.
		__( 'Triggers (%d)', 'desktop-mode' ),
		dossier.triggers.length,
	);
	triggersSec.appendChild( tH );
	if ( dossier.triggers.length === 0 ) {
		const none = document.createElement( 'p' );
		none.className = 'desktop-mode-my-wordpress__agent-dossier-empty';
		none.textContent = __(
			'No triggers configured.',
			'desktop-mode',
		);
		triggersSec.appendChild( none );
	} else {
		const ul = document.createElement( 'ul' );
		ul.className = 'desktop-mode-my-wordpress__agent-dossier-triggers';
		for ( const tr of dossier.triggers ) {
			const li = document.createElement( 'li' );
			const strong = document.createElement( 'strong' );
			strong.textContent = String( tr.kind );
			li.appendChild( strong );
			const small = document.createElement( 'small' );
			small.textContent = JSON.stringify( tr.config );
			li.appendChild( small );
			ul.appendChild( li );
		}
		triggersSec.appendChild( ul );
	}
	grid.appendChild( triggersSec );

	const revisionsSec = document.createElement( 'section' );
	revisionsSec.className =
		'desktop-mode-my-wordpress__agent-dossier-section';
	const rH = document.createElement( 'h3' );
	rH.textContent = sprintf(
		// translators: %d is the revision count.
		__( 'Guideline revisions (%d)', 'desktop-mode' ),
		dossier.revisions.count,
	);
	revisionsSec.appendChild( rH );
	if ( dossier.revisions.recent.length === 0 ) {
		const none = document.createElement( 'p' );
		none.className = 'desktop-mode-my-wordpress__agent-dossier-empty';
		none.textContent = __( 'No revisions yet.', 'desktop-mode' );
		revisionsSec.appendChild( none );
	} else {
		const ul = document.createElement( 'ul' );
		ul.className =
			'desktop-mode-my-wordpress__agent-dossier-revisions';
		for ( const rev of dossier.revisions.recent ) {
			const li = document.createElement( 'li' );
			li.textContent = sprintf(
				// translators: 1: revision date, 2: author name.
				__( '%1$s by %2$s', 'desktop-mode' ),
				formatDate( rev.date ),
				rev.authorName || `#${ rev.authorId }`,
			);
			ul.appendChild( li );
		}
		revisionsSec.appendChild( ul );
	}
	grid.appendChild( revisionsSec );

	const authoredSec = document.createElement( 'section' );
	authoredSec.className =
		'desktop-mode-my-wordpress__agent-dossier-section';
	const auH = document.createElement( 'h3' );
	auH.textContent = sprintf(
		// translators: %d is the count.
		__( 'Posts authored by this agent (%d shown)', 'desktop-mode' ),
		dossier.authored.recent.length,
	);
	authoredSec.appendChild( auH );
	if ( dossier.authored.recent.length === 0 ) {
		const none = document.createElement( 'p' );
		none.className = 'desktop-mode-my-wordpress__agent-dossier-empty';
		none.textContent = __(
			'The agent has not authored any posts yet.',
			'desktop-mode',
		);
		authoredSec.appendChild( none );
	} else {
		const ul = document.createElement( 'ul' );
		ul.className =
			'desktop-mode-my-wordpress__agent-dossier-authored';
		for ( const p of dossier.authored.recent ) {
			const li = document.createElement( 'li' );
			const a = document.createElement( 'a' );
			a.href = p.editLink || '#';
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = p.title || `(#${ p.id })`;
			li.appendChild( a );
			const small = document.createElement( 'small' );
			small.textContent =
				p.type + ' · ' + p.status + ' · ' + formatDate( p.modified );
			li.appendChild( small );
			ul.appendChild( li );
		}
		authoredSec.appendChild( ul );
	}
	grid.appendChild( authoredSec );

	// Activity log — every invocation logged by the runner. Most-
	// recent first, capped server-side at 25.
	const activitySec = document.createElement( 'section' );
	activitySec.className =
		'desktop-mode-my-wordpress__agent-dossier-section ' +
		'desktop-mode-my-wordpress__agent-dossier-section--activity';
	const acH = document.createElement( 'h3' );
	acH.textContent = sprintf(
		// translators: %d is the total invocation count persisted server-side.
		__( 'Activity (%d total)', 'desktop-mode' ),
		dossier.activity.total,
	);
	activitySec.appendChild( acH );
	if ( dossier.activity.recent.length === 0 ) {
		const none = document.createElement( 'p' );
		none.className = 'desktop-mode-my-wordpress__agent-dossier-empty';
		none.textContent = __(
			'The agent hasn\'t been invoked yet — send it something with Send to… or use the chat panel above.',
			'desktop-mode',
		);
		activitySec.appendChild( none );
	} else {
		const ul = document.createElement( 'ul' );
		ul.className =
			'desktop-mode-my-wordpress__agent-dossier-activity';
		for ( const entry of dossier.activity.recent ) {
			const li = document.createElement( 'li' );
			li.classList.add(
				'desktop-mode-my-wordpress__agent-dossier-activity-row',
			);
			if ( entry.status === 'error' ) {
				li.classList.add(
					'desktop-mode-my-wordpress__agent-dossier-activity-row--error',
				);
			}
			const head = document.createElement( 'div' );
			head.className =
				'desktop-mode-my-wordpress__agent-dossier-activity-head';
			const when = document.createElement( 'time' );
			when.textContent = formatDate(
				new Date( entry.time * 1000 ).toISOString(),
			);
			const who = document.createElement( 'span' );
			who.textContent = entry.userName || `#${ entry.userId }`;
			const summary = document.createElement( 'span' );
			summary.className =
				'desktop-mode-my-wordpress__agent-dossier-activity-summary';
			summary.textContent =
				entry.status === 'error'
					? sprintf(
						// translators: %s is the error message.
						__( '⚠ failed — %s', 'desktop-mode' ),
						entry.error,
					)
					: sprintf(
						// translators: 1: turn count, 2: tool-call count.
						__(
							'✓ %1$d turn(s), %2$d tool call(s)',
							'desktop-mode',
						),
						entry.turns,
						entry.toolCallsCount,
					);
			head.appendChild( when );
			head.appendChild( who );
			head.appendChild( summary );
			li.appendChild( head );

			if ( entry.message ) {
				const msg = document.createElement( 'p' );
				msg.className =
					'desktop-mode-my-wordpress__agent-dossier-activity-msg';
				msg.textContent = entry.message;
				li.appendChild( msg );
			}
			if ( entry.toolNames.length > 0 ) {
				const tools = document.createElement( 'p' );
				tools.className =
					'desktop-mode-my-wordpress__agent-dossier-activity-tools';
				tools.textContent = entry.toolNames.join( ' → ' );
				li.appendChild( tools );
			}
			if ( entry.text ) {
				const reply = document.createElement( 'p' );
				reply.className =
					'desktop-mode-my-wordpress__agent-dossier-activity-reply';
				reply.textContent = entry.text;
				li.appendChild( reply );
			}
			ul.appendChild( li );
		}
		activitySec.appendChild( ul );
	}
	grid.appendChild( activitySec );

	root.appendChild( grid );

	return root;
}

function buildChatPanel( dossier: AgentDossier ): HTMLElement {
	const panel = document.createElement( 'section' );
	panel.className = 'desktop-mode-my-wordpress__agent-dossier-chat';

	const h = document.createElement( 'h3' );
	h.textContent = __( 'Run agent', 'desktop-mode' );
	panel.appendChild( h );

	const intro = document.createElement( 'p' );
	intro.className =
		'desktop-mode-my-wordpress__agent-dossier-chat-intro';
	intro.textContent = __(
		"Send a message — the agent runs with OpenAI using its system prompt and enabled abilities. Tool calls execute under the agent's role.",
		'desktop-mode',
	);
	panel.appendChild( intro );

	const transcript = document.createElement( 'div' );
	transcript.className =
		'desktop-mode-my-wordpress__agent-dossier-chat-transcript';
	panel.appendChild( transcript );

	const inputRow = document.createElement( 'div' );
	inputRow.className =
		'desktop-mode-my-wordpress__agent-dossier-chat-input-row';

	const input = document.createElement( 'wpd-textarea' );
	input.setAttribute( 'rows', '3' );
	input.setAttribute(
		'placeholder',
		__( 'What do you want this agent to do?', 'desktop-mode' ),
	);
	inputRow.appendChild( input );

	const sendBtn = document.createElement( 'wpd-button' );
	sendBtn.setAttribute( 'variant', 'primary' );
	sendBtn.textContent = __( 'Send', 'desktop-mode' );
	inputRow.appendChild( sendBtn );

	panel.appendChild( inputRow );

	const dispatch = async (): Promise< void > => {
		const message = readTextareaValue( input ).trim();
		if ( message === '' ) {
			return;
		}
		transcript.appendChild(
			buildChatMessage( __( 'You', 'desktop-mode' ), message, 'user' ),
		);
		input.setAttribute( 'value', '' );
		sendBtn.setAttribute( 'disabled', '' );
		sendBtn.textContent = __( 'Running…', 'desktop-mode' );

		try {
			const result = await invokeAgent( dossier.id, message );
			if ( result.toolCalls.length > 0 ) {
				for ( const tc of result.toolCalls ) {
					transcript.appendChild( buildToolCallEntry( tc ) );
				}
			}
			transcript.appendChild(
				buildChatMessage(
					dossier.name,
					result.text || __( '(no reply)', 'desktop-mode' ),
					'agent',
				),
			);
		} catch ( error ) {
			const errMsg =
				error instanceof Error
					? error.message
					: __( 'Could not invoke agent.', 'desktop-mode' );
			transcript.appendChild(
				buildChatMessage(
					__( 'Error', 'desktop-mode' ),
					errMsg,
					'error',
				),
			);
		} finally {
			sendBtn.removeAttribute( 'disabled' );
			sendBtn.textContent = __( 'Send', 'desktop-mode' );
			transcript.scrollTop = transcript.scrollHeight;
		}
	};

	sendBtn.addEventListener( 'click', () => void dispatch() );
	input.addEventListener( 'wpd-submit', () => void dispatch() );

	return panel;
}

function buildChatMessage(
	who: string,
	body: string,
	kind: 'user' | 'agent' | 'error',
): HTMLElement {
	const div = document.createElement( 'div' );
	div.className =
		'desktop-mode-my-wordpress__agent-dossier-chat-message ' +
		`desktop-mode-my-wordpress__agent-dossier-chat-message--${ kind }`;
	const head = document.createElement( 'strong' );
	head.textContent = who;
	div.appendChild( head );
	const p = document.createElement( 'p' );
	p.textContent = body;
	div.appendChild( p );
	return div;
}

function buildToolCallEntry( tc: AgentToolCall ): HTMLElement {
	const div = document.createElement( 'details' );
	div.className =
		'desktop-mode-my-wordpress__agent-dossier-chat-toolcall';
	if ( tc.error ) {
		div.classList.add(
			'desktop-mode-my-wordpress__agent-dossier-chat-toolcall--error',
		);
	}
	const summary = document.createElement( 'summary' );
	summary.textContent = tc.error
		? sprintf(
			// translators: 1: ability slug, 2: error message.
			__( '🛠 %1$s — %2$s', 'desktop-mode' ),
			tc.name,
			tc.error,
		)
		: sprintf(
			// translators: %s is the ability slug.
			__( '🛠 %s', 'desktop-mode' ),
			tc.name,
		);
	div.appendChild( summary );
	const pre = document.createElement( 'pre' );
	pre.textContent =
		'args: ' +
		JSON.stringify( tc.args, null, 2 ) +
		'\n\nresult:\n' +
		JSON.stringify( tc.output, null, 2 );
	div.appendChild( pre );
	return div;
}

function buildDossierSection(
	title: string,
	rows: Array< { label: string; value: string } >,
): HTMLElement {
	const section = document.createElement( 'section' );
	section.className = 'desktop-mode-my-wordpress__agent-dossier-section';
	const h = document.createElement( 'h3' );
	h.textContent = title;
	section.appendChild( h );
	const dl = document.createElement( 'dl' );
	dl.className = 'desktop-mode-my-wordpress__agent-dossier-rows';
	for ( const r of rows ) {
		const dt = document.createElement( 'dt' );
		dt.textContent = r.label;
		const dd = document.createElement( 'dd' );
		dd.textContent = r.value;
		dl.appendChild( dt );
		dl.appendChild( dd );
	}
	section.appendChild( dl );
	return section;
}

function row( label: string, value: string ): { label: string; value: string } {
	return { label, value };
}

function formatDate( raw: string ): string {
	if ( ! raw ) {
		return '—';
	}
	const d = new Date( raw.replace( ' ', 'T' ) + 'Z' );
	if ( Number.isNaN( d.getTime() ) ) {
		return raw;
	}
	return d.toLocaleString();
}

/**
 * Right-click context menu for an agent tile. Two semantic options
 * plus a destructive one — kept narrow so the menu doesn't compete
 * with the much fuller dossier surface it routes into.
 *
 * @internal
 */
function openAgentContextMenu(
	agent: Agent,
	host: Parameters< EntityRenderer >[ 0 ],
	pos: { x: number; y: number },
	onConfirmDelete: () => Promise< void >,
): void {
	closeAgentContextMenu();

	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'desktop-mode-my-wordpress__agent-context-menu' );
	( menu as HTMLElement ).style.position = 'fixed';
	( menu as HTMLElement ).style.left = `${ pos.x }px`;
	( menu as HTMLElement ).style.top = `${ pos.y }px`;

	const addOpt = ( id: string, icon: string, label: string, danger = false ): void => {
		const opt = document.createElement( 'wpd-context-menu-option' );
		( opt as HTMLElement ).dataset.menuItemId = id;
		opt.setAttribute( 'value', id );
		opt.setAttribute( 'icon', icon );
		if ( danger ) {
			opt.setAttribute( 'danger', '' );
		}
		opt.textContent = label;
		menu.appendChild( opt );
	};

	addOpt( 'open-dossier', 'dashicons-superhero', __( 'Open dossier', 'desktop-mode' ) );
	addOpt( 'view-activity', 'dashicons-list-view', __( 'View activity', 'desktop-mode' ) );
	addOpt( 'delete', 'dashicons-trash', __( 'Delete agent', 'desktop-mode' ), true );

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		closeAgentContextMenu();
		if ( detail.id === 'open-dossier' || detail.id === 'view-activity' ) {
			host.navigate( {
				kind: 'detail',
				entityId: 'agents',
				postId: agent.id,
				postTitle: agent.name,
			} );
			// View-activity is the same destination plus a #activity
			// hash so the dossier can auto-scroll into the Activity
			// section. Read by `paintDossier`.
			if ( detail.id === 'view-activity' ) {
				lastAgentDossierFocus = 'activity';
			}
			return;
		}
		if ( detail.id === 'delete' ) {
			void onConfirmDelete();
		}
	} );

	document.body.appendChild( menu );
	activeAgentContextMenu = menu;

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
		const onPointer = ( ev: PointerEvent ): void => {
			if ( ev.target instanceof Node && menu.contains( ev.target ) ) {
				return;
			}
			closeAgentContextMenu();
		};
		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' ) {
				closeAgentContextMenu();
			}
		};
		document.addEventListener( 'pointerdown', onPointer );
		document.addEventListener( 'keydown', onKey );
		agentContextMenuTeardown = (): void => {
			document.removeEventListener( 'pointerdown', onPointer );
			document.removeEventListener( 'keydown', onKey );
		};
	} );
}

let activeAgentContextMenu: HTMLElement | null = null;
let agentContextMenuTeardown: ( () => void ) | null = null;
let lastAgentDossierFocus: 'activity' | null = null;

function closeAgentContextMenu(): void {
	if ( activeAgentContextMenu ) {
		activeAgentContextMenu.remove();
		activeAgentContextMenu = null;
	}
	if ( agentContextMenuTeardown ) {
		agentContextMenuTeardown();
		agentContextMenuTeardown = null;
	}
}

/**
 * Read-and-clear of the pending dossier scroll target. Returns the
 * section id the caller should scroll into focus, then clears so a
 * subsequent open without an explicit "view activity" lands at the
 * top of the dossier.
 *
 * @internal
 */
function consumeAgentDossierFocus(): 'activity' | null {
	const v = lastAgentDossierFocus;
	lastAgentDossierFocus = null;
	return v;
}

function paintLoading( host: HTMLElement ): void {
	host.replaceChildren();
	const spinner = document.createElement( 'wpd-spinner' );
	host.appendChild( spinner );
}

function buildErrorBlock( message: string ): HTMLElement {
	const notice = document.createElement( 'wpd-notice' );
	notice.setAttribute( 'tone', 'danger' );
	notice.textContent = message;
	return notice;
}

function readFieldValue( field: HTMLElement ): string {
	// `wpd-text-field` sets `.value` on the host element from its
	// internal input handler — read the property, not the attribute
	// (which only carries the initial value, not the typed value).
	const prop = ( field as unknown as { value?: unknown } ).value;
	if ( typeof prop === 'string' ) {
		return prop;
	}
	const attr = field.getAttribute( 'value' );
	return typeof attr === 'string' ? attr : '';
}

function readTextareaValue( field: HTMLElement ): string {
	const prop = ( field as unknown as { value?: unknown } ).value;
	if ( typeof prop === 'string' ) {
		return prop;
	}
	const attr = field.getAttribute( 'value' );
	return typeof attr === 'string' ? attr : '';
}

function readSelectValue( field: HTMLElement ): string {
	const prop = ( field as unknown as { value?: unknown } ).value;
	if ( typeof prop === 'string' ) {
		return prop;
	}
	const attr = field.getAttribute( 'value' );
	return typeof attr === 'string' ? attr : '';
}
