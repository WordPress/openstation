/**
 * Dynamic dock behavior — the auto-hide rail.
 *
 * OpenStation Preferences → Appearance → Desktop layout → Dock behavior, persisted as
 * `dockBehavior` and emitted as an `os-dock-<behavior>` body class
 * (PHP on first paint, the settings apply pass on every change).
 * Under `os-dock-dynamic`, `dock.css` parks every rail off its edge
 * leaving a peek strip; this module is the half CSS can't do:
 *
 * - **The parked inset.** The rail is parked by inset, not by
 *   transform — its tooltip is `position: fixed`, and a transformed
 *   ancestor would become the tooltip's containing block. An inset
 *   needs the rail's own size, so a ResizeObserver per rail writes
 *   `--os-dock-extent` (height for the bottom pill, width for a side
 *   rail) and the stylesheet subtracts it.
 * - **The reveal zone.** The admin bar reveals from a pseudo-element
 *   hanging off the bar, which is as wide as the bar. The dock pill
 *   is `fit-content` wide and centred, and "move the pointer to the
 *   bottom of the screen" has to mean the whole bottom, so the zone
 *   is a pointer test against the edge the rail hugs: within
 *   {@link REVEAL_ZONE} px of it, the rail wears `os-dock--revealed`.
 *   Hovering the rail itself, or one of its flyouts, or focusing
 *   something on it, keeps it out through CSS alone.
 *
 * Nothing here runs while the behavior is `static`: the pointer
 * listener returns on the first line, and the observers only write a
 * custom property the static stylesheet never reads.
 */

/** Pointer band at the rail's edge that summons it, in px. */
export const REVEAL_ZONE = 20;

/** Class the module toggles on a rail while the pointer is in its zone. */
export const REVEALED_CLASS = 'os-dock--revealed';

/** Body class for the dynamic behavior (mirrors `src/work-area`). */
const DYNAMIC_CLASS = 'os-dock-dynamic';

type Edge = 'bottom' | 'left' | 'right';

/** Wiring the installer needs from the shell boot path. */
export interface DockBehaviorDeps {
	/** `.os-shell__body` — the flex row every rail lives in. */
	shellBody: HTMLElement;
}

export interface DockBehaviorController {
	destroy(): void;
}

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

export function installDockBehavior( deps: DockBehaviorDeps ): DockBehaviorController {
	const observers = new Map< HTMLElement, ResizeObserver >();
	let destroyed = false;

	const rails = (): HTMLElement[] =>
		Array.from( deps.shellBody.querySelectorAll< HTMLElement >( '.os-dock' ) );

	const writeExtent = ( rail: HTMLElement ): void => {
		const extent =
			edgeOf( rail ) === 'bottom' ? rail.offsetHeight : rail.offsetWidth;
		if ( extent > 0 ) {
			rail.style.setProperty( '--os-dock-extent', `${ extent }px` );
		}
	};

	const observeRails = (): void => {
		const live = new Set( rails() );
		for ( const [ el, ro ] of observers ) {
			if ( ! live.has( el ) ) {
				ro.disconnect();
				observers.delete( el );
				el.classList.remove( REVEALED_CLASS );
			}
		}
		for ( const el of live ) {
			writeExtent( el );
			if ( observers.has( el ) || typeof ResizeObserver === 'undefined' ) {
				continue;
			}
			const ro = new ResizeObserver( () => writeExtent( el ) );
			ro.observe( el );
			observers.set( el, ro );
		}
	};

	const onPointer = ( e: PointerEvent ): void => {
		if ( destroyed || ! document.body.classList.contains( DYNAMIC_CLASS ) ) {
			return;
		}
		for ( const rail of rails() ) {
			const near = pointerInZone(
				edgeOf( rail ),
				e.clientX,
				e.clientY,
				window.innerWidth,
				window.innerHeight,
			);
			rail.classList.toggle( REVEALED_CLASS, near );
		}
	};
	const onLeave = (): void => {
		for ( const rail of rails() ) {
			rail.classList.remove( REVEALED_CLASS );
		}
	};
	const onLayoutChanged = (): void => observeRails();

	document.addEventListener( 'pointermove', onPointer, { passive: true } );
	// A tap has no move before it: the peek strip is the target on
	// touch, and the down is what should summon the rail.
	document.addEventListener( 'pointerdown', onPointer, { passive: true } );
	document.documentElement.addEventListener( 'pointerleave', onLeave );
	document.addEventListener( 'os-layout-changed', onLayoutChanged );

	let bodyObserver: MutationObserver | null = null;
	if ( typeof MutationObserver !== 'undefined' ) {
		bodyObserver = new MutationObserver( observeRails );
		bodyObserver.observe( deps.shellBody, { childList: true } );
	}
	observeRails();

	return {
		destroy: () => {
			destroyed = true;
			for ( const ro of observers.values() ) {
				ro.disconnect();
			}
			observers.clear();
			bodyObserver?.disconnect();
			document.removeEventListener( 'pointermove', onPointer );
			document.removeEventListener( 'pointerdown', onPointer );
			document.documentElement.removeEventListener( 'pointerleave', onLeave );
			document.removeEventListener( 'os-layout-changed', onLayoutChanged );
			onLeave();
		},
	};
}
