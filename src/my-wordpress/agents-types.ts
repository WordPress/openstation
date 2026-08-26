/**
 * WP Explorer — Agents: type contracts.
 *
 * Mirrors the REST shapes served by `includes/agents/rest.php`.
 *
 * @public
 */

/** One configured trigger row on an agent. */
export interface Trigger {
	kind: string;
	config: Record< string, unknown >;
}

/**
 * Canonical agent shape returned by every read/write route of
 * `/desktop-mode/v1/agents`.
 */
export interface Agent {
	id: number;
	slug: string;
	name: string;
	description: string;
	instructions: string;
	role: string;
	abilities: string[];
	triggers: Trigger[];
	model: string;
	rateLimit: number;
	/**
	 * One line of voice: "blunt, precise, no sugarcoating". Appended
	 * to the agent's instructions at run time, so it is how the agent
	 * actually sounds rather than a label on a card.
	 */
	vibes: string;
	/**
	 * The agent's face, as a partial Mio look. Only the keys someone
	 * had an opinion about, so a change to the shipped companion still
	 * shows through everywhere they did not.
	 */
	face: MioLook;
	/**
	 * The seed the face was rolled from. Provenance rather than the
	 * face itself: what makes a re-roll of the whole roster possible
	 * without stranding anyone on an old palette.
	 */
	faceSeed: number;
	/**
	 * Media Library image used as the profile picture. Zero or absent
	 * keeps the generated Mio face. The server bakes the AGENT ribbon
	 * into `avatarUrl`, so every avatar consumer gets the identity mark.
	 */
	avatarAttachmentId?: number;
	avatarUrl: string;
}

/**
 * A partial Mio look, mirroring `MioLook` in `src/mio/types.ts`.
 *
 * Restated here rather than imported so this module stays free of the
 * Mio bundle's import graph; the shapes are held together by the
 * portrait fixture, which both sides render through.
 */
export interface MioLook {
	appearance: Record< string, unknown >;
	physics: Record< string, unknown >;
}

/** One row of the abilities catalogue (`GET /agents/abilities`). */
export interface Ability {
	slug: string;
	label: string;
	description: string;
	category: string;
	readonly: boolean;
}

/**
 * What `POST /agents/draft` hands back: a definition to review, not
 * an agent. Already filtered against the site's catalogues; `role` is
 * '' when the model's pick was not one the site allows.
 */
export interface AgentDraft {
	name: string;
	description: string;
	vibes: string;
	instructions: string;
	role: string;
	abilities: string[];
}

/** One row of the trigger-kinds catalogue (`GET /agents/trigger-kinds`). */
export interface TriggerKindDescriptor {
	slug: string;
	label: string;
	description: string;
	icon: string;
	/** Whether the intake for this kind is actually plumbed yet. */
	wired?: boolean;
	config_schema?: Record< string, unknown >;
}

/** One row of the hooks catalogue (`GET /agents/hooks-catalogue`). */
export interface HookSuggestion {
	hook: string;
	when: string;
}

/** One row of the assignable-roles catalogue (`GET /agents/roles`). */
export interface RoleChoice {
	slug: string;
	label: string;
}

/** One executed tool call in an invocation trace. */
export interface AgentToolCall {
	callId: string;
	name: string;
	args: Record< string, unknown >;
	output: unknown;
	error: string | null;
}

/**
 * One call-to-action offered by an agent answer that needs the user's
 * confirmation — rendered as a button; pressing it sends `reply` back
 * as the user's next message.
 */
export interface AgentCallToAction {
	id: string;
	label: string;
	style: 'primary' | 'secondary' | 'danger';
	reply: string;
}

/** Result of `POST /agents/:id/invoke`. */
export interface AgentInvokeResult {
	text: string;
	callToActions?: AgentCallToAction[];
	toolCalls: AgentToolCall[];
	turns: number;
}

/**
 * Agents block injected into the WP Explorer window config by
 * `openstation_agents_my_wordpress_window_args()`.
 */
export interface AgentsSectionConfig {
	/**
	 * The `agents` extended option. False means the framework is off:
	 * the section still renders (and the tile is still listed) but every
	 * control is disabled and no REST call is attempted, because the
	 * `/desktop-mode/v1/agents` routes are not registered while off.
	 */
	enabled: boolean;
	/** Whether this user may flip that option (`manage_options`). */
	canEnable: boolean;
	canManage: boolean;
	/** Whether the current user may upload a new profile picture. */
	canUpload?: boolean;
	canInvoke: boolean;
	aiAvailable: boolean;
	aiStatusUrl: string;
	connectorsUrl: string;
	runWindowId: string;
	/**
	 * The cast this site would be seeded with, sent only while the
	 * framework is off. The five shipped agents do not exist as users
	 * until the flag is flipped, so there is nothing to fetch and
	 * nothing to select: this is the off-state's argument for flipping
	 * it, drawn greyed and inert above the button that does.
	 */
	preview?: PreviewAgent[];
}

/**
 * One card in the flag-off preview.
 *
 * Not an {@link Agent}: it has no id, because it is not a user yet,
 * and no `avatarUrl`, because nothing has been rendered to disk. The
 * face is drawn client-side from the look, the same way the wizard
 * draws its candidates. Deliberately only the fields a card shows —
 * instructions and abilities are the bulk of a definition and none of
 * it is on screen here.
 */
export interface PreviewAgent {
	name: string;
	vibes: string;
	description: string;
	role: string;
	/**
	 * Translated, unlike a real card's, which resolves its label out of
	 * the `/agents/roles` catalogue. That route does not exist while the
	 * flag is off, so the label ships with the payload rather than
	 * degrading to the raw slug in English.
	 */
	roleLabel: string;
	face: MioLook;
}
