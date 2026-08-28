/**
 * Tests for `src/work-area/` — the one rectangle every placing
 * surface reads.
 *
 * Pins the rules the module exists for:
 *
 * - chrome that floats OVER the desktop area (the bottom dock pill)
 *   claims the band it covers plus the gap; chrome BESIDE the area
 *   (a side rail that is a flex sibling) claims nothing;
 * - a rail claims the edge it is nearest to, so a one-tile pill
 *   (taller than wide) is still "bottom";
 * - the snapshot reaches CSS (`--os-work-area-*` on the shell), JS
 *   (`getWorkArea`, `workAreaRectOf`, `workAreaInsetsOf`) and the
 *   event bus (`os.work-area.changed` + `os-work-area-changed`), and
 *   a re-measure that lands on the same numbers notifies nobody.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	computeInsets,
	edgeFor,
	elementInsets,
	rectFromInsets,
	rectLike,
	WORK_AREA_GAP,
} from '../../src/work-area/compute';
import {
	_resetWorkAreaForTests,
	getWorkArea,
	installWorkArea,
	measureWorkArea,
	subscribeWorkArea,
	WORK_AREA_CHANGED_EVENT,
	workAreaInsetsOf,
	workAreaRectOf,
} from '../../src/work-area';
import { HOOKS } from '../../src/hooks';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

/** A 1600×900 desktop area sitting below a 32px admin bar. */
const AREA = rectLike( 0, 32, 1600, 900 );

/** The bottom pill: 64px tall, floating 12px above the area's floor. */
function bottomPill( width = 600, height = 64 ): ReturnType< typeof rectLike > {
	const left = ( AREA.width - width ) / 2;
	return rectLike( left, AREA.bottom - 12 - height, width, height );
}

describe( 'computeInsets', () => {
	test( 'a floating bottom pill claims its band plus the gap', () => {
		const pill = bottomPill();
		const insets = computeInsets( AREA, [ pill ] );
		expect( insets ).toEqual( {
			top: 0,
			right: 0,
			bottom: 12 + 64 + WORK_AREA_GAP,
			left: 0,
		} );
	} );

	test( 'a side rail beside the area (no overlap) claims nothing', () => {
		// The left dock is a flex sibling: the area starts where the
		// rail ends.
		const rail = rectLike( -56, AREA.top, 56, AREA.height );
		expect( computeInsets( AREA, [ rail ] ) ).toEqual( {
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		} );
	} );

	test( 'a one-tile pill, taller than wide, is still the bottom edge', () => {
		// 24px wide, 60px tall — the orientation heuristic alone would
		// call this a vertical rail and hand half the desktop to the
		// right inset.
		const tiny = bottomPill( 24, 60 );
		expect( edgeFor( AREA, tiny ) ).toBe( 'bottom' );
		const insets = computeInsets( AREA, [ tiny ] );
		expect( insets.right ).toBe( 0 );
		expect( insets.left ).toBe( 0 );
		expect( insets.bottom ).toBe( 12 + 60 + WORK_AREA_GAP );
	} );

	test( 'a rail overlapping the left band claims left', () => {
		const rail = rectLike( 0, AREA.top, 56, AREA.height );
		expect( edgeFor( AREA, rail ) ).toBe( 'left' );
		expect( computeInsets( AREA, [ rail ] ).left ).toBe( 56 + WORK_AREA_GAP );
	} );

	test( 'a rail overlapping the right band claims right', () => {
		const rail = rectLike( AREA.right - 56, AREA.top, 56, AREA.height );
		expect( edgeFor( AREA, rail ) ).toBe( 'right' );
		expect( computeInsets( AREA, [ rail ] ).right ).toBe( 56 + WORK_AREA_GAP );
	} );

	test( 'a strip along the top claims top', () => {
		const strip = rectLike( 0, AREA.top, AREA.width, 34 );
		expect( computeInsets( AREA, [ strip ] ).top ).toBe( 34 + WORK_AREA_GAP );
	} );

	test( 'collapsed (zero-size) chrome claims nothing', () => {
		// The overview animates every dock to width 0.
		const collapsed = rectLike( 800, AREA.bottom - 76, 0, 64 );
		expect( computeInsets( AREA, [ collapsed ] ).bottom ).toBe( 0 );
	} );

	test( 'several rails: the deepest claim per edge wins', () => {
		const insets = computeInsets( AREA, [ bottomPill( 600, 64 ), bottomPill( 300, 80 ) ] );
		expect( insets.bottom ).toBe( 12 + 80 + WORK_AREA_GAP );
	} );

	test( 'insets round up and are capped at half the area', () => {
		const fractional = rectLike( 500, AREA.bottom - 75.4, 600, 63.4 );
		expect( computeInsets( AREA, [ fractional ] ).bottom ).toBe(
			Math.ceil( 75.4 + WORK_AREA_GAP ),
		);
		const monster = rectLike( 0, AREA.top + 10, AREA.width, AREA.height - 10 );
		expect( computeInsets( AREA, [ monster ] ).bottom ).toBe( 450 );
	} );

	test( 'a zero-size area yields zero insets', () => {
		expect( computeInsets( rectLike( 0, 0, 0, 0 ), [ bottomPill() ] ) ).toEqual( {
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		} );
	} );
} );

