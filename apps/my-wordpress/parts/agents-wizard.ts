/**
 * My WordPress — the Agents section: the create wizard.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. Five steps, and a door before them:
 * Describe (the starters and the AI draft), Meet (the face picker,
 * the name, the voice), Powers (role + abilities), Summon (the
 * trigger doors), Launch (the summary card and the create). Every
 * earlier step stays reachable by clicking its number in the trail.
 * `renderAgents()` at the bottom is the section's view switch — the
 * one entry the app's `renderBody()` calls.
 *
 * @public
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import {
	FACE_CANDIDATES,
	faceCandidates,
	faceHueName,
	faceShapeName,
	faceSrc,
} from './agents-face';
import {
	uiOf,
	type AgentsPayload,
	type CastDraft,
	type Ctx,
} from './types';
import {
	STEP_LAUNCH,
	agentFaceSrc,
	agentsAiNotice,
	agentsCastGrid,
	runAgent,
	roleOptionsTpl,
} from './agents';
import {
	agentsAbilityChecklist,
	agentsDetail,
	agentsTriggersList,
} from './agents-detail';

const AGENT_STEP_LABELS = (): string[] => [
	__( 'Describe' ),
	__( 'Meet' ),
	__( 'Powers' ),
	__( 'Summon' ),
	__( 'Launch' ),
];

/** Whether Meet has the one thing it insists on: a name. */
function meetReady( cast: CastDraft ): boolean {
	return cast.name.trim() !== '';
}

function agentsWizard( ctx: Ctx, payload: AgentsPayload ): TemplateResult {
	const cast = ctx.state.cast as CastDraft;
	const step = ctx.state.wstep;
	const trail = html`
		<os-steps horizontal class="dm-agents__trail">
			${ AGENT_STEP_LABELS().map(
				( label, i ) => html`
					<os-step
						title=${ label }
						?done=${ i < step }
						?current=${ i === step }
						?interactive=${ i < step }
						@os-step-click=${ () => {
							if ( i < step ) {
								ctx.local( 'agent-step', { step: i } );
							}
						} }
					></os-step>
				`,
			) }
		</os-steps>
	`;
	return html`
		<div class="dm-agents__wizard">
			<div class="dm-agents__wiz-head">
				<h3>${ __( 'New agent' ) }</h3>
			</div>
			${ trail }
			${ step === 0 ? agentsDescribeStep( ctx, payload, cast ) : '' }
			${ step === 1 ? agentsMeetStep( ctx, cast ) : '' }
			${ step === 2 ? agentsPowersStep( ctx, payload, cast ) : '' }
			${ step === 3 ? agentsSummonStep( ctx, payload, cast ) : '' }
			${ step === 4 ? agentsLaunchStep( ctx, payload, cast ) : '' }
		</div>
	`;
}

function agentsCancelButton( ctx: Ctx, cast: CastDraft ): TemplateResult {
	return html`
		<os-button
			variant="ghost"
			?disabled=${ uiOf( ctx ).agentBusy || cast.drafting }
			@click=${ () => ctx.local( 'agent-cancel' ) }
		>
			${ __( 'Cancel' ) }
		</os-button>
	`;
}

