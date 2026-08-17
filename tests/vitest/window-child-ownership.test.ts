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
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
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
