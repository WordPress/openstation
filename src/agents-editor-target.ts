import { createSharedStore } from './shared-store';

const MY_WORDPRESS_WINDOW_ID = 'my-wordpress';

export const AGENTS_ENTITY_ID = 'agents';

export interface AgentEditorTarget {

	agentId: number | null;

	requestedAt: number;
}

export const agentEditorTarget = createSharedStore< AgentEditorTarget >(
	'desktop-mode/agents/editor-target',
	() => ( { agentId: null, requestedAt: 0 } ),
);

export function readAgentEditorTarget(): AgentEditorTarget {
	return { ...agentEditorTarget.state };
}

export function clearAgentEditorTarget(): void {
	agentEditorTarget.state.agentId = null;
	agentEditorTarget.state.requestedAt = 0;
	agentEditorTarget.notify();
}

export function subscribeAgentEditorTarget(
	cb: ( target: AgentEditorTarget ) => void,
): () => void {
	return agentEditorTarget.subscribe( ( state ) => cb( { ...state } ) );
}

export function openAgentEditor( agentId: number ): void {
	if ( ! Number.isFinite( agentId ) || agentId <= 0 ) {
		return;
	}
	agentEditorTarget.state.agentId = agentId;
	agentEditorTarget.state.requestedAt = Date.now();

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
