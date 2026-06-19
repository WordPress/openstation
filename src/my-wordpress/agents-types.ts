/**
 * My WordPress — Agents type contracts.
 *
 * Mirrors the canonical REST shape served by `/desktop-mode/v1/agents`
 * (see `includes/agents/rest.php::desktop_mode_agents_rest_shape_user`).
 * Every server response of `Agent` round-trips through these types.
 *
 * @public
 * @since 0.23.0
 */

/**
 * Trigger kind slug. Server-driven — the catalogue returned by
 * `/desktop-mode/v1/agents/trigger-kinds` is the source of truth and
 * plugins can extend it through the
 * `desktop_mode_agent_trigger_kinds` PHP filter. The built-in kinds
 * are tracked here for editor autocomplete.
 *
 * @public
 */
export type TriggerKind =
	| 'drag'
	| 'chat'
	| 'hook'
	| 'endpoint'
	| 'agent'
	| string;

export interface Trigger {
	kind: TriggerKind;
	config: Record< string, unknown >;
}

/**
 * Catalogue descriptor for a single ability. The renderer reads this
 * from `/desktop-mode/v1/agents/abilities` and paints one checkbox per
 * entry. `slug` is the canonical id stored in
 * `_desktop_mode_skill_abilities`.
 *
 * @public
 */
export interface Ability {
	slug: string;
	label: string;
	description: string;
}

/**
 * Catalogue entry for the Hook-trigger autocomplete.
 *
 * @public
 */
export interface HookSuggestion {
	hook: string;
	when: string;
}

/**
 * Trigger-kinds catalogue entry. `config_schema` is a JSON Schema
 * fragment — used loosely here for editor introspection, not validated
 * client-side (the PHP layer is the gate).
 *
 * @public
 */
export interface TriggerKindDescriptor {
	slug: TriggerKind;
	label: string;
	description?: string;
	/** Dashicon class — used by the renderer's add-trigger picker. */
	icon?: string;
	config_schema: {
		type: 'object';
		properties: Record< string, unknown >;
		required?: string[];
	};
}

/**
 * Canonical agent shape returned by every REST endpoint that emits an
 * agent (list / get / create / patch).
 *
 * @public
 */
export interface Agent {
	id: number;
	slug: string;
	name: string;
	description: string;
	instructions: string;
	role: string;
	guidelineId: number;
	guidelineLink: string;
	/**
	 * `publish` — visible to other agent runtimes (Dolly, pushmd's
	 * projection into `wp_guideline/skills/<slug>/SKILL.md`, Claude
	 * Code via the symlinked working tree). The default for new
	 * agents created through the bundle.
	 *
	 * `private` — only the author / admins can read; pushmd skips
	 * it. Use for site-specific agents you don't want to share
	 * across the ecosystem.
	 *
	 * `draft` — work-in-progress; same visibility as private.
	 *
	 * Maps verbatim to `wp_guideline.post_status` and aligns with
	 * the per-row `read_post` gate introduced in Gutenberg PR
	 * #78296.
	 */
	status: 'publish' | 'private' | 'draft' | string;
	abilities: string[];
	triggers: Trigger[];
	model: string;
	rateLimit: number;
	avatarUrl: string;
}

/**
 * Body of `POST /desktop-mode/v1/agents` (create).
 *
 * @public
 */
export interface AgentDraft {
	name: string;
	role: string;
	description?: string;
	instructions?: string;
	/** Defaults to `publish` server-side when omitted. */
	status?: 'publish' | 'private' | 'draft' | string;
}

/**
 * Body of `POST /desktop-mode/v1/agents/<id>` (patch). Any subset of
 * the writable fields. The server ignores unknown keys.
 *
 * @public
 */
export type AgentPatch = Partial< {
	name: string;
	description: string;
	instructions: string;
	role: string;
	status: 'publish' | 'private' | 'draft' | string;
	abilities: string[];
	triggers: Trigger[];
	model: string;
	rateLimit: number;
} >;

/**
 * Config blob delivered alongside the My WordPress window for the
 * Agents section.
 *
 * @public
 */
export interface AgentsConfig {
	enabled: boolean;
	gutenbergActive: boolean;
	skillTermId: number;
	restNamespace: string;
	enableExperimentNonce: string;
	gutenbergInstallUrl: string;
}
