/**
 * User Edit app — the client view: `<os-user-profile>` on the state's
 * id, re-pointed in place when the id changes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import app from './user-edit.os';

interface State extends Record< string, unknown > {
	userId: number;
}

function mount( userId: number ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< State, { userId: number } >( {
		state: { userId },
		data: { userId },
		root,
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx };
}

afterEach( () => {
	document.body.replaceChildren();
} );

describe( 'the user edit app view', () => {
	it( 'hosts <os-user-profile> on the state id, inside the legacy window root', () => {
		const { root } = mount( 7 );
		const host = root.querySelector( '.os-user-edit-window[data-os-user-edit-window-root]' );
		expect( host ).not.toBeNull();
		const profile = host?.querySelector( 'os-user-profile[data-os-user-profile-host]' );
		expect( profile?.getAttribute( 'user-id' ) ).toBe( '7' );
		expect( customElements.get( 'os-user-profile' ) ).toBeDefined();
	} );

	it( 'a retarget flips the attribute on the SAME element — the component re-mounts in place', () => {
		const { root, ctx } = mount( 7 );
		const before = root.querySelector( 'os-user-profile' );
		ctx.state.userId = 9;
		ctx.repaint();
		const after = root.querySelector( 'os-user-profile' );
		expect( after ).toBe( before );
		expect( after?.getAttribute( 'user-id' ) ).toBe( '9' );
	} );

	it( 'no id yet leaves the component idle (no user-id attribute)', () => {
		const { root } = mount( 0 );
		expect( root.querySelector( 'os-user-profile' )?.hasAttribute( 'user-id' ) ).toBe( false );
	} );
} );
