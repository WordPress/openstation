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
import { retireTexture } from './texture-retire';
import {
	WINDOW_EFFECT_NONE,
	type StageRect,
	type WindowEffectDef,
	type WindowEffectSelection,
	type WindowTransition,
} from './types';

/** Fallback when a def declares no duration. */
const DEFAULT_DURATION_MS = 400;

/**
 * Hard ceiling on how long a window may stay hidden for an effect.
 *
 * Hiding the real element is what makes the animated copy the only
 * visible one — but a hidden element receives no pointer events, so a
 * window stuck hidden is a window nobody can click, drag or close. No
 * effect is worth that, so visibility is restored on a timer regardless
 * of whether the effect ever resolves.
 */
const MAX_HIDDEN_MS = 4000;

/**
 * How long the stand-in stays on screen after the real window is
 * un-hidden, as a backstop for the two-frame hand-off below.
 */
const HANDOFF_BACKSTOP_MS = 250;

/**
 * Opacity used to hide a window while its animated copy plays.
 *
 * Deliberately not `0` — see {@link hideForEffect}.
 */
const HIDDEN_OPACITY = '0.001';

/**
 * Take a window off screen for the duration of an effect.
 *
 * Opacity, not `visibility: hidden` or `display: none`:
 *
 * - `visibility` is INHERITED, so any descendant carrying
 *   `visibility: visible` punches straight back through the hidden
 *   parent — the window reappears in pieces behind the animation.
 *   Opacity has no such escape hatch.
 * - `display: none` would collapse layout and move every other window.
 * - Opacity also leaves the element hit-testable, so a drag in progress
 *   keeps receiving pointer events.
 *
 * Not a flat `0`, though: a fully transparent subtree can be skipped
 * during paint altogether, and iframes get their rendering throttled
 * when they are. Restoring the window then made the iframe repaint from
 * scratch, which looked exactly like the whole shell reloading. A hair
 * above zero keeps the browser painting it, and at one part in a
 * thousand it is invisible — behind the animated copy anyway.
 *
 * Both writes go through {@link withoutTransition}, which is the half
 * that actually matters — see there.
 *
 * @param element The window element.
 */
function hideForEffect( element: HTMLElement ): void {
	withoutTransition( element, () => {
		element.style.opacity = HIDDEN_OPACITY;
	} );
}

/**
 * Put a window back on screen, instantly.
 *
 * Idempotent, so the watchdog and the normal path can both call it.
 *
 * @param element The window element.
 */
function showAfterEffect( element: HTMLElement ): void {
	withoutTransition( element, () => {
		element.style.opacity = '';
	} );
}

/**
 * Apply a style change that must take effect *now*, not over 200 ms.
 *
 * Windows carry `opacity 0.2s ease` in their base transition list
 * (`assets/css/window-chrome.css`), so writing the property does not
 * hide or show a window — it **animates** it. Dragging masked that at
 * the start, because the window manager's `--dragging` class sets
 * `transition: none`, but not at the end: the class comes off at
 * pointer-up, hundreds of milliseconds before a sustained effect
 * finishes settling. So handing the window back faded it in from
 * nothing while its stand-in was already gone. That was the blink, and
 * no amount of timing the stand-in's removal could have fixed it.
 *
 * Off for the write only, not for the effect's whole run: a snap-drag
 * gives the window a deliberate 90 ms transition of its own, and
 * pinning transitions off wholesale would silently flatten it. Any
 * inline value already on the element is put back rather than cleared,
 * for the same reason.
 *
 * @param element The element to restyle.
 * @param apply   Makes the change. Runs with transitions suppressed.
 */
function withoutTransition( element: HTMLElement, apply: () => void ): void {
	const previous = element.style.transition;
	element.style.transition = 'none';
	apply();
	// Reading a layout property flushes the change while transitions are
	// still off. The value is deliberately unused; the read is the work.
	void element.offsetHeight;
	element.style.transition = previous;
}

/** Transitions that run until something stops them, not for a duration. */
const SUSTAINED: ReadonlySet< string > = new Set( [ 'drag' ] );

