/**
 * My WordPress — the Agents section: the detail view and its panes.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. One open agent: the identity header,
 * the verb row (profile, contributions, desktop, chat, delete), and
 * the Define / Tools / Triggers panes. The ability checklist and the
 * trigger door cards are shared with the wizard's Powers and Summon
 * steps — one implementation, two surfaces, exactly as WP Explorer
 * built them.
 *
 * @public
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import { openUserFootprintWindow } from '../../../src/my-wordpress/footprint-target';
import type {
	Ability,
	Agent,
	Trigger,
	TriggerKindDescriptor,
} from '../../../src/my-wordpress/agents-types';
import {
	uiOf,
	type AgentsPayload,
	type AppAgent,
	type AppState,
	type Ctx,
	type UiState,
} from './types';
import {
	ABILITY_COLLAPSE_THRESHOLD,
	ENTITY_KIND_CHOICES,
	agentFaceSrc,
	openAgentProfile,
	openChatWindow,
	roleOptionsTpl,
	runAgent,
	sendAgentToDesktop,
} from './agents';

/**
 * The ability checklist: a filter, then collapsible groups. One
 * implementation for both surfaces that show it — the Tools pane and
 * the wizard's Powers step. The filter searches the description and
 * the slug as well as the label: plugin authors name abilities for
 * themselves, and "the one that reads custom fields" is easier to
 * remember than whatever it is called.
 */
