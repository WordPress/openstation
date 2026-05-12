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
 * @since 0.14.0
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
	 * @since 0.17.0
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
}

/**
 * Factory exported by the impl bundle on
 * `window.desktopModeCreateAiAssistant`. The stub awaits the script
 * load, then calls this to materialise the real assistant.
 */
export type AiAssistantFactory = ( config: AiAssistantConfig ) => AiAssistantApi & {
	attachAsk( fn: AskFn ): void;
};
