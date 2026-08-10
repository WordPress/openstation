/**
 * OpenStation Desktop — Electron main process.
 *
 * ## What this app is (and is not)
 *
 * It is a **host**, not a port. OpenStation stays exactly what it is: a
 * WordPress plugin that renders wp-admin as a desktop, served over
 * HTTP, working in any browser. This app loads that same URL and adds
 * the one thing a browser tab cannot give it — real OS windows.
 *
 * Nothing in OpenStation core is rebuilt for Electron. The shell
 * detects the host through a single injected global (see
 * `preload/shell.ts`), and when that global is absent every code path
 * stays exactly as it was in the browser. One capability probe,
 * additive behaviour behind it.
 *
 * ## This file is wiring only
 *
 * Every decision worth testing lives in `lib/`: pacing in
 * `schedule.ts`, the connection state machine in `connection.ts`,
 * bookkeeping in `free-windows.ts`, URL rules in `site-url.ts`. What
 * is left here is Electron itself — creating windows, routing IPC,
 * building a menu — which is exactly the part that needs a compositor
 * to observe and therefore the part worth keeping thin.
 */

import { join } from 'node:path';

import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	ipcMain,
	net,
	powerMonitor,
	shell,
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { Connection } from './lib/connection';
import { FreeWindows } from './lib/free-windows';
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
import { isSameSiteUrl, normalizeSiteUrl, shellEntryUrl } from './lib/site-url';

/** REST namespace the adapter plugin registers. */
const REST_NAMESPACE = 'openstation-electron/v1';

/** Read from `package.json` at runtime so there is one version to bump. */
const APP_VERSION: string = ( () => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return String( require( '../../package.json' ).version || '0.0.0' );
	} catch {
		return '0.0.0';
	}
} )();

/** The OpenStation desktop window. */
let shellWindow: BrowserWindow | null = null;

/**
 * The first-run "which site?" window.
 *
 * A separate `BrowserWindow` rather than a page loaded into the shell
 * window, on purpose. The connect screen needs an IPC channel that can
 * re-point the whole app at a different host, and preloads are
 * per-window — keeping it separate means that channel is never exposed
 * to the WordPress page. A compromised admin screen can ask the host to
 * open a window; it cannot ask it to go somewhere else.
 */
let connectWindow: BrowserWindow | null = null;

/**
 * Why the last connection attempt failed, shown on the connect screen.
 *
 * A site can be unreachable for reasons the address itself cannot
 * reveal — the server is down, the host is wrong, WordPress is behind a
 * VPN. Without this the app would sit on a blank shell window with no
 * way back, which is a worse dead end than a wrong address.
 */
let lastConnectError = '';

let store: Store;
let connection: Connection;
let freeWindows: FreeWindows;

/**
 * The app icon, as a spreadable option bag.
 *
 * macOS reads the icon from the app bundle, so a window-level one does
 * nothing there; Windows and Linux want an explicit path or the window
 * wears Electron's default. Returned as `{}` rather than
 * `{ icon: undefined }` because Electron warns on the latter — passing
 * the key at all is a claim that there is an icon.
 */
function appIconOption(): { icon?: string } {
	return 'darwin' === process.platform
		? {}
		: { icon: join( __dirname, 'renderer', 'openstation-256.png' ) };
}

/**
 * Broadcast to the shell renderer, if it is alive.
 *
 * @param channel Channel name.
 * @param payload Serializable payload.
 */
function toShell( channel: string, payload: unknown ): void {
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.webContents.send( channel, payload );
	}
}

/** Create (or focus) the first-run connect window. */
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

/** Create (or focus) the main OpenStation window. */
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

	// Anything the desktop opens "in a browser tab" really should go to
	// the browser — that menu item exists precisely to leave OpenStation.
	shellWindow.webContents.setWindowOpenHandler( ( { url } ) => {
		if ( /^https?:/i.test( url ) ) {
			void shell.openExternal( url );
		}
		return { action: 'deny' };
	} );

	// A site that will not load leaves the user staring at a blank
	// window with no way back — the worst possible outcome of a typo.
	// Send them to the connect screen with the reason instead.
	//
	// Only the main frame's own load counts: a failed image or an
	// aborted subresource inside a working admin page is not a reason
	// to tear the session down. `-3` is ERR_ABORTED, which Chromium
	// reports for ordinary interrupted navigations (the user clicking
	// again mid-load) and is not a failure either.
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

/**
 * Forget the current site and go back to the connect screen. Freed
 * windows go with it — they belong to the site being left.
 */