export function agentsAbilityChecklist(
	ctx: Ctx,
	payload: AgentsPayload,
	picked: readonly string[],
	toggle: ( slug: string, on: boolean ) => void,
	opts: { disabled?: boolean } = {},
): TemplateResult {
	const ui = uiOf( ctx );
	const all = payload.abilities;
	const query = ui.abilityQuery.trim().toLowerCase();
	const matches = ( ability: Ability ): boolean =>
		query === '' ||
		ability.label.toLowerCase().includes( query ) ||
		ability.description.toLowerCase().includes( query ) ||
		ability.slug.toLowerCase().includes( query );

	const groups = new Map< string, Ability[] >();
	for ( const ability of all.filter( matches ) ) {
		const key = ability.category || __( 'Other' );
		groups.set( key, [ ...( groups.get( key ) ?? [] ), ability ] );
	}

	// A group opens by default when there is little to hide, or when it
	// holds something already ticked — a checked box folded out of
	// sight is how someone loses track of what they granted. While
	// filtering, everything that survived is shown.
	const long = all.length > ABILITY_COLLAPSE_THRESHOLD;
	const isOpen = ( category: string, list: Ability[] ): boolean => {
		if ( query !== '' ) {
			return true;
		}
		return (
			ui.abilityOpen.get( category ) ??
			( ! long || list.some( ( a ) => picked.includes( a.slug ) ) )
		);
	};

	return html`
		${ long || query !== ''
			? html`
					<os-text-field
						class="dm-agents__ability-search"
						type="search"
						label=${ __( 'Search abilities' ) }
						value=${ ui.abilityQuery }
						placeholder=${ __( 'custom fields, orders, media…' ) }
						@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
							ui.abilityQuery = e.detail?.value ?? '';
							ctx.repaint();
						} }
					></os-text-field>
			  `
			: '' }
		${ groups.size === 0
			? html`<p class="dm-agents__hint">
					${ sprintf(
						/* translators: %s: the text typed into the ability filter. */
						__( 'No ability matches "%s".' ),
						ui.abilityQuery.trim(),
					) }
			  </p>`
			: '' }
		${ [ ...groups.entries() ].map( ( [ category, abilities ] ) => {
			const chosen = abilities.filter( ( a ) => picked.includes( a.slug ) ).length;
			// "3 of 12" when some are ticked, otherwise just the size of
			// the group: the count keeps a closed group informative.
			const count =
				chosen > 0
					? sprintf(
						/* translators: 1: ticked abilities in this group, 2: abilities in the group. */
						__( '%1$d of %2$d' ),
						chosen,
						abilities.length,
					)
					: String( abilities.length );
			return html`
				<details
					class="dm-agents__ability-group"
					?open=${ isOpen( category, abilities ) }
					@toggle=${ ( e: Event ) => {
						// Remembered, not repainted: the disclosure has
						// already opened itself, and this is only so the
						// next paint agrees with it.
						ui.abilityOpen.set(
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
									${ ability.readonly ? __( 'read-only' ) : __( 'can modify' ) }
								</os-badge>
								<p class="dm-agents__ability-desc">${ ability.description }</p>
							</div>
						`,
					) }
				</details>
			`;
		} ) }
	`;
}

/** Where a kind's row sits in the list, or -1. */
function triggerRowIndex( triggers: Trigger[], slug: string ): number {
	return triggers.findIndex( ( t ) => t.kind === slug );
}

/**
 * Whether a kind is one of the entity-kind doors. Send to and Drag &
 * drop configure the same thing, and the catalogue says so through the
 * schema rather than the slug, so a plugin kind shaped the same way
 * gets the same card.
 */
function takesEntityKinds( kind: TriggerKindDescriptor ): boolean {
	const schema = kind.config_schema as
		| { properties?: Record< string, unknown > }
		| undefined;
	return !! schema?.properties && 'entityKinds' in schema.properties;
}

/**
 * Commit with the one invariant the cards promise: chat is always on.
 * Rows for kinds the cards do not draw ride through untouched.
 */
function commitTriggers(
	commit: ( rows: Trigger[] ) => void,
	next: Trigger[],
): void {
	commit(
		triggerRowIndex( next, 'chat' ) === -1
			? [ { kind: 'chat', config: {} }, ...next ]
			: next,
	);
}

/**
 * Extra configuration for a door that is open. Only kinds with
 * something beyond "on" reach here: hook wants a hook name, endpoint a
 * capability — rendered for a plugin that wires one through the filter.
 */
function agentsTriggerEditor(
	payload: AgentsPayload,
	triggers: Trigger[],
	index: number,
	commit: ( next: Trigger[] ) => void,
): TemplateResult | '' {
	const trigger = triggers[ index ];
	const patchConfig = ( patch: Record< string, unknown > ): void => {
		commitTriggers(
			commit,
			triggers.map( ( t, i ) =>
				i === index ? { kind: t.kind, config: { ...t.config, ...patch } } : t,
			),
		);
	};
	if ( trigger.kind === 'hook' ) {
		const names = payload.hooks.map( ( h ) => h.hook );
		return html`
			<div class="dm-agents__trigger-config">
				<os-text-field
					label=${ __( 'Hook name' ) }
					value=${ String( trigger.config.hook ?? '' ) }
					?readonly=${ ! payload.canManage }
					@os-input-commit=${ ( e: CustomEvent< { value: string } > ) =>
						patchConfig( { hook: e.detail.value } ) }
				></os-text-field>
				${ names.length > 0
					? html`<p class="dm-agents__hint">
							${ sprintf(
								/* translators: %s: comma-separated list of WordPress hook names. */
								__( 'Suggestions: %s' ),
								names.join( ', ' ),
							) }
					  </p>`
					: '' }
			</div>
		`;
	}
	if ( trigger.kind === 'endpoint' ) {
		return html`
			<div class="dm-agents__trigger-config">
				<os-text-field
					label=${ __( 'Required capability' ) }
					value=${ String( trigger.config.capability ?? '' ) }
					?readonly=${ ! payload.canManage }
					@os-input-commit=${ ( e: CustomEvent< { value: string } > ) =>
						patchConfig( { capability: e.detail.value } ) }
				></os-text-field>
			</div>
		`;
	}
	return '';
}

/**
 * One door, as a fixed card. Chat is always on and says so. An
 * entity-kind door is the row of kinds to tick, and nothing ticked is
 * the door closed. Any other wired kind gets an On switch and, once
 * on, its editor.
 */
function agentsTriggerCard(
	ctx: Ctx,
	payload: AgentsPayload,
	kind: TriggerKindDescriptor,
	triggers: Trigger[],
	commit: ( next: Trigger[] ) => void,
): TemplateResult {
	const index = triggerRowIndex( triggers, kind.slug );
	const row = index === -1 ? null : triggers[ index ];
	const locked = ! payload.canManage || uiOf( ctx ).agentBusy;
	const without = (): Trigger[] => triggers.filter( ( t ) => t.kind !== kind.slug );
	let body: TemplateResult | '' = '';
	if ( kind.slug === 'chat' ) {
		body = '';
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
					label=${ __( 'On' ) }
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
			${ row ? agentsTriggerEditor( payload, triggers, index, commit ) : '' }
		`;
	}
	return html`
		<div class="dm-agents__trigger">
			<div class="dm-agents__trigger-head">
				<strong>${ kind.label }</strong>
				${ kind.slug === 'chat'
					? html`<os-badge tone="neutral">${ __( 'Always on' ) }</os-badge>`
					: '' }
			</div>
			${ kind.description
				? html`<p class="dm-agents__trigger-desc">${ kind.description }</p>`
				: '' }
			${ body }
		</div>
	`;
}

