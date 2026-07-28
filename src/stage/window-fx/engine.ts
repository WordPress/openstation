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
 * **The snapshot lags the DOM, and that cuts both ways.** The stage's
 * texture only re-uploads when the browser repaints, so at the instant a
 * lifecycle action fires — synchronously, mid-DOM-mutation — it still
 * holds the previous frame.
 *
 * For transitions announced AFTER the change, that lag is the whole
 * reason this works: a minimise arrives once the window is already
 * minimised, and the stale frame is the only remaining record of what it
 * looked like before.
 *
 * For a drag it is a bug. Drag-start is announced BEFORE anything about
 * the window changes, and the pointerdown just before it raised the
 * window to the top of the stack — so the DOM has it on top while the
 * snapshot still has it underneath, and the capture came out with the
 * overlapping window baked into the pixels. Those transitions wait for
 * `stage.afterNextSnapshot()` first; see `NEEDS_FRESH_SNAPSHOT`.
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
import { createWindowShadow } from './shadow';
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
 * Transitions whose capture has to be corrected from a later snapshot.
 *
 * Both are announced BEFORE the window looks the way the effect needs it
 * to, so the first capture is wrong and has to be repainted a frame
 * later — see the long note in `play()`:
 *
 * - `drag` catches whatever window was overlapping this one, because the
 *   raise that put it on top has not reached the snapshot yet.
 * - `open` catches the WALLPAPER. The window is announced in the same
 *   synchronous block that created it (`appendChild` → `focus` →
 *   `dispatchEvent`, `window-manager/index.ts`), so it has never been
 *   painted and simply is not in the picture; the rectangle still holds
 *   whatever was behind it. That is why an opening window appeared to
 *   be see-through.
 *
 * Every other transition is announced AFTER the change, where the stale
 * snapshot is the only remaining record of the "before" state and
 * repainting would capture the aftermath.
 */
const NEEDS_FRESH_SNAPSHOT: ReadonlySet< string > = new Set( [
	'drag',
	'open',
] );

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

/**
 * The window manager's own CSS opening animation.
 *
 * `Window`'s constructor adds this class, and `window-states.css` runs a
 * 200 ms `opacity: 0 → 1` + `scale(0.92 → 1)` keyframe on it. When a
 * PixiJS open effect is playing, that animation is not merely redundant,
 * it makes the effect impossible:
 *
 * - The corrected capture, taken a frame after the window mounts, gets a
 *   window that is still at roughly zero opacity — so the effect
 *   animates a ghost, which is what made an opening window look
 *   see-through even after the capture was being corrected.
 * - A running CSS animation outranks inline styles in the cascade, so
 *   the engine's own `opacity` hide does not take effect until the
 *   animation ends. The real window shows through its own stand-in.
 *
 * Removing the class before the first paint means the animation never
 * runs, which is right: the effect the user chose replaces it.
 */
