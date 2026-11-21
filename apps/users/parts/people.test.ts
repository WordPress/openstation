import { describe, expect, it, vi } from 'vitest';
import { render, html } from '../../../src/ui/core';
import { rolesView, recentSignIns, peopleCards } from './people';
import type { UserListItem, ProfileConfig } from './types';
const user = ( id: number, roles: string[], login: number | null = null ): UserListItem => ( { id, name: `Person ${ id }`, slug: `person${ id }`, roles, openstation_last_login: login, avatar_urls: {} } as UserListItem );
describe( 'people views', () => {
	it( 'renders complete role counts independently of the eight sampled faces', () => {
		const root = document.createElement( 'div' );
		render( rolesView( [ { role: 'editor', label: 'Editor', total: 120, members: Array.from( { length: 8 }, ( _, i ) => user( i, [ 'editor' ] ) ) } ], vi.fn() ), root );
		expect( root.querySelector( '.os-people__orbit-center strong' )?.textContent ).toBe( '120' );
		expect( root.querySelectorAll( 'os-avatar' ) ).toHaveLength( 8 );
		expect( root.textContent ).not.toContain( 'Load more' );
	} );
	it( 'shows only recorded sign-ins, newest first, without mutating input', () => {
		const rows = [ user( 1, [], 100 ), user( 2, [] ), user( 3, [], 200 ), user( 4, [], 0 ) ];
		expect( recentSignIns( rows ).map( ( p ) => p.id ) ).toEqual( [ 3, 1 ] );
		expect( rows.map( ( p ) => p.id ) ).toEqual( [ 1, 2, 3, 4 ] );
	} );
	it( 'keeps unknown counts explicit and hides account actions and selection from read-only viewers', () => {
		const root = document.createElement( 'div' );
		render( peopleCards( [ user( 1, [] ) ], { cfg: {} as ProfileConfig, actions: { onSendReset: vi.fn(), onResendWelcome: vi.fn(), onSendEmail: vi.fn(), toast: vi.fn() }, selected: [], select: vi.fn() }, html``, false ), root );
		expect( root.querySelector( 'os-stat' )?.getAttribute( 'value' ) ).toBe( '—' );
		expect( root.textContent ).toContain( 'No sign-in recorded' );
		expect( root.querySelector( 'os-checkbox' ) ).toBeNull();
		expect( root.querySelector( 'os-disclosure' ) ).toBeNull();
	} );
} );

describe( 'member ID cards', () => {
	it( 'shows real identity details and dispatches only permitted account actions', () => {
		const row = { ...user( 42, [ 'editor' ] ), name: 'Ada Dahl', email: 'ada@example.test', registered_date: '2025-01-10T00:00:00', openstation_can_edit: true };
		const actions = { onSendReset: vi.fn(), onResendWelcome: vi.fn(), onSendEmail: vi.fn(), toast: vi.fn() };
		const root = document.createElement( 'div' );
		const draw = ( canEdit: boolean ) => render( peopleCards( [ row ], { cfg: { canEdit } as ProfileConfig, actions, selected: [], select: vi.fn() }, html``, false ), root );
		draw( true );
		expect( root.textContent ).toContain( '#00042' );
		expect( root.textContent ).toContain( 'ada@example.test' );
		expect( root.querySelector( 'time' )?.getAttribute( 'datetime' ) ).toBe( row.registered_date );
		expect( root.querySelector( 'os-disclosure' ) ).toBeNull();
		expect( root.querySelectorAll( 'os-context-menu-option:not([heading])' ) ).toHaveLength( 4 );
		const pick = ( id: string ) => root.querySelector( 'os-action-menu' )!.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id }, bubbles: true } ) );
		pick( 'reset' ); pick( 'welcome' ); pick( 'email' );
		expect( actions.onSendReset ).toHaveBeenCalledWith( row );
		expect( actions.onResendWelcome ).toHaveBeenCalledWith( row );
		expect( actions.onSendEmail ).toHaveBeenCalledWith( row );
		draw( false );
		expect( root.querySelectorAll( 'os-context-menu-option' ) ).toHaveLength( 1 );
		pick( 'reset' ); pick( 'email' );
		expect( actions.onSendReset ).toHaveBeenCalledTimes( 1 );
		expect( actions.onSendEmail ).toHaveBeenCalledTimes( 1 );
		row.openstation_can_edit = false; draw( true );
		expect( root.querySelectorAll( 'os-context-menu-option' ) ).toHaveLength( 1 );
		pick( 'welcome' );
		expect( actions.onResendWelcome ).toHaveBeenCalledTimes( 1 );
	} );
} );
