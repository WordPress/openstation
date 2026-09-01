/**
 * My WordPress — the Agents section: character, cast and doors out.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. WP Explorer's Agents surface, ported
 * 1:1 (`agents-renderer.ts`): this part owns the CHARACTER SYSTEM —
 * seeds and faces, the empty cast, the roster stamp — the openers
 * that leave the window (chat, profile, connectors, desktop), and
 * the landing views: the cast grid, the off-state preview crew, and
 * the AI-provider notice. The detail panes live in
 * `agents-detail.ts`, the wizard in `agents-wizard.ts`.
 *
 * @public
 */

import { __, html, type TemplateResult } from '@openstation/app';
import {
	faceFromSeed,
	faceSrc,
	hasFace,
} from '../../../src/my-wordpress/agents-face';
import { openAgentChat } from '../../../src/agents-chat-store';
import { createSharedStore } from '../../../src/shared-store';
import type {
	Agent,
	PreviewAgent,
	RoleChoice,
} from '../../../src/my-wordpress/agents-types';
import {
	shell,
	uiOf,
	type AgentsPayload,
	type AppAgent,
	type CastDraft,
	type Ctx,
} from './types';

export const ENTITY_KIND_CHOICES = [ 'post', 'page', 'media', 'user', 'comment' ];

/**
 * How many abilities a site needs before the groups start closed.
 * Collapsing is for the site with a shelf of plugins; a stock install
 * has a handful, and starting those closed would hide the feature.
 */
export const ABILITY_COLLAPSE_THRESHOLD = 12;

/** The review step, where Summon continues to. */
export const STEP_LAUNCH = 4 as const;

/**
 * A starting point for a new face. Random here and deterministic from
 * there on: the seed is picked once when a wizard opens and then
 * carried, so paging the strip and coming back lands on the same faces.
 */
export function newSeed(): number {
	return Math.floor( Math.random() * 0xffffff ) + 1;
}

/** A blank agent, with a face already rolled so Meet has something. */
export function emptyCast( role: string, seed: number ): CastDraft {
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

/**
 * Role a fresh wizard starts on: `author` when the site allows it,
 * otherwise the first role the catalogue offers.
 */
export function agentDefaultRole( roles: RoleChoice[] | null ): string {
	if ( ! roles || roles.length === 0 || roles.some( ( r ) => r.slug === 'author' ) ) {
		return 'author';
	}
	return roles[ 0 ].slug;
}

/**
 * The image source for an agent's portrait. Prefers what the server
 * wrote (the one file `get_avatar()` can also point at); falls back to
 * rolling the seed here — deterministic, so it is the same face the
 * write would produce.
 */
export function agentFaceSrc(
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

/**
 * The roster identity `os.agents.roster-changed` watches: who exists
 * and which doors they answer. Fired for WP Explorer's "Send to" cache
 * when it changes, so trigger edits made here reach its menus without
 * a reload.
 */
export function agentsRosterStamp( list: Agent[] ): string {
	return list
		.map( ( a ) => `${ a.id }:${ a.triggers.map( ( t ) => t.kind ).sort().join( '+' ) }` )
		.join( '|' );
}

/** Per-mount sequence so multi-instance windows get unique target ids. */
let agentsMountSeq = 0;
const agentsMountIds = new WeakMap< HTMLElement, number >();

export function agentsMountIdOf( root: HTMLElement ): number {
	let id = agentsMountIds.get( root );
	if ( ! id ) {
		id = ++agentsMountSeq;
		agentsMountIds.set( root, id );
	}
	return id;
}

/**
 * Open OpenStation Preferences on the Features tab, where the `agents`
 * extended option lives.
 */
function openAgentsFeatureSetting(): void {
	shell().openOsSettings?.( { tabId: 'features' } );
}

/** Seed the cross-bundle chat store and open the Agent chat window. */
export function openChatWindow( payload: AgentsPayload, agent: Agent ): void {
	openAgentChat( {
		id: agent.id,
		name: agent.name,
		description: agent.description,
		avatarUrl: agent.avatarUrl,
	} );
	const opened = shell().openWindow?.( payload.runWindowId, { source: 'agents' } );
	if ( ! opened && typeof shell().openWindow !== 'function' ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[desktop-mode/agents] wp.os.openWindow is missing — desktop shell may not be ready.',
		);
	}
}

/**
 * Open the agent's USER profile — same three-step hand-off the users
 * grid uses: seed the user-edit target store, open the native window,
 * fall back to the iframe profile.
 */
export function openAgentProfile( agent: AppAgent ): void {
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

	const desktop = shell();
	const opened = desktop.openWindow?.( 'desktop-mode-user-edit', {
		source: 'agents/profile',
		// Survives a reload; the shared store above does not.
		params: { userId: agent.id },
	} );
	if ( ! opened && agent.profileUrl ) {
		desktop.windowManager?.open( {
			id: `user-edit-${ agent.id }`,
			url: agent.profileUrl,
			title: agent.name,
			icon: 'dashicons-admin-users',
		} );
	}
}

/**
 * Open the Connectors settings screen as a desktop window. A plain
 * `_blank` link would throw the screen out of the shell — and launch
 * the installed PWA. `deriveWindowId` is the shell's own slug
 * derivation, so the screen lands on the window the dock would open.
 */
export function openConnectorsWindow( url: string ): void {
	const desktop = shell();
	if ( ! desktop.windowManager?.open ) {
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
		title: __( 'Connectors' ),
		icon: 'dashicons-admin-settings',
	} );
}

