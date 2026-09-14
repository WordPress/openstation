/** Window-scoped MIO assistance. Registrations never enter WordPress Abilities. */
export interface MioDocument {
	/** Relative Markdown path, also the target of links between documents. */
	id: string;
	title: string;
	markdown: string;
}

export interface MioAbility {
	/** Unique within this window; lowercase letters, digits and underscores. */
	name: string;
	description: string;
	/** JSON Schema advertised to the model; validate again before any write. */
	parameters: Record<string, unknown>;
	/** Must reject invalid arguments, including unknown keys. */
	validate: ( args: Record<string, unknown> ) => boolean;
	run: ( args: Record<string, unknown>, signal: AbortSignal ) => unknown | Promise<unknown>;
	/** Rechecked immediately before execution, for dynamic capability gates. */
	allowed?: () => boolean;
}

export interface MioWindowContext {
	/** Initial per-window consent; defaults to true. The dock remains the master switch. */
	enabled?: boolean;
	/** A connected element belonging to this window's body. */
	host: HTMLElement;
	title: string;
	/** Read before every model round, never cached. */
	prompt: () => string | Promise<string>;
	documents: readonly MioDocument[];
	/** Read before each model round and each action. */
	abilities: () => readonly MioAbility[];
}

export interface MioChatMessage {
	role: 'user' | 'assistant';
	text: string;
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
	/** Release ownership, abort work and erase this context's memory. */
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
