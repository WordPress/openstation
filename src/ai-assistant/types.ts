/**
 * Desktop Mode — AI Assistant shared types.
 *
 * Lives in its own file so the main-bundle stub can import the
 * interface without dragging the full `impl.ts` (38 kB) along with
 * it. The impl bundle re-exports the same interface from
 * `./impl.ts` (its native declaration site) — keep the two in sync.
 *
 * @since 0.8.4
 */

import type { AskFn } from '../ai/ask';

/**
 * Public contract of the AI Assistant — what plugins reach through
 * `wp.desktop.ai`. Implemented by both the lazy stub (main bundle)
 * and the real `AiAssistant` class (in the lazy-loaded
 * `ai-assistant` bundle).
 *
 * @since 0.8.4
 */
export interface AiAssistantApi {
	open(): void;
	close(): void;
	toggle(): void;
	readonly isOpen: boolean;
	/**
	 * Programmatic access to the AI Copilot — same endpoint the
	 * overlay uses. Wired by `desktop.ts` via {@link AiAssistantStubMethods.attachAsk}.
	 *
	 * @since 0.8.4
	 */
	ask: AskFn;
}

/**
 * Construction config for the real {@link AiAssistant} class — and
 * the stub's lazy-loader. Defined here so the entry bundle's factory
 * signature can be typed from the main bundle without dragging the
 * impl.
 */
export interface AiAssistantConfig {
	aiSearchUrl: string;
	aiSearchStreamUrl: string;
	restNonce: string;
	getTransport?: () => 'sse' | 'off';
	/**
	 * Whether the AI mode is usable — the AI APIs are present and a
	 * provider is configured. When false the assistant is a pure command
	 * palette (Commands mode only, no mode switch). Read live so the
	 * overlay reflects a provider being (dis)connected without a reload.
	 */
	isAiAvailable?: () => boolean;
	/**
	 * The "AI assistant" toggle (OS Settings → Features). When on (and a
	 * provider is configured), the assistant offers the AI mode and opens
	 * in it by default, and the Commands/Ask AI switch appears; when off,
	 * it's a plain command palette. Read live so flipping the toggle takes
	 * effect on the next open.
	 */
	isOverrideEnabled?: () => boolean;
}

/**
 * Factory exported by the impl bundle on
 * `window.desktopModeCreateAiAssistant`. The stub awaits the script
 * load, then calls this to materialise the real assistant.
 */
export type AiAssistantFactory = ( config: AiAssistantConfig ) => AiAssistantApi & {
	attachAsk( fn: AskFn ): void;
};
