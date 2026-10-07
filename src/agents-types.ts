export interface Trigger {
	kind: string;
	config: Record< string, unknown >;
}

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

	vibes: string;

	face: MioLook;

	faceSeed: number;
	avatarUrl: string;
}

export interface MioLook {
	appearance: Record< string, unknown >;
	physics: Record< string, unknown >;
}

export interface Ability {
	slug: string;
	label: string;
	description: string;
	category: string;
	readonly: boolean;
}

export interface AgentDraft {
	name: string;
	description: string;
	vibes: string;
	instructions: string;
	role: string;
	abilities: string[];
}

export interface TriggerKindDescriptor {
	slug: string;
	label: string;
	description: string;
	icon: string;

	wired?: boolean;
	config_schema?: Record< string, unknown >;
}

export interface HookSuggestion {
	hook: string;
	when: string;
}

export interface RoleChoice {
	slug: string;
	label: string;
}

export interface AgentToolCall {
	callId: string;
	name: string;
	args: Record< string, unknown >;
	output: unknown;
	error: string | null;
}

export interface AgentCallToAction {
	id: string;
	label: string;
	style: 'primary' | 'secondary' | 'danger';
	reply: string;
}

export interface AgentInvokeResult {
	text: string;
	callToActions?: AgentCallToAction[];
	toolCalls: AgentToolCall[];
	turns: number;
}

export interface AgentsSectionConfig {

	enabled: boolean;

	canEnable: boolean;
	canManage: boolean;
	canInvoke: boolean;
	aiAvailable: boolean;
	aiStatusUrl: string;
	connectorsUrl: string;
	runWindowId: string;

	preview?: PreviewAgent[];
}

export interface PreviewAgent {
	name: string;
	vibes: string;
	description: string;
	role: string;

	roleLabel: string;
	face: MioLook;
}
