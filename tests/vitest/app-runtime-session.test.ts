/**
 * App Framework runtime — a mounted window's session.
 *
 * Exercises the client half of the state cycle against a stub host:
 * the `mount` dispatch, triggers → dispatches, `os-bind` writes,
 * debouncing, confirmation gating, serialised requests, effects,
 * error toasts, and `os-poll` timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, type Session } from '../../src/app-runtime/session';
import type { AppConfig, DispatchResponse, RuntimeHost } from '../../src/app-runtime/types';

interface Sent {
	action: string;
	state: Record< string, unknown >;
	args: Record< string, unknown >;
}

function config(): AppConfig {
	return {
		osApp: true,
		id: 'demo',
		title: 'Demo',
		endpoint: 'https://example.test/wp-json/desktop-mode/v1/apps/demo/dispatch',
		restNonce: 'nonce',
		state: { count: 0, query: '' },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
	};
}

function jsonResponse( payload: unknown, status = 200 ): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	} as unknown as Response;
}

interface Harness {
	root: HTMLElement;
	host: RuntimeHost & { sent: Sent[]; toasts: string[] };
	session: Session;
	respond: ( render: ( sent: Sent ) => DispatchResponse | { status: number; message: string } ) => void;
}

function harness( initialHtml = '' ): Harness {
	const root = document.createElement( 'div' );
	root.innerHTML = initialHtml;
	document.body.appendChild( root );

	let render: ( sent: Sent ) => DispatchResponse | { status: number; message: string } = ( sent ) => ( {
		ok: true,
		state: sent.state,
		html: `<p>${ sent.action }</p>`,
		effects: [],
	} );

	const host: Harness[ 'host' ] = {
		sent: [],
		toasts: [],
		fetch: async ( _input, init ) => {
			const body = JSON.parse( String( init?.body ) ) as Sent;
			host.sent.push( body );
			const out = render( body );
			if ( 'status' in out && ! ( 'ok' in out ) ) {
				return jsonResponse( { message: out.message }, out.status );
			}
			return jsonResponse( out );
		},
		toast: ( o ) => {
			host.toasts.push( o.message );
		},
		confirm: async () => true,
	};

	const session = createSession( { root, config: config(), windowId: 'demo', host } );
	return {
		root,
		host,
		session,
		respond: ( fn ) => {
			render = fn;
		},
	};
}

const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

describe( 'createSession', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'mounts by dispatching `mount` and morphing the response into the root', async () => {
		const h = harness( '<div class="loading"></div>' );
		await h.session.dispatch( 'mount' );
		expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'mount', state: { count: 0, query: '' } } );
		expect( h.root.innerHTML ).toBe( '<p>mount</p>' );
		expect( h.root.hasAttribute( 'aria-busy' ) ).toBe( false );
	} );

	it( 'dispatches a trigger with its arguments and adopts the returned state', async () => {
		const h = harness( '<button os-action="bump" os-arg-by="2">+</button>' );
		h.respond( ( sent ) => ( {
			ok: true,
			state: { ...sent.state, count: Number( sent.state.count ) + Number( sent.args.by ) },
			html: '<button os-action="bump" os-arg-by="2">+</button><output>done</output>',
			effects: [],
		} ) );
		( h.root.querySelector( 'button' ) as HTMLButtonElement ).click();
		await flush();
		expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'bump', args: { by: '2' } } );
		expect( h.session.state.count ).toBe( 2 );
		expect( h.root.querySelector( 'output' )?.textContent ).toBe( 'done' );
	} );

	it( 'writes an os-bind value into state before sending `set`', async () => {
		const h = harness( '<os-segmented os-bind="query"></os-segmented>' );
		h.root.firstElementChild!.dispatchEvent(
			new CustomEvent( 'os-pick', { bubbles: true, detail: { value: '7d' } } ),
		);
		await flush();
		expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'set', state: { query: '7d' } } );
	} );

	it( 'runs os-action after an os-bind on the same trigger', async () => {
		const h = harness( '<os-select os-bind="query" os-action="source"></os-select>' );
		h.root.firstElementChild!.dispatchEvent(
			new CustomEvent( 'os-pick', { bubbles: true, detail: { value: 'php' } } ),
		);
		await flush();
		expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'source', state: { query: 'php' } } );
	} );

	it( 'serialises dispatches so the second carries the first response state', async () => {
		const h = harness( '<button os-action="bump">+</button>' );
		h.respond( ( sent ) => ( {
			ok: true,
			state: { ...sent.state, count: Number( sent.state.count ) + 1 },
			html: '<button os-action="bump">+</button>',
			effects: [],
		} ) );
		const button = h.root.querySelector( 'button' ) as HTMLButtonElement;
		button.click();
		button.click();
		await flush();
		await flush();
		expect( h.host.sent ).toHaveLength( 2 );
		expect( h.host.sent[ 1 ].state.count ).toBe( 1 );
		expect( h.session.state.count ).toBe( 2 );
	} );

	it( 'asks for confirmation first and skips the dispatch when declined', async () => {
		const h = harness( '<button os-action="clear" os-confirm="Sure?">x</button>' );
		h.host.confirm = async () => false;
		( h.root.querySelector( 'button' ) as HTMLButtonElement ).click();
		await flush();
		expect( h.host.sent ).toHaveLength( 0 );
		h.host.confirm = async ( o ) => o.message === 'Sure?';
		( h.root.querySelector( 'button' ) as HTMLButtonElement ).click();
		await flush();
		expect( h.host.sent ).toHaveLength( 1 );
	} );

	it( 'performs effects after the morph', async () => {
		const h = harness();
		const titles: string[] = [];
		const closed: string[] = [];
		const opened: string[] = [];
		h.host.setTitle = ( id, t ) => {
			titles.push( `${ id }:${ t }` );
		};
		h.host.closeWindow = ( id ) => {
			closed.push( id );
		};
		h.host.openWindow = ( id ) => {
			opened.push( id );
		};
		h.respond( ( sent ) => ( {
			ok: true,
			state: sent.state,
			html: '',
			effects: [
				{ type: 'toast', message: 'Saved' },
				{ type: 'title', title: 'New' },
				{ type: 'open', window: 'other' },
				{ type: 'close' },
			],
		} ) );
		await h.session.dispatch( 'save' );
		expect( h.host.toasts ).toEqual( [ 'Saved' ] );
		expect( titles ).toEqual( [ 'demo:New' ] );
		expect( opened ).toEqual( [ 'other' ] );
		expect( closed ).toEqual( [ 'demo' ] );
	} );

	it( 'performs the shell-side effects: open_url, badge, announce, send, menu', async () => {
		const h = harness();
		const log: unknown[] = [];
		h.host.openUrl = ( url, title ) => log.push( [ 'url', url, title ] );
		h.host.setBadge = ( id, count ) => log.push( [ 'badge', id, count ] );
		h.host.announce = ( type, action, ids ) => log.push( [ 'announce', type, action, ids ] );
		h.host.send = ( channel, payload ) => log.push( [ 'send', channel, payload ] );
		h.host.menu = ( position, items, pick ) => {
			log.push( [ 'menu', position, items.map( ( i ) => i.id ) ] );
			pick( items[ 0 ] );
		};
		h.respond( ( sent ) => ( {
			ok: true,
			state: sent.state,
			html: '',
			effects:
				sent.action === 'first'
					? [
						{ type: 'open_url', url: 'post.php?post=1', title: 'Edit' },
						{ type: 'badge', count: 3 },
						{ type: 'announce', contentType: 'post', action: 'updated', ids: [ 1 ] },
						{ type: 'send', channel: 'ping', payload: { a: 1 } },
						{ type: 'menu', items: [ { id: 'e', label: 'Edit', action: 'edit', args: { id: 1 }, icon: '', danger: false, disabled: false } ] },
					]
					: [],
		} ) );
		h.root.dispatchEvent( new MouseEvent( 'click', { clientX: 40, clientY: 50, bubbles: true } ) );
		await h.session.dispatch( 'first' );
		await flush();
		expect( log ).toEqual( [
			[ 'url', 'post.php?post=1', 'Edit' ],
			[ 'badge', 'demo', 3 ],
			[ 'announce', 'post', 'updated', [ 1 ] ],
			[ 'send', 'ping', { a: 1 } ],
			[ 'menu', { x: 40, y: 50 }, [ 'e' ] ],
		] );
		expect( h.host.sent[ 1 ] ).toMatchObject( { action: 'edit', args: { id: 1 } } );
	} );

	it( 'assigns os-prop-* properties after every morph and sends view + params', async () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const sent: Array< Record< string, unknown > > = [];
		const host: RuntimeHost = {
			fetch: async ( _i, init ) => {
				sent.push( JSON.parse( String( init?.body ) ) as Record< string, unknown > );
				return jsonResponse( {
					ok: true,
					state: {},
					html: '<os-table os-prop-data=\'[{"a":1}]\'></os-table>',
					effects: [],
				} );
			},
		};
		const session = createSession( {
			root,
			config: config(),
			windowId: 'demo',
			host,
			view: 'log',
			params: { post: 7 },
		} );
		await session.dispatch( 'mount' );
		expect( sent[ 0 ] ).toMatchObject( { view: 'log', params: { post: 7 } } );
		expect( ( root.firstElementChild as HTMLElement & { data?: unknown } ).data ).toEqual( [ { a: 1 } ] );
	} );

	it( 'treats a contextmenu trigger as a dispatch and swallows the native menu', async () => {
		const h = harness( '<div class="row" os-on="contextmenu" os-action="menu" os-arg-id="9">row</div>' );
		const ev = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 } );
		h.root.querySelector( '.row' )!.dispatchEvent( ev );
		await flush();
		expect( ev.defaultPrevented ).toBe( true );
		expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'menu', args: { id: '9' } } );
	} );

	it( 'surfaces a failed dispatch as a toast and leaves the DOM alone', async () => {
		const h = harness( '<p>before</p>' );
		h.respond( () => ( { status: 500, message: 'Boom' } ) );
		const ok = await h.session.dispatch( 'explode' );
		expect( ok ).toBe( false );
		expect( h.host.toasts[ 0 ] ).toContain( 'Boom' );
		expect( h.root.innerHTML ).toBe( '<p>before</p>' );
	} );

	describe( 'timers', () => {
		beforeEach( () => {
			vi.useFakeTimers();
		} );
		afterEach( () => {
			vi.useRealTimers();
		} );

		it( 'debounces typing into one dispatch', async () => {
			const h = harness( '<os-text-field os-bind="query"></os-text-field>' );
			const field = h.root.firstElementChild!;
			for ( const value of [ 'a', 'ab', 'abc' ] ) {
				field.dispatchEvent( new CustomEvent( 'os-input-change', { bubbles: true, detail: { value } } ) );
			}
			expect( h.host.sent ).toHaveLength( 0 );
			await vi.advanceTimersByTimeAsync( 300 );
			expect( h.host.sent ).toHaveLength( 1 );
			expect( h.host.sent[ 0 ].state.query ).toBe( 'abc' );
		} );

		it( 'a keystroke during an in-flight response survives the echo and rides the next dispatch', async () => {
			const h = harness(
				'<os-text-field os-bind="query" os-action="search"></os-text-field><button os-action="refresh">r</button>',
			);
			// Gate the FIRST response so a keystroke can land mid-flight —
			// the shape of typing while a watch refresh is on the wire.
			let release!: () => void;
			const gate = new Promise< void >( ( resolve ) => {
				release = resolve;
			} );
			const baseFetch = h.host.fetch;
			let gated = true;
			h.host.fetch = async ( input, init, opts ) => {
				const response = baseFetch( input, init, opts );
				if ( gated ) {
					gated = false;
					await gate;
				}
				return response;
			};

			( h.root.querySelector( 'button' ) as HTMLButtonElement ).click();
			await Promise.resolve();
			expect( h.host.sent ).toHaveLength( 1 );
			expect( h.host.sent[ 0 ] ).toMatchObject( { action: 'refresh', state: { query: '' } } );

			// The user types while that request is on the wire: the bind
			// writes immediately, the search dispatch debounces behind it.
			h.root.firstElementChild!.dispatchEvent(
				new CustomEvent( 'os-input-change', { bubbles: true, detail: { value: 'hello' } } ),
			);

			// The refresh's response lands, echoing the EMPTY query it was
			// sent with. The newer local write must survive the echo —
			// this is the search box snapping back mid-word.
			release();
			await vi.advanceTimersByTimeAsync( 0 );
			expect( h.session.state.query ).toBe( 'hello' );

			// And the queued search must carry the typed value, not the
			// stomped one — otherwise the text merely FLASHES right and
			// the request that matters still searches for nothing.
			await vi.advanceTimersByTimeAsync( 300 );
			expect( h.host.sent ).toHaveLength( 2 );
			expect( h.host.sent[ 1 ] ).toMatchObject( { action: 'search', state: { query: 'hello' } } );
		} );

		it( 'polls while an os-poll element is rendered and stops when it disappears', async () => {
			const h = harness();
			let auto = true;
			h.respond( ( sent ) => ( {
				ok: true,
				state: sent.state,
				html: auto ? '<span os-poll="1000" os-action="refresh"></span>' : '',
				effects: [],
			} ) );
			await h.session.dispatch( 'mount' );
			await vi.advanceTimersByTimeAsync( 2100 );
			const refreshes = h.host.sent.filter( ( s ) => s.action === 'refresh' ).length;
			expect( refreshes ).toBe( 2 );
			auto = false;
			await h.session.dispatch( 'refresh' );
			await vi.advanceTimersByTimeAsync( 3000 );
			expect( h.host.sent.filter( ( s ) => s.action === 'refresh' ).length ).toBe( refreshes + 1 );
		} );

		it( 'stops everything on dispose', async () => {
			const h = harness();
			h.respond( ( sent ) => ( {
				ok: true,
				state: sent.state,
				html: '<span os-poll="1000" os-action="refresh"></span>',
				effects: [],
			} ) );
			await h.session.dispatch( 'mount' );
			h.session.dispose();
			await vi.advanceTimersByTimeAsync( 5000 );
			expect( h.host.sent ).toHaveLength( 1 );
			expect( await h.session.dispatch( 'anything' ) ).toBe( false );
		} );
	} );

	describe( 'watch', () => {
		interface WatchHarness extends Omit< Harness, 'session' > {
			session: Session;
			fire: ( topic: string ) => void;
			unsubscribed: string[];
		}

		function watchHarness( watch: string[] = [ 'post', 'page' ] ): WatchHarness {
			const subscribers = new Map< string, ( topic: string ) => void >();
			const unsubscribed: string[] = [];
			const root = document.createElement( 'div' );
			document.body.appendChild( root );
			const host: Harness[ 'host' ] = {
				sent: [],
				toasts: [],
				fetch: async ( _input, init ) => {
					const body = JSON.parse( String( init?.body ) ) as Sent;
					host.sent.push( body );
					return jsonResponse( { ok: true, state: body.state, html: '', effects: [] } );
				},
				toast: () => undefined,
				onBroadcast: ( topic, cb ) => {
					subscribers.set( topic, cb );
					return () => {
						unsubscribed.push( topic );
					};
				},
			};
			const session = createSession( {
				root,
				config: { ...config(), watch },
				windowId: 'demo',
				host,
			} );
			return {
				root,
				host,
				session,
				respond: () => undefined,
				// A broadcast reaches the exact subscription and the wildcard.
				fire: ( topic ) => {
					subscribers.get( topic )?.( topic );
					subscribers.get( '*' )?.( topic );
				},
				unsubscribed,
			};
		}

		it( 'subscribes each watched type and re-dispatches `set` on a change', async () => {
			const h = watchHarness();
			h.fire( 'os.post.changed' );
			await flush();
			expect( h.host.sent.map( ( s ) => s.action ) ).toEqual( [ 'set' ] );
			h.fire( 'os.page.changed' );
			await flush();
			expect( h.host.sent ).toHaveLength( 2 );
		} );

		it( 'coalesces a burst of changes into one queued refresh', async () => {
			const h = watchHarness();
			h.fire( 'os.post.changed' );
			h.fire( 'os.post.changed' );
			h.fire( 'os.page.changed' );
			await flush();
			expect( h.host.sent ).toHaveLength( 1 );
		} );

		it( 'marks a paused window stale and catches up on restore', async () => {
			const h = watchHarness();
			h.session.setPaused( true );
			h.fire( 'os.post.changed' );
			await flush();
			expect( h.host.sent ).toHaveLength( 0 );
			h.session.setPaused( false );
			await flush();
			expect( h.host.sent.map( ( s ) => s.action ) ).toEqual( [ 'set' ] );
			// A clean restore does not refresh again.
			h.session.setPaused( true );
			h.session.setPaused( false );
			await flush();
			expect( h.host.sent ).toHaveLength( 1 );
		} );

		it( 'watch(*) refreshes on any content change and ignores other broadcasts', async () => {
			const h = watchHarness( [ '*' ] );
			h.fire( 'os.product.changed' );
			await flush();
			expect( h.host.sent.map( ( s ) => s.action ) ).toEqual( [ 'set' ] );
			h.fire( 'os-window-focused' );
			h.fire( 'os.data-refresh' );
			await flush();
			// Only os.<type>.changed topics count.
			expect( h.host.sent ).toHaveLength( 1 );
		} );

		it( 'unsubscribes every watched topic on dispose', () => {
			const h = watchHarness();
			h.session.dispose();
			expect( h.unsubscribed.sort() ).toEqual( [ 'os.page.changed', 'os.post.changed' ] );
			h.fire( 'os.post.changed' );
			expect( h.host.sent ).toHaveLength( 0 );
		} );
	} );

	describe( 'the client view context', () => {
		type Ctx = import( '../../src/app-runtime/client' ).ViewContext<
			Record< string, unknown >,
			unknown
		>;

		function clientHarness() {
			const root = document.createElement( 'div' );
			document.body.appendChild( root );
			const fetches: Array< { input: string; init?: RequestInit } > = [];
			const confirms: string[] = [];
			let renders = 0;
			let ctx: Ctx | undefined;
			const host: RuntimeHost = {
				fetch: async ( input, init ) => {
					fetches.push( { input: String( input ), init } );
					return jsonResponse( { ok: true, state: {}, html: '', data: null, effects: [] } );
				},
				confirm: async ( o ) => {
					confirms.push( o.message );
					return true;
				},
			};
			const session = createSession( {
				root,
				config: { ...config(), restRoot: 'https://example.test/wp-json/', client: true },
				windowId: 'demo',
				host,
				client: {
					id: 'demo',
					hasLocal: () => false,
					runLocal: ( _a, state ) => state,
					render: ( c ) => {
						renders++;
						ctx = c;
					},
					mounted: () => undefined,
				},
			} );
			return {
				session,
				fetches,
				confirms,
				ctx: () => ctx as Ctx,
				renders: () => renders,
			};
		}

		it( 'ui() memoises one bag per view and repaint() re-renders without a request', async () => {
			const h = clientHarness();
			await h.session.dispatch( 'mount' );
			const first = h.ctx().ui( () => ( { open: false } ) );
			first.open = true;
			// Same bag on every call, factory run once.
			expect( h.ctx().ui( () => ( { open: false } ) ) ).toBe( first );
			const before = h.renders();
			const requests = h.fetches.length;
			h.ctx().repaint();
			expect( h.renders() ).toBe( before + 1 );
			expect( h.fetches ).toHaveLength( requests );
		} );

		it( 'fetch() resolves paths against the REST root and carries the nonce', async () => {
			const h = clientHarness();
			await h.session.dispatch( 'mount' );
			await h.ctx().fetch( 'desktop-mode/v1/things/7' );
			const call = h.fetches.at( -1 );
			expect( call?.input ).toBe( 'https://example.test/wp-json/desktop-mode/v1/things/7' );
			const headers = new Headers( call?.init?.headers );
			expect( headers.get( 'X-WP-Nonce' ) ).toBe( 'nonce' );
			expect( headers.get( 'Accept' ) ).toBe( 'application/json' );
			// An absolute URL passes through untouched.
			await h.ctx().fetch( 'https://elsewhere.test/x' );
			expect( h.fetches.at( -1 )?.input ).toBe( 'https://elsewhere.test/x' );
		} );

		it( 'dispatch() asks the confirm dialog when the caller passes one', async () => {
			const h = clientHarness();
			await h.session.dispatch( 'mount' );
			await h.ctx().dispatch( 'trash', {}, {
				confirm: { message: 'Move this to the Trash?', danger: true },
			} );
			expect( h.confirms ).toEqual( [ 'Move this to the Trash?' ] );
		} );

		it( 'exposes the runtime host itself', async () => {
			const h = clientHarness();
			await h.session.dispatch( 'mount' );
			expect( typeof h.ctx().host.fetch ).toBe( 'function' );
			expect( typeof h.ctx().host.confirm ).toBe( 'function' );
		} );
	} );
} );