function showConnectScreen(): void {
	freeWindows?.reset();
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.destroy();
		shellWindow = null;
	}
	openConnectWindow();
}

/**
 * Build one freed window. The registry decides *whether* and *where*;
 * this decides what an Electron window for it looks like.
 *
 * @param opts           Geometry + identity from the registry.
 * @param opts.windowId
 * @param opts.url
 * @param opts.title
 * @param opts.width
 * @param opts.height
 * @param opts.x
 * @param opts.y
 * @param opts.minWidth
 * @param opts.minHeight
 * @return The window handle the registry tracks.
 */
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
		// A freed window is a real OS window — it wears the OS frame
		// rather than OpenStation's own title bar. On macOS the
		// hidden-inset style keeps the traffic lights without spending
		// a full title bar on a page that already has a heading.
		titleBarStyle: 'darwin' === process.platform ? 'hiddenInset' : 'default',
		trafficLightPosition:
			'darwin' === process.platform ? { x: 14, y: 14 } : undefined,
		webPreferences: {
			preload: join( __dirname, 'preload', 'free.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			// Freed windows share the default session with the shell —
			// same cookies, same login, no second sign-in.
			spellcheck: true,
		},
	} );

	win.once( 'ready-to-show', () => win.show() );

	// Anything the page tries to open in a new window goes to the
	// user's browser. A freed window is a single screen, not a second
	// desktop that starts sprouting windows of its own.
	win.webContents.setWindowOpenHandler( ( { url } ) => {
		if ( /^https?:/i.test( url ) ) {
			void shell.openExternal( url );
		}
		return { action: 'deny' };
	} );

	win.webContents.on( 'did-finish-load', () => {
		win.webContents.send( CHANNELS.EVENT_FRAME_INIT, {
			windowId: opts.windowId,
		} );
	} );

	void win.loadURL( opts.url );

	return win as unknown as FreeWindowHandle;
}

/** Application menu — thin, but the OS expects one. */
function buildMenu(): void {
	const isMac = 'darwin' === process.platform;

	// macOS puts the app menu first and never puts Quit anywhere else;
	// every other platform has no app menu and expects Quit at the
	// bottom of the first one. Built as named pieces rather than
	// inline spreads so the template below stays readable.
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

/** Wire every IPC channel the preloads call. */
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

	// The connect screen (a local page with its own preload, never the
	// WordPress shell) asks the main process to remember a site.
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

			// Closed on the next tick, not here: destroying the window
			// mid-handler kills the renderer before Electron can deliver
			// this reply, so the caller's `await` never settles and the
			// button sits on "Connecting…" forever.
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
		// Read once. A stale failure shown on a later visit to this
		// screen would describe a site the user is no longer trying.
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
	store = new Store( app.getPath( 'userData' ) );

	connection = new Connection( {
		// `net.fetch` rather than the global: it goes through Chromium's
		// network stack, so the shell's session cookies ride along and
		// the heartbeat is authenticated without this process ever
		// handling a credential.
		fetch: async ( url, init ) => {
			const response = await net.fetch( url, init as RequestInit );
			return {
				ok: response.ok,
				status: response.status,
				json: () => response.json(),
			};
		},
		namespace: REST_NAMESPACE,
		hostId: () => store.hostId(),
		describe: () => ( {
			protocol: HOST_PROTOCOL_VERSION,
			platform: process.platform,
			arch: process.arch,
			appVersion: APP_VERSION,
			electronVersion: process.versions.electron,
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
	// macOS keeps the app running with no windows; everywhere else the
	// last window closing means "I'm done".
	if ( 'darwin' !== process.platform ) {
		app.quit();
	}
} );

app.on( 'before-quit', () => {
	freeWindows?.closeAll();
	// Best-effort and deliberately not awaited — see `farewell()`.
	void connection?.farewell();
} );

/**
 * A certificate error on a site the user explicitly typed in is worth
 * asking about rather than silently failing: self-signed certificates
 * are normal in local development, which is where this app gets used
 * most. Anywhere else, refuse without a prompt — a dialog that appears
 * for an origin the user did not choose is a phishing surface.
 */
app.on( 'certificate-error', ( event, _webContents, url, error, _cert, callback ) => {
	const site = store?.get( 'siteUrl' ) ?? '';
	const isConfiguredSite = !! site && url.startsWith( site );
	const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test( url );
	if ( ! isConfiguredSite && ! isLocal ) {
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
