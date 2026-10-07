export interface MioDocument {

	id: string;
	title: string;
	markdown: string;
	version?: string;
	topics?: readonly string[];
	componentIds?: readonly string[];
}

export interface MioAbility {

	name: string;
	description: string;

	parameters: Record<string, unknown>;

	validate: ( args: Record<string, unknown>, context?: MioCallContext ) => boolean | MioValidationResult;
	run: ( args: Record<string, unknown>, signal: AbortSignal, context: MioCallContext ) => unknown | Promise<unknown>;

	effect?: 'read' | 'validate' | 'write' | 'none';

	history?: ( entry: MioHistoryEntry, context: MioCallContext ) => Record<string, unknown>;

	allowed?: () => boolean;
}

export interface MioWindowContext {

	enabled?: boolean;

	host: HTMLElement;
	title: string;

	windowId?: string;
	revision?: () => string;
	onTurnBegin?: ( context: MioTurnContext ) => void;
	onTurnEnd?: ( summary: MioTurnSummary ) => void;
	onTurnAbort?: ( context: MioTurnContext ) => void;
	onOperation?: ( operation: MioOperation ) => void;

	responseActions?: ( context: MioResponseContext ) => readonly MioResponseAction[];

	operationStatus?: ( operation: MioOperation, signal: AbortSignal ) => Promise<MioOperationOutcome>;

	compactHistory?: ( history: MioHistory, context: MioTurnContext ) => unknown;

	prompt: () => string | Promise<string>;
	documents: readonly MioDocument[];

	abilities: () => readonly MioAbility[];
}

export interface MioChatMessage {
	role: 'user' | 'assistant';
	text: string;
	id?: string;

	actionIds?: readonly string[];
}

export interface MioResponseAction {

	id: string;

	label: string;
	ariaLabel?: string;

	icon?: string;
	emphasis?: 'primary' | 'secondary';

	effect: 'read' | 'navigate';
	allowed?: () => boolean;
	run: ( context: MioResponseActionContext ) => void | Promise<void>;
}

export interface MioResponseActionContext {
	signal: AbortSignal;
	messageId: string;
	turnId: string;
}

export interface MioResponseContext {
	messageId: string;
	summary: Readonly<MioTurnSummary>;

	operations: readonly Readonly<MioOperation>[];
}

export interface MioConversationStore {
	read: () => readonly MioChatMessage[];
	write: ( messages: readonly MioChatMessage[] ) => void;
	clear: () => void;
}

export interface MioCallout {

	id: string;

	target: () => HTMLElement | null;
	message: string;
	onDismiss?: () => void;
}

export interface MioWindowLease {

	showCallout: ( callout: MioCallout ) => void;

	clearCallout: () => void;

	isEnabled: () => boolean;

	setEnabled: ( enabled: boolean ) => void;

	openChat: () => Promise<void>;

	getOperations: () => MioOperation[];

	inspectOperation: ( callId: string, signal?: AbortSignal ) => Promise<MioOperation>;

	dispose: () => void;
}

export interface MioTurn {
	message: string;
	calls: Array<{ name: string; arguments: string }>;
}

export interface MioTurnRequest {
	prompt: string;
	transcript: string;
	tools: Array<Pick<MioAbility, 'name' | 'description' | 'parameters'>>;
}

export type MioTransport = ( request: MioTurnRequest, signal: AbortSignal ) => Promise<MioTurn>;

export interface MioArgumentError {
	code: string;

	path: string;
	message: string;
	suggestion?: string;
}
export type MioValidationResult = { ok: true } | { ok: false; errors: MioArgumentError[]; retryable: boolean };
export type MioOperationOutcome =
	| { effect: 'none'; status: 'completed'; data?: unknown }
	| { effect: 'none'; status: 'rejected'; errors: MioArgumentError[]; retryable: boolean; data?: unknown }
	| { effect: 'write'; status: 'confirmed'; receipt: string; data?: unknown }
	| { effect: 'write'; status: 'unknown'; data?: unknown };
export interface MioTurnContext {
	turnId: string;
	windowId?: string;
	revision?: string;
	signal: AbortSignal;
	limits: Readonly<{ rounds: number; calls: number; validationFailures: number; repeatedReads: number }>;
	validationFailures: number;
	validationRemaining: number;
}
export interface MioCallContext extends MioTurnContext {
	callId: string;

	idempotencyKey: string;
	effect: 'read' | 'validate' | 'write' | 'none';
}
export interface MioOperation {
	turnId: string;
	callId: string;
	idempotencyKey: string;
	windowId?: string;
	revision?: string;
	ability: string;
	effect: 'read' | 'validate' | 'write' | 'none';
	status: 'running' | 'completed' | 'rejected' | 'confirmed' | 'unknown';
	receipt?: string;
}
export interface MioTurnSummary extends MioTurnContext {
	status: 'completed' | 'aborted' | 'failed';
	reads: number;
	rejected: number;
	confirmedWrites: number;
	unknownWrites: number;
	calls: number;
}
export interface MioHistoryEntry {
	name: string;
	callId: string;
	args: unknown;
	result: unknown;
}
export interface MioHistory {
	messages: readonly MioChatMessage[];
	help: unknown;
	outcomes: unknown[];
}
