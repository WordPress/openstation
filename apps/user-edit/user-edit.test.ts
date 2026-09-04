/**
 * User Edit app — the client view: `<os-user-profile>` on the state's
 * id, re-pointed in place when the id changes, fed the app's facts,
 * REST access and toast as properties.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import app from './user-edit.os';

interface State extends Record< string, unknown > {
	userId: number;
}

type ProfileEl = HTMLElement & { config?: unknown; fetch?: unknown; toast?: ( m: string, k?: string ) => void };

function mount( userId: number ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const toast = vi.fn();
	const ctx = mockViewContext< State, { userId: number } >( {
		state: { userId },
		data: { userId },
		root,
		extra: { currentUserId: 1, allRoles: { editor: 'Editor' } },
		host: { fetch: globalThis.fetch, toast },
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx, toast };
}

afterEach( () => {
	document.body.replaceChildren();
} );

describe( 'the user edit app view', () => {
	it( 'hosts <os-user-profile> on the state id, inside the window root, fed the app’s properties', () => {
		const { root, ctx, toast } = mount( 7 );
		const host = root.querySelector( '.os-user-edit-window[data-os-user-edit-window-root]' );
		expect( host ).not.toBeNull();
		const profile = host?.querySelector< ProfileEl >( 'os-user-profile[data-os-user-profile-host]' );
		expect( profile?.getAttribute( 'user-id' ) ).toBe( '7' );
		// The element itself ships in the companion bundle, not here.
		expect( profile?.config ).toEqual( ctx.extra );
		expect( profile?.fetch ).toBe( ctx.fetch );
		profile?.toast?.( 'Saved', 'success' );
		expect( toast ).toHaveBeenCalledWith( { message: 'Saved', duration: 5000 } );
		profile?.toast?.( 'Broke', 'error' );
		expect( toast ).toHaveBeenCalledWith( { message: 'Broke', duration: 8000 } );
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
