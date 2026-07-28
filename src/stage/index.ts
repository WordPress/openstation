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
import { startWindowEffectEngine } from './window-fx/engine';
import type { WindowEffectSelection } from './window-fx/types';

let stage: CanvasStage | null = null;
let selection: ScreenEffectSelection[] = [];
let unsubscribeRegistry: ( () => void ) | null = null;
let stopWindowEffects: ( () => void ) | null = null;
let windowSelection: Record< string, WindowEffectSelection > = {};

export interface StartStageOptions {
	/** The shell root — `#desktop-mode-shell`. */
	shell: HTMLElement;
	/** The user's saved effect chain. */
	selection?: ScreenEffectSelection[];
	/** The user's per-transition window animation choices. */
	windowEffects?: Record< string, WindowEffectSelection >;
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
	windowSelection = options.windowEffects ?? {};

	if ( ! stage ) {
		stage = new CanvasStage( { shell: options.shell } );
	}

	await stage.start( currentChain() );

	if ( ! unsubscribeRegistry ) {
		unsubscribeRegistry = subscribeScreenEffects( () => {
			void stage?.setEffects( currentChain() );
		} );
	}

	// Window transition effects ride on the same stage: they capture
	// regions of its texture and animate them in its overlay, so they
	// start and stop with it.
	if ( ! stopWindowEffects && stage ) {
		stopWindowEffects = startWindowEffectEngine( {
			stage,
			getSelection: () => windowSelection,
		} );
	}
}

/**
 * Replace the per-transition window animation choices. Read fresh on
 * every transition, so this takes effect immediately.
 *
 * @param next The user's new per-transition selection.
 */
export function setWindowEffectSelection(
	next: Record< string, WindowEffectSelection >,
): void {
	windowSelection = next;
}

/** Unwrap the shell and tear the renderer down. Safe when stopped. */
export function stopStage(): void {
	stopWindowEffects?.();
	stopWindowEffects = null;
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

/**
 * Paint and upload counts for the running stage, or `null`.
 *
 * The stage asks the browser to re-record the shell every frame but only
 * uploads when the paint says something changed. This reports whether
 * that is actually happening: `skipped` climbs on an idle desktop and
 * stalls the moment anything moves.
 */
export function stageStats() {
	return stage?.stats ?? null;
}

function currentChain() {
	return resolveEffectChain( selection, listScreenEffects() );
}
