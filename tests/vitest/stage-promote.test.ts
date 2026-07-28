/**
 * Tests for window promotion — the DOM half of the live-texture path.
 *
 * The HTML-in-Canvas API only draws direct children of the canvas, so
 * a window that wants its own live texture has to MOVE there with
 * `moveBefore()` (atomic, state-preserving). A `layoutsubtree` child
 * is laid out at the canvas origin — its inline `left`/`top` stop
 * meaning anything — so the promotion mirrors the window manager's
 * numbers into a `translate` every frame, self-calibrated against
 * where layout actually put the element.
 *
 * jsdom does not implement `moveBefore`, which is convenient: the
 * feature checks are exercised for real, and the capable-browser cases
 * install a minimal polyfill on exactly the nodes under test. Layout
 * is simulated by a rect stub that behaves like the origin-layout
 * model: the element sits wherever its transform translates it.
 */
import { describe, expect, test } from 'vitest';
import {
	canPromoteWindow,
	promoteWindow,
} from '../../src/stage/window-fx/promote';

/** `moveBefore` as the spec behaves for connected same-document moves. */
function installMoveBefore( el: HTMLElement ): void {
	(
		el as HTMLElement & {
			moveBefore?: ( node: Node, child: Node | null ) => void;
		}
	 ).moveBefore = function ( node: Node, child: Node | null ) {
		this.insertBefore( node, child );
	};
}

/** Wait for the promotion's rAF sync loop to run once. */
function nextFrame(): Promise< void > {
	return new Promise( ( resolve ) => {
		requestAnimationFrame( () => resolve() );
	} );
}

/**
 * A canvas + area + window fixture with predictable geometry.
 *
 * The area sits at (56, 32) — a left dock under an admin bar. The
 * window's rect stub models origin layout inside the canvas: the
 * element renders at exactly its own transform's translation.
 */
function fixture() {
	const canvas = document.createElement( 'canvas' );
	canvas.getBoundingClientRect = () =>
		( { left: 0, top: 32, width: 800, height: 568 } ) as DOMRect;
	const area = document.createElement( 'div' );
	area.getBoundingClientRect = () =>
		( { left: 56, top: 32, width: 744, height: 568 } ) as DOMRect;
	const win = document.createElement( 'div' );
	win.className = 'desktop-mode-window';
	win.getBoundingClientRect = () => {
		const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
			win.style.transform ?? '',
		);
		return {
			left: m ? parseFloat( m[ 1 ] ) : 0,
			top: m ? parseFloat( m[ 2 ] ) : 0,
			width: 300,
			height: 200,
		} as DOMRect;
	};
	area.append( win );
	document.body.append( canvas, area );
	installMoveBefore( canvas );
	installMoveBefore( area );
	return { canvas, area, win };
}

describe( 'canPromoteWindow', () => {
	test( 'declines without moveBefore support', () => {
		const canvas = document.createElement( 'canvas' );
		const area = document.createElement( 'div' );
		const win = document.createElement( 'div' );
		area.append( win );

		// jsdom ships no moveBefore — a plain appendChild move would
		// reload the window's iframe, which is the one thing promotion
		// must never do.
		expect( canPromoteWindow( win, canvas ) ).toBe( false );
	} );

	test( 'declines for a detached element', () => {
		const { canvas } = fixture();
		const win = document.createElement( 'div' );
		expect( canPromoteWindow( win, canvas ) ).toBe( false );
	} );

	test( 'declines for a fullscreen window', () => {
		// Fullscreen windows are position: fixed; the compensating
		// transform would both shift them and become the containing
		// block for their fixed descendants.
		const { canvas, win } = fixture();
		win.classList.add( 'desktop-mode-window--fullscreen' );
		expect( canPromoteWindow( win, canvas ) ).toBe( false );
	} );

	test( 'declines when the element carries an inline transform', () => {
		// The promotion OWNS the inline transform while it lasts; a
		// window mid desktop-switch or overview scale would fight it.
		const { canvas, win } = fixture();
		win.style.transform = 'scale(0.5)';
		expect( canPromoteWindow( win, canvas ) ).toBe( false );
	} );

	test( 'declines when already a canvas child', () => {
		const { canvas, win } = fixture();
		canvas.append( win );
		expect( canPromoteWindow( win, canvas ) ).toBe( false );
	} );

	test( 'accepts a movable nested window', () => {
		const { canvas, win } = fixture();
		expect( canPromoteWindow( win, canvas ) ).toBe( true );
	} );
} );