/**
 * Create a wallpaper tile for the agent (a user placement — the same
 * thing dragging the agent out of the Users grid produces). First FREE
 * cell in the same row-major grid the Trash restore flow uses.
 */
export async function sendAgentToDesktop( agent: Agent ): Promise< string > {
	const files = shell().files;
	if ( ! files?.rest?.createPlacement ) {
		return __( 'The desktop files API is not available in this context.' );
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
		return __( 'Agent added to the desktop.' );
	} catch ( err ) {
		return err instanceof Error ? err.message : String( err );
	}
}

/**
 * `<os-option>` list for a role picker. A role the agent already
 * carries but the site no longer registers is appended so the select
 * shows the truth instead of silently reading as the first role.
 */
export function roleOptionsTpl( roles: RoleChoice[], current: string ): TemplateResult {
	const known = roles.some( ( r ) => r.slug === current );
	return html`
		${ roles.map(
			( role ) => html`<os-option value=${ role.slug }>${ role.label }</os-option>`,
		) }
		${ current && ! known
			? html`<os-option value=${ current }>${ current }</os-option>`
			: '' }
	`;
}

/** A mutation dispatch with the busy flag around it. */
export function runAgent(
	ctx: Ctx,
	action: string,
	args?: Record< string, unknown >,
): Promise< boolean > {
	const ui = uiOf( ctx.root );
	ui.agentBusy = true;
	ctx.local( 'repaint' );
	return ctx.dispatch( action, args ).finally( () => {
		ui.agentBusy = false;
		ctx.local( 'repaint' );
	} );
}

/**
 * Silent while the framework is off: a connector is the SECOND thing
 * to fix, and the off state is already saying what the first one is.
 */
export function agentsAiNotice( payload: AgentsPayload ): TemplateResult | '' {
	if ( ! payload.enabled || payload.aiReady ) {
		return '';
	}
	const noProvider = __(
		'No AI provider is configured — agents cannot run until a connector is set up.',
	);
	const noClient = __(
		'This WordPress does not ship the AI Client (WordPress 7.0+). Agents can be defined but not run.',
	);
	// The href stays real so middle-click, cmd-click and "copy link"
	// still behave; only the plain click is claimed for the shell.
	const connectorsLink = html`
		<a
			href=${ payload.connectorsUrl }
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
				openConnectorsWindow( payload.connectorsUrl );
			} }
		>
			${ __( 'Open Connectors settings' ) }
		</a>
	`;
	return html`
		<os-notice tone="warning" class="dm-agents__ai-notice">
			${ payload.aiAvailable ? html`${ noProvider } ${ connectorsLink }` : noClient }
		</os-notice>
	`;
}

/** One cast card's inner column — the real grid and the preview share it. */
function agentsCardInner(
	face: TemplateResult,
	name: string,
	vibes: string,
	description: string,
	roleLabel: string,
): TemplateResult {
	return html`
		<div class="dm-agents__cast-inner">
			${ face }
			<span class="dm-agents__cast-name">${ name }</span>
			${ vibes ? html`<span class="dm-agents__cast-vibes">${ vibes }</span>` : '' }
			<span class="dm-agents__cast-good">${ description }</span>
			<os-badge>${ roleLabel }</os-badge>
		</div>
	`;
}

/**
 * The crew you would get, while the framework is off: the same cards
 * the grid draws once the flag is on, greyed and inert above the
 * button that flips it. Inert all the way down — nothing to select,
 * because none of these are users yet — but deliberately NOT
 * `aria-hidden`: it is the argument this state makes.
 */
function agentsPreviewCast( payload: AgentsPayload ): TemplateResult | null {
	const cast: PreviewAgent[] = payload.preview ?? [];
	if ( cast.length === 0 ) {
		return null;
	}
	return html`
		<div class="dm-agents__cast-head">
			<h3>${ __( 'The crew you would get' ) }</h3>
			<span class="dm-agents__cast-count">${ cast.length }</span>
		</div>
		<div class="dm-agents__cast dm-agents__cast--preview" role="list">
			${ cast.map(
				( member ) => html`
					<os-card class="dm-agents__cast-card" role="listitem">
						${ agentsCardInner(
							html`<img
								class="dm-agents__cast-face"
								src=${ faceSrc( member.face, 88 ) }
								alt=""
								width="88"
								height="88"
							/>`,
							member.name,
							member.vibes,
							member.description,
							member.roleLabel,
						) }
					</os-card>
				`,
			) }
		</div>
	`;
}