/**
 * Transitions during which the real element is hidden.
 *
 * Everything where the window is arriving, leaving, or already captured
 * by an active drag. Focus and blur are deliberately absent: they fire
 * mid-click, while the user is interacting with the window, and hiding
 * it there swallows the very click that caused them — you cannot press
 * the close button or start a drag on a window that vanishes under the
 * pointer.
 *
 * Not hiding costs nothing in blocking terms: the Pixi canvas draws
 * pixels and never receives pointer events itself (the `layoutsubtree`
 * children do), so a focus effect simply animates a ghost over the live
 * window.
 */
const HIDES_WINDOW: ReadonlySet< string > = new Set( [
	'open',
	'close',
	'minimize',
	'restore',
	'maximize',
	'unmaximize',
	'drag',
] );

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

		/*
		 * Each effect gets its OWN container inside the overlay.
		 *
		 * Effects add display objects of their own — the dissolve makes
		 * hundreds of particles, the cloth builds a mesh — and all of
		 * them reference the captured texture. If the engine only tore
		 * down the sprite it created, those extras outlived the texture
		 * it destroyed, and the next render hit a null GPU resource:
		 *
		 *   Cannot read properties of null (reading '0') at setResource
		 *
		 * The reproducer is starting a second drag while the first is
		 * still settling: the new effect supersedes the old one, whose
		 * mesh is still in the scene graph. Owning a whole container
		 * makes teardown cover everything the effect built, in the right
		 * order, without the engine needing to know what that was.
		 */
		const layer = new pixi.Container();
		overlay.addChild( layer );

		const sprite = new pixi.Sprite( texture );
		sprite.x = from.x;
		sprite.y = from.y;
		layer.addChild( sprite );

		// Hide the real element so the desktop snapshot stops drawing it
		// and only the animated copy shows. See `hideForEffect` — how it
		// hides matters more than it looks.
		const hides = HIDES_WINDOW.has( transition );
		if ( hides ) {
			hideForEffect( element );
		}

		const controller = new AbortController();
		const sustained = SUSTAINED.has( transition );
		let done = false;

		/*
		 * Watchdog, for MOMENTARY effects only. If one never resolves — a
		 * thrown ticker callback, a torn-down stage, a bug — the window
		 * must not be left invisible and unclickable.
		 *
		 * A sustained effect gets no clock at all. There is no honest
		 * number: a drag lasting a minute is perfectly ordinary, and any
		 * ceiling picked out of the air eventually fires mid-drag and
		 * un-hides the real window behind its own animation. The failsafe
		 * has to be a FACT rather than a duration, and there is one
		 * readily available — a pointer release means the drag is over,
		 * whatever the window manager did or did not tell us. Drag-end
		 * normally aborts first; this only matters when that event goes
		 * missing (a pointer capture lost to an alt-tab, a window torn
		 * out from under the drag).
		 */
		const watchdog =
			hides && ! sustained
				? setTimeout( () => {
					showAfterEffect( element );
				}, MAX_HIDDEN_MS )
				: null;

		let releaseFailsafe: ( () => void ) | null = null;
		if ( sustained ) {
			const onPointerRelease = (): void => {
				controller.abort();
			};
			// Capture phase: a window that stops propagation on pointerup
			// must not be able to strand its own effect.
			document.addEventListener( 'pointerup', onPointerRelease, true );
			document.addEventListener( 'pointercancel', onPointerRelease, true );
			releaseFailsafe = () => {
				document.removeEventListener(
					'pointerup',
					onPointerRelease,
					true,
				);
				document.removeEventListener(
					'pointercancel',
					onPointerRelease,
					true,
				);
			};
		}

		/*
		 * Whether the stand-in should outlive the un-hiding by a frame or
		 * two.
		 *
		 * The stage does not draw the DOM directly — it uploads a
		 * SNAPSHOT of it, refreshed once per ticker frame from inside the
		 * browser's paint event. So restoring the window's opacity does
		 * not put it back on screen; it puts it back on screen a couple
		 * of frames later, once the snapshot catches up. Removing the
		 * stand-in in the same breath therefore left a gap where neither
		 * was drawn, which is the abrupt blink at the end of a drag.
		 *
		 * Overlapping instead of gapping is free here: an effect that
		 * hands the window back has already settled its stand-in onto the
		 * window's exact rectangle, so for those two frames the same
		 * pixels are simply drawn twice, in the same place.
		 *
		 * Not for `close`: that element is on its way out of the DOM, and
		 * keeping the copy around only risks flashing a window that is
		 * supposed to be gone.
		 */
		const deferTeardown = hides && 'close' !== transition;

		let torn = false;
		const tearDown = (): void => {
			if ( torn ) {
				return;
			}
			torn = true;
			try {
				// Container first — everything that could still be
				// sampling the texture must leave the scene graph before
				// its GPU resource is released.
				overlay.removeChild( layer );
				layer.destroy( { children: true } );
			} catch {
				// Destroying twice is harmless; the references go out of
				// scope either way.
			}

			// Hand the texture to the deferred reaper rather than freeing
			// it here — releasing a texture is neither immediate nor
			// silent, see `./texture-retire`.
			retireTexture( texture );
		};

		const cleanup = (): void => {
			if ( done ) {
				return;
			}
			done = true;
			running.delete( windowId );
			if ( watchdog ) {
				clearTimeout( watchdog );
			}
			releaseFailsafe?.();

			// Un-hide FIRST, so the stage's next snapshot already has the
			// real window in it. Closing windows are removed from the DOM
			// by the window manager, so this is a no-op there.
			if ( hides ) {
				showAfterEffect( element );
			}

			if ( ! deferTeardown ) {
				tearDown();
				return;
			}

			// Two frames: one for the browser to paint the restored
			// element, one for the stage to upload and draw that paint.
			// The timer is the backstop for a tab that gets hidden before
			// either frame arrives — `tearDown` is idempotent, so
			// whichever wins is fine.
			requestAnimationFrame( () => requestAnimationFrame( tearDown ) );
			setTimeout( tearDown, HANDOFF_BACKSTOP_MS );
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
				layer,
				from,
				to,
				element,
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

	/**
	 * Document CustomEvents carry `detail.windowId`, not the element, so
	 * look it up.
	 *
	 * The DOM id is NOT the window id — `createWindowElement()` builds it
	 * as `wp-window-<id>` (see `src/window/dom.ts`). Looking up the bare
	 * id silently found nothing, which is why the event-driven
	 * transitions (open, focus, blur) never played while the
	 * action-driven ones — which receive `element` in their payload —
	 * worked fine.
	 */
	function elementFor( windowId: string ): HTMLElement | null {
		return document.getElementById( `wp-window-${ windowId }` );
	}

	const onOpened = ( e: Event ): void => {
		const id = ( e as CustomEvent ).detail?.windowId;
		const el = id ? elementFor( id ) : null;
		if ( el ) {
			play( 'open', id, el );
		}
	};
	document.addEventListener( 'desktop-mode-window-opened', onOpened );
	document.addEventListener( 'desktop-mode-window-reopened', onOpened );

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

	/*
	 * Drag is sustained rather than momentary: it starts on drag-start
	 * and runs until drag-end aborts it. The effect loops until its
	 * signal fires, so the engine only has to start and stop it.
	 */
	addAction(
		HOOKS.WINDOW_DRAG_START,
		`${ namespace }/drag-start`,
		( payload: { windowId?: string } ) => {
			const windowId = payload?.windowId;
			const element = windowId ? elementFor( windowId ) : null;
			if ( windowId && element ) {
				play( 'drag', windowId, element );
			}
		},
	);
	addAction(
		HOOKS.WINDOW_DRAG_END,
		`${ namespace }/drag-end`,
		( payload: { windowId?: string } ) => {
			const windowId = payload?.windowId;
			if ( ! windowId ) {
				return;
			}
			// Abort rather than clean up: the effect decides how to wind
			// down, and its own resolution drives the teardown.
			running.get( windowId )?.controller.abort();
		},
	);

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
		for ( const [ hook ] of stateHooks ) {
			removeAction( hook, namespace );
		}
		removeAction( HOOKS.WINDOW_DRAG_START, `${ namespace }/drag-start` );
		removeAction( HOOKS.WINDOW_DRAG_END, `${ namespace }/drag-end` );
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