/**
 * The doors, as fixed cards, one per wired kind. Shared by the detail
 * pane's Triggers tab and the wizard's Summon step — agnostic about
 * where the rows live.
 */
export function agentsTriggersList(
	ctx: Ctx,
	payload: AgentsPayload,
	triggers: Trigger[],
	commit: ( next: Trigger[] ) => void,
): TemplateResult {
	const kinds = payload.triggerKinds.filter( ( k ) => k.wired !== false );
	return html`
		<div class="dm-agents__pane">
			<p class="dm-agents__hint">
				${ __(
					'Chat is always on. Tick where else this site should reach the agent; a door with nothing ticked stays closed.',
				) }
			</p>
			${ kinds.map( ( kind ) => agentsTriggerCard( ctx, payload, kind, triggers, commit ) ) }
		</div>
	`;
}

/** The Define pane's draft, rebuilt whenever another agent opens. */
function agentsDefineDraft( ui: UiState, agent: Agent ): NonNullable< UiState[ 'agentDraft' ] > {
	if ( ! ui.agentDraft || ui.agentDraftFor !== agent.id ) {
		ui.agentDraft = {
			name: agent.name,
			description: agent.description,
			instructions: agent.instructions,
			role: agent.role,
		};
		ui.agentDraftFor = agent.id;
	}
	return ui.agentDraft;
}

function agentsDefinePane( ctx: Ctx, payload: AgentsPayload, agent: Agent ): TemplateResult {
	const ui = uiOf( ctx );
	const readOnly = ! payload.canManage;
	const draft = agentsDefineDraft( ui, agent );
	const dirty =
		draft.name !== agent.name ||
		draft.description !== agent.description ||
		draft.instructions !== agent.instructions ||
		draft.role !== agent.role;
	return html`
		<div class="dm-agents__pane">
			<os-text-field
				label=${ __( 'Name' ) }
				value=${ draft.name }
				?readonly=${ readOnly }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					draft.name = e.detail.value;
					ctx.repaint();
				} }
			></os-text-field>
			<os-text-field
				label=${ __( 'When to use (description)' ) }
				value=${ draft.description }
				?readonly=${ readOnly }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					draft.description = e.detail.value;
					ctx.repaint();
				} }
			></os-text-field>
			<os-textarea
				label=${ __( 'Instructions (system prompt)' ) }
				value=${ draft.instructions }
				rows="10"
				?readonly=${ readOnly }
				@os-input-change=${ ( e: CustomEvent< { value: string } > ) => {
					draft.instructions = e.detail.value;
					ctx.repaint();
				} }
			></os-textarea>
			${ readOnly
				? html`<p class="dm-agents__hint">${ __( 'Role' ) }: ${ agent.role }</p>`
				: html`
						${ payload.roles
							? html`
									<os-select
										label=${ __( 'Role' ) }
										value=${ draft.role }
										@os-pick=${ ( e: CustomEvent< { value: string } > ) => {
											draft.role = e.detail?.value ?? draft.role;
											ctx.repaint();
										} }
									>
										${ roleOptionsTpl( payload.roles, draft.role ) }
									</os-select>
							  `
							: html`
									<os-select label=${ __( 'Role' ) } value=${ draft.role } disabled>
										<os-option value=${ draft.role }>${ draft.role }</os-option>
									</os-select>
							  ` }
						<p class="dm-agents__hint">
							${ __(
								"The agent acts with this role's capabilities — pick the least privilege that still lets it do its job.",
							) }
						</p>
						<os-button
							?disabled=${ ui.agentBusy || ! dirty }
							@click=${ () =>
								void runAgent( ctx, 'agent-update', {
									id: agent.id,
									name: draft.name,
									description: draft.description,
									instructions: draft.instructions,
									role: draft.role,
								} ) }
						>
							${ __( 'Save' ) }
						</os-button>
				  ` }
		</div>
	`;
}

