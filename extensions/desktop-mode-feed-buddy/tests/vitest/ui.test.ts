import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	mountReader,
	mountWidget,
	renderTranscript,
	renderWidget,
} from '../../src/index';
import { getStore } from '../../src/state';
import type {
	DesktopApi,
	FeedBuddyClientState,
	FeedBuddyServerState,
	FeedItemsPage,
	NativeRenderContext,
	SharedStore,
	WidgetContext,
} from '../../src/types';

const serverState: FeedBuddyServerState = {
	subscriptions: [
		{
			id: 'news',
			url: 'https://example.com/news.xml',
			title: 'Example News',
			group: 'NEWS',
			order: 0,
			addedAt: '2026-07-28T12:00:00Z',
		},
	],
	summaries: [
		{
			id: 'news',
			status: 'online',
			unread: 2,
			lastFetchedAt: '2026-07-28T12:00:00Z',
			error: null,
		},
	],
	groups: [ 'NEWS' ],
	preferences: { soundEnabled: false },
};

const itemsPage: FeedItemsPage = {
	items: [
		{
			id: 'item-1',
			feedId: 'news',
			feedTitle: 'Example News',
			title: '<b>Readable headline</b>',
			url: 'https://example.com/article',
			author: 'Reporter',
			publishedAt: '2026-07-28T12:00:00Z',
			excerpt: '<script>bad()</script> Plain text',
			unread: true,
		},
	],
	nextCursor: null,
};

let sharedStore: SharedStore< FeedBuddyClientState > | null = null;
const subscribers = new Set<
	( state: Readonly< FeedBuddyClientState > ) => void
>();
const send = vi.fn();
const openWindow = vi.fn( () => true );
const applyWindowTheme = vi.fn();
const requests: Array< {
	url: string;
	method?: string;
	body?: string;
	signal?: AbortSignal | null;
} > = [];

function jsonResponse( value: unknown ): Response {
	return new Response( JSON.stringify( value ), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	} );
}

function createStore< T >( initial: () => T ): SharedStore< T > {
	const state = initial();
	return {
		state,
		getState: () => state,
		notify: () => {
			for ( const subscriber of subscribers ) {
				subscriber( state as FeedBuddyClientState );
			}
		},
		subscribe: ( callback ) => {
			subscribers.add(
				callback as ( state: Readonly< FeedBuddyClientState > ) => void,
			);
			return () => {
				subscribers.delete(
					callback as ( state: Readonly< FeedBuddyClientState > ) => void,
				);
			};
		},
	};
}

function clientState(
	overrides: Partial< FeedBuddyClientState > = {},
): FeedBuddyClientState {
	return {
		server: serverState,
		selectedFeedId: null,
		items: [],
		itemsForFeedId: null,
		itemsLoading: false,
		stateLoading: false,
		error: null,
		managerOpen: false,
		newFeedIds: [],
		presenceMode: 'online',
		retroMode: false,
		...overrides,
	};
}

function postedSubscriptions(): typeof requests {
	return requests.filter(
		( request ) =>
			'POST' === request.method && request.url.endsWith( '/subscriptions' ),
	);
}

/**
 * Mount the reader with the manager pane open and the add-feed form
 * pre-filled, mirroring the markup `feed_buddy_render_reader_template()`
 * emits.
 */
async function mountManager( url: string ): Promise< {
	container: HTMLElement;
	teardown: () => void;
} > {
	const store = getStore();
	Object.assign( store.state, clientState( { managerOpen: true } ) );
	store.notify();
	requests.length = 0;

	const container = document.createElement( 'div' );
	container.innerHTML = `
		<div data-feed-buddy-reader>
			<wpd-select data-feed-buddy-feed-select></wpd-select>
			<div data-feed-buddy-empty hidden>
				<h2 data-feed-buddy-empty-title></h2>
				<p data-feed-buddy-empty-copy></p>
				<wpd-button data-feed-buddy-add-first></wpd-button>
			</div>
			<ol data-feed-buddy-items></ol>
			<div data-feed-buddy-loading hidden></div>
			<aside data-feed-buddy-manager hidden>
				<form data-feed-buddy-add-form>
					<wpd-text-field name="url"${ url ? ` value="${ url }"` : '' }></wpd-text-field>
					<wpd-text-field name="group" value="NEWS"></wpd-text-field>
					<wpd-button type="submit" data-feed-buddy-add-submit>Add buddy</wpd-button>
				</form>
				<div data-feed-buddy-manager-list></div>
			</aside>
			<div data-feed-buddy-status></div>
		</div>
	`;

	const context: NativeRenderContext = {
		signal: new AbortController().signal,
		onResize: () => () => undefined,
		onHide: () => () => undefined,
		onShow: () => () => undefined,
		markLoading: vi.fn(),
		markReady: vi.fn(),
		window: {
			send: () => undefined,
			on: () => () => undefined,
		},
	};

	const teardown = await mountReader( container, context );
	return { container, teardown };
}

