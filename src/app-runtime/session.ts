import { __ } from '../i18n';
import { RestError, restErrorFromResponse } from '../core/api-client';
import { toastRestFailure } from '../core/rest-failure';
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
import { takePrewarm } from './prewarm';
import {
	appAnnounceSource,
	type AppConfig,
	type Binding,
	type ConfirmSpec,
	type DispatchResponse,
	type Effect,
	type MenuItemDef,
	type RuntimeHost,
} from './types';

export interface SessionDeps {
	root: HTMLElement;
	config: AppConfig;
	windowId: string;
	host: RuntimeHost;

	view?: string;

	params?: Record< string, string | number | boolean >;

	signal?: AbortSignal;

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

	readonly state: Record< string, unknown >;

	readonly data: unknown;

	dispatch: (
		action: string,
		args?: Record< string, unknown >,
		options?: DispatchOptions,
	) => Promise< boolean >;

	local: ( action: string, args?: Record< string, unknown > ) => void;

	paintEagerly: () => boolean;

	setPaused: ( paused: boolean ) => void;

	setParams: ( params: Record< string, string | number | boolean > ) => void;
	dispose: () => void;
}

const debugWindows = new Set< string >();

export function setSessionDebug( windowId: string, on = true ): void {
	if ( on ) {
		debugWindows.add( windowId );
	} else {
		debugWindows.delete( windowId );
	}
}

const warnedOnce = new Set< string >();
function warnOnce( key: string, message: string ): void {
	if ( warnedOnce.has( key ) ) {
		return;
	}
	warnedOnce.add( key );

	console.warn( message );
}

