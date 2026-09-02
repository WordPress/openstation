/**
 * App Framework runtime — one mounted view.
 *
 * A session owns the client half of a view's state cycle: it keeps
 * the state bag the server last returned, serialises dispatches so
 * two quick clicks can't race each other, morphs each response into
 * the root, assigns `os-prop-*` properties, performs the effects,
 * and keeps `os-poll` timers alive for exactly as long as their
 * elements are rendered. A window with tabs has one session per tab
 * panel; `view` tells the server which one is asking.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import {
	CAPTURED_EVENTS,
	LISTENED_EVENTS,
	applyProps,
	boundValue,
	findTrigger,
	readBinding,
	readPolls,
} from './bindings';
import type { ClientApp } from './client';
import { morphChildren } from './morph';
import type {
	AppConfig,
	Binding,
	ConfirmSpec,
	DispatchResponse,
	Effect,
	MenuItemDef,
	RuntimeHost,
} from './types';

export interface SessionDeps {
	root: HTMLElement;
	config: AppConfig;
	windowId: string;
	host: RuntimeHost;
	/** `main` or a tab slug. */
	view?: string;
	/** The window's open-time params, sent with every dispatch. */
	params?: Record< string, string | number | boolean >;
	/** Fires when the window closes; aborts in-flight requests. */
	signal?: AbortSignal;
	/**
	 * The app's `.os.ts` half, when it shipped one. With a client, the
	 * body is rendered in the browser from `( state, data )`, `local`
	 * actions and `os-bind` writes never leave the tab, and a server
	 * response refreshes `data` instead of morphing HTML.
	 */
	client?: ClientApp;
}

export interface DispatchOptions {
	confirm?: ConfirmSpec | null;
	trigger?: Element | null;
}

export interface Session {
	readonly appId: string;
	readonly windowId: string;
	readonly view: string;
	/** State as last confirmed by the server (plus local writes). */
	readonly state: Record< string, unknown >;
	/** What `App::data()` returned on the last server response (client apps). */
	readonly data: unknown;
	/** Run an action. Resolves `true` once its response was applied. */
	dispatch: (
		action: string,
		args?: Record< string, unknown >,
		options?: DispatchOptions,
	) => Promise< boolean >;
	/** Run a client-side action; re-renders without a request. */
	local: ( action: string, args?: Record< string, unknown > ) => void;
	/**
	 * Paint the client view NOW from the declared state and the data
	 * the config prefetched (`App::prefetch()`), before `mount` has
	 * answered. False when the session has no client view or no
	 * prefetched data — the caller then waits for `mount` as usual.
	 */
	paintEagerly: () => boolean;
	/** Whether the window is paused (minimized / hidden tab). */
	setPaused: ( paused: boolean ) => void;
	dispose: () => void;
}

/**
 * Windows whose sessions log every dispatch to the console —
 * `wp.os.apps.debug( windowId | '*' )` flips them. Module-level so
 * one call covers every session of a window, tabs included.
 */
const debugWindows = new Set< string >();

/** Enable/disable the dispatch trace for one window (or `'*'`). */
export function setSessionDebug( windowId: string, on = true ): void {
	if ( on ) {
		debugWindows.add( windowId );
	} else {
		debugWindows.delete( windowId );
	}
}

/**
 * One warning per (app, subject) per page — a guard that fires on
 * every render would bury the console it is trying to help.
 */
const warnedOnce = new Set< string >();
function warnOnce( key: string, message: string ): void {
	if ( warnedOnce.has( key ) ) {
		return;
	}
	warnedOnce.add( key );
	// eslint-disable-next-line no-console
	console.warn( message );
}

