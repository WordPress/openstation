/**
 * App Framework runtime — entry point.
 *
 * The one bundle every `.os.php` window shares. On load it finds
 * every app config the PHP host shipped (`wp.os.getWindowConfig()`
 * entries flagged `osApp: true`), publishes a render callback for
 * each on `window.openStationNativeWindows[ id ]`, and registers the
 * title-bar buttons and ⋯-menu rows the manifest declared. When a
 * window opens, the callback mounts a {@link Session} on each of its
 * mount roots (the body, plus one per declared tab): first dispatch
 * is `mount`, every `os-action` after that is a round trip that
 * morphs the returned markup into place.
 *
 * Also publishes `wp.os.apps` — `dispatch( windowId, action, args,
 * view? )` and `session( windowId, view? )` — so another bundle can
 * drive an app window without knowing its endpoint.
 *
 * @public
 */

import { openActionMenu } from '../selection/menu';
import type { NativeRenderContext } from '../types';
import type { Window as DesktopWindow } from '../window';
import {
	__,
	_n,
	_x,
	applySelection,
	clientAppFor,
	copyText,
	createMarquee,
	createPagedList,
	defineApp,
	formatBytes,
	formatDate,
	html,
	sprintf,
} from './client';
import { createSession, setSessionDebug, type Session } from './session';
import type { AppConfig, AppearanceDef, ControlDef, RuntimeHost } from './types';

const OWNER = 'openstation-app-runtime';
const RESIZE_DEBOUNCE_MS = 200;

type RenderCallback = (
	body: HTMLElement,
	ctx?: NativeRenderContext,
) => void | ( () => void ) | Promise< void | ( () => void ) >;

interface RuntimeGlobals {
	openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	openStationWindowConfig?: Record< string, unknown >;
}

/** windowId → view → session. */
const sessions = new Map< string, Map< string, Session > >();
const registeredApps = new Set< string >();

function os() {
	return window.wp?.os;
}

function sessionOf( windowId: string, view = 'main' ): Session | undefined {
	return sessions.get( windowId )?.get( view );
}

/** The shell surface the sessions use, built once from `wp.os`. */
function buildHost(): RuntimeHost {
	const api = os();
	return {
		fetch: ( input, init, opts ) => {
			if ( ! api ) {
				return Promise.reject( new Error( '[openstation] wp.os is not available.' ) );
			}
			return api.fetch( input, init, opts );
		},
		confirm: ( options ) => {
			if ( ! api?.confirm ) {
				return Promise.resolve( false );
			}
			return api.confirm( {
				title: options.title,
				message: options.message,
				confirmLabel: options.confirmLabel,
				danger: options.danger,
			} );
		},
		toast: ( options ) => {
			api?.showToast( { message: options.message } );
		},
		setTitle: ( windowId, title ) => {
			api?.windowManager.getById( windowId )?.setTitle( title );
		},
		closeWindow: ( windowId ) => {
			api?.windowManager.getById( windowId )?.close();
		},
		openWindow: ( id ) => {
			api?.openWindow( id );
		},
		openUrl: ( url, title, icon ) => {
			if ( ! api ) {
				return;
			}
			const id = api.deriveWindowId( url );
			void api.windowManager.open( {
				id,
				baseId: id,
				url,
				title: title || url,
				icon: icon || 'dashicons-admin-generic',
			} );
		},
		setBadge: ( appId, count ) => {
			// The desktop icon and the dock tile share the app id.
			api?.icons.setBadge( appId, count );
			api?.dock?.setBadge( appId, count );
		},
		setIcon: ( appId, art ) => {
			// Every rail that might host the tile exposes the same
			// `setArt( id, art )` shape and silently no-ops for ids it
			// doesn't own — fanning to all three is the canonical
			// pattern (see the recycle-bin icon-state module), not a
			// hack. The rails own paint state, including survival
			// across grid rebuilds.
			interface ArtRail {
				setArt?: ( id: string, value: string ) => void;
			}
			const rails = api as unknown as
				| { dock?: ArtRail; taskbar?: ArtRail; icons?: ArtRail }
				| undefined;
			rails?.dock?.setArt?.( appId, art );
			rails?.taskbar?.setArt?.( appId, art );
			rails?.icons?.setArt?.( appId, art );
		},
		announce: ( contentType, action, ids ) => {
			api?.announceContentChange(
				contentType,
				action as Parameters< typeof api.announceContentChange >[ 1 ],
				ids,
				OWNER,
			);
		},
		menu: ( position, items, pick ) => {
			openActionMenu( position, {
				scope: 'os-app',
				actions: items.map( ( item ) => ( {
					id: item.id,
					label: item.label,
					icon: item.icon || undefined,
					danger: item.danger,
					disabled: item.disabled,
					onClick: () => pick( item ),
				} ) ),
			} );
		},
		onBroadcast: ( topic, cb ) =>
			api?.subscribe( topic, ( _payload, meta ) => cb( meta.topic ) ) ?? ( () => undefined ),
		loadComponents: ( tags ) => api?.loadComponents( tags ) ?? Promise.resolve(),
		applyAppearance: ( windowId, appearance ) => applyAppearance( windowId, appearance ),
	};
}

