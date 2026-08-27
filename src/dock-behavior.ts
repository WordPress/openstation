/**
 * Dynamic dock behavior — the auto-hide rail.
 *
 * OpenStation Preferences → Appearance → Desktop layout, persisted as
 * `dockBehavior` (the dock: the single rail in Unified, the bottom
 * dock in Split) and `sideDockBehavior` (the Split sidebar). Each
 * rail wears its answer as a `data-os-dock-behavior` attribute — an
 * attribute per rail rather than a body class, because the two rails
 * answer independently. PHP stamps the dock for the first paint; the
 * settings apply pass re-stamps both on every change; this module
 * re-stamps whenever the layout dispatcher rebuilds a rail, since
 * the Split sidebar is a fresh element every time.
 *
 * A `dynamic` rail that is not `os-dock--revealed` is PARKED:
 * `dock.css` collapses it into a thin indicator line hugging its
 * edge — the iOS home indicator, one line that says "there is a dock
 * here" — and it expands back into the full rail when the pointer
 * comes for it.
 *
 * This module owns the revealed / parked state. Nothing in CSS
 * decides it (no `:hover`), because the flip is animated through the
 * View Transitions API and a state that CSS flipped on its own would
 * jump. A rail is revealed while any of these hold:
 *
 * - the pointer is within {@link REVEAL_ZONE} px of the rail's edge
 *   of the viewport — the whole edge, not just the indicator's
 *   width, so "move the pointer to the bottom" means the bottom;
 * - the rail is out and the pointer is still near it: over the rail,
 *   or within {@link KEEP_OUT_FACTOR} rail-heights past it on the
 *   desktop side (twice the rail's height from the screen edge, all
 *   told), so the user can work right above the dock without folding
 *   it by accident and it only folds once they have clearly moved on;
 * - the pointer is over one of the rail's flyouts (the constellation,
 *   the peek cards), which are body-level and would otherwise retract
 *   the rail out from under the pointer;
 * - something on the rail has keyboard focus.
 *
 * The pointer leaving the window changes nothing: a dock that was out
 * stays out, a line stays a line, until the pointer is back and says
 * otherwise. Reaching for the browser's own chrome, or the OS dock
 * below the window, is not "moving on".
 *
 * **The morph.** Each flip runs inside `document.startViewTransition()`
 * when the browser has it: the rail gets a transient
 * `view-transition-name`, so the browser animates its box from the
 * line to the pill (and the pill's contents cross-fade in) on its
 * own; `dock.css` tunes the timing and opts the root out of the
 * snapshot so the rest of the desktop stays live. Without the API,
 * or under `prefers-reduced-motion`, the class just flips and the
 * stylesheet's plain transitions (or none) take it from there. One
 * transition at a time per rail: a flip requested mid-morph is
 * remembered and applied when the morph settles, so a pointer
 * skating along the edge never stacks animations.
 *
 * Nothing here costs anything while every rail is `static`: the
 * pointer handler skips a static rail on its first line.
 */

/** Pointer band at the rail's edge that summons it, in px. */
export const REVEAL_ZONE = 20;

/**
 * How far a revealed rail's "still near it" band reaches past the
 * rail onto the desktop, in rail heights (widths, for a side rail).
 * One rail deep, so the band spans twice the rail's height measured
 * from the screen edge: the pointer can cross the strip of desktop
 * just above the dock — where a window's bottom row of actions sits
 * — without folding it, and anything further up means moving on.
 */
export const KEEP_OUT_FACTOR = 1;

/** Air past a revealed rail's ends within which the pointer still counts as "on it". */
const RAIL_HOVER_MARGIN = 24;

/** Class a dynamic rail wears while expanded; absent = parked. */
export const REVEALED_CLASS = 'os-dock--revealed';

/** The per-rail attribute carrying `static` / `dynamic` (mirrors `src/work-area`). */
export const DOCK_BEHAVIOR_ATTR = 'data-os-dock-behavior';

/** The dock's element id (from the PHP shell template). */
export const PRIMARY_DOCK_ID = 'os-dock';

/** The Split layout's sidebar id (synthesised by `desktop-layout.ts`). */
export const SIDE_DOCK_ID = 'os-side-dock';

/** Root class worn for the duration of one of this module's view transitions. */
export const VIEW_TRANSITION_CLASS = 'os-dock-vt';

/** The rail's flyouts — body-level, so a pointer on them has "left" the rail. */
const FLYOUT_SELECTOR = '.os-constellation, .os-dock-peek';

type Edge = 'bottom' | 'left' | 'right';

/** One answer per rail. */
export interface DockBehaviors {
	dock: string;
	sidebar: string;
}

/** Wiring the installer needs from the shell boot path. */
export interface DockBehaviorDeps {
	/** `.os-shell__body` — the flex row every rail lives in. */
	shellBody: HTMLElement;
	/** The current picks, read whenever a rail needs stamping. */
	getBehaviors: () => DockBehaviors;
}