export function createSession( deps: SessionDeps ): Session {
	const { root, config, windowId, host, signal, client } = deps;
	const view = deps.view ?? 'main';
	let params = deps.params ?? {};

	let state: Record< string, unknown > = { ...config.state };
	let data: unknown;

	let loading = false;

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

	const declaredKeys = new Set( Object.keys( config.state ?? {} ) );
	const declaredActions = new Set( [
		'mount',
		'set',
		'refresh',
		...( config.actions ?? [] ),
		...( config.lifecycle ?? [] ),
	] );
	const debugging = (): boolean => debugWindows.has( '*' ) || debugWindows.has( windowId );

	const auditTriggers = (): void => {
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

	const send = async ( action: string, args: Record< string, unknown >, trigger: Element | null ): Promise< boolean > => {
		if ( disposed ) {
			return false;
		}

		const startedAt = Date.now();
		inFlight++;
		root.setAttribute( 'aria-busy', 'true' );
		if ( trigger && trigger.tagName.toLowerCase() === 'os-button' ) {
			trigger.setAttribute( 'busy', '' );
		}

		const sentState = state;
		try {
			if ( action === 'mount' && view === 'main' && Object.keys( params ).length === 0 ) {
				const warmed = await takePrewarm( config.id );
				if ( disposed ) {
					return false;
				}
				if ( warmed ) {
					apply( warmed, sentState );
					return true;
				}
			}
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
				throw await restErrorFromResponse( response );
			}
			const payload = ( await response.json() ) as DispatchResponse;
			if ( disposed ) {
				return false;
			}
			if ( ! payload || payload.ok !== true ) {
				const failed = ( payload ?? {} ) as {
					message?: unknown;
					error?: unknown;
					status?: unknown;
				};
				const serverMessage = typeof failed.message === 'string' ? failed.message : '';
				let status = response.status;
				if ( typeof failed.status === 'number' ) {
					status = failed.status;
				} else if ( serverMessage ) {
					status = 500;
				}
				throw new RestError( '', {
					status,
					code: typeof failed.error === 'string' ? failed.error : undefined,
					serverMessage,
				} );
			}
			apply( payload, sentState );
			if ( debugging() ) {
				const changed = Object.keys( state ).filter( ( key ) => state[ key ] !== sentState[ key ] );

				console.groupCollapsed(
					`[openstation:${ config.id }] ${ action } · ${ Date.now() - startedAt }ms`,
				);

				console.log( 'args', args );

				console.log( 'state Δ', changed, changed.length > 0 ? Object.fromEntries( changed.map( ( key ) => [ key, state[ key ] ] ) ) : '' );

				console.log( 'effects', payload.effects ?? [] );

				console.groupEnd();
			}
			return true;
		} catch ( err ) {
			if ( disposed || signal?.aborted ) {
				return false;
			}
			if ( debugging() ) {
				console.warn(
					`[openstation:${ config.id }] ${ action } FAILED after ${ Date.now() - startedAt }ms:`,
					err,
				);
			}
			toastRestFailure( host.toast, err, {
				lead: __( 'The window could not update' ),
				fallback: __( 'The window could not update.' ),
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

		const run = chain.then( () => send( action, args, options.trigger ?? null ) );
		chain = run.catch( () => undefined );
		return run;
	};

	const finishRender = (): void => {
		applyProps( root, propsSeen );
		void ensureComponents();
		reconcilePolls();
		auditTriggers();
	};

	const apply = ( payload: DispatchResponse, sentState: Record< string, unknown >, placeholder = false ): void => {
		const next = { ...payload.state };
		for ( const key of Object.keys( state ) ) {
			if ( state[ key ] !== sentState[ key ] ) {
				next[ key ] = state[ key ];
			}
		}
		state = next;
		if ( client ) {
			data = payload.data;
			loading = placeholder;
			const first = clientTeardown === undefined;
			client.render( viewContext() );
			finishRender();

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

	let uiBag: unknown;
	const uiOf = < T >( factory: () => T ): T => {
		if ( uiBag === undefined ) {
			uiBag = factory();
		}
		return uiBag as T;
	};

	const repaint = (): void => {
		if ( ! client || disposed ) {
			return;
		}
		client.render( viewContext() );
		finishRender();
	};

	const restFetch = ( path: string, init: RequestInit = {}, options: { silent?: boolean } = {} ): Promise< Response > => {
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
			{ windowId, source: `openstation/app/${ config.id }`, ...options },
		);
	};

	const viewContext = () => ( {
		get state() {
			return state;
		},
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		root,
		windowId,
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

	const runLocal = ( action: string, args: Record< string, unknown > ): void => {
		if ( ! client || disposed ) {
			return;
		}
		if ( client.hasLocal( action ) ) {
			state = client.runLocal( action, state, args, data );
			auditStateKeys( `local action "${ action }"` );
			if ( debugging() ) {
				console.debug( `[openstation:${ config.id }] local ${ action }`, args );
			}
		}
		client.render( viewContext() );
		finishRender();
	};

	const requestedTags = new Set< string >();

	const ensureComponents = async (): Promise< void > => {
		if ( ! host.loadComponents ) {
			return;
		}
		const missing = new Set< string >();
		for ( const el of Array.from( root.querySelectorAll( '*' ) ) ) {
			const tag = el.tagName.toLowerCase();

			if ( ! tag.startsWith( 'os-' ) || customElements.get( tag ) || el.closest( '[os-preserve]' ) ) {
				continue;
			}
			if ( ! requestedTags.has( tag ) ) {
				missing.add( tag );
				requestedTags.add( tag );
			}
		}
		if ( missing.size > 0 ) {
			await host.loadComponents( Array.from( missing ) );

			applyProps( root, new WeakMap() );
		}
	};

	const performEffect = ( effect: Effect ): void => {
		switch ( effect.type ) {
			case 'toast': {
				const { message, toastType } = effect as { message: string; toastType?: unknown };
				host.toast?.(
					typeof toastType === 'string' && toastType
						? { message: String( message ), type: toastType }
						: { message: String( message ) },
				);
				return;
			}
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

	const ownSource = appAnnounceSource( windowId );
	const isOwnEcho = ( payload: unknown ): boolean =>
		!! payload && typeof payload === 'object' && ( payload as { source?: unknown } ).source === ownSource;
	if ( host.onBroadcast ) {
		for ( const type of config.watch ?? [] ) {
			if ( type === '*' ) {
				listeners.push( host.onBroadcast( '*', ( topic, payload ) => {
					if ( /^os\..+\.changed$/.test( topic ) && ! isOwnEcho( payload ) ) {
						refresh();
					}
				} ) );
				continue;
			}
			listeners.push( host.onBroadcast( `os.${ type }.changed`, ( _topic, payload ) => {
				if ( ! isOwnEcho( payload ) ) {
					refresh();
				}
			} ) );
		}
	}

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
			if ( ! client || disposed || clientTeardown !== undefined ) {
				return false;
			}

			const prefetched = config.data !== undefined;
			if ( ! prefetched && ! client.placeholder ) {
				return false;
			}
			const declared = { ...config.state };
			const payload = prefetched ? config.data : client.placeholder?.( declared );

			apply( { ok: true, state: declared, html: '', data: payload, effects: [] }, state, ! prefetched );
			return true;
		},
		setPaused( value: boolean ) {
			paused = value;
			if ( ! value && stale ) {
				stale = false;
				refresh();
			}
		},
		setParams( next ) {
			params = { ...next };
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