beforeAll( () => {
	const api: DesktopApi = {
		ready: ( callback ) => callback(),
		getWindowConfig: () => ( {
			restBase: 'https://example.com/wp-json/feed-buddy/v1/',
			restNonce: 'nonce',
			pollMs: 300000,
		} ),
		createSharedStore: < T, >( _key: string, initial: () => T ) => {
			sharedStore = createStore( initial as () => FeedBuddyClientState );
			return sharedStore as unknown as SharedStore< T >;
		},
		fetch: async ( input, init ) => {
			const url = String( input );
			requests.push( {
				url,
				method: init?.method,
				body: typeof init?.body === 'string' ? init.body : undefined,
				signal: init?.signal,
			} );
			return jsonResponse( url.includes( '/items?' ) ? itemsPage : serverState );
		},
		openWindow,
		applyWindowTheme,
		confirm: async () => true,
		windowManager: {
			getById: () => ( { send } ),
		},
	};
	window.wp = {
		desktop: api,
		i18n: {
			__: ( text ) => text,
			sprintf: ( format, ...values ) =>
				format.replace( /%[sd]/g, () => String( values.shift() ?? '' ) ),
		},
	};
} );

afterAll( () => {
	delete window.wp;
} );

describe( 'SOL Inbound Monologue UI', () => {
	it( 'renders a compact, non-color-only buddy roster', () => {
		const root = document.createElement( 'div' );
		renderWidget( root, clientState( { newFeedIds: [ 'news' ] } ) );

		expect( root.textContent ).toContain( 'SOL Inbound Monologue' );
		expect( root.textContent ).toContain( 'Feeds online: 1' );
		expect( root.textContent ).toContain( 'NEWS' );
		expect( root.textContent ).toContain( 'Example News' );
		expect( root.querySelector( '.feed-buddy-widget__menubar' ) )
			.not.toBeNull();
		expect( root.querySelector( '.feed-buddy-widget__identity' ) )
			.not.toBeNull();
		expect( root.querySelector( '.feed-buddy-widget__group' )
			?.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		expect( root.querySelector( '.feed-buddy-widget__badge' )?.textContent )
			.toBe( '2' );
		expect(
			root.querySelector(
				'.feed-buddy-widget__feed .screen-reader-text',
			)?.textContent,
		).toBe( 'Online' );
		expect( root.querySelector( '[data-feed-buddy-action="mark-all"]' ) )
			.not.toBeNull();
		const status = root.querySelector( '[data-feed-buddy-status]' );
		expect( status?.getAttribute( 'aria-live' ) ).toBe( 'polite' );
		expect( status?.textContent ).toBe( 'You’ve got… eventually.' );

		const offlineState = clientState( {
			server: {
				...serverState,
				summaries: [
					{ ...serverState.summaries[ 0 ], status: 'error' },
				],
			},
		} );
		renderWidget( root, offlineState );
		expect(
			root.querySelector( '.feed-buddy-widget__feed' )
				?.classList.contains( 'feed-buddy-widget__feed--offline' ),
		).toBe( true );
		expect(
			root.querySelector( '.feed-buddy-widget__feed .screen-reader-text' )
				?.textContent,
		).toBe( 'Offline' );
	} );

	it( 'renders feed content as text and safe external links', () => {
		const root = document.createElement( 'div' );
		root.innerHTML = `
			<div data-feed-buddy-empty>
				<h2 data-feed-buddy-empty-title></h2>
				<p data-feed-buddy-empty-copy></p>
				<wpd-button data-feed-buddy-add-first></wpd-button>
			</div>
			<ol data-feed-buddy-items></ol>
			<div data-feed-buddy-loading></div>
		`;
		renderTranscript( root, clientState( { items: itemsPage.items } ) );

		expect( root.querySelector( 'script' ) ).toBeNull();
		expect( root.querySelector( '.feed-buddy-message__bubble' ) ).toBeNull();
		expect( root.querySelector( '.feed-buddy-message__body' ) ).not.toBeNull();
		expect( root.querySelector( '.feed-buddy-message__title' )?.textContent )
			.toBe( '<b>Readable headline</b>' );
		expect( root.querySelector( '.feed-buddy-message__excerpt' )?.textContent )
			.toBe( '<script>bad()</script> Plain text' );
		const link = root.querySelector< HTMLAnchorElement >( 'a' );
		expect( link?.textContent ).toBe( 'Open article' );
		expect( link?.target ).toBe( '_blank' );
		expect( link?.rel ).toBe( 'noopener noreferrer' );
	} );

	it( 'distinguishes an empty subscribed feed from first-run setup', () => {
		const root = document.createElement( 'div' );
		root.innerHTML = `
			<div data-feed-buddy-empty>
				<h2 data-feed-buddy-empty-title></h2>
				<p data-feed-buddy-empty-copy></p>
				<wpd-button data-feed-buddy-add-first></wpd-button>
			</div>
			<ol data-feed-buddy-items></ol>
			<div data-feed-buddy-loading></div>
		`;
		renderTranscript( root, clientState() );

		expect( root.querySelector( '[data-feed-buddy-empty-title]' )?.textContent )
			.toBe( 'No recent messages' );
		expect(
			( root.querySelector( '[data-feed-buddy-add-first]' ) as HTMLElement ).hidden,
		).toBe( true );
	} );

	it( 'opens the reader on buddy selection and aborts work on unmount', async () => {
		const container = document.createElement( 'div' );
		const context: WidgetContext = {
			id: 'feed-buddy/buddy-list',
			pluginUrl: 'https://example.com/plugin',
			storage: {
				get: () => null,
				set: () => undefined,
				remove: () => undefined,
				clear: () => undefined,
			},
		};
		const teardown = mountWidget( container, context );
		await vi.waitFor( () => {
			expect( container.textContent ).toContain( 'Example News' );
		} );
		const widget = container.querySelector< HTMLElement >( '.feed-buddy-widget' )!;
		for ( const key of [ 's', 'o', 'l' ] ) {
			widget.dispatchEvent( new KeyboardEvent( 'keydown', { key, bubbles: true } ) );
		}
		expect(
			container.querySelector( '.feed-buddy-widget__frame' )
				?.hasAttribute( 'data-retro-egg' ),
		).toBe( true );
		expect( container.textContent ).toContain( 'Screen name: SOL_Online :-)' );
		container.querySelector< HTMLElement >(
			'[data-feed-buddy-action="toggle-away"]',
		)?.click();
		expect(
			container.querySelector( '.feed-buddy-widget__frame' )
				?.getAttribute( 'data-feed-buddy-presence' ),
		).toBe( 'away' );
		expect( container.textContent ).toContain( 'idle — 2 unread' );

		const group = container.querySelector< HTMLElement >(
			'[data-feed-buddy-action="toggle-group"]',
		);
		const feed = container.querySelector< HTMLElement >(
			'[data-feed-id="news"]',
		);
		group?.click();
		expect( group?.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
		expect( feed?.hidden ).toBe( true );
		group?.click();
		expect( feed?.hidden ).toBe( false );
		feed?.click();
		await Promise.resolve();
		expect( openWindow ).toHaveBeenCalledWith( 'feed-buddy-reader', {
			source: 'feed-buddy-widget',
		} );
		expect( send ).toHaveBeenCalledWith( 'feed:select', {
			feedId: 'news',
			manager: false,
		} );

		const initialRequest = requests[ 0 ];
		teardown();
		expect( initialRequest.signal?.aborted ).toBe( true );
		expect( container.children ).toHaveLength( 0 );
	} );

	it( 'handles the feed-selection channel and releases reader listeners', async () => {
		const store = getStore();
		Object.assign( store.state, clientState() );
		store.notify();

		const container = document.createElement( 'div' );
		container.innerHTML = `
			<div data-feed-buddy-reader>
				<wpd-button data-feed-buddy-about>About</wpd-button>
				<wpd-select data-feed-buddy-feed-select></wpd-select>
				<div data-feed-buddy-empty hidden>
					<h2 data-feed-buddy-empty-title></h2>
					<p data-feed-buddy-empty-copy></p>
					<wpd-button data-feed-buddy-add-first></wpd-button>
				</div>
				<ol data-feed-buddy-items></ol>
				<div data-feed-buddy-loading hidden></div>
				<aside data-feed-buddy-manager hidden>
					<div data-feed-buddy-manager-list></div>
				</aside>
				<div data-feed-buddy-status></div>
			</div>
		`;
		let channelCallback:
			| ( ( payload: { feedId?: string | null; manager?: boolean } ) => void )
			| undefined;
		const offChannel = vi.fn();
		const offResize = vi.fn();
		const markLoading = vi.fn();
		const markReady = vi.fn();
		const controller = new AbortController();
		const context: NativeRenderContext = {
			signal: controller.signal,
			onResize: () => offResize,
			onHide: () => () => undefined,
			onShow: () => () => undefined,
			markLoading,
			markReady,
			window: {
				send: () => undefined,
				on: ( _channel, callback ) => {
					channelCallback = callback as typeof channelCallback;
					return offChannel;
				},
			},
		};

		const teardown = await mountReader( container, context );
		expect( markLoading ).toHaveBeenCalledOnce();
		expect( markReady ).toHaveBeenCalledOnce();
		expect( applyWindowTheme ).toHaveBeenCalledWith(
			'feed-buddy-reader',
			expect.objectContaining( {
				tokens: expect.objectContaining( {
					'--desktop-mode-titlebar-image': 'none',
					'--desktop-mode-titlebar-image-focused': 'none',
				} ),
			} ),
		);
		expect( container.textContent ).toContain( '<b>Readable headline</b>' );
		container.querySelector< HTMLElement >( '[data-feed-buddy-about]' )?.click();
		expect(
			document.querySelector( '[data-feed-buddy-about-dialog]' )?.textContent,
		).toContain( 'SOL Inbound Monologue' );

		channelCallback?.( { feedId: 'news', manager: false } );
		await vi.waitFor( () => {
			expect( requests.some( ( request ) => request.url.includes( 'feed_id=news' ) ) )
				.toBe( true );
		} );

		teardown();
		expect( offChannel ).toHaveBeenCalledOnce();
		expect( offResize ).toHaveBeenCalledOnce();
		expect( document.querySelector( '[data-feed-buddy-about-dialog]' ) )
			.toBeNull();
		expect( applyWindowTheme ).toHaveBeenLastCalledWith(
			'feed-buddy-reader',
			null,
		);
	} );

	// `<wpd-button>` and `<wpd-text-field>` keep their native controls
	// in a shadow root, so the surrounding `<form>` never receives a
	// native `submit` event. Adding a feed has to be driven by the
	// button's click and the field's `wpd-submit` event instead.
	it.each( [
		{
			label: 'the Add buddy button click',
			url: 'https://example.com/new.xml',
			fire: ( form: HTMLElement ) =>
				form
					.querySelector< HTMLElement >( '[data-feed-buddy-add-submit]' )!
					.click(),
		},
		{
			label: 'Enter in the URL field',
			url: 'https://example.com/second.xml',
			fire: ( form: HTMLElement ) =>
				form
					.querySelector< HTMLElement >( '[name="url"]' )!
					.dispatchEvent(
						new CustomEvent( 'wpd-submit', {
							bubbles: true,
							composed: true,
						} ),
					),
		},
	] )( 'adds a feed from $label', async ( { url, fire } ) => {
		const { container, teardown } = await mountManager( url );
		expect( postedSubscriptions() ).toHaveLength( 0 );

		fire( container.querySelector< HTMLElement >( '[data-feed-buddy-add-form]' )! );

		await vi.waitFor( () => {
			expect( postedSubscriptions() ).toHaveLength( 1 );
		} );
		expect( JSON.parse( postedSubscriptions()[ 0 ].body! ) ).toEqual( {
			url,
			group: 'NEWS',
		} );

		teardown();
	} );

	it( 'ignores an empty add-feed submission without calling the server', async () => {
		const { container, teardown } = await mountManager( '' );
		const before = requests.length;

		container
			.querySelector< HTMLElement >( '[data-feed-buddy-add-submit]' )!
			.click();
		await Promise.resolve();

		expect( requests ).toHaveLength( before );
		expect(
			container.querySelector( '[data-feed-buddy-status]' )?.textContent,
		).toContain( 'Enter a feed or website URL first.' );

		teardown();
	} );
} );
