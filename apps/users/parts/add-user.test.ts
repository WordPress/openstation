/**
 * The Add User form — its template, and the sync that paints the
 * server's answer onto it only when the answer changed.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '../../../src/ui/core/html';
import { addUserForm, syncAddUserForm } from './add-user';
import type { UsersState } from './types';

const state = ( over: Partial< UsersState > = {} ): UsersState => ( {
	page: 1,
	perPage: 20,
	search: '',
	status: '',
	orderby: 'name',
	order: 'asc',
	tab: 'add-new',
	createError: '',
	createField: '',
	created: 0,
	...over,
} );

function fakeForm(): HTMLElement & Record< 'reset' | 'clearErrors' | 'setError' | 'setFieldInvalid', ReturnType< typeof vi.fn > > {
	const root = document.createElement( 'div' );
	const form = document.createElement( 'div' ) as unknown as HTMLElement & Record< string, unknown >;
	form.setAttribute( 'data-os-users-add-form', '' );
	form.reset = vi.fn();
	form.clearErrors = vi.fn();
	form.setError = vi.fn();
	form.setFieldInvalid = vi.fn();
	root.appendChild( form );
	document.body.appendChild( root );
	return form as never;
}

afterEach( () => {
	document.body.replaceChildren();
} );

describe( 'addUserForm', () => {
	test( 'submits to `create`, lists the assignable roles with the default picked, and the locales', () => {
		const host = document.createElement( 'div' );
		render(
			addUserForm(
				{
					defaultRole: 'subscriber',
					assignableRoles: { subscriber: 'Subscriber', editor: 'Editor' },
					locales: { '': 'Site default', en_US: 'en_US' },
				},
				() => undefined,
			),
			host,
		);
		const form = host.querySelector( 'os-form' );
		expect( form?.getAttribute( 'os-action' ) ).toBe( 'create' );
		expect( host.querySelector( 'os-select[name="role"]' )?.getAttribute( 'value' ) ).toBe( 'subscriber' );
		expect( host.querySelectorAll( 'os-select[name="role"] os-option' ).length ).toBe( 2 );
		expect( host.querySelectorAll( 'os-select[name="locale"] os-option' ).length ).toBe( 2 );
		expect( host.querySelector( '[name="send_notification"]' )?.hasAttribute( 'checked' ) ).toBe( true );
	} );
} );

describe( 'syncAddUserForm', () => {
	test( 'paints an error and its field once, and leaves the form alone while nothing changes', () => {
		const form = fakeForm();
		const root = form.parentElement as HTMLElement;
		let painted = { created: 0, error: '', field: '' };
		painted = syncAddUserForm( root, state( { createError: 'Taken', createField: 'email' } ), painted );
		expect( form.setError ).toHaveBeenCalledWith( 'Taken' );
		expect( form.setFieldInvalid ).toHaveBeenCalledWith( 'email' );
		expect( form.clearErrors ).toHaveBeenCalledTimes( 1 );

		// A selection repaint with the same answer: not touched again.
		painted = syncAddUserForm( root, state( { createError: 'Taken', createField: 'email' } ), painted );
		expect( form.setError ).toHaveBeenCalledTimes( 1 );
		expect( form.clearErrors ).toHaveBeenCalledTimes( 1 );

		// The error went away: cleared once.
		syncAddUserForm( root, state(), painted );
		expect( form.clearErrors ).toHaveBeenCalledTimes( 2 );
		expect( form.setError ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a successful create resets the form', () => {
		const form = fakeForm();
		const root = form.parentElement as HTMLElement;
		const painted = syncAddUserForm( root, state( { created: 1 } ), { created: 0, error: '', field: '' } );
		expect( form.reset ).toHaveBeenCalledTimes( 1 );
		expect( painted.created ).toBe( 1 );
		syncAddUserForm( root, state( { created: 1 } ), painted );
		expect( form.reset ).toHaveBeenCalledTimes( 1 );
	} );
} );