describe( 'promoteWindow', () => {
	test( 'moves the element under the canvas and mirrors its geometry', () => {
		const { canvas, win } = fixture();
		win.style.left = '300px';
		win.style.top = '100px';

		const promoted = promoteWindow( win, canvas );

		expect( promoted ).not.toBeNull();
		expect( win.parentElement ).toBe( canvas );
		// Laid out at the origin, the window must be translated to the
		// area origin (56, 32) plus its own left/top.
		expect( win.style.transform ).toBe( 'translate(356px, 132px)' );
		// Instant writes for the whole promotion — the base window CSS
		// transitions `transform` over 0.2s, and a mirror that lags its
		// own measurement oscillates.
		expect( win.style.transition ).toBe( 'none' );
	} );

	test( 'the mirror is stable once converged', async () => {
		const { canvas, win } = fixture();
		win.style.left = '300px';
		win.style.top = '100px';

		promoteWindow( win, canvas );
		const applied = win.style.transform;
		await nextFrame();
		await nextFrame();

		expect( win.style.transform ).toBe( applied );
	} );

	test( 'the mirror follows left/top writes made mid-drag', async () => {
		const { canvas, win } = fixture();
		win.style.left = '300px';
		win.style.top = '100px';

		const promoted = promoteWindow( win, canvas )!;

		// The window manager keeps writing left/top on every
		// pointermove; layout ignores them, the mirror must not.
		win.style.left = '420px';
		win.style.top = '160px';
		await nextFrame();

		expect( win.style.transform ).toBe( 'translate(476px, 192px)' );
		promoted.demote();
	} );

	test( 'demote restores parent, sibling order and inline styles', () => {
		const { canvas, area, win } = fixture();
		win.style.left = '300px';
		win.style.top = '100px';
		win.style.transition = 'opacity 0.2s ease';
		const after = document.createElement( 'div' );
		area.append( after );

		const promoted = promoteWindow( win, canvas )!;
		expect( win.parentElement ).toBe( canvas );

		promoted.demote();

		expect( promoted.demoted ).toBe( true );
		expect( win.parentElement ).toBe( area );
		expect( win.nextSibling ).toBe( after );
		expect( win.style.transform ).toBe( '' );
		expect( win.style.transition ).toBe( 'opacity 0.2s ease' );
	} );

	test( 'demote flushes the cleared transform before transitions return', () => {
		// If the clear and the transition restore land in the same
		// style recalc, the base window CSS (`transform 0.2s ease`)
		// animates the mirror's last translate away in the NEW
		// containing block — the window renders displaced by the whole
		// mirror offset and slides home: a phantom second reposition
		// right after the drop.
		const { canvas, win } = fixture();
		win.style.left = '300px';
		win.style.transition = 'opacity 0.2s ease';

		const writes: string[] = [];
		const style = win.style;
		for ( const prop of [ 'transform', 'transition' ] as const ) {
			const original = Object.getOwnPropertyDescriptor(
				CSSStyleDeclaration.prototype,
				prop,
			);
			Object.defineProperty( style, prop, {
				configurable: true,
				get: () => original?.get?.call( style ),
				set: ( value: string ) => {
					writes.push( `${ prop }=${ value }` );
					original?.set?.call( style, value );
				},
			} );
		}
		Object.defineProperty( win, 'offsetHeight', {
			configurable: true,
			get: () => {
				writes.push( 'reflow' );
				return 200;
			},
		} );

		const promoted = promoteWindow( win, canvas )!;
		writes.length = 0;
		promoted.demote();

		expect( writes ).toEqual( [
			'transform=',
			'reflow',
			'transition=opacity 0.2s ease',
		] );
	} );

	test( 'demote stops the mirror', async () => {
		const { canvas, win } = fixture();
		win.style.left = '300px';

		const promoted = promoteWindow( win, canvas )!;
		promoted.demote();

		win.style.left = '999px';
		await nextFrame();
		await nextFrame();

		// A demoted window's transform belongs to the window manager
		// again; a surviving loop would keep stamping translates on it.
		expect( win.style.transform ).toBe( '' );
	} );

	test( 'demote is idempotent', () => {
		const { canvas, area, win } = fixture();
		const promoted = promoteWindow( win, canvas )!;

		promoted.demote();
		promoted.demote();

		expect( win.parentElement ).toBe( area );
	} );

	test( 'demote appends at the end when the old sibling is gone', () => {
		const { canvas, area, win } = fixture();
		const after = document.createElement( 'div' );
		area.append( after );

		const promoted = promoteWindow( win, canvas )!;
		after.remove();
		promoted.demote();

		// Sibling order is not load-bearing for windows (stacking is
		// inline z-index); being back inside the area is.
		expect( win.parentElement ).toBe( area );
	} );

	test( 'returns null when moveBefore is missing, leaving the DOM alone', () => {
		const canvas = document.createElement( 'canvas' );
		const area = document.createElement( 'div' );
		const win = document.createElement( 'div' );
		area.append( win );
		document.body.append( canvas, area );

		expect( promoteWindow( win, canvas ) ).toBeNull();
		expect( win.parentElement ).toBe( area );
		expect( win.style.transform ).toBe( '' );
	} );
} );