describe( 'rectFromInsets / elementInsets', () => {
	test( 'rectFromInsets subtracts each edge and never goes negative', () => {
		expect(
			rectFromInsets( 1600, 900, { top: 0, right: 0, bottom: 84, left: 0 } ),
		).toEqual( { x: 0, y: 0, width: 1600, height: 816 } );
		expect(
			rectFromInsets( 100, 100, { top: 60, right: 60, bottom: 60, left: 60 } ),
		).toEqual( { x: 60, y: 60, width: 0, height: 0 } );
	} );

	test( 'elementInsets reports the overhang per edge, clamped to the element', () => {
		const work = rectLike( 0, 32, 1600, 816 );
		// A maximized window body that runs 84px under the dock.
		const host = rectLike( 0, 32 + 40, 1600, 860 );
		expect( elementInsets( work, host ) ).toEqual( {
			top: 0,
			right: 0,
			bottom: 84,
			left: 0,
		} );
		// Fully inside: nothing.
		expect( elementInsets( work, rectLike( 100, 100, 400, 300 ) ) ).toEqual( {
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		} );
		// Entirely below the work area: the whole height, not more.
		expect( elementInsets( work, rectLike( 0, 900, 100, 50 ) ).bottom ).toBe( 50 );
	} );
} );

/** A DOMRect-shaped object jsdom can't produce from layout. */
function fakeRect( left: number, top: number, width: number, height: number ): DOMRect {
	return {
		...rectLike( left, top, width, height ),
		x: left,
		y: top,
		toJSON: () => ( {} ),
	} as DOMRect;
}

function stubRect( el: HTMLElement, rect: () => DOMRect ): void {
	el.getBoundingClientRect = rect;
}

