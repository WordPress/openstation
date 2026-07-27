/**
 * Desktop Mode — canvas stage singleton (lazy-bundle side).
 *
 * Ships in `assets/js/stage[.min].js`, never in the main shell bundle,
 * because everything under it pulls in the Pixi glue. The main bundle
 * talks to this through `window.desktopModeStage` — see
 * `src/stage/loader.ts` for the other half of that contract.
 *
 * Holds the one `CanvasStage` for the page plus the user's raw
 * selection, and re-resolves the selection into a filter chain whenever
 * either the selection *or* the registry changes. That second trigger
 * matters: a plugin's effect can register long after boot (its script
 * loads on the plugins-changed payload sweep), and an effect the user
 * already had selected must light up when it finally arrives.
 *
 * @since 0.9.8
 */

import { resolveEffectChain } from './chain';
import { listScreenEffects, subscribeScreenEffects } from './registry';
import { CanvasStage } from './stage';
import type { ScreenEffectSelection } from './types';

let stage: CanvasStage | null = null;
let selection: ScreenEffectSelection[] = [];
let unsubscribeRegistry: ( () => void ) | null = null;

export interface StartStageOptions {
	/** The shell root — `#desktop-mode-shell`. */
	shell: HTMLElement;
	/** The user's saved effect chain. */
	selection?: ScreenEffectSelection[];
}

/**
 * Wrap the shell and begin rendering through the canvas. Resolves once
 * the first frame is on screen. Calling it while already running just
 * applies the new selection.
 *
 * @param options Shell element and initial effect selection.
 */
export async function startStage( options: StartStageOptions ): Promise< void > {
	selection = options.selection ?? [];

	if ( ! stage ) {
		stage = new CanvasStage( { shell: options.shell } );
	}

	await stage.start( currentChain() );

	if ( ! unsubscribeRegistry ) {
		unsubscribeRegistry = subscribeScreenEffects( () => {
			void stage?.setEffects( currentChain() );
		} );
	}
}

/** Unwrap the shell and tear the renderer down. Safe when stopped. */
export function stopStage(): void {
	unsubscribeRegistry?.();
	unsubscribeRegistry = null;
	stage?.stop();
	selection = [];
}

/**
 * Replace the active effect chain. No-op when the stage is stopped
 * beyond remembering the selection for the next `startStage()`.
 *
 * @param next The user's new effect chain.
 */
export async function setStageSelection(
	next: ScreenEffectSelection[],
): Promise< void > {
	selection = next;
	await stage?.setEffects( currentChain() );
}

/** Whether the shell is currently rendering through the canvas. */
export function isStageActive(): boolean {
	return stage?.isActive === true;
}

function currentChain() {
	return resolveEffectChain( selection, listScreenEffects() );
}
