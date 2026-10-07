import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/app-runtime/session';
import { createFocusGate } from '../../src/app-runtime/index';
import { defineApp, html } from '../../src/app-runtime/client';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';

interface State extends Record< string, unknown > {
	tab: string;
}
interface Data {
	label: string;
}

const APP = 'eager-demo';

const mountedSpy = vi.fn();
const app = defineApp< State, Data >( APP, {
	view: ( { state, data } ) => html`<p data-tab=${ state.tab }>${ data.label }</p>`,
	mounted: mountedSpy,
} );

function config( data?: unknown ): AppConfig {
	return {
		osApp: true,
		id: APP,
		title: 'Eager',
		endpoint: '/dispatch',
		state: { tab: 'home' },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [],
		client: true,
		...( data === undefined ? {} : { data } ),
	};
}

let root: HTMLElement;
let host: RuntimeHost;
let resolveMount: ( value: Response ) => void;

beforeEach( () => {
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	host = {
		fetch: vi.fn(
			() =>
				new Promise< Response >( ( resolve ) => {
					resolveMount = resolve;
				} ),
		),
	};
	mountedSpy.mockClear();
} );

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'paintEagerly', () => {
	it( 'paints from the declared state and the prefetched data before mount answers', () => {
		const session = createSession( { root, config: config( { label: 'prefetched' } ), windowId: APP, host, client: app } );
		void session.dispatch( 'mount' );
		expect( root.textContent ).toBe( '' );
		expect( session.paintEagerly() ).toBe( true );
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'prefetched' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-tab' ) ).toBe( 'home' );

		expect( mountedSpy ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'is a no-op without prefetched data, without a client view, and after a paint', () => {
		const plain = createSession( { root, config: config(), windowId: APP, host, client: app } );
		expect( plain.paintEagerly() ).toBe( false );
		expect( root.textContent ).toBe( '' );

		const eager = createSession( { root, config: config( { label: 'x' } ), windowId: APP, host, client: app } );
		expect( eager.paintEagerly() ).toBe( true );
		expect( eager.paintEagerly() ).toBe( false );
		expect( mountedSpy ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'the mount answer then refreshes state and data without a second mounted()', async () => {
		const session = createSession( { root, config: config( { label: 'prefetched' } ), windowId: APP, host, client: app } );
		const mount = session.dispatch( 'mount' );
		session.paintEagerly();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		resolveMount( {
			ok: true,
			status: 200,
			json: async () => ( { ok: true, state: { tab: 'fresh' }, html: '', data: { label: 'from mount' }, effects: [] } ),
		} as unknown as Response );
		await mount;
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'from mount' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-tab' ) ).toBe( 'fresh' );
		expect( mountedSpy ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'createFocusGate', () => {
	it( 'reports transitions, not requests', () => {
		const gate = createFocusGate();

		expect( gate.focus() ).toBe( false );
		expect( gate.focus() ).toBe( false );
		expect( gate.blur() ).toBe( true );
		expect( gate.blur() ).toBe( false );
		expect( gate.focus() ).toBe( true );
		expect( gate.focus() ).toBe( false );
	} );
} );

describe( 'component requests', () => {
	it( 'asks the shell for an undefined tag once per session, not once per paint', async () => {
		const loadComponents = vi.fn( async () => undefined );
		const demo = defineApp< State, Data >( 'warner-demo', {
			view: () => html`<os-not-a-component></os-not-a-component>`,
		} );
		const session = createSession( {
			root,
			config: { ...config( { label: '' } ), id: 'warner-demo' },
			windowId: 'warner-demo',
			host: { ...host, loadComponents },
			client: demo,
		} );
		session.paintEagerly();
		session.local( 'noop' );
		session.local( 'noop' );
		await Promise.resolve();
		expect( loadComponents ).toHaveBeenCalledTimes( 1 );
		expect( loadComponents ).toHaveBeenCalledWith( [ 'os-not-a-component' ] );
	} );

	it( 'never asks for a tag inside an os-preserve subtree', async () => {
		const loadComponents = vi.fn( async () => undefined );
		const demo = defineApp< State, Data >( 'preserve-demo', {
			view: () => html`<div os-preserve><os-deliberately-bogus></os-deliberately-bogus></div>`,
		} );
		const session = createSession( {
			root,
			config: { ...config( { label: '' } ), id: 'preserve-demo' },
			windowId: 'preserve-demo',
			host: { ...host, loadComponents },
			client: demo,
		} );
		session.paintEagerly();
		await Promise.resolve();
		expect( loadComponents ).not.toHaveBeenCalled();
	} );
} );