function applyAppearance( windowId: string, appearance: AppearanceDef ): void {
	const api = os();
	if ( ! api ) {
		return;
	}
	if ( appearance.theme && Object.keys( appearance.theme ).length > 0 ) {
		api.applyWindowTheme( windowId, appearance.theme );
	}
	if ( appearance.controls && Object.keys( appearance.controls ).length > 0 ) {
		api.applyWindowControls(
			windowId,
			appearance.controls as Parameters< typeof api.applyWindowControls >[ 1 ],
		);
	}
	if ( appearance.slots ) {
		for ( const [ slot, config ] of Object.entries( appearance.slots ) ) {
			api.applyWindowSlot(
				windowId,
				slot as Parameters< typeof api.applyWindowSlot >[ 1 ],
				config,
			);
		}
	}
}

/** The window id a body element belongs to (`wp-window-<id>`). */
function windowIdOf( body: HTMLElement, fallback: string ): string {
	const root = body.closest< HTMLElement >( '[id^="wp-window-"]' );
	return root ? root.id.slice( 'wp-window-'.length ) : fallback;
}

function matchesApp( win: DesktopWindow, appId: string ): boolean {
	return win.id === appId || win.config.baseId === appId;
}

function dispatchControl( win: DesktopWindow, control: ControlDef ): void {
	void sessionOf( win.id )?.dispatch( control.action, control.args, { confirm: control.confirm } );
}

/** Title-bar buttons + ⋯ rows for one app, from its manifest. */
function registerChrome( config: AppConfig ): void {
	const api = os();
	if ( ! api ) {
		return;
	}
	for ( const button of config.titleBarButtons ?? [] ) {
		api.registerTitleBarButton( {
			id: `os-app/${ config.id }/${ button.id }`,
			label: button.label,
			icon: button.icon,
			placement: button.placement ?? 'right',
			order: button.order,
			match: ( win ) => matchesApp( win, config.id ),
			onClick: ( win ) => dispatchControl( win, button ),
			owner: OWNER,
		} );
	}
	for ( const row of config.windowActions ?? [] ) {
		api.registerWindowAction( {
			id: `os-app/${ config.id }/${ row.id }`,
			label: row.label,
			icon: row.icon,
			order: row.order,
			isVisible: ( win ) => matchesApp( win, config.id ),
			onSelect: ( win ) => dispatchControl( win, row ),
			owner: OWNER,
		} );
	}
}

/** The render callback the shell invokes when an app window opens. */
function buildRender( config: AppConfig ): RenderCallback {
	return async ( body, ctx ) => {
		const windowId = windowIdOf( body, config.id );
		const host = buildHost();
		const lifecycle = new Set( config.lifecycle ?? [] );
		const teardowns: Array< () => void > = [];

		host.applyAppearance?.( windowId, config.appearance ?? {} );

		// One session per mount root: the main body plus each tab panel.
		const roots = Array.from(
			body.querySelectorAll< HTMLElement >( `[data-os-app="${ config.id }"]` ),
		);
		if ( roots.length === 0 ) {
			roots.push( body );
		}
		// The `.os.ts` half, if the app shipped one: its bundle travels
		// with the window as a companion script, so it is in the tab by
		// now. Only the main body is client-rendered; tab panels stay
		// server views.
		const client = config.client ? clientAppFor( config.id ) : undefined;
		const byView = new Map< string, Session >();
		for ( const root of roots ) {
			const view = root.getAttribute( 'data-os-view' ) || 'main';
			const session = createSession( {
				root,
				config,
				windowId,
				host,
				view,
				params: ctx?.params ?? {},
				signal: ctx?.signal,
				client: view === 'main' ? client : undefined,
			} );
			byView.set( view, session );
		}
		sessions.set( windowId, byView );
		const each = ( fn: ( s: Session ) => void ): void => {
			byView.forEach( fn );
		};

		if ( ctx ) {
			teardowns.push( ctx.onHide( () => {
				each( ( s ) => s.setPaused( true ) );
				if ( lifecycle.has( 'hide' ) ) {
					each( ( s ) => void s.dispatch( 'hide' ) );
				}
			} ) );
			teardowns.push( ctx.onShow( () => {
				each( ( s ) => s.setPaused( false ) );
				if ( lifecycle.has( 'show' ) ) {
					each( ( s ) => void s.dispatch( 'show' ) );
				}
			} ) );
			if ( lifecycle.has( 'resize' ) ) {
				let timer: number | null = null;
				teardowns.push( ctx.onResize( ( width, height ) => {
					if ( timer !== null ) {
						window.clearTimeout( timer );
					}
					timer = window.setTimeout( () => {
						timer = null;
						each( ( s ) => void s.dispatch( 'resize', { width, height } ) );
					}, RESIZE_DEBOUNCE_MS );
				} ) );
			}
			for ( const [ channel, action ] of Object.entries( config.channels ?? {} ) ) {
				teardowns.push( ctx.window.on( channel, ( payload ) => {
					each( ( s ) => void s.dispatch( action, { payload } ) );
				} ) );
			}
			host.send = ( channel, payload ) => ctx.window.send( channel, payload );
		}
		const api = os();
		if ( api && ( lifecycle.has( 'focus' ) || lifecycle.has( 'blur' ) ) ) {
			teardowns.push( api.onWindow( windowId, {
				focused: lifecycle.has( 'focus' ) ? () => each( ( s ) => void s.dispatch( 'focus' ) ) : undefined,
				blurred: lifecycle.has( 'blur' ) ? () => each( ( s ) => void s.dispatch( 'blur' ) ) : undefined,
			} ) );
		}

		// The first render of every view. Awaited so the shell keeps its
		// loading overlay up until the body has real content.
		await Promise.all( Array.from( byView.values(), ( s ) => s.dispatch( 'mount' ) ) );

		return () => {
			for ( const off of teardowns ) {
				off();
			}
			each( ( s ) => s.dispose() );
			if ( sessions.get( windowId ) === byView ) {
				sessions.delete( windowId );
			}
		};
	};
}