function agentsToolsPane( ctx: Ctx, payload: AgentsPayload, agent: Agent ): TemplateResult {
	return html`
		<div class="dm-agents__pane">
			<p class="dm-agents__hint">
				${ __(
					"The agent may only call abilities ticked here — and every call is still gated by the ability's own permission check against the agent's role.",
				) }
			</p>
			${ agentsAbilityChecklist(
				ctx,
				payload,
				agent.abilities,
				( slug, on ) => {
					const abilities = on
						? Array.from( new Set( [ ...agent.abilities, slug ] ) )
						: agent.abilities.filter( ( s ) => s !== slug );
					void runAgent( ctx, 'agent-update', { id: agent.id, abilities } );
				},
				{ disabled: ! payload.canManage || uiOf( ctx ).agentBusy },
			) }
		</div>
	`;
}

export function agentsDetail( ctx: Ctx, payload: AgentsPayload, agent: AppAgent ): TemplateResult {
	const ui = uiOf( ctx );
	const state = ctx.state;
	const hasUsersSection = ctx.data.sections.some( ( s ) => s.id === 'users' );
	const paneTabs = html`
		<os-tabs
			class="dm-agents__tabs"
			value=${ state.pane }
			label=${ __( 'Agent detail' ) }
			@os-tab-change=${ ( e: CustomEvent< { value: string | null } > ) => {
				if ( e.detail.value ) {
					ctx.local( 'agent-pane', { pane: e.detail.value } );
				}
			} }
		>
			${ ( [
				[ 'define', __( 'Define' ) ],
				[ 'tools', __( 'Tools' ) ],
				[ 'triggers', __( 'Triggers' ) ],
			] as Array< [ AppState[ 'pane' ], string ] > ).map(
				( [ pane, label ] ) => html`
					<os-tab value=${ pane }>${ label }</os-tab>
				`,
			) }
		</os-tabs>
	`;
	return html`
		<os-button class="dm-agents__back" variant="link" @click=${ () => void ctx.dispatch( 'open', { item: 0 } ) }>
			${ __( '‹ Your cast' ) }
		</os-button>
		<div class="dm-agents__detail-head">
			<img class="dm-agents__detail-avatar" src=${ agentFaceSrc( agent, 96 ) } alt="" />
			<div class="dm-agents__detail-title">
				<h3>${ agent.name }</h3>
				<span class="dm-agents__detail-slug">@agent-${ agent.slug }</span>
			</div>
		</div>
		<div class="dm-agents__detail-actions">
			<os-button @click=${ () => openAgentProfile( agent ) }>
				${ __( 'Open profile' ) }
			</os-button>
			${ hasUsersSection
				? html`
						<os-button
							@click=${ () =>
								openUserFootprintWindow( { userId: agent.id, userName: agent.name } ) }
						>
							${ __( 'View contributions' ) }
						</os-button>
				  `
				: '' }
			${ payload.canManage
				? html`
						<os-button
							?disabled=${ ui.agentBusy }
							@click=${ () =>
								void sendAgentToDesktop( agent ).then( ( notice ) =>
									ctx.local( 'agent-notice', { notice } ),
								) }
						>
							${ __( 'Send to Desktop' ) }
						</os-button>
				  `
				: '' }
			${ payload.canInvoke
				? html`
						<os-button
							variant="primary"
							?disabled=${ ! payload.aiReady }
							@click=${ () => openChatWindow( payload, agent ) }
						>
							${ __( 'Chat' ) }
						</os-button>
				  `
				: '' }
			${ payload.canManage
				? html`
						<os-button
							?disabled=${ ui.agentBusy }
							os-action="agent-delete"
							os-arg-id=${ String( agent.id ) }
							os-confirm=${ __(
								'The agent user is deleted permanently. Content it authored is not reassigned.',
							) }
							os-confirm-label=${ __( 'Delete' ) }
							os-confirm-danger
						>
							${ __( 'Delete' ) }
						</os-button>
				  `
				: '' }
		</div>
		${ paneTabs }
		${ state.pane === 'define' ? agentsDefinePane( ctx, payload, agent ) : '' }
		${ state.pane === 'tools' ? agentsToolsPane( ctx, payload, agent ) : '' }
		${ state.pane === 'triggers'
			? agentsTriggersList( ctx, payload, agent.triggers, ( next ) => {
				void runAgent( ctx, 'agent-update', { id: agent.id, triggers: next } );
			} )
			: '' }
	`;
}