/** Step 0 — the door, then the brief. */
function agentsDescribeStep( ctx: Ctx, payload: AgentsPayload, cast: CastDraft ): TemplateResult {
	// Their words are already a first draft of the instructions.
	const seedFromBrief = (): void => {
		if ( cast.instructions === '' && cast.brief.trim() !== '' ) {
			cast.instructions = cast.brief.trim();
		}
	};
	const draftWithAi = (): void => {
		if ( cast.brief.trim() === '' ) {
			ctx.local( 'agent-brief-error', {
				msg: __( 'Describe the agent first. A sentence is enough.' ),
			} );
			return;
		}
		cast.drafting = true;
		void runAgent( ctx, 'agent-draft' );
	};
	return html`
		${ payload.list.length > 0
			? html`
					<h4 class="dm-agents__wiz-heading">${ __( 'Start from someone' ) }</h4>
					<p class="dm-agents__hint">
						${ __(
							'Copies their instructions and abilities, and rolls a new face. Nothing you pick is changed.',
						) }
					</p>
					<div class="dm-agents__starters">
						${ payload.list.map(
							( agent ) => html`
								<os-card
									class="dm-agents__starter"
									interactive
									@os-card-click=${ () =>
										ctx.local( 'agent-start', { from: agent } ) }
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
					<h4 class="dm-agents__wiz-heading">${ __( 'Or describe a new one' ) }</h4>
			  `
			: '' }
		<os-field-row
			class="dm-agents__brief-row"
			hint=${ __(
				'Plain words are fine: what it should watch, what it should write, where it may act. This is what the agent reads before every run; drafting rewrites it into proper instructions, filling it in yourself keeps it as written.',
			) }
			error=${ ctx.state.briefError }
		>
			<os-textarea
				os-field-control
				class="dm-agents__brief"
				label=${ __( 'What should this agent do? (system prompt)' ) }
				value=${ cast.brief }
				rows="5"
				placeholder=${ __(
					'Go through my drafts once a week and tell me which ones are closest to finished.',
				) }
				?invalid=${ ctx.state.briefError !== '' }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					cast.brief = e.detail?.value ?? '';
					if ( ctx.state.briefError !== '' ) {
						// Typing is the fix; the error goes as soon as it
						// starts rather than after the next click.
						ctx.local( 'agent-brief-error', { msg: '' } );
					}
				} }
			></os-textarea>
		</os-field-row>
		<div class="dm-agents__actions">
			${ payload.aiReady
				? html`
						<os-button
							variant="holo"
							?busy=${ cast.drafting }
							@click=${ draftWithAi }
						>
							${ __( 'Draft it for me' ) }
						</os-button>
				  `
				: '' }
			<os-button
				variant=${ payload.aiReady ? 'ghost' : 'primary' }
				?disabled=${ cast.drafting }
				@click=${ () => {
					seedFromBrief();
					ctx.local( 'agent-step', { step: 1 } );
				} }
			>
				${ payload.aiReady ? __( 'I will fill it in myself' ) : __( 'Continue' ) }
			</os-button>
			<span class="os-app__spacer"></span>
			${ agentsCancelButton( ctx, cast ) }
		</div>
	`;
}

/** Step 1 — meet them: the face, the name, the voice. */
function agentsMeetStep( ctx: Ctx, cast: CastDraft ): TemplateResult {
	const ui = uiOf( ctx );
	const strip = faceCandidates( cast.stripSeed, FACE_CANDIDATES );
	return html`
		<div class="dm-agents__meet">
			<div class="dm-agents__portrait">
				<img
					class="dm-agents__portrait-face"
					src=${ faceSrc( cast.face, 176 ) }
					alt=""
					width="176"
					height="176"
				/>
				<div class="dm-agents__faces" role="radiogroup" aria-label=${ __( 'Face' ) }>
					${ strip.map(
						( candidate ) => html`
							<button
								type="button"
								class="dm-agents__face-pick ${ candidate.seed === cast.faceSeed
									? 'is-picked'
									: '' }"
								role="radio"
								aria-checked=${ candidate.seed === cast.faceSeed ? 'true' : 'false' }
								@click=${ () =>
									ctx.local( 'agent-wiz', {
										faceSeed: candidate.seed,
										face: candidate.look,
									} ) }
							>
								<img src=${ faceSrc( candidate.look, 44 ) } alt="" width="44" height="44" />
							</button>
						`,
					) }
				</div>
				<os-button
					variant="secondary"
					@click=${ () =>
						ctx.local( 'agent-wiz', {
							stripSeed: cast.stripSeed + FACE_CANDIDATES,
						} ) }
				>
					${ __( 'Surprise me' ) }
				</os-button>
				<div class="dm-agents__portrait-chips">
					<os-chip size="compact" label=${ faceShapeName( cast.face ) }></os-chip>
					<os-chip size="compact" label=${ faceHueName( cast.face ) }></os-chip>
				</div>
			</div>
			<div class="dm-agents__meet-fields">
				${ cast.copiedFrom
					? html`<os-notice tone="info">
							${ sprintf(
								/* translators: %s: name of the agent this one was copied from. */
								__( 'Copied from %s, with a face of its own.' ),
								cast.copiedFrom,
							) }
					  </os-notice>`
					: '' }
				<os-field-row error=${ ui.nameError }>
					<os-text-field
						os-field-control
						label=${ __( 'Name' ) }
						value=${ cast.name }
						?invalid=${ ui.nameError !== '' }
						@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
							// Repaint only when the Continue gate flips —
							// per-keystroke repaints are what the original
							// deliberately avoided here.
							const before = meetReady( cast ) && ui.nameError === '';
							cast.name = e.detail?.value ?? '';
							ui.nameError = '';
							if ( before !== meetReady( cast ) ) {
								ctx.repaint();
							}
						} }
					></os-text-field>
				</os-field-row>
				<os-text-field
					label=${ __( 'Vibes' ) }
					value=${ cast.vibes }
					maxlength="120"
					placeholder=${ __( 'blunt, precise, no sugarcoating' ) }
					@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
						cast.vibes = e.detail?.value ?? '';
					} }
				></os-text-field>
				<p class="dm-agents__hint">
					${ __(
						"One line of voice. It goes into the agent's instructions, so it is how the agent sounds rather than a label on a card.",
					) }
				</p>
				<os-text-field
					label=${ __( 'When to use' ) }
					value=${ cast.description }
					@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
						cast.description = e.detail?.value ?? '';
					} }
				></os-text-field>
			</div>
		</div>
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => ctx.local( 'agent-step', { step: 0 } ) }>
				${ __( 'Back' ) }
			</os-button>
			<span class="os-app__spacer"></span>
			<os-button
				variant="primary"
				?disabled=${ ! meetReady( cast ) }
				@click=${ () => ctx.local( 'agent-step', { step: 2 } ) }
			>
				${ __( 'Continue' ) }
			</os-button>
			${ agentsCancelButton( ctx, cast ) }
		</div>
	`;
}

/**
 * Step 2, powers — named for what is actually being decided: what the
 * agent is allowed to touch, the one thing in the flow worth slowing
 * down for.
 */
function agentsPowersStep( ctx: Ctx, payload: AgentsPayload, cast: CastDraft ): TemplateResult {
	return html`
		<os-select
			class="dm-agents__role-select"
			label=${ __( 'Role' ) }
			value=${ cast.role }
			@os-pick=${ ( e: CustomEvent< { value: string } > ) =>
				ctx.local( 'agent-wiz', { role: e.detail?.value ?? cast.role } ) }
		>
			${ payload.roles === null
				? html`<os-option value=${ cast.role }>${ cast.role }</os-option>`
				: roleOptionsTpl( payload.roles, cast.role ) }
		</os-select>
		<p class="dm-agents__hint">
			${ __(
				"The agent acts with this role's capabilities. Pick the least privilege that still lets it do its job.",
			) }
		</p>
		<h4 class="dm-agents__wiz-heading">${ __( 'What it may call (abilities)' ) }</h4>
		${ payload.abilities.length === 0
			? ''
			: html`
					${ agentsPowersChecklist( ctx, payload, cast ) }
					<p class="dm-agents__hint">
						${ __(
							"The agent may only call abilities ticked here, and every call is still gated by the ability's own permission check against the agent's role.",
						) }
					</p>
			  ` }
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => ctx.local( 'agent-step', { step: 1 } ) }>
				${ __( 'Back' ) }
			</os-button>
			<span class="os-app__spacer"></span>
			<os-button variant="primary" @click=${ () => ctx.local( 'agent-step', { step: 3 } ) }>
				${ __( 'Continue' ) }
			</os-button>
			${ agentsCancelButton( ctx, cast ) }
		</div>
	`;
}

/**
 * The Powers step's checklist — the same widget the Tools pane uses,
 * on purpose: a guided flow that showed a flat, undescribed list would
 * be giving less help than the expert surface it is meant to be
 * gentler than.
 */
function agentsPowersChecklist( ctx: Ctx, payload: AgentsPayload, cast: CastDraft ): TemplateResult {
	return agentsAbilityChecklist( ctx, payload, cast.abilities, ( slug, on ) => {
		const next = new Set( cast.abilities );
		if ( on ) {
			next.add( slug );
		} else {
			next.delete( slug );
		}
		ctx.local( 'agent-wiz', { abilities: [ ...next ] } );
	} );
}

/**
 * Step 3, summon: how the site calls the agent — named for the act
 * rather than the mechanism.
 */
function agentsSummonStep( ctx: Ctx, payload: AgentsPayload, cast: CastDraft ): TemplateResult {
	return html`
		${ agentsTriggersList( ctx, payload, cast.triggers, ( next ) =>
			ctx.local( 'agent-wiz', { triggers: next } ),
		) }
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => ctx.local( 'agent-step', { step: 2 } ) }>
				${ __( 'Back' ) }
			</os-button>
			<span class="os-app__spacer"></span>
			<os-button
				variant="primary"
				@click=${ () => ctx.local( 'agent-step', { step: STEP_LAUNCH } ) }
			>
				${ __( 'Continue' ) }
			</os-button>
			${ agentsCancelButton( ctx, cast ) }
		</div>
	`;
}

/** Step 4, launch. */
function agentsLaunchStep( ctx: Ctx, payload: AgentsPayload, cast: CastDraft ): TemplateResult {
	const ui = uiOf( ctx );
	const canChat = payload.canInvoke && payload.aiReady;
	const abilityLabel = ( slug: string ): string =>
		payload.abilities.find( ( a ) => a.slug === slug )?.label ?? slug;
	const triggerLabel = ( kind: string ): string =>
		payload.triggerKinds.find( ( k ) => k.slug === kind )?.label ?? kind;
	const roleLabel =
		payload.roles?.find( ( r ) => r.slug === cast.role )?.label ??
		payload.roleLabels[ cast.role ] ??
		cast.role;
	const triggerLine =
		cast.triggers.length === 0
			? __( 'No triggers configured: reachable in chat.' )
			: sprintf(
				/* translators: %s: comma-separated list of trigger kind labels. */
				__( 'Starts from: %s.' ),
				cast.triggers.map( ( t ) => triggerLabel( t.kind ) ).join( ', ' ),
			);
	const castCreate = ( thenChat: boolean ): void => {
		if ( cast.name.trim() === '' ) {
			ui.nameError = __( 'Agent name is required.' );
			ctx.local( 'agent-step', { step: 1 } );
			return;
		}
		ui.chatAfterCreate = thenChat;
		void runAgent( ctx, 'agent-create' );
	};
	return html`
		<os-card class="dm-agents__summary">
			<img
				class="dm-agents__summary-face"
				src=${ faceSrc( cast.face, 96 ) }
				alt=""
				width="96"
				height="96"
			/>
			<div class="dm-agents__summary-text">
				<h4>${ cast.name }</h4>
				${ cast.vibes ? html`<p class="dm-agents__summary-vibes">${ cast.vibes }</p>` : '' }
				<p class="dm-agents__summary-desc">
					${ cast.description || __( 'No description yet.' ) }
				</p>
				<div class="dm-agents__chips">
					<os-chip size="compact" label=${ roleLabel }></os-chip>
					${ cast.abilities.map(
						( slug ) => html`<os-chip size="compact" label=${ abilityLabel( slug ) }></os-chip>`,
					) }
				</div>
				${ cast.instructions === ''
					? html`<p class="dm-agents__hint">
							${ __(
								'No instructions yet: the agent will improvise. You can add them any time in Define.',
							) }
					  </p>`
					: html`<p class="dm-agents__summary-instr">${ cast.instructions }</p>` }
				${ cast.abilities.length === 0
					? html`<p class="dm-agents__hint">
							${ __( 'No abilities ticked: the agent can talk, but not touch the site.' ) }
					  </p>`
					: '' }
				<p class="dm-agents__hint">${ triggerLine }</p>
			</div>
		</os-card>
		<div class="dm-agents__actions">
			<os-button variant="ghost" @click=${ () => ctx.local( 'agent-step', { step: 3 } ) }>
				${ __( 'Back' ) }
			</os-button>
			<span class="os-app__spacer"></span>
			<os-button
				variant=${ canChat ? 'secondary' : 'primary' }
				?disabled=${ ui.agentBusy }
				@click=${ () => castCreate( false ) }
			>
				${ __( 'Create agent' ) }
			</os-button>
			${ canChat
				? html`
						<os-button
							variant="primary"
							?disabled=${ ui.agentBusy }
							@click=${ () => castCreate( true ) }
						>
							${ __( 'Create and chat' ) }
						</os-button>
				  `
				: '' }
			${ agentsCancelButton( ctx, cast ) }
		</div>
	`;
}

/**
 * The Agents section's view switch — grid, one open agent, or the
 * wizard — wrapped with the AI notice and the message rail, exactly
 * as the original's paint() composed them.
 */
export function renderAgents( ctx: Ctx ): TemplateResult {
	const payload = ctx.data.agents;
	if ( ! payload ) {
		return html`<os-empty-state>${ __( 'This section is not available.' ) }</os-empty-state>`;
	}
	// The framework is opt-in, but the section is always listed. With
	// the option off the whole surface paints disabled: nothing to
	// load, and every control inert.
	const off = ! payload.enabled;
	const state = ctx.state;
	const selected = payload.list.find( ( a ) => a.id === state.item ) ?? null;

	let view: TemplateResult;
	if ( state.casting && state.cast ) {
		view = agentsWizard( ctx, payload );
	} else if ( selected ) {
		view = html`<div class="dm-agents__detail">${ agentsDetail( ctx, payload, selected ) }</div>`;
	} else {
		view = agentsCastGrid( ctx, payload );
	}

	return html`
		<div class="dm-agents ${ off ? 'is-disabled' : '' }">
			${ agentsAiNotice( payload ) }
			${ state.agentNotice
				? html`<os-notice class="dm-agents__notice">${ state.agentNotice }</os-notice>`
				: '' }
			<div class="dm-agents__view">${ view }</div>
		</div>
	`;
}
