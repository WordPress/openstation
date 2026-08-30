/**
 * The two arrangements a workspace's `layout` adds: columns and focus.
 *
 * Both are geometry, so both are asserted as geometry. The rules worth
 * pinning are the ones that are wrong in a way nobody notices until
 * they are using it:
 *
 * - columns covers the full work-area height and hands off to `tile()`
 *   past four windows, where a column is narrower than an admin table;
 * - focus leads with the FOCUSED window, not the first in the stack,
 *   so re-applying after clicking into the reference list does not
 *   demote the thing the user just reached for;
 * - focus with one window is "maximize politely" — no margin reserved
 *   for a stack that does not exist.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const LAYOUT_HOOKS = [
	'os.arrange.columns.starting',
	'os.arrange.columns.applied',
	'os.arrange.focus.starting',
	'os.arrange.focus.applied',
	'os.arrange.tile.applied',
] as const;

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

/** Pixel value off an inline style, as a number. */
function px( el: HTMLElement, prop: 'left' | 'top' | 'width' | 'height' ): number {
	return parseInt( el.style[ prop ] || '0', 10 );
}

describe( 'Arrange — columns + focus', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'an empty desk fires nothing', () => {
		const log = recordActions( hooks, LAYOUT_HOOKS );
		manager.columns();
		manager.focusLayout();
		expect( log ).toHaveLength( 0 );
	} );

	test( 'columns gives every window the full height, side by side', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		const c = await manager.open( openConfig( 'c' ) );
		const log = recordActions( hooks, LAYOUT_HOOKS );

		manager.columns();

		// padding 16 both sides, gap 12 between three columns:
		// ( 1600 - 32 - 24 ) / 3 = 514.67 → 514.
		for ( const win of [ a, b, c ] ) {
			expect( px( win.element, 'width' ) ).toBe( 514 );
			expect( px( win.element, 'height' ) ).toBe( 900 - 32 );
			expect( px( win.element, 'top' ) ).toBe( 16 );
		}
		expect( px( a.element, 'left' ) ).toBe( 16 );
		expect( px( b.element, 'left' ) ).toBe( 16 + 514 + 12 );
		expect( px( c.element, 'left' ) ).toBe( 16 + ( 514 + 12 ) * 2 );

		expect(
			log.find( ( e ) => e.name === 'os.arrange.columns.applied' )?.args[ 0 ],
		).toMatchObject( { windowCount: 3, cols: 3 } );
	} );

	test( 'columns hands off to tile past four windows', async () => {
		for ( const id of [ 'a', 'b', 'c', 'd', 'e' ] ) {
			await manager.open( openConfig( id ) );
		}
		const log = recordActions( hooks, LAYOUT_HOOKS );

		manager.columns();

		// A fifth column would be narrower than an admin table's own
		// minimum; the honest answer is a grid.
		expect(
			log.some( ( e ) => e.name === 'os.arrange.columns.applied' ),
		).toBe( false );
		expect( log.some( ( e ) => e.name === 'os.arrange.tile.applied' ) ).toBe(
			true,
		);
	} );

	test( 'focus leads with the focused window and stacks the rest', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		const c = await manager.open( openConfig( 'c' ) );
		// Reach for the FIRST window — the arrangement has to honour
		// that rather than leading with the top of the stack.
		manager.focus( a );
		const log = recordActions( hooks, LAYOUT_HOOKS );

		manager.focusLayout();

		// area 1568 wide after padding; lead = floor( 1568 * 0.64 ).
		const leadWidth = Math.floor( 1568 * 0.64 );
		expect( px( a.element, 'width' ) ).toBe( leadWidth );
		expect( px( a.element, 'height' ) ).toBe( 868 );
		expect( px( a.element, 'left' ) ).toBe( 16 );

		const stackX = 16 + leadWidth + 12;
		const stackWidth = 1568 - leadWidth - 12;
		const stackHeight = Math.floor( ( 868 - 12 ) / 2 );
		expect( px( b.element, 'left' ) ).toBe( stackX );
		expect( px( b.element, 'width' ) ).toBe( stackWidth );
		expect( px( b.element, 'height' ) ).toBe( stackHeight );
		expect( px( c.element, 'top' ) ).toBe( 16 + stackHeight + 12 );

		expect(
			log.find( ( e ) => e.name === 'os.arrange.focus.applied' )?.args[ 0 ],
		).toMatchObject( { windowCount: 3, split: 0.64 } );
	} );

	test( 'focus with one window takes the whole work area', async () => {
		const a = await manager.open( openConfig( 'a' ) );

		manager.focusLayout();

		expect( px( a.element, 'width' ) ).toBe( 1568 );
		expect( px( a.element, 'height' ) ).toBe( 868 );
	} );

	test( 'the focus split is filterable, and nonsense falls back', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		await manager.open( openConfig( 'b' ) );
		// `a` has to be the lead for its width to be the split — the
		// second window is focused by virtue of having opened last.
		manager.focus( a );

		hooks.addFilter(
			'os.arrange.focus.split',
			'test/half',
			() => 0.5,
		);
		manager.focusLayout();
		expect( px( a.element, 'width' ) ).toBe( Math.floor( 1568 * 0.5 ) );

		// Outside the band: a lead that leaves no room for the stack is
		// not an arrangement, so the shipped value stands rather than
		// being clamped to something the plugin did not ask for either.
		hooks.removeFilter( 'os.arrange.focus.split', 'test/half' );
		hooks.addFilter( 'os.arrange.focus.split', 'test/absurd', () => 12 );
		manager.focusLayout();
		expect( px( a.element, 'width' ) ).toBe( Math.floor( 1568 * 0.64 ) );
	} );

	test( 'a minimized window rejoins the arrangement', async () => {
		const a = await manager.open( openConfig( 'a' ) );
		const b = await manager.open( openConfig( 'b' ) );
		b.minimize();

		manager.columns();

		expect( b.state ).not.toBe( 'minimized' );
		expect( px( a.element, 'width' ) ).toBe( px( b.element, 'width' ) );
	} );
} );
