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
	avatarUrl: string;
}

/** One row of the abilities catalogue (`GET /agents/abilities`). */
export interface Ability {
	slug: string;
	label: string;
	description: string;
	category: string;
	readonly: boolean;
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
	canInvoke: boolean;
	aiAvailable: boolean;
	aiStatusUrl: string;
	connectorsUrl: string;
	runWindowId: string;
}
