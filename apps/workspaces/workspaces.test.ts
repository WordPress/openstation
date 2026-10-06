/**
 * The Workspaces app's one piece of client logic: telling a shared
 * workspace that changed since it was published from one that merely
 * came back from the server shaped differently.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import app, { profileFingerprint } from './workspaces.os';
import type { WorkspaceProfile } from '../../src/workspaces/types';
import type { Desktop } from '../../src/types';
import type { WorkspacesApi } from '../../src/workspaces/api';
import { mockViewContext } from '../../src/app-runtime/testing';
import { clearHooksStub, installHooksStub, type FakeWpHooks } from '../../tests/vitest/helpers/hooks-stub';
import '../../src/ui/components/os-disclosure/os-disclosure';
import '../../src/ui/components/os-swatch/os-swatch';
import '../../src/ui/components/os-swatch-grid/os-swatch-grid';
import '../../src/ui/components/os-badge/os-badge';

const asWritten: WorkspaceProfile = {
	preset: '',
	icon: 'dashicons-cart',
	color: '',
	apps: { mode: 'only', ids: [ 'edit-php' ] },
	appearance: { wallpaper: 'mono', wallpaperSettings: {} },
	windows: [ { match: 'edit-php', url: 'edit.php', place: { x: 0.123456, y: 0, width: 0.5, height: 0.5 } } ],
	layout: 'free',
	provisioned: true,
};

describe( 'profileFingerprint', () => {
	test( 'the server round trip does not read as a change', () => {
		// What PHP hands back: `{}` as `[]`, widgets filled in as `all`,
		// positions rounded to four places, provisioned reset.
		const asRead = {
			...asWritten,
			appearance: { wallpaper: 'mono', wallpaperSettings: [] as unknown as Record< string, unknown > },
			widgets: { mode: 'all' as const, ids: [] },
			windows: [ { match: 'edit-php', url: 'edit.php', place: { x: 0.1235, y: 0, width: 0.5, height: 0.5 } } ],
			restricted: false,
			provisioned: false,
		};
		expect( profileFingerprint( asRead ) ).toBe( profileFingerprint( asWritten ) );
	} );

	test( 'a real edit does', () => {
		expect( profileFingerprint( { ...asWritten, restricted: true } ) ).not.toBe(
			profileFingerprint( asWritten ),
		);
		expect( profileFingerprint( { ...asWritten, windows: [] } ) ).not.toBe(
			profileFingerprint( asWritten ),
		);
	} );
} );

describe( 'Workspaces management', () => {
	let root: HTMLElement;
	let hooks: FakeWpHooks;
	let desks: Desktop[];
	let active: string;
	let shell: Partial< WorkspacesApi >;
	let dispose: ( () => void ) | void;

	function paint( canShare = true ) {
		const ctx = mockViewContext( {
			state: { focus: '', mio: false },
			data: { canShare, shares: [] as Array< {
				id: number; label: string; desktop: string; url: string; version: number;
				disabled: boolean; mine: boolean; authorName: string; hash: string;
				claimants: Array< { user: number; name: string; email: string; pinned: boolean; at: number } >;
			} > },
			root,
			host: { fetch: globalThis.fetch, toast: vi.fn() },
		} );
		ctx.repaint = () => app.render( ctx as never );
		ctx.repaint();
		return ctx;
	}

	const flush = async () => {
		await Promise.resolve();
		await Promise.resolve();
	};

	const button = ( text: string ): HTMLElement => Array.from( root.querySelectorAll< HTMLElement >( 'os-button' ) )
		.find( ( el ) => el.textContent?.trim() === text )!;

	beforeEach( () => {
		hooks = installHooksStub();
		root = document.createElement( 'div' );
		document.body.append( root );
		desks = [ { id: 'main', label: 'Main desk' }, { id: 'writing', label: 'Writing', profile: structuredClone( asWritten ) } ];
		active = 'main';
		shell = {
			list: () => desks,
			active: () => desks.find( ( desk ) => desk.id === active ) ?? null,
			apps: () => [ { id: 'edit-php', title: 'Posts', icon: 'dashicons-admin-post', pages: [], dock: true } ],
			switchTo: vi.fn( ( id: string ) => {
				active = id;
				hooks.doAction( 'os.os.switched' );
			} ),
			rename: vi.fn( ( id: string, label: string ) => {
				desks.find( ( desk ) => desk.id === id )!.label = label;
				hooks.doAction( 'os.os.renamed' );
				return true;
			} ),
			setProfile: vi.fn( ( id: string, profile: WorkspaceProfile | null ) => {
				desks.find( ( desk ) => desk.id === id )!.profile = profile ?? undefined;
				hooks.doAction( 'os.workspaces.updated' );
				return true;
			} ),
			saveAs: vi.fn( () => {
				const desk = { id: 'new', label: 'Workspace 3', profile: structuredClone( asWritten ) };
				desks.push( desk );
				hooks.doAction( 'os.os.created' );
				return desk;
			} ),
		};
		( window.wp as unknown as { os: unknown } ).os = { workspaces: shell };
	} );

	afterEach( () => {
		dispose?.();
		dispose = undefined;
		root.remove();
		clearHooksStub();
	} );

	test( 'shows saved windows and switches desks with a live current-desk indicator', async () => {
		const ctx = paint();
		dispose = app.mounted( ctx as never );
		expect( root.querySelector( '.os-workspaces__summary' )?.textContent ).toContain( '1 saved window' );
		expect( root.querySelector( '.os-workspaces__chip' )?.textContent ).toBe( 'Posts' );
		button( 'Go to desk' ).click();
		await flush();
		expect( active ).toBe( 'writing' );
		expect( button( 'On this desk' ).hasAttribute( 'disabled' ) ).toBe( true );
		expect( root.querySelector( '.os-workspaces__card-head os-badge' )?.textContent ).toBe( 'Current desk' );
	} );

	test( 'customization stays expanded after a profile edit and a repaint', async () => {
		const ctx = paint();
		dispose = app.mounted( ctx as never );
		await flush();
		const section = root.querySelector< HTMLElement >( 'os-disclosure[heading="Customize"]' )!;
		expect( section.shadowRoot?.querySelector( '[part="body"]' )?.hasAttribute( 'hidden' ) ).toBe( true );
		section.shadowRoot?.querySelector< HTMLButtonElement >( 'button' )?.click();
		root.querySelector( 'os-swatch[label="Green"]' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '#00a32a' } } ) );
		await flush();
		expect( desks[ 1 ].profile?.color ).toBe( '#00a32a' );
		expect( section.hasAttribute( 'open' ) ).toBe( true );
		expect( section.shadowRoot?.querySelector( '[part="body"]' )?.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'rejects a blank rename and keeps the previous name visible', async () => {
		const ctx = paint();
		const name = root.querySelector< HTMLElement >( 'os-text-field[label="Workspace name"]' )!;
		name.setAttribute( 'value', '  ' );
		name.dispatchEvent( new CustomEvent( 'os-input-commit', { detail: { value: '  ' } } ) );
		await flush();
		expect( name.shadowRoot?.querySelector< HTMLInputElement >( 'input' )?.value ).toBe( 'Writing' );
		expect( shell.rename ).not.toHaveBeenCalled();
		expect( ctx.host.toast ).toHaveBeenCalledWith( expect.objectContaining( { type: 'warning' } ) );
	} );

	test( 'commits a trimmed name on Enter or leaving the field, without duplicate renames', () => {
		paint();
		const name = root.querySelector< HTMLElement >( 'os-text-field[label="Workspace name"]' )!;
		name.dispatchEvent( new CustomEvent( 'os-submit', { detail: { value: '  Editorial desk  ' } } ) );
		name.dispatchEvent( new FocusEvent( 'focusout' ) );
		expect( desks[ 1 ].label ).toBe( 'Editorial desk' );
		expect( shell.rename ).toHaveBeenCalledTimes( 1 );
		name.setAttribute( 'value', 'Reviews' );
		name.dispatchEvent( new FocusEvent( 'focusout' ) );
		expect( desks[ 1 ].label ).toBe( 'Reviews' );
	} );

	test( 'saving another desk selects its name without colliding with the existing field', async () => {
		const ctx = paint();
		dispose = app.mounted( ctx as never );
		button( 'Save as new workspace' ).click();
		await flush();
		expect( shell.saveAs ).toHaveBeenCalledWith( 'main' );
		const fields = Array.from( root.querySelectorAll< HTMLElement >( 'os-text-field[label="Workspace name"]' ) );
		expect( new Set( fields.map( ( el ) => el.id ) ).size ).toBe( 2 );
		const input = fields[ 1 ].shadowRoot!.querySelector< HTMLInputElement >( 'input' )!;
		expect( root.ownerDocument.activeElement ).toBe( fields[ 1 ] );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( 'Workspace 3'.length );
	} );

	test( 'prevents duplicate share submissions and permits a retry after failure', async () => {
		const ctx = paint();
		let finish!: ( ok: boolean ) => void;
		ctx.dispatch = vi.fn( () => new Promise< boolean >( ( resolve ) => {
			finish = resolve;
		} ) );
		button( 'Create link' ).click();
		const pending = button( 'Creating link…' );
		expect( pending.hasAttribute( 'disabled' ) ).toBe( true );
		// Even a programmatic host click cannot submit twice.
		pending.click();
		expect( ctx.dispatch ).toHaveBeenCalledTimes( 1 );
		finish( false );
		await flush();
		expect( button( 'Create link' ).hasAttribute( 'disabled' ) ).toBe( false );
		button( 'Create link' ).click();
		expect( ctx.dispatch ).toHaveBeenCalledTimes( 2 );
		finish( false );
		await flush();
	} );

	test( 'keeps unpublished changes visible with sharing collapsed and counts only pinned recipients', () => {
		const ctx = paint();
		ctx.data.shares = [ {
			id: 1, desktop: 'writing', label: 'Writing', url: 'https://example.org/share', version: 1,
			disabled: true, mine: true, authorName: 'Admin', hash: 'old',
			claimants: [
				{ user: 2, name: 'Editor', email: '', pinned: true, at: 1 },
				{ user: 3, name: 'Released', email: '', pinned: false, at: 1 },
			],
		} ];
		ctx.repaint();
		const sharing = root.querySelector( 'os-disclosure[heading="Sharing"]' )!;
		expect( sharing.hasAttribute( 'open' ) ).toBe( false );
		expect( sharing.getAttribute( 'hint' ) ).toBe( 'Link off · 1 person using it' );
		expect( root.querySelector( '.os-workspaces__changed' )?.textContent ).toContain( 'Unpublished changes' );
		expect( sharing.contains( button( 'Publish changes' ) ) ).toBe( false );
	} );

	test( 'does not offer sharing to someone without share access', () => {
		paint( false );
		expect( root.querySelector( 'os-disclosure[heading="Sharing"]' ) ).toBeNull();
	} );
} );
