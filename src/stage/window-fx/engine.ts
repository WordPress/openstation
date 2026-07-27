/**
 * Desktop Mode — Window transition effect engine.
 *
 * Listens for window lifecycle events and, when the user has an effect
 * configured for that transition, plays it as a PixiJS animation over
 * the canvas stage.
 *
 * The sequence for every transition is the same:
 *
 * 1. Measure the window's rectangle relative to the stage canvas.
 * 2. Freeze that rectangle out of the stage's live desktop texture.
 * 3. Hide the real element, so the desktop texture stops drawing it.
 * 4. Hand the frozen sprite to the effect and let it animate.
 * 5. Clean up: destroy the sprite and restore the element's visibility.
 *
 * **Why the capture lands on the "before" state.** The stage's texture
 * only re-uploads when the browser repaints, so at the instant a
 * lifecycle action fires — synchronously, mid-DOM-mutation — the texture
 * still holds the previous frame. That is exactly the frame we want: the
 * window as it looked *before* it minimised or maximised. Capturing
 * after the fact would otherwise be impossible for transitions whose
 * only notification arrives once the element is already hidden.
 *
 * @since 0.9.8
 */

import {
	addAction,
	addFilter,
	HOOKS,
	removeAction,
	removeFilter,
} from '../../hooks';
import { resolveParams } from '../chain';
import type { CanvasStage } from '../stage';
import { getWindowEffect } from './registry';
import {
	WINDOW_EFFECT_NONE,
	type StageRect,
	type WindowEffectDef,
	type WindowEffectSelection,
	type WindowTransition,
} from './types';

/** Fallback when a def declares no duration. */
const DEFAULT_DURATION_MS = 400;

/** Unique namespace per engine instance, so teardown is exact. */
let namespaceCounter = 0;

export interface WindowEffectEngineDeps {
	stage: CanvasStage;
	/** The user's per-transition selection, read fresh on every event. */
	getSelection(): Readonly< Record< string, WindowEffectSelection > >;
	/**
	 * Where a minimising window is heading, in CSS pixels relative to
	 * the stage — normally its dock tile. Optional; without it the genie
	 * effect collapses in place.
	 */
	getMinimizeTarget?( windowId: string ): StageRect | null;
}

interface RunningEffect {
	controller: AbortController;
	cleanup(): void;
}