describe( 'installWorkArea', () => {
	let shell: HTMLElement;
	let body: HTMLElement;
	let area: HTMLElement;
	let dock: HTMLElement;
	let pillRect: DOMRect;

	beforeEach( () => {
		installHooksStub();
		_resetWorkAreaForTests();
		shell = document.createElement( 'div' );
		shell.id = 'os-shell';
		body = document.createElement( 'div' );
		body.className = 'os-shell__body';
		area = document.createElement( 'div' );
		area.id = 'os-area';
		dock = document.createElement( 'div' );
		dock.id = 'os-dock';
		dock.className = 'os-dock';
		body.append( area, dock );
		shell.append( body );
		document.body.append( shell );
		stubRect( area, () => fakeRect( 0, 32, 1600, 900 ) );
		pillRect = fakeRect( 500, 32 + 900 - 12 - 64, 600, 64 );
		stubRect( dock, () => pillRect );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
		_resetWorkAreaForTests();
	} );

	test( 'measureWorkArea reads the pill into a bottom inset and both coordinate spaces', () => {
		const s = measureWorkArea( { shell, shellBody: body, area } );
		expect( s.insets ).toEqual( { top: 0, right: 0, bottom: 84, left: 0 } );
		expect( s.area ).toEqual( { width: 1600, height: 900 } );
		expect( s.rect ).toEqual( { x: 0, y: 0, width: 1600, height: 816 } );
		expect( s.viewport ).toEqual( { x: 0, y: 32, width: 1600, height: 816 } );
	} );

	test( 'install writes the CSS custom properties on the shell', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-bottom' ) ).toBe( '84px' );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-top' ) ).toBe( '0px' );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-left' ) ).toBe( '0px' );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-right' ) ).toBe( '0px' );
		expect( shell.style.getPropertyValue( '--os-work-area-width' ) ).toBe( '1600px' );
		expect( shell.style.getPropertyValue( '--os-work-area-height' ) ).toBe( '816px' );
		ctl.destroy();
	} );

	test( 'getWorkArea / workAreaRectOf / workAreaInsetsOf read the snapshot', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( getWorkArea().rect ).toEqual( { x: 0, y: 0, width: 1600, height: 816 } );
		// A copy: mutating it changes nothing.
		getWorkArea().insets.bottom = 999;
		expect( getWorkArea().insets.bottom ).toBe( 84 );

		// jsdom has no layout, so clientWidth is 0 and the bounding
		// rect is the fallback — the same rect the snapshot used.
		expect( workAreaRectOf( area ) ).toEqual( { x: 0, y: 0, width: 1600, height: 816 } );
		expect( workAreaRectOf() ).toEqual( { x: 0, y: 0, width: 1600, height: 816 } );

		// A window body reaching the area's floor hangs 84px outside.
		const host = document.createElement( 'div' );
		stubRect( host, () => fakeRect( 0, 72, 1600, 860 ) );
		expect( workAreaInsetsOf( host ) ).toEqual( { top: 0, right: 0, bottom: 84, left: 0 } );
		ctl.destroy();
	} );

	test( 'before install everything is zero and workAreaInsetsOf claims nothing', () => {
		expect( getWorkArea().rect ).toEqual( { x: 0, y: 0, width: 0, height: 0 } );
		const host = document.createElement( 'div' );
		stubRect( host, () => fakeRect( 0, 0, 100, 100 ) );
		expect( workAreaInsetsOf( host ) ).toEqual( { top: 0, right: 0, bottom: 0, left: 0 } );
		// No installed area: the rect is derived from the element alone.
		expect( workAreaRectOf( area ) ).toEqual( { x: 0, y: 0, width: 1600, height: 900 } );
	} );

	test( 'notifies once per change through the store, the hook and the CustomEvent', () => {
		const onEvent = vi.fn();
		document.addEventListener( WORK_AREA_CHANGED_EVENT, onEvent );
		const onHook = vi.fn();
		window.wp!.hooks!.addAction( HOOKS.WORK_AREA_CHANGED, 'test', onHook );
		const onStore = vi.fn();
		const off = subscribeWorkArea( onStore );

		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( onEvent ).toHaveBeenCalledTimes( 1 );
		expect( onHook ).toHaveBeenCalledTimes( 1 );
		expect( onStore ).toHaveBeenCalledTimes( 1 );
		expect( ( onEvent.mock.calls[ 0 ][ 0 ] as CustomEvent ).detail.insets.bottom ).toBe( 84 );

		// Same numbers → nobody hears about it.
		ctl.refresh();
		expect( onEvent ).toHaveBeenCalledTimes( 1 );
		expect( onStore ).toHaveBeenCalledTimes( 1 );

		// The dock grows (Large size) → one more notification.
		pillRect = fakeRect( 500, 32 + 900 - 12 - 80, 600, 80 );
		ctl.refresh();
		expect( onEvent ).toHaveBeenCalledTimes( 2 );
		expect( onStore ).toHaveBeenCalledTimes( 2 );
		expect( getWorkArea().insets.bottom ).toBe( 100 );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-bottom' ) ).toBe( '100px' );

		off();
		pillRect = fakeRect( 500, 32 + 900 - 12 - 64, 600, 64 );
		ctl.refresh();
		expect( onStore ).toHaveBeenCalledTimes( 2 );
		expect( onEvent ).toHaveBeenCalledTimes( 3 );

		document.removeEventListener( WORK_AREA_CHANGED_EVENT, onEvent );
		ctl.destroy();
	} );

	test( 'the dock moving to a side edge releases the bottom band', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		// Flex sibling on the left: the area now starts at x=56 and
		// the rail overlaps nothing.
		stubRect( area, () => fakeRect( 56, 32, 1544, 900 ) );
		stubRect( dock, () => fakeRect( 0, 32, 56, 900 ) );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		expect( getWorkArea().insets ).toEqual( { top: 0, right: 0, bottom: 0, left: 0 } );
		expect( getWorkArea().rect ).toEqual( { x: 0, y: 0, width: 1544, height: 900 } );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-bottom' ) ).toBe( '0px' );
		ctl.destroy();
	} );

	test( 'a hidden rail and a rail added later are both handled', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		dock.hidden = true;
		ctl.refresh();
		expect( getWorkArea().insets.bottom ).toBe( 0 );
		dock.hidden = false;

		// The split layout synthesises a sidebar — here one that floats
		// over the top band, to prove a second rail is measured.
		const strip = document.createElement( 'div' );
		strip.className = 'os-dock';
		stubRect( strip, () => fakeRect( 0, 32, 1600, 34 ) );
		body.prepend( strip );
		ctl.refresh();
		expect( getWorkArea().insets ).toEqual( { top: 42, right: 0, bottom: 84, left: 0 } );
		expect( getWorkArea().rect ).toEqual( { x: 0, y: 42, width: 1600, height: 774 } );
		ctl.destroy();
	} );

	test( 'the snapshot freezes across the overview cycle', () => {
		const onStore = vi.fn();
		const off = subscribeWorkArea( onStore );
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		expect( onStore ).toHaveBeenCalledTimes( 1 );

		// Exposé collapses the pill to width 0 over 280ms; measured
		// live that would walk the inset to 0 and back. Frozen from
		// ENTERING, every rail tick is ignored...
		window.wp!.hooks!.doAction( HOOKS.OVERVIEW_ENTERING, {} );
		pillRect = fakeRect( 800, 32 + 900 - 12 - 40, 0, 40 );
		ctl.refresh();
		window.dispatchEvent( new Event( 'resize' ) );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		expect( onStore ).toHaveBeenCalledTimes( 1 );

		// ...and one measure runs once the rails have landed. Same
		// numbers → same snapshot, nobody woken; a rail that grew
		// during the overview is picked up here.
		pillRect = fakeRect( 500, 32 + 900 - 12 - 64, 600, 64 );
		window.wp!.hooks!.doAction( HOOKS.OVERVIEW_EXITED, {} );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		expect( onStore ).toHaveBeenCalledTimes( 1 );
		pillRect = fakeRect( 500, 32 + 900 - 12 - 80, 600, 80 );
		window.wp!.hooks!.doAction( HOOKS.OVERVIEW_ENTERING, {} );
		window.wp!.hooks!.doAction( HOOKS.OVERVIEW_EXITED, {} );
		expect( getWorkArea().insets.bottom ).toBe( 100 );
		expect( onStore ).toHaveBeenCalledTimes( 2 );
		off();
		ctl.destroy();
	} );

	test( 'a dynamic rail claims nothing', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		// The settings apply pass stamps the rail and asks for a
		// re-measure; the folded rail is transient chrome.
		dock.setAttribute( 'data-os-dock-behavior', 'dynamic' );
		ctl.refresh();
		expect( getWorkArea().insets ).toEqual( { top: 0, right: 0, bottom: 0, left: 0 } );
		expect( shell.style.getPropertyValue( '--os-work-area-inset-bottom' ) ).toBe( '0px' );
		dock.setAttribute( 'data-os-dock-behavior', 'static' );
		ctl.refresh();
		expect( getWorkArea().insets.bottom ).toBe( 84 );
		ctl.destroy();
	} );

	test( 'destroy stops listening', () => {
		const ctl = installWorkArea( { shell, shellBody: body, area } );
		ctl.destroy();
		pillRect = fakeRect( 500, 32 + 900 - 12 - 80, 600, 80 );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( getWorkArea().insets.bottom ).toBe( 84 );
	} );
} );
