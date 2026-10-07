import { __, html, type TemplateResult } from '@openstation/app';
import {
	faceFromSeed,
	faceSrc,
	hasFace,
} from './agents-face';
import { openAgentChat } from '../../../src/agents-chat-store';
import { openUserEditWindow } from '../../../src/open-targets/user-edit-window';
import type {
	Agent,
	PreviewAgent,
	RoleChoice,
} from '../../../src/agents-types';
import {
	shell,
	uiOf,
	type AgentsPayload,
	type AppAgent,
	type CastDraft,
	type Ctx,
} from './types';

export const ENTITY_KIND_CHOICES = [ 'post', 'page', 'media', 'user', 'comment' ];

export const ABILITY_COLLAPSE_THRESHOLD = 12;

export const STEP_LAUNCH = 4 as const;

export function newSeed(): number {
	return Math.floor( Math.random() * 0xffffff ) + 1;
}

export function emptyCast( role: string, seed: number ): CastDraft {
	return {
		brief: '',
		name: '',
		description: '',
		vibes: '',
		instructions: '',
		role,
		abilities: [],

		triggers: [ { kind: 'chat', config: {} } ],
		copiedFrom: '',
		faceSeed: seed,
		face: faceFromSeed( seed ),
		stripSeed: seed,
		drafting: false,
	};
}

export function agentDefaultRole( roles: RoleChoice[] | null ): string {
	if ( ! roles || roles.length === 0 || roles.some( ( r ) => r.slug === 'author' ) ) {
		return 'author';
	}
	return roles[ 0 ].slug;
}

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

export function agentsRosterStamp( list: Agent[] ): string {
	return list
		.map( ( a ) => `${ a.id }:${ a.triggers.map( ( t ) => t.kind ).sort().join( '+' ) }` )
		.join( '|' );
}

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

function openAgentsFeatureSetting(): void {
	shell().openOsSettings?.( { tabId: 'features' } );
}

export function openChatWindow( payload: AgentsPayload, agent: Agent ): void {
	openAgentChat( {
		id: agent.id,
		name: agent.name,
		description: agent.description,
		avatarUrl: agent.avatarUrl,
	} );
	const opened = shell().openWindow?.( payload.runWindowId, { source: 'agents' } );
	if ( ! opened && typeof shell().openWindow !== 'function' ) {
		console.warn(
			'[desktop-mode/agents] wp.os.openWindow is missing — desktop shell may not be ready.',
		);
	}
}

export function openAgentProfile( agent: AppAgent ): void {
	openUserEditWindow( agent.id, {
		source: 'agents/profile',
		fallback: () => {
			if ( ! agent.profileUrl ) {
				return;
			}
			shell().windowManager?.open( {
				id: `user-edit-${ agent.id }`,
				url: agent.profileUrl,
				title: agent.name,
				icon: 'dashicons-admin-users',
			} );
		},
	} );
}

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

export function runAgent(
	ctx: Ctx,
	action: string,
	args?: Record< string, unknown >,
): Promise< boolean > {
	const ui = uiOf( ctx );
	ui.agentBusy = true;
	ctx.repaint();
	return ctx.dispatch( action, args ).finally( () => {
		ui.agentBusy = false;
		ctx.repaint();
	} );
}

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
	const ui = uiOf( ctx );
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
