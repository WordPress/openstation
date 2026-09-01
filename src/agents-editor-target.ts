/**
 * Agents — cross-bundle "open this agent's editor" target.
 *
 * The Agent chat window and the My WordPress window are two separate
 * lazy Vite bundles, so the click that asks for an agent's editor
 * (an avatar in the chat) can't reach the Agents section renderer
 * directly. The requested agent is threaded through a shared store
 * instead, exactly like `my-wordpress/footprint-target.ts` does for
 * the activity footprint.
 *
 * Flow:
 *   1. A caller invokes {@link openAgentEditor}, which stashes the
 *      agent id and opens (or focuses) the My WordPress window.
 *   2. The My WordPress bundle reads the target while choosing its
 *      initial route — cold open — or navigates on the subscription
 *      when the window was already mounted.
 *   3. The Agents section renderer consumes the target on mount and
 *      selects that agent, then clears it.
 *
 * The renderer owns the clear (not the router) because it runs
 * synchronously inside `navigate()`, so the target is always still
 * there when the section paints.
 *
 * @public
 */

import { createSharedStore } from './shared-store';

/** The explorer app's window id — its Agents section renders the editor. */
const MY_WORDPRESS_WINDOW_ID = 'my-wordpress';

/** Entity id of the Agents section inside My WordPress. */
export const AGENTS_ENTITY_ID = 'agents';

export interface AgentEditorTarget {
	/** Agent user id to select, or null when nothing is pending. */
	agentId: number | null;
	/** `Date.now()` of the last request — informational. */
	requestedAt: number;
}

export const agentEditorTarget = createSharedStore< AgentEditorTarget >(
	'desktop-mode/agents/editor-target',
	() => ( { agentId: null, requestedAt: 0 } ),
);

/** Read the pending target. `agentId === null` means nothing pending. */
export function readAgentEditorTarget(): AgentEditorTarget {
	return { ...agentEditorTarget.state };
}

/** Clear the target once a consumer has captured it. */
export function clearAgentEditorTarget(): void {
	agentEditorTarget.state.agentId = null;
	agentEditorTarget.state.requestedAt = 0;
	agentEditorTarget.notify();
}

/**
 * Subscribe to target changes — fires when a request arrives while
 * the My WordPress window is already open, so the live render can
 * navigate without a close/reopen.
 */
export function subscribeAgentEditorTarget(
	cb: ( target: AgentEditorTarget ) => void,
): () => void {
	return agentEditorTarget.subscribe( ( state ) => cb( { ...state } ) );
}

/**
 * Open (or focus) My WordPress on the Agents section with `agentId`
 * selected. Cold-start safe: the target is stashed before the window
 * opens, so the freshly-mounted bundle reads it back.
 *
 * @param agentId Agent user id.
 *
 * @public
 */
export function openAgentEditor( agentId: number ): void {
	if ( ! Number.isFinite( agentId ) || agentId <= 0 ) {
		return;
	}
	agentEditorTarget.state.agentId = agentId;
	agentEditorTarget.state.requestedAt = Date.now();
	// `createSharedStore` is mutate-then-notify; field assignment
	// alone never wakes subscribers.
	agentEditorTarget.notify();

	const openWindow = (
		window as unknown as {
			wp?: {
				os?: {
					openWindow?: (
						id: string,
						opts?: { source?: string },
					) => boolean;
				};
			};
		}
	).wp?.os?.openWindow;
	if ( typeof openWindow === 'function' ) {
		openWindow( MY_WORDPRESS_WINDOW_ID, { source: 'agents/editor' } );
	}
}