/**
 * The cast — faces, not rows. The off-state and the empty state belong
 * to this view: it is what renders when no agent is open, which is
 * exactly when there is something to explain. The door to the wizard
 * is the LAST card: a grid wraps, so it stays in view with the cast
 * around it and reads as the crew's next empty slot.
 */
export function agentsCastGrid( ctx: Ctx, payload: AgentsPayload ): TemplateResult {
	if ( ! payload.enabled ) {
		const offDescription = payload.canEnable
			? __(
				'Turn the Agents framework on in OpenStation Preferences → Features to hire this crew, or cast your own.',
			)
			: __(
				'Ask an administrator to turn the Agents framework on in OpenStation Preferences → Features.',
			);
		const enableButton = payload.canEnable
			? html`
					<os-button
						slot="cta"
						class="dm-agents__enable"
						variant="primary"
						@click=${ () => openAgentsFeatureSetting() }
					>
						${ __( 'Turn on Agents' ) }
					</os-button>
			  `
			: '';
		const cast = agentsPreviewCast( payload );
		// With a crew to show, the explanation shrinks to a bar ABOVE
		// the faces — five cards are taller than the window, and dimming
		// (or scrolling) the way out is how a disabled screen becomes a
		// dead end. With no crew the full empty state carries it alone.
		if ( cast === null ) {
			return html`
				<os-empty-state
					icon="superhero"
					heading=${ __( 'Agents are turned off' ) }
					description=${ offDescription }
				>
					${ enableButton }
				</os-empty-state>
			`;
		}
		return html`
			<div class="dm-agents__off-head">
				<div class="dm-agents__off-copy">
					<h3>${ __( 'Agents are turned off' ) }</h3>
					<p>${ offDescription }</p>
				</div>
				${ enableButton }
			</div>
			${ cast }
		`;
	}
	const ui = uiOf( ctx.root );
	const roleLabel = ( slug: string ): string => payload.roleLabels[ slug ] ?? slug;
	if ( payload.list.length === 0 ) {
		const emptyDescription = payload.canManage
			? __(
				'Cast your first agent: describe what it should do, give it a face and a voice, then pick the abilities it may use.',
			)
			: __( 'An administrator has not created any agents on this site yet.' );
		return html`
			<os-empty-state
				icon="superhero"
				heading=${ __( 'No agents yet' ) }
				description=${ emptyDescription }
			>
				${ payload.canManage
					? html`
							<os-button
								slot="cta"
								class="dm-agents__create"
								variant="primary"
								?disabled=${ ui.agentBusy }
								@click=${ () => ctx.local( 'agent-start' ) }
							>
								${ __( 'Cast an agent' ) }
							</os-button>
					  `
					: '' }
			</os-empty-state>
		`;
	}
	return html`
		<div class="dm-agents__cast-head">
			<h3>${ __( 'Your cast' ) }</h3>
			<span class="dm-agents__cast-count">${ payload.list.length }</span>
		</div>
		<div class="dm-agents__cast" role="list">
			${ payload.list.map(
				( agent ) => html`
					<os-card
						class="dm-agents__cast-card"
						role="listitem"
						interactive
						data-agent-id=${ String( agent.id ) }
						?selected=${ agent.id === ctx.state.item }
						@os-card-click=${ () => void ctx.dispatch( 'open', { item: agent.id } ) }
					>
						${ agentsCardInner(
							html`<img
								class="dm-agents__cast-face"
								src=${ agentFaceSrc( agent, 88 ) }
								alt=""
								width="88"
								height="88"
							/>`,
							agent.name,
							agent.vibes,
							agent.description || __( 'No description yet.' ),
							roleLabel( agent.role ),
						) }
					</os-card>
				`,
			) }
			${ payload.canManage
				? html`
						<os-card
							class="dm-agents__cast-new"
							role="listitem"
							interactive
							?disabled=${ ui.agentBusy }
							@os-card-click=${ () => ctx.local( 'agent-start' ) }
						>
							<div class="dm-agents__cast-inner">
								<span class="dm-agents__cast-plus" aria-hidden="true">+</span>
								<span class="dm-agents__cast-name">${ __( 'Cast a new agent' ) }</span>
								<span class="dm-agents__cast-good">
									${ __( 'Start from one of these, or from scratch.' ) }
								</span>
							</div>
						</os-card>
				  `
				: '' }
		</div>
	`;
}