export function startWindowEffectEngine(
	deps: WindowEffectEngineDeps,
): () => void {
	const { stage, getSelection } = deps;
	const namespace = `desktop-mode/window-fx-${ ++namespaceCounter }`;
	const running = new Map< string, RunningEffect >();

	/** Resolve the configured effect for a transition, if any. */
	function effectFor(
		transition: WindowTransition,
	): { def: WindowEffectDef; params: Record< string, number > } | null {
		const selection = getSelection()[ transition ];
		if ( ! selection || selection.id === WINDOW_EFFECT_NONE ) {
			return null;
		}
		const def = getWindowEffect( selection.id );
		if ( ! def || ! def.transitions.includes( transition ) ) {
			return null;
		}
		return {
			def,
			// `resolveParams` is the screen-effect helper — the parameter
			// contract is identical, so it is shared rather than cloned.
			params: resolveParams(
				{ params: def.params } as never,
				selection.params,
			),
		};
	}

	/** The element's box in CSS pixels relative to the stage canvas. */
	function rectOf( element: HTMLElement ): StageRect | null {
		const canvas = stage.canvas;
		if ( ! canvas ) {
			return null;
		}
		const box = element.getBoundingClientRect();
		// A zero-area window has nothing worth capturing — it is either
		// already hidden or mid-layout.
		if ( box.width <= 0 || box.height <= 0 ) {
			return null;
		}
		const origin = canvas.getBoundingClientRect();
		return {
			x: box.left - origin.left,
			y: box.top - origin.top,
			width: box.width,
			height: box.height,
		};
	}

	/**
	 * Play `transition` for a window. Returns the effect's nominal
	 * duration in milliseconds, or 0 when nothing ran — which is what
	 * the close gate needs in order to size its wait.
	 */
	function play(
		transition: WindowTransition,
		windowId: string,
		element: HTMLElement,
		to?: StageRect,
	): number {
		const pixi = stage.pixi;
		const overlay = stage.overlay;
		const ticker = stage.ticker;
		if ( ! pixi || ! overlay || ! ticker ) {
			return 0;
		}

		const chosen = effectFor( transition );
		if ( ! chosen ) {
			return 0;
		}

		const from = rectOf( element );
		if ( ! from ) {
			return 0;
		}

		const texture = stage.captureRegion( from );
		if ( ! texture ) {
			return 0;
		}

		// A newer transition supersedes whatever this window was doing.
		running.get( windowId )?.controller.abort();
		running.get( windowId )?.cleanup();

		const sprite = new pixi.Sprite( texture );
		sprite.x = from.x;
		sprite.y = from.y;
		overlay.addChild( sprite );

		// Hide the real element so the desktop texture stops drawing it
		// and only our animated copy is visible. `visibility` rather than
		// `display` so layout, and therefore every other window's
		// position, is undisturbed.
		element.style.visibility = 'hidden';

		const controller = new AbortController();
		let done = false;
		const cleanup = (): void => {
			if ( done ) {
				return;
			}
			done = true;
			running.delete( windowId );
			try {
				sprite.destroy();
				texture.destroy( true );
			} catch {
				// Destroying twice is harmless here; the references go
				// out of scope either way.
			}
			// Closing windows are removed from the DOM by the window
			// manager, so restoring visibility is a no-op there and
			// matters for every other transition.
			// Restore rather than clear: the window manager may have set
			// its own inline visibility (minimised windows do).
			element.style.visibility = '';
		};

		running.set( windowId, { controller, cleanup } );

		const durationMs = chosen.def.durationMs
			? chosen.def.durationMs( chosen.params )
			: DEFAULT_DURATION_MS;

		try {
			const result = chosen.def.run( {
				pixi,
				transition,
				params: chosen.params,
				sprite,
				texture,
				layer: overlay,
				from,
				to,
				ticker,
				signal: controller.signal,
			} );
			Promise.resolve( result )
				.catch( ( err ) => {
					reportEffectError( chosen.def.id, transition, err );
				} )
				.finally( cleanup );
		} catch ( err ) {
			reportEffectError( chosen.def.id, transition, err );
			cleanup();
			return 0;
		}

		return durationMs;
	}

	// -----------------------------------------------------------------
	// Lifecycle wiring
	// -----------------------------------------------------------------

	/** Document CustomEvents carry `detail.windowId`; look the element up. */
	function elementFor( windowId: string ): HTMLElement | null {
		return document.getElementById( windowId );
	}

	const onOpened = ( e: Event ): void => {
		const id = ( e as CustomEvent ).detail?.windowId;
		const el = id ? elementFor( id ) : null;
		if ( el ) {
			play( 'open', id, el );
		}
	};
	const onFocused = ( e: Event ): void => {
		const id = ( e as CustomEvent ).detail?.windowId;
		const el = id ? elementFor( id ) : null;
		if ( el ) {
			play( 'focus', id, el );
		}
	};
	const onBlurred = ( e: Event ): void => {
		const id = ( e as CustomEvent ).detail?.windowId;
		const el = id ? elementFor( id ) : null;
		if ( el ) {
			play( 'blur', id, el );
		}
	};

	document.addEventListener( 'desktop-mode-window-opened', onOpened );
	document.addEventListener( 'desktop-mode-window-reopened', onOpened );
	document.addEventListener( 'desktop-mode-window-focused', onFocused );
	document.addEventListener( 'desktop-mode-window-blurred', onBlurred );

	/** State transitions arrive as hook actions with `{ windowId, element }`. */
	const stateHooks: Array< [ string, WindowTransition ] > = [
		[ HOOKS.WINDOW_MINIMIZED, 'minimize' ],
		[ HOOKS.WINDOW_RESTORED, 'restore' ],
		[ HOOKS.WINDOW_MAXIMIZED, 'maximize' ],
		[ HOOKS.WINDOW_UNMAXIMIZED, 'unmaximize' ],
	];

	for ( const [ hook, transition ] of stateHooks ) {
		addAction(
			hook,
			namespace,
			( payload: { windowId?: string; element?: HTMLElement } ) => {
				const { windowId, element } = payload ?? {};
				if ( ! windowId || ! element ) {
					return;
				}
				const to =
					transition === 'minimize'
						? ( deps.getMinimizeTarget?.( windowId ) ?? undefined )
						: undefined;
				play( transition, windowId, element, to );
			},
		);
	}

	/**
	 * Close is a filter, not an event, because the window manager has to
	 * WAIT for us. Returning a duration tells `Window.close()` to hold
	 * its teardown open that long instead of the default 300 ms.
	 */
	const closeFilterNamespace = `${ namespace }/close`;
	addFilter(
		HOOKS.WINDOW_CLOSE_ANIMATION,
		closeFilterNamespace,
		(
			claimed: number | null,
			payload: { windowId?: string; element?: HTMLElement },
		) => {
			// Another handler already claimed this close.
			if ( typeof claimed === 'number' && claimed > 0 ) {
				return claimed;
			}
			const { windowId, element } = payload ?? {};
			if ( ! windowId || ! element ) {
				return claimed;
			}
			const duration = play( 'close', windowId, element );
			return duration > 0 ? duration : claimed;
		},
	);

	return () => {
		document.removeEventListener( 'desktop-mode-window-opened', onOpened );
		document.removeEventListener( 'desktop-mode-window-reopened', onOpened );
		document.removeEventListener( 'desktop-mode-window-focused', onFocused );
		document.removeEventListener( 'desktop-mode-window-blurred', onBlurred );
		for ( const [ hook ] of stateHooks ) {
			removeAction( hook, namespace );
		}
		removeFilter( HOOKS.WINDOW_CLOSE_ANIMATION, closeFilterNamespace );
		for ( const entry of Array.from( running.values() ) ) {
			entry.controller.abort();
			entry.cleanup();
		}
		running.clear();
	};
}

function reportEffectError(
	id: string,
	transition: string,
	err: unknown,
): void {
	if ( typeof console !== 'undefined' ) {
		console.error(
			`[desktop-mode/stage] window effect "${ id }" threw during "${ transition }":`,
			err,
		);
	}
}
