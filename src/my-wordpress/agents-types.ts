/**
 * Site folder — Agents: type contracts.
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

/** Result of `POST /agents/:id/invoke`. */
export interface AgentInvokeResult {
	text: string;
	toolCalls: AgentToolCall[];
	turns: number;
}

/**
 * Agents block injected into the site folder window config by
 * `desktop_mode_agents_my_wordpress_window_args()`.
 */
export interface AgentsSectionConfig {
	canManage: boolean;
	canInvoke: boolean;
	aiAvailable: boolean;
	aiStatusUrl: string;
	connectorsUrl: string;
	runWindowId: string;
}