const OPENING_CLASS = 'desktop-mode-window--opening';

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

		// A zero-area window is mid-layout or already gone; nothing worth
		// capturing. Re-measured at capture time — this is only a gate.
		if ( ! rectOf( element ) ) {
			return 0;
		}

		// Now that an effect is definitely playing, call off the window
		// manager's CSS opening animation — see `OPENING_CLASS`. This runs
		// in the same synchronous block that mounted the window, so the
		// animation is cancelled before its first frame ever paints.
		if ( 'open' === transition ) {
			element.classList.remove( OPENING_CLASS );
		}

		// A newer transition supersedes whatever this window was doing.
		running.get( windowId )?.controller.abort();
		running.get( windowId )?.cleanup();

		const controller = new AbortController();
		const durationMs = chosen.def.durationMs
			? chosen.def.durationMs( chosen.params )
			: DEFAULT_DURATION_MS;

		/*
		 * Some transitions need their capture CORRECTED a frame later.
		 *
		 * A drag begins on pointermove, and the pointerdown that preceded
		 * it — possibly in the SAME frame — raised the window to the top
		 * of the stack. The DOM knows that; the snapshot does not yet, so
		 * freezing the window straight away catches whatever had been
		 * sitting on top of it.
		 *
		 * Nothing waits for that, though. Delaying the effect until the
		 * snapshot caught up meant the real window carried on being
		 * dragged, unaltered, for a beat before the animation took over —
		 * a visible hiccup, and a worse one than the bug it fixed. So the
		 * stand-in goes up immediately with the stale pixels, and once
		 * the snapshot lands the SAME texture is repainted from it and the
		 * real window is hidden. The stand-in covers the window for that
		 * one frame, so nothing flashes; the only imperfection is a single
		 * frame of stale pixels behind an already-moving animation.
		 *
		 * The other transitions do not correct at all, and for the
		 * opposite reason: they are notified AFTER the change has been
		 * made — a minimise arrives once the window is already minimised,
		 * a close once the `--closing` class is on. There the stale
		 * snapshot is the point, because it is the only remaining record
		 * of what the window looked like before; repainting it would
		 * capture the aftermath. Their stacking is safe anyway, since the
		 * pointerup that triggers them lands frames after the pointerdown
		 * that did the raising.
		 */
		let cancelWait: ( () => void ) | null = null;
		const entry: RunningEffect = {
			controller,
			cleanup: () => {
				cancelWait?.();
				running.delete( windowId );
			},
		};
		running.set( windowId, entry );

		/**
		 * Capture, hide, mount and run. Everything below owns cleanup.
		 *
		 * @param slot The registry entry to hand teardown over to.
		 * @return Whether anything is actually going to animate.
		 */
		const start = ( slot: RunningEffect ): boolean => {
			const from = rectOf( element );
			if ( ! from ) {
				running.delete( windowId );
				return false;
			}

			const texture = stage.captureRegion( from );
			if ( ! texture ) {
				running.delete( windowId );
				return false;
			}

			/*
			 * Whether the real element is hidden while the copy plays, and
			 * whether the copy outlives the un-hiding.
			 *
			 * `close` is the odd one out for the second: that element is on
			 * its way out of the DOM, and keeping the copy around only
			 * risks flashing a window that is supposed to be gone.
			 */
			const hides = HIDES_WINDOW.has( transition );
			const deferTeardown = hides && 'close' !== transition;

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

			/*
			 * The window's shadow, drawn rather than captured.
			 *
			 * `box-shadow` paints outside the border box, and the capture
			 * IS the border box — so a stand-in has never carried one, and
			 * the shadow snapped into existence the instant the window was
			 * handed back. Added before the sprite so it sits behind it.
			 *
			 * Only for transitions that hand the window back: a close ends
			 * with the window gone, so there is no moment of comparison to
			 * get wrong, and a crisp shadow outliving a dissolving window
			 * would be its own artefact.
			 */
			const shadow = deferTeardown
				? createWindowShadow( pixi, element, from )
				: null;
			if ( shadow ) {
				layer.addChild( shadow );
			}

			const sprite = new pixi.Sprite( texture );
			sprite.x = from.x;
			sprite.y = from.y;
			layer.addChild( sprite );

			// Hiding the real element is what makes the copy the only
			// visible one. See `hideForEffect` — how it hides matters more
			// than it looks.
			if ( NEEDS_FRESH_SNAPSHOT.has( transition ) ) {
				/*
				 * For one frame the real window stays visible and the
				 * stand-in stays hidden.
				 *
				 * Visible because it has to be IN the next snapshot for
				 * the corrected capture to contain it — that is the whole
				 * point. Hidden because until that correction the
				 * stand-in's pixels are known to be wrong, and on an open
				 * they are not merely wrong but the wallpaper: showing
				 * them is exactly the see-through flash being fixed. The
				 * real window is the better thing to look at for that
				 * frame, because it is the real window.
				 *
				 * The effect runs regardless, so it simply plays its first
				 * frame or two off-screen — a few milliseconds of a
				 * two-hundred millisecond animation.
				 */
				layer.visible = false;
				cancelWait = stage.afterNextSnapshot( () => {
					cancelWait = null;
					layer.visible = true;
					// Repaint from where the window is NOW, not from where
					// it was: a drag has moved it, and the old rectangle
					// holds half a wallpaper by this point. Only the pixels
					// are refreshed — the effect owns where its sprite
					// sits, and writing to it here would fight whatever it
					// set on its last frame.
					const now = rectOf( element );
					if ( now ) {
						stage.recaptureRegion( texture, now );
					}
					if ( hides ) {
						hideForEffect( element );
					}
				} );
			} else if ( hides ) {
				hideForEffect( element );
			}

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
		 * Keep the drawn shadow under whatever the effect is doing.
		 *
		 * By default it tracks the stand-in sprite, which is exactly right
		 * for the effects that animate that sprite — it scales, rotates
		 * and fades with the window.
		 *
		 * The moment an effect hides the sprite or fades it out, though,
		 * it has replaced it: the cloth builds a mesh, the dissolve builds
		 * particles, the reconstruct builds tiles. There is nothing
		 * sensible left to track, so the engine lets go and the effect
		 * owns `ctx.shadow` from then on.
		 */
			const syncShadow = (): void => {
				if ( ! shadow || ! sprite.visible || sprite.alpha <= 0 ) {
					return;
				}
				shadow.x = sprite.x;
				shadow.y = sprite.y;
				shadow.scale.set( sprite.scale.x, sprite.scale.y );
				shadow.rotation = sprite.rotation;
				shadow.alpha = sprite.alpha;
			};
			if ( shadow ) {
				ticker.add( syncShadow );
			}

			let torn = false;
			const tearDown = (): void => {
				if ( torn ) {
					return;
				}
				torn = true;
				ticker.remove( syncShadow );
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
				// A correction still queued would repaint a texture that
				// is about to be released, and hide a window that is about
				// to be handed back.
				cancelWait?.();
				cancelWait = null;

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

				// Hand over the moment the snapshot actually contains the
				// restored window, not a guessed number of frames later.
				// `afterNextSnapshot` carries its own backstop and calls
				// straight through when the stage is not running, so the
				// stand-in can never be stranded on screen.
				stage.afterNextSnapshot( tearDown );
			};

			// Take over the slot's placeholder teardown now that there is
			// something real to tear down.
			slot.cleanup = cleanup;

			try {
				const result = chosen.def.run( {
					pixi,
					transition,
					params: chosen.params,
					sprite,
					texture,
					layer,
					shadow,
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
			}
			return true;
		};

		// Nothing is deferred: the close gate reads this return value to
		// decide whether to hold the window open, so a capture that
		// failed has to report nothing rather than a duration nobody is
		// going to animate for.
		return start( entry ) ? durationMs : 0;
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
