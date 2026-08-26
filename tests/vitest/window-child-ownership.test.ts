/**
 * Child-window ownership.
 *
 * A child is a real window with one rule attached: **its owner can
 * never sit above it.** Clicking the owner hands focus to the child
 * instead of raising the owner. Everything else about the owner keeps
 * working — this is z-order and focus modality, not an inert parent.
 *
 * The tests below pin the rule itself, the paths that could quietly
 * bury a child under its owner (raise, restore-from-minimize), the
 * cascades (close, minimize, restore), and the two deliberate
 * escape hatches: a minimized child stops blocking, and children stay
 * out of session snapshots.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { NATIVE_GEOMETRY_STORAGE_KEY } from '../../src/window-manager/native-window-geometry';
import { HOOKS } from '../../src/hooks';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function cfg( id: string, extra: Record< string, unknown > = {} ) {
	return {
		id,
		url: `http://example.test/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
		...extra,
	};
}

function makeDesktop(): HTMLElement {
	const desktop = document.createElement( 'div' );
	desktop.id = 'os-area';
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
	return desktop;
}

/** Window ids in z-order, lowest first. */
function zOrder( manager: WindowManager ): string[] {
	return manager._stack.map( ( w ) => w.id );
}

describe( 'child windows — the owner cannot come to the front', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'focusing the owner focuses the child instead', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );
		expect( child.isFocused() ).toBe( true );

		manager.focus( owner );

		expect( child.isFocused() ).toBe( true );
		expect( owner.isFocused() ).toBe( false );
		// And the child is still the one in front.
		expect( zOrder( manager ).at( -1 ) ).toBe( 'child' );
	} );

	test( 'the owner still cannot be raised above the child', async () => {
		await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );

		manager.raise( 'owner' );

		const order = zOrder( manager );
		expect( order.indexOf( 'child' ) ).toBeGreaterThan(
			order.indexOf( 'owner' ),
		);
	} );

	test( 'an unrelated window can still be focused over both', async () => {
		await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );
		const other = await manager.open( cfg( 'other' ) );

		expect( other.isFocused() ).toBe( true );
		// Ownership constrains owner-vs-child, nothing else. The
		// stack pass must not drag unrelated windows around.
		const order = zOrder( manager );
		expect( order.indexOf( 'child' ) ).toBeGreaterThan(
			order.indexOf( 'owner' ),
		);
		expect( order.at( -1 ) ).toBe( 'other' );
	} );

	test( 'focus redirects to the DEEPEST descendant in a chain', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );
		const grandchild = await manager.openChild( 'child', cfg( 'grandchild' ) );

		manager.focus( owner );

		// Not the middle link — it is blocked in turn.
		expect( grandchild.isFocused() ).toBe( true );
		const order = zOrder( manager );
		expect( order ).toEqual( [ 'owner', 'child', 'grandchild' ] );
	} );

	test( 'a cycle in declared ownership does not hang the focus path', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b', { parentWindowId: 'a' } ) );
		// A plugin declaring both directions. Nonsense, but it must
		// not spin on the first click.
		a.config.parentWindowId = 'b';

		expect( () => manager.focus( a ) ).not.toThrow();
		expect( () => manager.focus( b ) ).not.toThrow();
	} );

	test( 'reports ownership both ways', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		expect( manager.ownerOf( child ) ).toBe( owner );
		expect( manager.ownerOf( owner ) ).toBeUndefined();
		expect( manager.childrenOf( 'owner' ).map( ( w ) => w.id ) ).toEqual( [
			'child',
		] );
		expect( manager.childrenOf( 'child' ) ).toEqual( [] );
	} );

	test( 'openChild refuses an owner that is not open', async () => {
		await expect(
			manager.openChild( 'nope', cfg( 'child' ) ),
		).rejects.toThrow( /no open window with id "nope"/ );
	} );

	test( 'openChild centers over the live owner rect, not its config', async () => {
		const owner = await manager.open(
			cfg( 'owner', { x: 100, y: 100, width: 800, height: 600 } ),
		);
		// The user drags/resizes it after opening — which is the case
		// that made reading `config` wrong.
		owner.element.style.left = '400px';
		owner.element.style.top = '200px';
		owner.element.style.width = '600px';
		owner.element.style.height = '400px';

		const child = await manager.openChild(
			'owner',
			cfg( 'child', { width: 300, height: 200 } ),
		);

		// jsdom reports offsetParent as null, so getSnapshot() parses
		// the inline styles — the same path a window on an inactive
		// desktop takes.
		expect( child.config.x ).toBe( 400 + ( 600 - 300 ) / 2 );
		expect( child.config.y ).toBe( 200 + ( 400 - 200 ) / 2 );
	} );

	test( 'openChild centers with NO explicit size — the documented call shape', async () => {
		const owner = await manager.open(
			cfg( 'owner', { x: 100, y: 100, width: 800, height: 600 } ),
		);
		owner.element.style.left = '300px';
		owner.element.style.top = '150px';
		owner.element.style.width = '600px';
		owner.element.style.height = '400px';

		// No width/height — exactly what docs/examples/child-windows.md
		// shows. This used to compute x/y for an assumed 80%-of-owner
		// size and then let `open()` pick a completely different size
		// from the desktop rect, so the child landed nowhere near
		// centered. Size and position have to be pinned together.
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		const width = Math.round( 600 * 0.8 );
		const height = Math.round( 400 * 0.8 );
		expect( child.config.width ).toBe( width );
		expect( child.config.height ).toBe( height );
		expect( child.config.x ).toBe( 300 + ( 600 - width ) / 2 );
		expect( child.config.y ).toBe( 150 + ( 400 - height ) / 2 );

		// The real invariant behind the arithmetic: concentric.
		expect( child.config.x + width / 2 ).toBe( 300 + 600 / 2 );
		expect( child.config.y + height / 2 ).toBe( 150 + 400 / 2 );
	} );

	test( 'a centered child stays inside the desktop when its owner hangs off an edge', async () => {
		const owner = await manager.open(
			cfg( 'owner', { width: 800, height: 600 } ),
		);
		// Dragged mostly off the right/bottom of the 1600x900 desktop.
		owner.element.style.left = '1500px';
		owner.element.style.top = '800px';
		owner.element.style.width = '800px';
		owner.element.style.height = '600px';

		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		expect( child.config.x ).toBeLessThanOrEqual(
			1600 - ( child.config.width ?? 0 ),
		);
		expect( child.config.y ).toBeLessThanOrEqual(
			900 - ( child.config.height ?? 0 ),
		);
		expect( child.config.x ).toBeGreaterThanOrEqual( 0 );
		expect( child.config.y ).toBeGreaterThanOrEqual( 0 );
	} );

	test( 'openChild honours an explicit position', async () => {
		await manager.open(
			cfg( 'owner', { x: 100, y: 100, width: 800, height: 600 } ),
		);

		const child = await manager.openChild(
			'owner',
			cfg( 'child', { x: 12, y: 34, width: 300, height: 200 } ),
		);

		expect( child.config.x ).toBe( 12 );
		expect( child.config.y ).toBe( 34 );
	} );

	test( "a child's remembered geometry wins over centering", async () => {
		// The user dragged this child aside and resized it last time.
		// Centering must not overrule that — a child is a real window
		// and gets the same geometry memory as any other.
		window.localStorage.setItem(
			NATIVE_GEOMETRY_STORAGE_KEY,
			JSON.stringify( {
				child: { x: 25, y: 45, width: 333, height: 222 },
			} ),
		);

		await manager.open(
			cfg( 'owner', { x: 100, y: 100, width: 800, height: 600 } ),
		);
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		expect( child.config.x ).toBe( 25 );
		expect( child.config.y ).toBe( 45 );
		expect( child.config.width ).toBe( 333 );
		expect( child.config.height ).toBe( 222 );

		window.localStorage.removeItem( NATIVE_GEOMETRY_STORAGE_KEY );
	} );
} );

