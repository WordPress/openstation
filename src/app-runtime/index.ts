import { tryNativeUrlRemap } from '../native-url-remap';
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
	createListTableSync,
	createMarquee,
	createPagedList,
	defineApp,
	formatBytes,
	formatDate,
	html,
	mountMenuCheckboxes,
	pager,
	sprintf,
	statusControl,
} from './client';
import { startPrewarm } from './prewarm';
import { createSession, setSessionDebug, type Session } from './session';
import { appAnnounceSource, type AppConfig, type AppearanceDef, type ControlDef, type RuntimeHost } from './types';

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

const sessions = new Map< string, Map< string, Session > >();
const registeredApps = new Set< string >();

function os() {
	return window.wp?.os;
}

function sessionOf( windowId: string, view = 'main' ): Session | undefined {
	return sessions.get( windowId )?.get( view );
}

export function buildHost( ownerWindowId: string ): RuntimeHost {
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
			const toast: { message: string; duration?: number; type?: string } = {
				message: options.message,
			};
			if ( options.duration ) {
				toast.duration = options.duration;
			}
			if ( options.type ) {
				toast.type = options.type;
			}
			api?.showToast( toast );
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

			if ( tryNativeUrlRemap( url ) ) {
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
			api?.icons.setBadge( appId, count );
			api?.dock?.setBadge( appId, count );
		},
		setIcon: ( appId, art ) => {
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
				appAnnounceSource( ownerWindowId ),
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
		refreshMenu: () => {
			try {
				void api?.refreshMenu?.();
			} catch {

			}
		},
		onBroadcast: ( topic, cb ) =>
			api?.subscribe( topic, ( payload, meta ) => cb( meta.topic, payload ) ) ?? ( () => undefined ),
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

export function createFocusGate(): { focus: () => boolean; blur: () => boolean } {
	let focused = true;
	return {
		focus: () => {
			if ( focused ) {
				return false;
			}
			focused = true;
			return true;
		},
		blur: () => {
			if ( ! focused ) {
				return false;
			}
			focused = false;
			return true;
		},
	};
}

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

function buildRender( config: AppConfig ): RenderCallback {
	return async ( body, ctx ) => {
		const windowId = windowIdOf( body, config.id );
		const host = buildHost( windowId );
		const lifecycle = new Set( config.lifecycle ?? [] );
		const teardowns: Array< () => void > = [];

		host.applyAppearance?.( windowId, config.appearance ?? {} );

		const roots = Array.from(
			body.querySelectorAll< HTMLElement >( `[data-os-app="${ config.id }"]` ),
		);
		if ( roots.length === 0 ) {
			roots.push( body );
		}

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

		const onReopened = ( ev: Event ): void => {
			const detail = ( ev as CustomEvent< {
				windowId?: string;
				params?: Record< string, string | number | boolean >;
			} > ).detail;
			if ( ! detail || detail.windowId !== windowId ) {
				return;
			}
			const next = detail.params ?? {};
			each( ( s ) => s.setParams( next ) );
			if ( lifecycle.has( 'reopen' ) ) {
				each( ( s ) => void s.dispatch( 'reopen', { params: next } ) );
			}
		};
		document.addEventListener( 'os-window-reopened', onReopened );
		teardowns.push( () => document.removeEventListener( 'os-window-reopened', onReopened ) );

		const api = os();
		if ( api && ( lifecycle.has( 'focus' ) || lifecycle.has( 'blur' ) ) ) {
			const gate = createFocusGate();
			teardowns.push( api.onWindow( windowId, {
				focused: () => {
					if ( gate.focus() && lifecycle.has( 'focus' ) ) {
						each( ( s ) => void s.dispatch( 'focus' ) );
					}
				},
				blurred: () => {
					if ( gate.blur() && lifecycle.has( 'blur' ) ) {
						each( ( s ) => void s.dispatch( 'blur' ) );
					}
				},
			} ) );
		}

		const mounts = Array.from( byView.values(), ( s ) => s.dispatch( 'mount' ) );
		const eager =
			Object.keys( ctx?.params ?? {} ).length === 0 && byView.get( 'main' )?.paintEagerly() === true;
		if ( ! eager ) {
			await Promise.all( mounts );
		}

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
	statusControl,
	pager,
	mountMenuCheckboxes,
	createListTableSync,
} as const;

export type ClientApi = typeof CLIENT_API;

interface ClientApiGlobals {
	openStationAppsPending?:
		| Array< ( api: ClientApi ) => void >
		| { push: ( fn: ( api: ClientApi ) => void ) => void };
}

export function publishClientApi(): void {
	const globals = window as unknown as ClientApiGlobals;
	const run = ( fn: ( api: ClientApi ) => void ): void => {
		try {
			fn( CLIENT_API );
		} catch ( err ) {
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

document.addEventListener( 'os-registry-changed', () => {
	registerApps();
} );

os()?.registerNamespace( 'apps', {
	...CLIENT_API,

	debug: ( windowId = '*', on = true ) => setSessionDebug( windowId, on ),

	dispatch: (
		windowId: string,
		action: string,
		args: Record< string, unknown > = {},
		view = 'main',
	) => sessionOf( windowId, view )?.dispatch( action, args ) ?? Promise.resolve( false ),

	local: ( windowId: string, action: string, args: Record< string, unknown > = {} ) =>
		sessionOf( windowId )?.local( action, args ),

	session: ( windowId: string, view = 'main' ) => sessionOf( windowId, view ),

	refresh: () => registerApps(),

	prewarm: ( id: string ) => {
		const config = ( window as unknown as RuntimeGlobals ).openStationWindowConfig?.[ id ] as
			| Partial< AppConfig >
			| undefined;
		if ( ! config || config.osApp !== true || sessions.has( id ) ) {
			return false;
		}
		return startPrewarm( config as AppConfig, buildHost( id ).fetch );
	},
} );
