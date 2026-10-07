import { join } from 'node:path';

import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	ipcMain,
	nativeImage,
	net,
	powerMonitor,
	shell,
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { Connection } from './lib/connection';
import { FreeWindows } from './lib/free-windows';
import { LocalAgent } from './lib/agent';
import { Store } from './lib/store';
import {
	CHANNELS,
	HOST_PROTOCOL_VERSION,
	osLabelFor,
} from './lib/protocol';
import type {
	FreeWindowRequest,
	HandshakeArgs,
	HostInfo,
} from './lib/protocol';
import type { FreeWindowHandle } from './lib/free-windows';
import {
	isLoopbackUrl,
	isSameSiteUrl,
	navigationVerdict,
	normalizeSiteUrl,
	settledSiteUrl,
	shellEntryUrl,
} from './lib/site-url';

const REST_NAMESPACE = 'openstation-electron/v1';

app.setName( 'OpenStation' );

const APP_VERSION: string = ( () => {
	try {

		return String( require( '../../package.json' ).version || '0.0.0' );
	} catch {
		return '0.0.0';
	}
} )();

let shellWindow: BrowserWindow | null = null;

let connectWindow: BrowserWindow | null = null;

let lastConnectError = '';

let store: Store;
let connection: Connection;
let freeWindows: FreeWindows;
let agent: LocalAgent;

const ICON_PATH = join( __dirname, 'renderer', 'openstation.png' );

function appIconOption(): { icon?: string } {
	return 'darwin' === process.platform ? {} : { icon: ICON_PATH };
}

function brandDock(): void {
	if ( 'darwin' !== process.platform || ! app.dock ) {
		return;
	}
	try {
		const image = nativeImage.createFromPath( ICON_PATH );
		if ( ! image.isEmpty() ) {
			app.dock.setIcon( image );
		}
	} catch ( err ) {

		console.error( '[openstation-desktop] could not set the dock icon:', err );
	}
}

function toShell( channel: string, payload: unknown ): void {
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.webContents.send( channel, payload );
	}
}

