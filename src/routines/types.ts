/**
 * Routines — shared types.
 *
 * Mirrors `includes/routines/schema.php`. Drift between the two
 * shows up at the API boundary as a TS error inside the bundle and
 * a `WP_Error` from the validator on the server — failures are
 * loud, not silent.
 *
 * @since 0.22.0
 */

export type StepKind =
	| 'command'
	| 'ai_tool'
	| 'action'
	| 'email'
	| 'http'
	| 'log'
	| 'wait'
	| 'if'
	| 'stop'
	| 'set_var';

export type Operator =
	| 'eq'
	| 'neq'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'contains'
	| 'starts_with'
	| 'ends_with'
	| 'matches'
	| 'in'
	| 'not_in'
	| 'truthy'
	| 'falsy';

export interface RoutineCondition {
	left: unknown;
	op: Operator;
	right: unknown;
}

export interface RoutineStep {
	kind: StepKind;
	id: string;
	args: Record< string, unknown >;
	condition?: RoutineCondition;
	then?: RoutineStep[];
	else?: RoutineStep[];
}

export interface RoutineDef {
	version: number;
	trigger: { kind: 'hook' | 'broadcast'; id: string; priority: number };
	conditions: RoutineCondition[];
	steps: RoutineStep[];
	run_as: 'author' | 'system';
	settings: {
		rate_limit: { max: number; per_seconds: number };
		timeout_ms: number;
		stop_on_error: boolean;
	};
}

export interface Routine {
	id: number;
	title: string;
	author: number;
	enabled: boolean;
	def: RoutineDef;
	stats: {
		runs: number;
		last_run: number;
		last_error: string;
		avg_ms: number;
	};
}

export interface RoutineRun {
	id: number;
	routine_id: number;
	started_at: string;
	finished_at: string | null;
	status: 'success' | 'failure' | 'skipped' | 'running';
	duration_ms: number;
	trigger_id: string;
	payload: unknown;
	steps_log: Array< {
		kind: StepKind;
		id: string;
		ok: boolean;
		ms: number;
		error?: string;
		result?: unknown;
		branch?: 'then' | 'else';
		stopped?: boolean;
	} >;
	error: string | null;
}

export interface CatalogTrigger {
	id: string;
	label: string;
	group: string;
	icon: string;
	kind: 'hook' | 'broadcast';
	priority: number;
	accepted_args: number;
	payload_schema: Record< string, unknown >;
	sample_payload: Record< string, unknown >;
}

export interface CatalogAction {
	id: string;
	label: string;
	description: string;
	icon: string;
	group: string;
	capability: string;
	args_schema: Record< string, unknown >;
}

export interface CatalogAiTool {
	name: string;
	description: string;
	parameters: unknown;
	capability: string;
}

export interface Catalog {
	triggers: CatalogTrigger[];
	actions: CatalogAction[];
	ai_tools: CatalogAiTool[];
	operators: Operator[];
	kinds: StepKind[];
}

export interface Template {
	id: string;
	title: string;
	description: string;
	icon: string;
	group: string;
	def: RoutineDef;
}

declare global {
	interface Window {
		wpDesktopRoutinesConfig?: {
			restNonce: string;
			rootUrl: string;
			catalogUrl: string;
			templatesUrl: string;
			fromTemplateUrl: string;
		};
		wpDesktopNativeWindows?: Record<
			string,
			( ( body: HTMLElement ) => void ) | undefined
		>;
	}
}

export {};