export interface DockBehaviorController {
	/** Re-evaluate every rail now (the settings apply pass calls this). */
	refresh(): void;
	destroy(): void;
}

interface ViewTransitionLike {
	finished?: Promise< void >;
}

type DocumentWithViewTransitions = Document & {
	startViewTransition?: ( cb: () => void ) => ViewTransitionLike;
};

/** Which viewport edge a rail hugs — from its placement, not its rect, so a parked rail still answers. */
function edgeOf( rail: HTMLElement ): Edge {
	const placement = rail.getAttribute( 'data-os-dock-placement' );
	if ( placement === 'left' || placement === 'right' ) {
		// Placement is logical (`order` / `inset-inline-*` in
		// dock.css); resolve to the visual side for the pointer test.
		const rtl = getComputedStyle( rail ).direction === 'rtl';
		return ( placement === 'left' ) !== rtl ? 'left' : 'right';
	}
	return 'bottom';
}

/** Is `rail` set to fold? */
export function isDynamicRail( rail: Element ): boolean {
	return rail.getAttribute( DOCK_BEHAVIOR_ATTR ) === 'dynamic';
}

/** Is the pointer within the reveal band of `edge`? */
export function pointerInZone(
	edge: Edge,
	clientX: number,
	clientY: number,
	viewportWidth: number,
	viewportHeight: number,
	zone: number = REVEAL_ZONE,
): boolean {
	switch ( edge ) {
		case 'bottom':
			return clientY >= viewportHeight - zone;
		case 'left':
			return clientX <= zone;
		case 'right':
			return clientX >= viewportWidth - zone;
	}
	return false;
}

/**
 * Is the pointer near a revealed `rail`: on its box, past its ends by
 * {@link RAIL_HOVER_MARGIN}, or onto the desktop by
 * {@link KEEP_OUT_FACTOR} rail extents?
 */