/** Publish a render callback for every app config not yet seen. */
export function registerApps(): string[] {
	const globals = window as unknown as RuntimeGlobals;
	const configs = globals.openStationWindowConfig ?? {};
	const registry = globals.openStationNativeWindows ?? ( globals.openStationNativeWindows = {} );
	const added: string[] = [];
	for ( const [ id, raw ] of Object.entries( configs ) ) {
		const config = raw as Partial< AppConfig > | undefined;
		if ( ! config || config.osApp !== true || registeredApps.has( id ) ) {
			continue;
		}
		registeredApps.add( id );
		registry[ id ] = buildRender( config as AppConfig );
		registerChrome( config as AppConfig );
		added.push( id );
	}
	return added;
}

/**
 * The client-view API, published for scripts that cannot import
 * `@openstation/app` — a third-party plugin's client view, built (or
 * hand-written) outside this repo. Everything an in-repo `.os.ts`
 * imports, as one value.
 */
const CLIENT_API = {
	defineApp,
	html,
	__,
	_n,
	_x,
	sprintf,
	formatBytes,
	formatDate,
	createPagedList,
	applySelection,
	createMarquee,
	copyText,
} as const;

/** What a queued third-party client view receives. */
export type ClientApi = typeof CLIENT_API;

interface ClientApiGlobals {
	openStationAppsPending?:
		| Array< ( api: ClientApi ) => void >
		| { push: ( fn: ( api: ClientApi ) => void ) => void };
}

/**
 * Serve the client API to third-party client views, load order be
 * damned. A companion script loads BEFORE this runtime, so it cannot
 * read `wp.os.apps` at parse time; instead it queues:
 *
 *     ( window.openStationAppsPending ??= [] ).push( ( { defineApp, html } ) =>
 *         defineApp( 'my-window', { view: ( { state } ) => html`…` } ) );
 *
 * On load the runtime drains the queue, then replaces it with a
 * live object whose `push` runs immediately — the same snippet works
 * whether the script ran before or after the runtime.
 */
export function publishClientApi(): void {
	const globals = window as unknown as ClientApiGlobals;
	const run = ( fn: ( api: ClientApi ) => void ): void => {
		try {
			fn( CLIENT_API );
		} catch ( err ) {
			// Third-party code — contained, named, never fatal to the shell.
			// eslint-disable-next-line no-console
			console.error( '[openstation] a queued client view threw.', err );
		}
	};
	const queued = globals.openStationAppsPending;
	if ( Array.isArray( queued ) ) {
		queued.forEach( run );
	}
	globals.openStationAppsPending = { push: run };
}

publishClientApi();
registerApps();
// An app registered mid-session (a plugin activation) arrives with a
// payload refresh; pick its config up without a reload.
document.addEventListener( 'os-registry-changed', () => {
	registerApps();
} );

os()?.registerNamespace( 'apps', {
	...CLIENT_API,
	/** Log every dispatch of one window (or `'*'`) to the console. */
	debug: ( windowId = '*', on = true ) => setSessionDebug( windowId, on ),
	/** Run an action on a mounted app window (optionally on one tab). */
	dispatch: (
		windowId: string,
		action: string,
		args: Record< string, unknown > = {},
		view = 'main',
	) => sessionOf( windowId, view )?.dispatch( action, args ) ?? Promise.resolve( false ),
	/** Run a client-side action on a mounted app window; no request. */
	local: ( windowId: string, action: string, args: Record< string, unknown > = {} ) =>
		sessionOf( windowId )?.local( action, args ),
	/** The live session of a mounted app window (optionally one tab), if any. */
	session: ( windowId: string, view = 'main' ) => sessionOf( windowId, view ),
	/** Re-scan window configs for app definitions. */
	refresh: () => registerApps(),
} );
