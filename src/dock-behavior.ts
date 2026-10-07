export const REVEAL_ZONE = 20;

export const KEEP_OUT_FACTOR = 1;

const RAIL_HOVER_MARGIN = 24;

export const REVEALED_CLASS = 'os-dock--revealed';

export const DOCK_BEHAVIOR_ATTR = 'data-os-dock-behavior';

export const PRIMARY_DOCK_ID = 'os-dock';

export const SIDE_DOCK_ID = 'os-side-dock';

export const VIEW_TRANSITION_CLASS = 'os-dock-vt';

const FLYOUT_SELECTOR = '.os-constellation, .os-dock-peek';

type Edge = 'bottom' | 'left' | 'right';

export interface DockBehaviors {
	dock: string;
	sidebar: string;
}

export interface DockBehaviorDeps {

	shellBody: HTMLElement;

	getBehaviors: () => DockBehaviors;
}

export interface DockBehaviorController {

	refresh(): void;
	destroy(): void;
}

interface ViewTransitionLike {
	finished?: Promise< void >;
}

type DocumentWithViewTransitions = Document & {
	startViewTransition?: ( cb: () => void ) => ViewTransitionLike;
};

function edgeOf( rail: HTMLElement ): Edge {
	const placement = rail.getAttribute( 'data-os-dock-placement' );
	if ( placement === 'left' || placement === 'right' ) {
		const rtl = getComputedStyle( rail ).direction === 'rtl';
		return ( placement === 'left' ) !== rtl ? 'left' : 'right';
	}
	return 'bottom';
}

export function isDynamicRail( rail: Element ): boolean {
	return rail.getAttribute( DOCK_BEHAVIOR_ATTR ) === 'dynamic';
}

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

	let pointer: { x: number; y: number } | null = null;

	let overFlyout = false;

	const inFlight = new Map< HTMLElement, Promise< void > >();
	const pending = new Map< HTMLElement, boolean >();

	let buttonDown = false;
	let parkAfterRelease = false;

	const rails = (): HTMLElement[] =>
		Array.from( deps.shellBody.querySelectorAll< HTMLElement >( '.os-dock' ) );

	const stamp = ( rail: HTMLElement ): void => {
		const picks = deps.getBehaviors();
		const behavior = rail.id === SIDE_DOCK_ID ? picks.sidebar : picks.dock;
		if ( rail.getAttribute( DOCK_BEHAVIOR_ATTR ) !== behavior ) {
			rail.setAttribute( DOCK_BEHAVIOR_ATTR, behavior );
		}
	};

	const wanted = ( rail: HTMLElement ): boolean => {
		const active = rail.ownerDocument.activeElement;
		if ( active && rail.contains( active ) ) {
			return true;
		}
		if ( ! pointer ) {
			return false;
		}
		if ( overFlyout ) {
			return rail.classList.contains( REVEALED_CLASS );
		}
		const edge = edgeOf( rail );
		return (
			pointerInZone( edge, pointer.x, pointer.y, window.innerWidth, window.innerHeight ) ||
			( rail.classList.contains( REVEALED_CLASS ) &&
				pointerNearRail( rail, edge, pointer.x, pointer.y ) )
		);
	};

	const setRevealed = ( rail: HTMLElement, next: boolean ): void => {
		if ( rail.classList.contains( REVEALED_CLASS ) === next ) {
			pending.delete( rail );
			return;
		}
		if ( ! next && buttonDown ) {
			parkAfterRelease = true;
			return;
		}
		if ( inFlight.has( rail ) ) {
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

		const vtName = `os-dock-${ rail.id || 'rail' }`;
		rail.style.setProperty( 'view-transition-name', vtName );
		document.documentElement.classList.add( VIEW_TRANSITION_CLASS );
		let transition: ViewTransitionLike;
		try {
			transition = doc.startViewTransition( flip );
		} catch {
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

	const onButtonDown = (): void => {
		buttonDown = true;
	};
	const onButtonUp = (): void => {
		buttonDown = false;
		if ( parkAfterRelease ) {
			parkAfterRelease = false;
			evaluate();
		}
	};

	document.addEventListener( 'pointerdown', onButtonDown, { capture: true, passive: true } );
	document.addEventListener( 'pointerup', onButtonUp, { capture: true, passive: true } );
	document.addEventListener( 'pointercancel', onButtonUp, { capture: true, passive: true } );
	document.addEventListener( 'pointermove', onPointer, { passive: true } );

	document.addEventListener( 'pointerdown', onPointer, { passive: true } );

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
			document.removeEventListener( 'pointerdown', onButtonDown, { capture: true } );
			document.removeEventListener( 'pointerup', onButtonUp, { capture: true } );
			document.removeEventListener( 'pointercancel', onButtonUp, { capture: true } );
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

let installed: DockBehaviorController | null = null;

export function refreshDockBehavior(): void {
	installed?.refresh();
}
