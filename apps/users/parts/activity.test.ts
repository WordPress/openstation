import { describe, expect, it, vi } from 'vitest';
import { render } from '../../../src/ui/core';
import { activityView } from './activity';
import type { ProfileConfig, UserListItem } from './types';
const cfg = { allRoles: { editor: 'Editor' } } as ProfileConfig;
const actions = { onSendReset: vi.fn(), onResendWelcome: vi.fn(), onSendEmail: vi.fn(), toast: vi.fn() };
describe( 'community activity view', () => {
	it( 'offers distinct empty states and no invented contribution totals', () => {
		const root = document.createElement( 'div' );
		render( activityView( [], actions, cfg, 'posts', vi.fn() ), root );
		expect( root.querySelectorAll( '.os-community__panel' ) ).toHaveLength( 4 );
		expect( root.querySelector( '.os-community__totals strong' )?.textContent ).toBe( '—' );
		expect( root.textContent ).toContain( 'No sign-ins recorded' );
		expect( root.textContent ).toContain( 'No registration dates available' );
		expect( root.textContent ).toContain( 'Nobody across this site' );
	} );
	it( 'includes approved-comment leaders and a local contribution switch', () => {
		const root = document.createElement( 'div' );
		const row = { id: 1, name: 'Peter', slug: 'peter', roles: [ 'editor' ], openstation_user_stats: { posts: 0, pages: 0, comments: 70 } } as UserListItem;
		const pick = vi.fn();
		render( activityView( [ row ], actions, cfg, 'comments', pick ), root );
		expect( root.querySelector( '.os-community__spotlight' )?.textContent ).toContain( 'Peter' );
		expect( root.querySelector( '.os-community__spotlight strong' )?.textContent ).toContain( '70' );
		expect( root.querySelector( '.os-community__totals p' )?.textContent ).toContain( '70 approved comments' );
		root.querySelector( 'os-segmented' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'pages' } } ) );
		expect( pick ).toHaveBeenCalledWith( 'pages' );
		root.querySelector( 'os-segmented' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'invalid' } } ) );
		expect( pick ).toHaveBeenCalledTimes( 1 );
	} );
} );