export function createSession( deps: SessionDeps ): Session {
	const { root, config, windowId, host, signal, client } = deps;
	const view = deps.view ?? 'main';
	const params = deps.params ?? {};

	let state: Record< string, unknown > = { ...config.state };
	let data: unknown;
	/** `undefined` until the client view first painted; then its teardown or null. */
	let clientTeardown: ( () => void ) | null | undefined;
	let disposed = false;
	let paused = false;
	let inFlight = 0;
	let chain: Promise< unknown > = Promise.resolve();
	let pointer = { x: 0, y: 0 };
	const debounces = new Map< string, number >();
	const polls = new Map< string, number >();
	const propsSeen = new WeakMap< Element, Record< string, string > >();
	const listeners: Array< () => void > = [];

	// ------------------------------------------------------- dev guards

	// The two silent failure modes a new app author hits first: a
	// trigger naming an action nothing implements (a typo no-ops until
	// the click 400s), and a write to a state key the schema does not
	// declare (works locally, vanishes on the next round trip). Both
	// warn once, at the moment the mistake is visible.
	const declaredKeys = new Set( Object.keys( config.state ?? {} ) );
	const declaredActions = new Set( [
		'mount',
		'set',
		'refresh',
		...( config.actions ?? [] ),
		...( config.lifecycle ?? [] ),
	] );
	const debugging = (): boolean => debugWindows.has( '*' ) || debugWindows.has( windowId );

	/** Flag rendered triggers whose action nothing implements. */
	const auditTriggers = (): void => {
		// An older config blob without the action list cannot tell a
		// typo from a legitimate action — stay quiet rather than cry
		// wolf on everything.
		if ( ! config.actions || config.actions.length === 0 ) {
			return;
		}
		for ( const el of Array.from( root.querySelectorAll( '[os-action]' ) ) ) {
			const action = el.getAttribute( 'os-action' ) ?? '';
			if ( '' === action || declaredActions.has( action ) || ( client?.hasLocal( action ) ?? false ) ) {
				continue;
			}
			warnOnce(
				`${ config.id }:action:${ action }`,
				`[openstation] app "${ config.id }": os-action="${ action }" names no server action, no local reducer and no built-in — dispatching it will fail. Declare ->action( '${ action }' ) in the .os.php, or a local reducer in the .os.ts.`,
			);
		}
	};

	/** Flag a write to a key the state schema does not declare. */
	const auditStateKeys = ( wrote: string ): void => {
		for ( const key of Object.keys( state ) ) {
			if ( ! declaredKeys.has( key ) ) {
				warnOnce(
					`${ config.id }:key:${ key }`,
					`[openstation] app "${ config.id }": ${ wrote } wrote state.${ key }, which App::state() does not declare — the next server response silently drops it. Declare it in ->state(), or keep client-only values in ctx.ui().`,
				);
			}
		}
	};

	// ------------------------------------------------------- transport

	const send = async ( action: string, args: Record< string, unknown >, trigger: Element | null ): Promise< boolean > => {
		if ( disposed ) {
			return false;
		}
		// eslint-disable-next-line @wordpress/no-unused-vars-before-return -- the trace must clock the WHOLE dispatch; the guards above return before any work exists to time.
		const startedAt = Date.now();
		inFlight++;
		root.setAttribute( 'aria-busy', 'true' );
		if ( trigger && trigger.tagName.toLowerCase() === 'os-button' ) {
			trigger.setAttribute( 'busy', '' );
		}
		// The snapshot this request carries. `apply()` diffs the live
		// state against it when the response lands: any key written
		// locally while the request was in flight is newer than the
		// echo and must survive it.
		const sentState = state;
		try {
			const headers: Record< string, string > = {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			};
			if ( config.restNonce ) {
				headers[ 'X-WP-Nonce' ] = config.restNonce;
			}
			const response = await host.fetch(
				config.endpoint,
				{
					method: 'POST',
					headers,
					body: JSON.stringify( {
						action,
						view,
						state: sentState,
						args,
						params,
						client: { width: root.clientWidth, height: root.clientHeight },
					} ),
					signal,
				},
				{ windowId, source: `openstation/app/${ config.id }` },
			);
			if ( ! response.ok ) {
				let message = String( response.status );
				try {
					const body = ( await response.json() ) as { message?: string };
					if ( body && body.message ) {
						message = body.message;
					}
				} catch {
					// A non-JSON error body: the status code will do.
				}
				throw new Error( message );
			}
			const payload = ( await response.json() ) as DispatchResponse;
			if ( disposed || ! payload || payload.ok !== true ) {
				return false;
			}
			apply( payload, sentState );
			if ( debugging() ) {
				const changed = Object.keys( state ).filter( ( key ) => state[ key ] !== sentState[ key ] );
				// eslint-disable-next-line no-console
				console.groupCollapsed(
					`[openstation:${ config.id }] ${ action } · ${ Date.now() - startedAt }ms`,
				);
				// eslint-disable-next-line no-console
				console.log( 'args', args );
				// eslint-disable-next-line no-console
				console.log( 'state Δ', changed, changed.length > 0 ? Object.fromEntries( changed.map( ( key ) => [ key, state[ key ] ] ) ) : '' );
				// eslint-disable-next-line no-console
				console.log( 'effects', payload.effects ?? [] );
				// eslint-disable-next-line no-console
				console.groupEnd();
			}
			return true;
		} catch ( err ) {
			if ( disposed || signal?.aborted ) {
				return false;
			}
			if ( debugging() ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[openstation:${ config.id }] ${ action } FAILED after ${ Date.now() - startedAt }ms:`,
					err,
				);
			}
			host.toast?.( {
				message: sprintf(
					/* translators: %s: error message. */
					__( 'The window could not update: %s' ),
					err instanceof Error ? err.message : String( err ),
				),
			} );
			return false;
		} finally {
			inFlight--;
			if ( inFlight === 0 ) {
				root.removeAttribute( 'aria-busy' );
			}
			if ( trigger && trigger.isConnected ) {
				trigger.removeAttribute( 'busy' );
			}
		}
	};

	const dispatch = async (
		action: string,
		args: Record< string, unknown > = {},
		options: DispatchOptions = {},
	): Promise< boolean > => {
		if ( disposed ) {
			return false;
		}
		if ( options.confirm ) {
			if ( ! host.confirm ) {
				return false;
			}
			const ok = await host.confirm( {
				title: options.confirm.title,
				message: options.confirm.message,
				confirmLabel: options.confirm.label,
				danger: !! options.confirm.danger,
			} );
			if ( ! ok || disposed ) {
				return false;
			}
		}
		// Serialise: every dispatch reads `state` at send time, so a
		// bind that landed while another request was in flight is
		// carried by the next one instead of being overwritten.
		const run = chain.then( () => send( action, args, options.trigger ?? null ) );
		chain = run.catch( () => undefined );
		return run;
	};

	// ------------------------------------------------------------ apply

	/**
	 * The one pass that follows EVERY paint, server or local: assign
	 * `os-prop-*` properties, lazy-load any `os-*` component the new
	 * markup uses that is not defined yet, and start/stop `os-poll`
	 * timers to match what is rendered.
	 */
	const finishRender = (): void => {
		applyProps( root, propsSeen );
		void ensureComponents();
		reconcilePolls();
		auditTriggers();
	};

	const apply = ( payload: DispatchResponse, sentState: Record< string, unknown > ): void => {
		// The response echoes the state AS OF when its request was
		// sent. Anything written locally since — an os-bind keystroke,
		// a `local` reducer — is newer than that echo, and adopting the
		// echo wholesale would visibly revert it (a search box snapping
		// back mid-word during a watch refresh) and then LOSE it, since
		// the next queued dispatch reads state at its own send time.
		// So: adopt the server's answer, but every key whose live value
		// diverged from this request's snapshot keeps the local value —
		// the serialisation chain carries it up on the next dispatch.
		const next = { ...payload.state };
		for ( const key of Object.keys( state ) ) {
			if ( state[ key ] !== sentState[ key ] ) {
				next[ key ] = state[ key ];
			}
		}
		state = next;
		if ( client ) {
			data = payload.data;
			const first = clientTeardown === undefined;
			client.render( viewContext() );
			finishRender();
			// After finishRender, so a mounted() hook reads a complete
			// DOM: os-prop properties assigned, polls running.
			if ( first ) {
				const teardown = client.mounted( viewContext() );
				clientTeardown = typeof teardown === 'function' ? teardown : null;
			}
		} else {
			morphChildren( root, payload.html );
			finishRender();
		}
		for ( const effect of payload.effects ?? [] ) {
			performEffect( effect );
		}
	};

	// ----------------------------------------------------- client view

	/** The per-view client-only bag `ctx.ui( factory )` serves. */
	let uiBag: unknown;
	const uiOf = < T >( factory: () => T ): T => {
		if ( uiBag === undefined ) {
			uiBag = factory();
		}
		return uiBag as T;
	};

	/** Re-render the client view with no action and no request. */
	const repaint = (): void => {
		if ( ! client || disposed ) {
			return;
		}
		client.render( viewContext() );
		finishRender();
	};

	/**
	 * `ctx.fetch` — a REST request the framework way: the path is
	 * resolved against the site's REST root, the nonce and a JSON
	 * Accept header ride along unless the caller set their own, and
	 * the request is attributed to this window so its spinner shows.
	 */
	const restFetch = ( path: string, init: RequestInit = {} ): Promise< Response > => {
		const url = /^https?:\/\//i.test( path )
			? path
			: String( config.restRoot ?? '' ) + path.replace( /^\//, '' );
		const headers = new Headers( init.headers );
		if ( ! headers.has( 'Accept' ) ) {
			headers.set( 'Accept', 'application/json' );
		}
		if ( config.restNonce && ! headers.has( 'X-WP-Nonce' ) ) {
			headers.set( 'X-WP-Nonce', config.restNonce );
		}
		return host.fetch(
			url,
			{ credentials: 'same-origin', signal, ...init, headers },
			{ windowId, source: `openstation/app/${ config.id }` },
		);
	};

	// `state` and `data` are LIVE getters, not snapshots: a `mounted()`
	// hook installs listeners that outlive every render, and a
	// captured context that froze the mount-time state would make
	// them silently blind to everything the user did since (a
	// drag-out reading the selection as it was at mount, an Escape
	// handler reading the mount-time navigation). Reading through the
	// context always answers with the current values.
	const viewContext = () => ( {
		get state() {
			return state;
		},
		get data() {
			return data;
		},
		root,
		dispatch: (
			action: string,
			args: Record< string, unknown > = {},
			options: { confirm?: ConfirmSpec | null } = {},
		) => dispatch( action, args, { confirm: options.confirm ?? null } ),
		local: ( action: string, args: Record< string, unknown > = {} ) => runLocal( action, args ),
		ui: uiOf,
		repaint,
		fetch: restFetch,
		host,
		extra: ( config.extra ?? {} ) as Record< string, unknown >,
	} );

	/** A client-side action: reduce, re-render, no request. */
	const runLocal = ( action: string, args: Record< string, unknown > ): void => {
		if ( ! client || disposed ) {
			return;
		}
		if ( client.hasLocal( action ) ) {
			state = client.runLocal( action, state, args, data );
			auditStateKeys( `local action "${ action }"` );
			if ( debugging() ) {
				// eslint-disable-next-line no-console
				console.debug( `[openstation:${ config.id }] local ${ action }`, args );
			}
		}
		client.render( viewContext() );
		finishRender();
	};

	/**
	 * Tags this session already asked the shell for. A tag that is
	 * still undefined after a load is not a component (the Components
	 * tab renders two such tags on purpose, for its warner demo), and
	 * asking again on every repaint would log the loader's error on
	 * every repaint.
	 */
	const requestedTags = new Set< string >();

	const ensureComponents = async (): Promise< void > => {
		if ( ! host.loadComponents ) {
			return;
		}
		const missing = new Set< string >();
		for ( const el of Array.from( root.querySelectorAll( '*' ) ) ) {
			const tag = el.tagName.toLowerCase();
			if ( tag.startsWith( 'os-' ) && ! customElements.get( tag ) && ! requestedTags.has( tag ) ) {
				missing.add( tag );
				requestedTags.add( tag );
			}
		}
		if ( missing.size > 0 ) {
			await host.loadComponents( Array.from( missing ) );
			// Property-driven components upgraded after the assignment
			// pass keep the values (they live on the element), but a
			// component that reads them only at connect time gets a
			// second chance now that it exists.
			applyProps( root, new WeakMap() );
		}
	};

	const performEffect = ( effect: Effect ): void => {
		switch ( effect.type ) {
			case 'toast':
				host.toast?.( { message: String( ( effect as { message: string } ).message ) } );
				return;
			case 'title':
				host.setTitle?.( windowId, String( ( effect as { title: string } ).title ) );
				return;
			case 'close':
				host.closeWindow?.( windowId );
				return;
			case 'open':
				host.openWindow?.( String( ( effect as { window: string } ).window ) );
				return;
			case 'open_url':
				host.openUrl?.(
					String( ( effect as { url: string } ).url ),
					String( ( effect as { title?: string } ).title ?? '' ),
					String( ( effect as { icon?: string } ).icon ?? '' ),
				);
				return;
			case 'badge':
				host.setBadge?.( config.id, Number( ( effect as { count: number } ).count ) || 0 );
				return;
			case 'icon':
				host.setIcon?.( config.id, String( ( effect as { icon: string } ).icon ) );
				return;
			case 'announce': {
				const e = effect as { contentType: string; action: string; ids: number[] };
				host.announce?.( e.contentType, e.action, e.ids );
				return;
			}
			case 'menu': {
				const items = ( effect as { items: MenuItemDef[] } ).items ?? [];
				host.menu?.( pointer, items, ( item ) => {
					void dispatch( item.action, item.args );
				} );
				return;
			}
			case 'send': {
				const e = effect as { channel: string; payload?: unknown };
				host.send?.( e.channel, e.payload );
				return;
			}
			case 'refresh_menu':
				host.refreshMenu?.();
				return;
			default:
				root.dispatchEvent(
					new CustomEvent( 'os-app-effect', {
						bubbles: true,
						composed: true,
						detail: { appId: config.id, windowId, view, effect },
					} ),
				);
		}
	};

	// ------------------------------------------------------------ polls

	const reconcilePolls = (): void => {
		const wanted = new Map( readPolls( root ).map( ( poll ) => [ poll.key, poll ] ) );
		for ( const [ key, timer ] of polls ) {
			if ( ! wanted.has( key ) ) {
				window.clearInterval( timer );
				polls.delete( key );
			}
		}
		for ( const [ key, poll ] of wanted ) {
			if ( polls.has( key ) ) {
				continue;
			}
			polls.set(
				key,
				window.setInterval( () => {
					if ( paused || document.hidden || inFlight > 0 || disposed ) {
						return;
					}
					void dispatch( poll.action, poll.args );
				}, poll.intervalMs ),
			);
		}
	};

	// ----------------------------------------------------------- events

	const trigger = ( binding: Binding, el: Element ): void => {
		if ( binding.bind ) {
			if ( ! declaredKeys.has( binding.bind ) ) {
				warnOnce(
					`${ config.id }:bind:${ binding.bind }`,
					`[openstation] app "${ config.id }": os-bind="${ binding.bind }" writes a key App::state() does not declare — the server drops it on the next round trip. Declare it in ->state(), or keep client-only values in ctx.ui().`,
				);
			}
			const value = boundValue( binding.args );
			if ( value !== undefined ) {
				state = { ...state, [ binding.bind ]: value };
			}
		}
		// With a client view, a bound write and a `local` action never
		// leave the browser: reduce, re-render, done.
		const isLocal =
			!! client && ( client.hasLocal( binding.action ) || ( binding.action === 'set' && binding.bind !== null ) );
		const fire = (): void => {
			if ( isLocal ) {
				runLocal( binding.action, binding.args );
				return;
			}
			void dispatch( binding.action, binding.args, {
				confirm: binding.confirm,
				trigger: el,
			} );
		};
		if ( binding.debounce <= 0 ) {
			fire();
			return;
		}
		const key = binding.bind ?? binding.action;
		const pending = debounces.get( key );
		if ( pending !== undefined ) {
			window.clearTimeout( pending );
		}
		debounces.set(
			key,
			window.setTimeout( () => {
				debounces.delete( key );
				fire();
			}, binding.debounce ),
		);
	};

	const onEvent = ( ev: Event ): void => {
		if ( disposed ) {
			return;
		}
		if ( ev instanceof MouseEvent ) {
			pointer = { x: ev.clientX, y: ev.clientY };
		}
		const target = ev.target instanceof Element ? ev.target : null;
		const el = findTrigger( target, ev.type, root );
		if ( ! el ) {
			return;
		}
		if ( ( ev.type === 'click' || ev.type === 'dblclick' ) && el.hasAttribute( 'disabled' ) ) {
			return;
		}
		if ( ev.type === 'submit' || ev.type === 'contextmenu' ) {
			ev.preventDefault();
		}
		if ( ev.type === 'keydown' ) {
			const keys = el.getAttribute( 'os-keys' );
			if ( keys && ! keys.split( /\s+/ ).includes( ( ev as KeyboardEvent ).key ) ) {
				return;
			}
			ev.preventDefault();
		}
		trigger( readBinding( el, ev ), el );
	};

	for ( const type of LISTENED_EVENTS ) {
		const capture = CAPTURED_EVENTS.has( type );
		root.addEventListener( type, onEvent, capture );
		listeners.push( () => root.removeEventListener( type, onEvent, capture ) );
	}

	// ------------------------------------------------------------ watch

	/**
	 * `App::watch( ...$types )` — re-render when watched content
	 * changes anywhere on the desktop. A burst of broadcasts coalesces
	 * into one queued refresh; a paused (minimized) window marks
	 * itself stale instead and catches up on restore.
	 */
	let stale = false;
	let refreshQueued = false;
	const refresh = (): void => {
		if ( disposed || refreshQueued ) {
			return;
		}
		if ( paused ) {
			stale = true;
			return;
		}
		refreshQueued = true;
		void dispatch( 'set' ).finally( () => {
			refreshQueued = false;
		} );
	};
	if ( host.onBroadcast ) {
		for ( const type of config.watch ?? [] ) {
			if ( type === '*' ) {
				// Any content change: the wildcard subscription hears every
				// broadcast, so filter down to the content-change envelope.
				listeners.push( host.onBroadcast( '*', ( topic ) => {
					if ( /^os\..+\.changed$/.test( topic ) ) {
						refresh();
					}
				} ) );
				continue;
			}
			listeners.push( host.onBroadcast( `os.${ type }.changed`, refresh ) );
		}
	}

	// ---------------------------------------------------------- session

	const session: Session = {
		appId: config.id,
		windowId,
		view,
		get state() {
			return state;
		},
		get data() {
			return data;
		},
		dispatch,
		local: ( action, args = {} ) => runLocal( action, args ),
		paintEagerly() {
			if ( ! client || disposed || config.data === undefined || clientTeardown !== undefined ) {
				return false;
			}
			// The same path a response takes, fed the declared state and
			// the prefetched data: `mounted()` runs now, and the `mount`
			// answer that follows refreshes both without a second mount.
			apply( { ok: true, state: { ...config.state }, html: '', data: config.data, effects: [] }, state );
			return true;
		},
		setPaused( value: boolean ) {
			paused = value;
			if ( ! value && stale ) {
				stale = false;
				refresh();
			}
		},
		dispose() {
			disposed = true;
			if ( typeof clientTeardown === 'function' ) {
				clientTeardown();
			}
			for ( const off of listeners ) {
				off();
			}
			for ( const timer of debounces.values() ) {
				window.clearTimeout( timer );
			}
			debounces.clear();
			for ( const timer of polls.values() ) {
				window.clearInterval( timer );
			}
			polls.clear();
		},
	};
	return session;
}