function pointerNearRail(
	rail: HTMLElement,
	edge: Edge,
	clientX: number,
	clientY: number,
): boolean {
	const r = rail.getBoundingClientRect();
	if ( r.width <= 0 || r.height <= 0 ) {
		return false;
	}
	let top = r.top - RAIL_HOVER_MARGIN;
	const bottom = r.bottom + RAIL_HOVER_MARGIN;
	let left = r.left - RAIL_HOVER_MARGIN;
	let right = r.right + RAIL_HOVER_MARGIN;
	switch ( edge ) {
		case 'bottom':
			top = r.top - r.height * KEEP_OUT_FACTOR;
			break;
		case 'left':
			right = r.right + r.width * KEEP_OUT_FACTOR;
			break;
		case 'right':
			left = r.left - r.width * KEEP_OUT_FACTOR;
			break;
	}
	return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

export function installDockBehavior( deps: DockBehaviorDeps ): DockBehaviorController {
	let destroyed = false;
	/** Last known pointer position; `null` once it left the window. */
	let pointer: { x: number; y: number } | null = null;
	/** Whether the last pointer event landed on one of the rail's flyouts. */
	let overFlyout = false;
	/** Per rail: a morph in flight, and the state requested during it. */
	const inFlight = new Map< HTMLElement, Promise< void > >();
	const pending = new Map< HTMLElement, boolean >();

	const rails = (): HTMLElement[] =>
		Array.from( deps.shellBody.querySelectorAll< HTMLElement >( '.os-dock' ) );

	/** Write a rail's pick onto it. The sidebar is a fresh element on every rebuild. */
	const stamp = ( rail: HTMLElement ): void => {
		const picks = deps.getBehaviors();
		const behavior = rail.id === SIDE_DOCK_ID ? picks.sidebar : picks.dock;
		if ( rail.getAttribute( DOCK_BEHAVIOR_ATTR ) !== behavior ) {
			rail.setAttribute( DOCK_BEHAVIOR_ATTR, behavior );
		}
	};

	/** The state a rail should be in, from everything the pointer and focus say. */
	const wanted = ( rail: HTMLElement ): boolean => {
		const active = rail.ownerDocument.activeElement;
		if ( active && rail.contains( active ) ) {
			return true;
		}
		if ( ! pointer ) {
			return false;
		}
		if ( overFlyout ) {
			return true;
		}
		const edge = edgeOf( rail );
		return (
			pointerInZone( edge, pointer.x, pointer.y, window.innerWidth, window.innerHeight ) ||
			( rail.classList.contains( REVEALED_CLASS ) &&
				pointerNearRail( rail, edge, pointer.x, pointer.y ) )
		);
	};

	/** Flip one rail, through a view transition where there is one. */
	const setRevealed = ( rail: HTMLElement, next: boolean ): void => {
		if ( rail.classList.contains( REVEALED_CLASS ) === next ) {
			pending.delete( rail );
			return;
		}
		if ( inFlight.has( rail ) ) {
			// Remembered, applied when the current morph settles.
			pending.set( rail, next );
			return;
		}
		const flip = (): void => {
			rail.classList.toggle( REVEALED_CLASS, next );
		};
		const doc = document as DocumentWithViewTransitions;
		if ( typeof doc.startViewTransition !== 'function' || prefersReducedMotion() ) {
			flip();
			return;
		}
		// A transient name, the way the dock peek does it: a permanent
		// one would enrol the rail in every other view transition on
		// the page. Derived from the element id so Split's two rails
		// never share one.
		const vtName = `os-dock-${ rail.id || 'rail' }`;
		rail.style.setProperty( 'view-transition-name', vtName );
		document.documentElement.classList.add( VIEW_TRANSITION_CLASS );
		let transition: ViewTransitionLike;
		try {
			transition = doc.startViewTransition( flip );
		} catch {
			// A transition that can't start (another one mid-capture,
			// a hidden document) must still land the state.
			rail.style.removeProperty( 'view-transition-name' );
			document.documentElement.classList.remove( VIEW_TRANSITION_CLASS );
			flip();
			return;
		}
		const finished =
			transition.finished && typeof transition.finished.then === 'function'
				? transition.finished
				: Promise.resolve();
		const settle = (): void => {
			rail.style.removeProperty( 'view-transition-name' );
			inFlight.delete( rail );
			if ( inFlight.size === 0 ) {
				document.documentElement.classList.remove( VIEW_TRANSITION_CLASS );
			}
			const later = pending.get( rail );
			pending.delete( rail );
			if ( ! destroyed && later !== undefined ) {
				setRevealed( rail, later );
			}
		};
		inFlight.set( rail, finished.then( settle, settle ) );
	};

	const evaluate = (): void => {
		if ( destroyed ) {
			return;
		}
		for ( const rail of rails() ) {
			stamp( rail );
			if ( ! isDynamicRail( rail ) ) {
				// Static rails never wear the class; a leftover from a
				// behavior flip is cleared without ceremony.
				rail.classList.remove( REVEALED_CLASS );
				continue;
			}
			setRevealed( rail, wanted( rail ) );
		}
	};

	const onPointer = ( e: PointerEvent ): void => {
		if ( destroyed || ! rails().some( isDynamicRail ) ) {
			return;
		}
		pointer = { x: e.clientX, y: e.clientY };
		const target = e.target;
		overFlyout =
			target instanceof Element && target.closest( FLYOUT_SELECTOR ) !== null;
		evaluate();
	};
	// Focus moves land before `activeElement` settles on the new
	// target; evaluate on the next frame so a Tab off the rail parks
	// it and a Tab onto it reveals it, in that order.
	let focusFrame = 0;
	const onFocusChange = (): void => {
		if ( focusFrame ) {
			return;
		}
		focusFrame = requestAnimationFrame( () => {
			focusFrame = 0;
			evaluate();
		} );
	};
	const onLayoutChanged = (): void => evaluate();

	document.addEventListener( 'pointermove', onPointer, { passive: true } );
	// A tap has no move before it: the indicator line is the target
	// on touch, and the down is what should summon the rail.
	document.addEventListener( 'pointerdown', onPointer, { passive: true } );
	// Deliberately no `pointerleave`: the pointer leaving the window
	// freezes whatever state the rails are in (see the module
	// docblock). The last in-window position stays on record for
	// the focus-driven re-evaluations.
	document.addEventListener( 'focusin', onFocusChange );
	document.addEventListener( 'focusout', onFocusChange );
	document.addEventListener( 'os-layout-changed', onLayoutChanged );

	let bodyObserver: MutationObserver | null = null;
	if ( typeof MutationObserver !== 'undefined' ) {
		bodyObserver = new MutationObserver( evaluate );
		bodyObserver.observe( deps.shellBody, { childList: true } );
	}
	evaluate();

	const controller: DockBehaviorController = {
		refresh: evaluate,
		destroy: () => {
			destroyed = true;
			if ( focusFrame ) {
				cancelAnimationFrame( focusFrame );
				focusFrame = 0;
			}
			bodyObserver?.disconnect();
			document.removeEventListener( 'pointermove', onPointer );
			document.removeEventListener( 'pointerdown', onPointer );
			document.removeEventListener( 'focusin', onFocusChange );
			document.removeEventListener( 'focusout', onFocusChange );
			document.removeEventListener( 'os-layout-changed', onLayoutChanged );
			for ( const rail of rails() ) {
				rail.classList.remove( REVEALED_CLASS );
				rail.style.removeProperty( 'view-transition-name' );
			}
			pending.clear();
			document.documentElement.classList.remove( VIEW_TRANSITION_CLASS );
			if ( installed === controller ) {
				installed = null;
			}
		},
	};
	installed = controller;
	return controller;
}

/** The live installer, for {@link refreshDockBehavior}. Main bundle only. */
let installed: DockBehaviorController | null = null;

/**
 * Re-evaluate every rail now, if installed. The settings apply pass
 * calls this after flipping the behavior so a rail that just went
 * static drops its revealed state; a no-op before boot.
 */
export function refreshDockBehavior(): void {
	installed?.refresh();
}