describe( 'child windows — a cascade is one focus change', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	/**
	 * Count `os-window-focused` dispatches for one user action.
	 *
	 * The end state was always correct; what these guard is event
	 * churn. A plugin building an activity feed off WINDOW_FOCUSED /
	 * WINDOW_BLURRED saw a transition per cascaded window, none of
	 * which the user performed.
	 */
	function countFocusEvents( run: () => void ): number {
		const seen = vi.fn();
		document.addEventListener( 'os-window-focused', seen );
		try {
			run();
		} finally {
			document.removeEventListener( 'os-window-focused', seen );
		}
		return seen.mock.calls.length;
	}

	test( 'minimizing an owner with three children fires one focus change', async () => {
		const other = await manager.open( cfg( 'other' ) );
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'c1' ) );
		await manager.openChild( 'owner', cfg( 'c2' ) );
		await manager.openChild( 'owner', cfg( 'c3' ) );

		const focusEvents = countFocusEvents( () => owner.minimize() );

		expect( focusEvents ).toBe( 1 );
		// And it landed somewhere real.
		expect( other.isFocused() ).toBe( true );
	} );

	test( 'closing an owner with three children fires one focus change', async () => {
		const other = await manager.open( cfg( 'other' ) );
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'c1' ) );
		await manager.openChild( 'owner', cfg( 'c2' ) );
		await manager.openChild( 'owner', cfg( 'c3' ) );

		const focusEvents = countFocusEvents( () => owner.close() );

		expect( focusEvents ).toBe( 1 );
		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'other' ] );
		expect( other.isFocused() ).toBe( true );
	} );

	test( 'restoring an owner with three children fires one focus change', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'c1' ) );
		await manager.openChild( 'owner', cfg( 'c2' ) );
		const c3 = await manager.openChild( 'owner', cfg( 'c3' ) );
		owner.minimize();

		const focusEvents = countFocusEvents( () => owner.restore() );

		expect( focusEvents ).toBe( 1 );
		// The owner cannot hold focus while a child is open, so the one
		// focus change resolves to a restored child.
		expect( owner.isFocused() ).toBe( false );
		expect( c3.state ).not.toBe( 'minimized' );
		expect( manager.blockingChildOf( owner ) ).toBeDefined();
	} );

	test( 'the blur side is quiet too', async () => {
		await manager.open( cfg( 'other' ) );
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'c1' ) );
		await manager.openChild( 'owner', cfg( 'c2' ) );

		const blurs: string[] = [];
		const onBlur = ( e: Event ): void => {
			blurs.push( ( e as CustomEvent ).detail.windowId );
		};
		document.addEventListener( 'os-window-blurred', onBlur );
		owner.minimize();
		document.removeEventListener( 'os-window-blurred', onBlur );

		expect( blurs.length ).toBeLessThanOrEqual( 1 );
	} );

	test( 'a normal minimize still settles focus', async () => {
		const a = await manager.open( cfg( 'a' ) );
		const b = await manager.open( cfg( 'b' ) );

		// No ownership in play — the depth guard must not suppress the
		// ordinary path.
		const focusEvents = countFocusEvents( () => b.minimize() );

		expect( focusEvents ).toBe( 1 );
		expect( a.isFocused() ).toBe( true );
	} );

	test( 'the hook action fires alongside the event, once', async () => {
		await manager.open( cfg( 'other' ) );
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'c1' ) );
		await manager.openChild( 'owner', cfg( 'c2' ) );

		const seen = vi.fn();
		window.wp.hooks.addAction( HOOKS.WINDOW_FOCUSED, 'test/churn', seen );
		owner.minimize();
		window.wp.hooks.removeAction( HOOKS.WINDOW_FOCUSED, 'test/churn' );

		expect( seen ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'child windows — minimized children stop blocking', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'the owner is focusable again once the child is minimized', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		child.minimize();
		manager.focus( owner );

		// The user put the child away; the owner is theirs again.
		expect( owner.isFocused() ).toBe( true );
		expect( manager.blockingChildOf( owner ) ).toBeUndefined();
	} );

	test( 'a minimized child is never hoisted above its owner', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		child.minimize();
		manager.focus( owner );

		// The regression this guards: the ownership pass hoisting an
		// invisible window to the top of the stack, where
		// `setFocused( i === length - 1 )` hands focus to a window
		// nobody can see.
		expect( zOrder( manager ).at( -1 ) ).toBe( 'owner' );
		expect( child.isFocused() ).toBe( false );
	} );

	test( 'restoring the child restores the block', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		child.minimize();
		child.restore();
		manager.focus( owner );

		expect( child.isFocused() ).toBe( true );
		expect( owner.isFocused() ).toBe( false );
	} );
} );

