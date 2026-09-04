/**
 * The instance hop's two halves, on either side of the page swap.
 *
 * Switching site is a navigation (`hop.ts`), and the cross-document
 * view transition the shell opts into can only crossfade the root: the
 * new page paints its bare desk long before its session restores and
 * overview opens, so the strip and the tiles would pop in after the
 * load. So each side animates on its own. The switcher slides this
 * desk OUT towards the site it picked (`os-shell--hop-out-next` /
 * `-prev` on the shell root, for the beat before it navigates) and
 * leaves the direction in `sessionStorage`; the shell it lands on was
 * stamped `os-shell--arriving` server-side (it was asked to boot into
 * overview), so its first paint is the wallpaper alone, and once
 * overview is up the desk slides IN from the same side. No hint (a
 * cross-origin site never sees this origin's storage) means a plain
 * fade. The wallpaper never moves, which is what makes it read as the
 * tiles changing rather than the page.
 *
 * A desk must never stay hidden: `stampArrival()` arms a reveal of its
 * own, and `assets/css/desktop.css` carries a keyframe fallback that
 * lets the desk back in even if this bundle never ran. Reduced motion
 * skips every slide and the wait before navigating.
 */

export type HopDirection = 'next' | 'prev';

/** How long the leaving desk gets before the navigation starts. */
export const HOP_OUT_MS = 220;
/** How long the arriving desk's slide lasts (matches the stylesheet). */
export const REVEAL_MS = 360;
/** If overview never asks for the reveal, the desk comes back anyway. */
const REVEAL_FALLBACK_MS = 4000;
/** One-shot, per tab, per origin: the side the next shell enters from. */
const DIRECTION_KEY = 'openstation-hop-direction';

const ARRIVING = 'os-shell--arriving';
const REVEALING = 'os-shell--revealing';

function shellRoot(): HTMLElement | null {
	return document.getElementById( 'os-shell' );
}

function reducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

/**
 * Slide this desk out towards the site being switched to, and resolve
 * when the navigation may start. Records the direction for the shell
 * that arrives.
 */
export function leaveInstance( direction: HopDirection ): Promise< void > {
	try {
		window.sessionStorage.setItem( DIRECTION_KEY, direction );
	} catch {
		// Storage refused (a private window, a quota): the next shell
		// fades in instead of sliding.
	}
	const root = shellRoot();
	if ( ! root || reducedMotion() ) {
		return Promise.resolve();
	}
	root.classList.add( `os-shell--hop-out-${ direction }` );
	return new Promise( ( resolve ) => {
		window.setTimeout( resolve, HOP_OUT_MS );
	} );
}

/** The direction the previous shell left, consumed on read. */
function takeArrivalDirection(): HopDirection | null {
	try {
		const value = window.sessionStorage.getItem( DIRECTION_KEY );
		window.sessionStorage.removeItem( DIRECTION_KEY );
		return value === 'next' || value === 'prev' ? value : null;
	} catch {
		return null;
	}
}

/**
 * At boot, on a shell that arrived hidden: stamp the side it should
 * slide in from, and arm the fallback reveal. A no-op on every other
 * shell.
 */
export function stampArrival(): void {
	const root = shellRoot();
	if ( ! root || ! root.classList.contains( ARRIVING ) ) {
		return;
	}
	const direction = takeArrivalDirection();
	if ( direction ) {
		root.classList.add( `os-shell--arriving-${ direction }` );
	}
	window.setTimeout( revealInstance, REVEAL_FALLBACK_MS );
}

/**
 * Let the desk in: overview is up, so the arriving state comes off and
 * the desk transitions to its resting place. Idempotent, and a no-op on
 * a shell that did not arrive hidden.
 */
export function revealInstance(): void {
	const root = shellRoot();
	if ( ! root || ! root.classList.contains( ARRIVING ) ) {
		return;
	}
	root.classList.remove(
		ARRIVING,
		'os-shell--arriving-next',
		'os-shell--arriving-prev',
	);
	if ( reducedMotion() ) {
		return;
	}
	// Same frame as the removal above, so the change from hidden to
	// shown is the transition this class declares.
	root.classList.add( REVEALING );
	window.setTimeout( () => root.classList.remove( REVEALING ), REVEAL_MS );
}
