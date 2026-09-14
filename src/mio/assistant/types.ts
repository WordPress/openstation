/** Window-scoped MIO assistance. Registrations never enter WordPress Abilities. */
export interface MioDocument {
	/** Relative Markdown path, also the target of links between documents. */
	id: string;
	title: string;
	markdown: string;
	version?: string;
	topics?: readonly string[];
	componentIds?: readonly string[];
}

export interface MioAbility {
	/** Unique within this window; lowercase letters, digits and underscores. */
	name: string;
	description: string;
	/** JSON Schema advertised to the model; validate again before any write. */
	parameters: Record<string, unknown>;
	/** Must reject invalid arguments, including unknown keys. */
	validate: ( args: Record<string, unknown>, context?: MioCallContext ) => boolean | MioValidationResult;
	run: ( args: Record<string, unknown>, signal: AbortSignal, context: MioCallContext ) => unknown | Promise<unknown>;
	/** Omitted metadata is conservatively treated as a write. */
	effect?: 'read' | 'validate' | 'write' | 'none';
	/** Replace large args/results with an app-owned, lossless resource reference. */
	history?: ( entry: MioHistoryEntry, context: MioCallContext ) => Record<string, unknown>;
	/** Rechecked immediately before execution, for dynamic capability gates. */
	allowed?: () => boolean;
}

export interface MioWindowContext {
	/** Initial per-window consent; defaults to true. The dock remains the master switch. */
	enabled?: boolean;
	/** A connected element belonging to this window's body. */
	host: HTMLElement;
	title: string;
	/** Stable instance id and a live document/window revision, never model supplied. */
	windowId?: string;
	revision?: () => string;
	onTurnBegin?: ( context: MioTurnContext ) => void;
	onTurnEnd?: ( summary: MioTurnSummary ) => void;
	onTurnAbort?: ( context: MioTurnContext ) => void;
	onOperation?: ( operation: MioOperation ) => void;
	/** App-owned read/navigation buttons, resolved once from the settled turn. */
	responseActions?: ( context: MioResponseContext ) => readonly MioResponseAction[];
	/** Read-only application endpoint; must never retry a write. */
	operationStatus?: ( operation: MioOperation, signal: AbortSignal ) => Promise<MioOperationOutcome>;
	/** Optional app-owned history representation; no automatic document truncation. */
	compactHistory?: ( history: MioHistory, context: MioTurnContext ) => unknown;
	/** Read before every model round, never cached. */
	prompt: () => string | Promise<string>;
	documents: readonly MioDocument[];
	/** Read before each model round and each action. */
	abilities: () => readonly MioAbility[];
}

export interface MioChatMessage {
	role: 'user' | 'assistant';
	text: string;
	id?: string;
	/** Opaque lease-local references; never executable definitions. */
	actionIds?: readonly string[];
}

export interface MioResponseAction {
	/** Unique within this message, 1–80 characters. */
	id: string;
	/** Plain text, 1–40 characters. */
	label: string;
	ariaLabel?: string;
	/** A Dashicon identifier; no markup or URL. */
	icon?: string;
	emphasis?: 'primary' | 'secondary';
	/** Callbacks must not save, submit, publish or otherwise write. */
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
	/** Frozen snapshots of this turn only, with no arguments or result bodies. */
	operations: readonly Readonly<MioOperation>[];
}

/** Explicit extension point; the default implementation is memory only. */
export interface MioConversationStore {
	read: () => readonly MioChatMessage[];
	write: ( messages: readonly MioChatMessage[] ) => void;
	clear: () => void;
}

/** A dismissible, window-local tip. No model request or persistence is involved. */
export interface MioCallout {
	/** Dismissal is remembered by id until this window lease is disposed. */
	id: string;
	/** Resolve after app renders; return null while the relevant view is absent. */
	target: () => HTMLElement | null;
	message: string;
	onDismiss?: () => void;
}

export interface MioWindowLease {
	/** Present MIO beside a caller-owned control, subject to both enable switches. */
	showCallout: ( callout: MioCallout ) => void;
	/** Withdraw the tip without recording a dismissal. */
	clearCallout: () => void;
	/** This instance's consent, independent of the master dock switch. */
	isEnabled: () => boolean;
	/** Enable or disable residency and chat for this instance. Never enables the master switch. */
	setEnabled: ( enabled: boolean ) => void;
	/** Open the floating conversation for this context, only while focused. */
	openChat: () => Promise<void>;
	/** Content-free, memory-only operation metadata, including uncertain saves. */
	getOperations: () => MioOperation[];
	/** Reconcile via the caller's read-only endpoint, including after disposal. */
	inspectOperation: ( callId: string, signal?: AbortSignal ) => Promise<MioOperation>;
	/** Release ownership, abort work and erase this context's conversation memory. */
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
	/** JSON path, e.g. $.document.fields[2].name. */
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
	/** Stable for this one logical invocation; never permission to replay it. */
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