describe( 'child windows — cascades', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'closing the owner closes its children', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );

		owner.close();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [] );
	} );

	test( 'closing the owner closes a whole chain', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );
		await manager.openChild( 'child', cfg( 'grandchild' ) );

		owner.close();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [] );
	} );

	test( 'closing a child leaves the owner alone and focusable again', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		child.close();

		expect( manager.getAll().map( ( w ) => w.id ) ).toEqual( [ 'owner' ] );
		manager.focus( owner );
		expect( owner.isFocused() ).toBe( true );
	} );

	test( 'minimizing the owner minimizes its children, restoring brings them back', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		owner.minimize();
		expect( child.state ).toBe( 'minimized' );

		owner.restore();
		expect( child.state ).not.toBe( 'minimized' );
	} );

	test( 'restoring the owner leaves a child the user had minimized alone', async () => {
		const owner = await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );

		// The user puts the child away FIRST, then minimizes the owner.
		child.minimize();
		owner.minimize();
		owner.restore();

		// Bringing it back would silently re-block the owner they just
		// returned to.
		expect( child.state ).toBe( 'minimized' );
	} );
} );

describe( 'child windows — session persistence', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const w of manager.getAll() ) {
			w.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'children are left out of the snapshot', async () => {
		await manager.open( cfg( 'owner' ) );
		await manager.openChild( 'owner', cfg( 'child' ) );

		const snap = manager.snapshot();

		// A restored child whose owner failed to come back would block
		// a window that does not exist.
		expect( snap.windows.map( ( w ) => w.id ) ).toEqual( [ 'owner' ] );
	} );

	test( 'a focused child does not become the persisted focus id', async () => {
		await manager.open( cfg( 'owner' ) );
		const child = await manager.openChild( 'owner', cfg( 'child' ) );
		expect( child.isFocused() ).toBe( true );

		// Pointing `focused` at a window that was never written would
		// restore as "focus nothing".
		expect( manager.snapshot().focused ).toBe( '' );
	} );
} );