function openConnectWindow(): void {
	if ( connectWindow && ! connectWindow.isDestroyed() ) {
		connectWindow.focus();
		return;
	}
	connectWindow = new BrowserWindow( {
		width: 620,
		height: 620,
		resizable: false,
		title: 'Connect to your site',
		show: false,
		backgroundColor: '#0c0b0f',
		...appIconOption(),
		webPreferences: {
			preload: join( __dirname, 'preload', 'connect.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	} );
	connectWindow.once( 'ready-to-show', () => connectWindow?.show() );
	connectWindow.on( 'closed', () => {
		connectWindow = null;
	} );
	void connectWindow.loadFile( join( __dirname, 'renderer', 'connect.html' ) );
}

function openShellWindow(): void {
	const entry = shellEntryUrl( store.get( 'siteUrl' ) );
	if ( ! entry ) {
		openConnectWindow();
		return;
	}
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.focus();
		return;
	}

	const bounds = store.get( 'shellBounds' );
	shellWindow = new BrowserWindow( {
		width: bounds?.width ?? 1440,
		height: bounds?.height ?? 900,
		x: bounds?.x,
		y: bounds?.y,
		minWidth: 900,
		minHeight: 600,
		title: 'OpenStation',
		show: false,
		backgroundColor: '#0c0b0f',
		...appIconOption(),
		webPreferences: {
			preload: join( __dirname, 'preload', 'shell.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	} );

	shellWindow.on( 'page-title-updated', ( event ) => {
		event.preventDefault();
		shellWindow?.setTitle( 'OpenStation' );
	} );

	const remember = () => {
		if ( shellWindow && ! shellWindow.isDestroyed() && ! shellWindow.isMinimized() ) {
			store.set( 'shellBounds', shellWindow.getBounds() );
		}
	};
	shellWindow.on( 'resized', remember );
	shellWindow.on( 'moved', remember );
	shellWindow.on( 'focus', () => connection?.markActive() );
	shellWindow.once( 'ready-to-show', () => shellWindow?.show() );
	shellWindow.on( 'closed', () => {
		shellWindow = null;
	} );

	shellWindow.webContents.setWindowOpenHandler( ( { url, frameName } ) =>
		routeNewWindow( url, frameName ),
	);

	let settling = true;
	guardNavigation( shellWindow.webContents, () => settling );

	shellWindow.webContents.on( 'did-navigate', ( _event, url ) => {
		if ( settling ) {
			settling = false;

			const landed = settledSiteUrl( url, store.get( 'siteUrl' ) );
			if ( landed && landed !== store.get( 'siteUrl' ) ) {
				store.set( 'siteUrl', landed );
			}
		}

		if ( url.includes( '/wp-admin/' ) ) {
			void askWhereToOpen();
		}
	} );

	shellWindow.webContents.on(
		'did-fail-load',
		( _event, errorCode, errorDescription, _validatedURL, isMainFrame ) => {
			if ( ! isMainFrame || -3 === errorCode ) {
				return;
			}
			lastConnectError = `Could not reach ${ store.get( 'siteUrl' ) } — ${
				errorDescription || `error ${ errorCode }`
			}`;
			showConnectScreen();
		},
	);

	void shellWindow.loadURL( entry );
}

async function askWhereToOpen(): Promise< void > {
	if ( store.get( 'openIn' ) ) {
		return;
	}
	if ( ! shellWindow || shellWindow.isDestroyed() ) {
		return;
	}

	const { response, checkboxChecked } = await dialog.showMessageBox( shellWindow, {
		type: 'question',
		buttons: [ 'Open here', 'Use my browser' ],
		defaultId: 0,
		cancelId: 0,
		title: 'Where would you like to work?',
		message: 'Open OpenStation here, or in your browser?',
		detail:
			'Either way this app stays connected, so any window can be sent ' +
			'to your desktop as a real window — from here or from your browser.',
		checkboxLabel: 'Remember my choice',
		checkboxChecked: true,
	} );

	const choice = 0 === response ? 'app' : 'browser';
	if ( checkboxChecked ) {
		store.set( 'openIn', choice );
	}

	if ( 'browser' === choice ) {
		await openInBrowser();
	}
}

async function openInBrowser(): Promise< void > {
	const entry = shellEntryUrl( store.get( 'siteUrl' ) );
	if ( entry ) {
		await shell.openExternal( entry );
	}
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.hide();
	}
}

function showConnectScreen(): void {
	freeWindows?.reset();
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.destroy();
		shellWindow = null;
	}
	openConnectWindow();
}

function routeNewWindow(
	url: string,
	frameName?: string,
): { action: 'deny' } {
	if ( ! /^https?:/i.test( url ) ) {
		return { action: 'deny' };
	}

	const site = store?.get( 'siteUrl' ) ?? '';

	let wantsBrowser = false;
	try {
		wantsBrowser = '1' === new URL( url ).searchParams.get( 'desktop_mode_classic' );
	} catch {
		wantsBrowser = false;
	}

	if ( wantsBrowser || ! isSameSiteUrl( url, site ) ) {
		void shell.openExternal( url );
		return { action: 'deny' };
	}

	freeWindows?.free( {
		windowId: frameName || url,
		url,
		title: 'OpenStation',
	} );

	return { action: 'deny' };
}

function guardNavigation(
	contents: Electron.WebContents,
	allowAny: () => boolean = () => false,
): void {

	const onNavigate = (
		event: { preventDefault: () => void; isMainFrame?: boolean },
		url: string,
	): void => {
		if ( false === event.isMainFrame || allowAny() ) {
			return;
		}
		const verdict = navigationVerdict( url, store?.get( 'siteUrl' ) ?? '' );
		if ( 'allow' === verdict ) {
			return;
		}
		event.preventDefault();
		if ( 'external' === verdict ) {
			void shell.openExternal( url );
		}
	};

	contents.on( 'will-navigate', onNavigate as never );
	contents.on( 'will-redirect', onNavigate as never );
}

function createFreedWindow( opts: {
	windowId: string;
	url: string;
	title: string;
	width: number;
	height: number;
	x?: number;
	y?: number;
	minWidth: number;
	minHeight: number;
} ): FreeWindowHandle {
	const win = new BrowserWindow( {
		width: opts.width,
		height: opts.height,
		x: opts.x,
		y: opts.y,
		minWidth: opts.minWidth,
		minHeight: opts.minHeight,
		title: opts.title,
		show: false,
		backgroundColor: '#0c0b0f',

		titleBarStyle: 'default',
		webPreferences: {
			preload: join( __dirname, 'preload', 'free.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,

			spellcheck: true,
		},
	} );

	win.once( 'ready-to-show', () => win.show() );

	win.webContents.setWindowOpenHandler( ( { url, frameName } ) =>
		routeNewWindow( url, frameName ),
	);

	guardNavigation( win.webContents );

	win.webContents.on( 'did-finish-load', () => {
		win.webContents.send( CHANNELS.EVENT_FRAME_INIT, {
			windowId: opts.windowId,
		} );
	} );

	void win.loadURL( opts.url );

	return win as unknown as FreeWindowHandle;
}

function buildMenu(): void {
	const isMac = 'darwin' === process.platform;

	const appMenu: MenuItemConstructorOptions[] = isMac
		? [
			{
				label: app.name,
				submenu: [
					{ role: 'about' },
					{ type: 'separator' },
					{ role: 'services' },
					{ type: 'separator' },
					{ role: 'hide' },
					{ role: 'hideOthers' },
					{ role: 'unhide' },
					{ type: 'separator' },
					{ role: 'quit' },
				],
			},
		]
		: [];

	const quitItems: MenuItemConstructorOptions[] = isMac
		? []
		: [ { type: 'separator' }, { role: 'quit' } ];

	const template: MenuItemConstructorOptions[] = [
		...appMenu,
		{
			label: 'Station',
			submenu: [
				{
					label: 'Open OpenStation',
					accelerator: 'CmdOrCtrl+Shift+O',
					click: () => openShellWindow(),
				},
				{
					label: 'Reload',
					accelerator: 'CmdOrCtrl+R',
					click: () => BrowserWindow.getFocusedWindow()?.webContents.reload(),
				},
				{ type: 'separator' },
				{
					label: 'Dock every freed window',
					click: () => {
						for ( const id of freeWindows?.list() ?? [] ) {
							freeWindows.dock( id );
						}
					},
				},
				{
					label: 'Open in my browser',
					click: () => void openInBrowser(),
				},
				{
					label: 'Ask where to open next time',
					click: () => store.set( 'openIn', '' ),
				},
				{ type: 'separator' },
				{
					label: 'Connect to a different site…',
					click: () => {
						store.set( 'siteUrl', '' );
						showConnectScreen();
					},
				},
				...quitItems,
			],
		},
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
				{ role: 'toggleDevTools' },
			],
		},
		{ role: 'windowMenu' },
	];
	Menu.setApplicationMenu( Menu.buildFromTemplate( template ) );
}

function registerIpc(): void {
	ipcMain.handle(
		CHANNELS.INVOKE_HOST_INFO,
		(): HostInfo => ( {
			isDesktopHost: true,
			protocol: HOST_PROTOCOL_VERSION,
			platform: process.platform,
			osLabel: osLabelFor( process.platform ),
			appVersion: APP_VERSION,
			electronVersion: process.versions.electron,
			hostId: store.hostId(),
			freedWindows: freeWindows?.list() ?? [],
		} ),
	);

	ipcMain.handle(
		CHANNELS.INVOKE_FREE_WINDOW,
		( _event, req: FreeWindowRequest ) => {
			connection?.markActive();
			const result = freeWindows.free( req || {} );
			connection?.setHasFreedWindows( freeWindows.any() );
			return result;
		},
	);

	ipcMain.handle(
		CHANNELS.INVOKE_DOCK_WINDOW,
		( _event, req: { windowId?: string } ) => ( {
			ok: !! freeWindows?.dock( req?.windowId ?? '' ),
		} ),
	);

	ipcMain.handle(
		CHANNELS.INVOKE_FOCUS_WINDOW,
		( _event, req: { windowId?: string } ) => ( {
			ok: !! freeWindows?.focus( req?.windowId ?? '' ),
		} ),
	);

	ipcMain.handle( CHANNELS.INVOKE_LIST_WINDOWS, () => ( {
		windowIds: freeWindows?.list() ?? [],
	} ) );

	ipcMain.handle(
		CHANNELS.INVOKE_OPEN_WINDOW,
		( _event, req: FreeWindowRequest ) => {
			connection?.markActive();
			const result = freeWindows.free( req || {} );
			connection?.setHasFreedWindows( freeWindows.any() );
			return result;
		},
	);

	ipcMain.handle( CHANNELS.INVOKE_HANDSHAKE, ( _event, args: HandshakeArgs ) =>
		connection.handshake( args || { restUrl: '', nonce: '' } ),
	);

	ipcMain.handle( CHANNELS.INVOKE_CONNECTION, () => connection.getState() );

	ipcMain.handle( CHANNELS.INVOKE_DISCONNECT, async () => {
		await connection.farewell();
		store.set( 'siteUrl', '' );
		showConnectScreen();
		return { ok: true };
	} );

	ipcMain.handle(
		CHANNELS.INVOKE_CONNECT_SITE,
		( _event, args: { siteUrl?: string } ) => {
			const site = normalizeSiteUrl( args?.siteUrl ?? '' );
			if ( ! site ) {
				return { ok: false, error: 'That does not look like a site address.' };
			}
			lastConnectError = '';
			store.set( 'siteUrl', site );
			openShellWindow();

			const closing = connectWindow;
			connectWindow = null;
			setImmediate( () => {
				if ( closing && ! closing.isDestroyed() ) {
					closing.destroy();
				}
			} );

			return { ok: true, siteUrl: site };
		},
	);

	ipcMain.handle( CHANNELS.INVOKE_CONNECT_STATE, () => {
		const error = lastConnectError;

		lastConnectError = '';
		return {
			siteUrl: store.get( 'siteUrl' ),
			appVersion: APP_VERSION,
			osLabel: osLabelFor( process.platform ),
			error,
		};
	} );
}

void app.whenReady().then( () => {

	app.setAboutPanelOptions( {
		applicationName: 'OpenStation',
		applicationVersion: APP_VERSION,
		version: process.versions.electron,
		copyright: 'GPL-2.0-or-later',
	} );
	brandDock();

	store = new Store( app.getPath( 'userData' ) );

	connection = new Connection( {

		fetch: async ( url, init ) => {
			const response = await net.fetch( url, init as RequestInit );
			return {
				ok: response.ok,
				status: response.status,
				json: () => response.json(),
			};
		},
		namespace: REST_NAMESPACE,
		siteUrl: () => store.get( 'siteUrl' ),
		hostId: () => store.hostId(),
		describe: () => ( {
			protocol: HOST_PROTOCOL_VERSION,
			platform: process.platform,
			arch: process.arch,
			appVersion: APP_VERSION,
			electronVersion: process.versions.electron,

			agentUrl: agent?.url ?? '',
			agentToken: agent?.url ? store.agentToken() : '',
		} ),
		onChange: ( state ) => toShell( CHANNELS.EVENT_CONNECTION, state ),
	} );

	powerMonitor.on( 'suspend', () => connection.stopTimer() );
	powerMonitor.on( 'resume', () => connection.resume() );

	freeWindows = new FreeWindows( {
		createWindow: createFreedWindow,
		getBounds: ( id ) => store.freedBounds( id ),
		saveBounds: ( id, bounds ) => store.setFreedBounds( id, bounds ),
		isAllowedUrl: ( url ) => isSameSiteUrl( url, store.get( 'siteUrl' ) ),
		onDocked: ( windowId ) => {
			toShell( CHANNELS.EVENT_WINDOW_DOCKED, { windowId } );
			connection.setHasFreedWindows( freeWindows.any() );
		},
		onFreed: ( windowId ) => {
			toShell( CHANNELS.EVENT_WINDOW_FREED, { windowId } );
		},
		onActivity: () => connection.markActive(),
	} );

	agent = new LocalAgent( {
		token: store.agentToken(),
		allowedOrigin: () => {
			const site = store.get( 'siteUrl' );
			try {
				return site ? new URL( site ).origin : '';
			} catch {
				return '';
			}
		},
		free: ( req ) => {
			connection?.markActive();
			const result = freeWindows.free( req );
			connection?.setHasFreedWindows( freeWindows.any() );
			return result;
		},
		dock: ( windowId ) => freeWindows.dock( windowId ),
		focus: ( windowId ) => freeWindows.focus( windowId ),
		list: () => freeWindows.list(),
		describe: () => ( {
			app: 'OpenStation Desktop',
			appVersion: APP_VERSION,
			protocol: HOST_PROTOCOL_VERSION,
			platform: process.platform,
			osLabel: osLabelFor( process.platform ),
			hostId: store.hostId(),
		} ),
		onActivity: () => connection?.markActive(),
	} );

	void agent.start().then( ( port ) => {
		if ( ! port ) {
			console.error(
				'[openstation-desktop] local agent could not start; browser tabs will not be able to free windows.',
			);
		}
	} );

	registerIpc();
	buildMenu();
	openShellWindow();

	app.on( 'activate', () => {
		if ( 0 === BrowserWindow.getAllWindows().length ) {
			openShellWindow();
		}
	} );
} );

app.on( 'window-all-closed', () => {

	if ( 'darwin' !== process.platform ) {
		app.quit();
	}
} );

app.on( 'before-quit', () => {
	freeWindows?.closeAll();
	agent?.stop();

	void connection?.farewell();
} );

app.on( 'certificate-error', ( event, _webContents, url, error, _cert, callback ) => {
	const site = store?.get( 'siteUrl' ) ?? '';

	const isConfiguredSite = isSameSiteUrl( url, site );

	const isLocalDevelopment = isLoopbackUrl( url ) && isLoopbackUrl( site );
	if ( ! isConfiguredSite && ! isLocalDevelopment ) {
		callback( false );
		return;
	}
	event.preventDefault();
	const response = dialog.showMessageBoxSync( {
		type: 'warning',
		buttons: [ 'Cancel', 'Continue anyway' ],
		defaultId: 0,
		cancelId: 0,
		title: 'Certificate problem',
		message: `The certificate for ${ url } could not be verified.`,
		detail: String( error ),
	} );
	callback( 1 === response );
} );
