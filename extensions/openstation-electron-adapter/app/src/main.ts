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

/** REST namespace the adapter plugin registers. */
const REST_NAMESPACE = 'openstation-electron/v1';

/**
 * What the operating system calls this app.
 *
 * Set here, at module scope, rather than left to `package.json` alone.
 * The npm package is named `openstation-electron-adapter` because that
 * is what the *extension* is, and unpackaged Electron falls back to
 * that name — so the macOS menu bar, the dock tooltip and the About
 * panel all read "openstation-electron-adapter" in development. The
 * user did not install an adapter; they installed OpenStation.
 *
 * It must run before `app.getPath( 'userData' )`, which derives its
 * directory from the name — hence module scope rather than inside
 * `whenReady`. One consequence worth knowing: this moves the state
 * file to an `OpenStation` folder, so a site address entered under the
 * old name is forgotten once.
 */
app.setName( 'OpenStation' );

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
let agent: LocalAgent;

/**
 * The 1024px brand mark, used for the Dock and for window icons.
 *
 * Lives inside `app/` rather than in `build/` so a packaged app can
 * find it too: electron-builder treats `build/` as packaging resources
 * and leaves it out of the bundle. `build/icon.icns` is for the
 * packager; this one is for the running process.
 */
const ICON_PATH = join( __dirname, 'renderer', 'openstation.png' );

/**
 * The app icon, as a spreadable option bag.
 *
 * macOS reads window icons from the app bundle, so a window-level one
 * does nothing there; Windows and Linux want an explicit path or the
 * window wears Electron's default. Returned as `{}` rather than
 * `{ icon: undefined }` because Electron warns on the latter — passing
 * the key at all is a claim that there is an icon.
 */
function appIconOption(): { icon?: string } {
	return 'darwin' === process.platform ? {} : { icon: ICON_PATH };
}

/**
 * Put the brand mark in the macOS Dock.
 *
 * A packaged build takes its Dock icon from the app bundle and needs
 * none of this. Development runs Electron's own bundle, so without it
 * the Dock shows Electron's atom while the app calls itself
 * OpenStation. `scripts/brand-dev-bundle.mjs` fixes the bundle's name
 * and icon for the same reason; this covers the running process.
 */
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
		// Cosmetic. An app that refuses to start over its own icon
		// would be a worse bug than the wrong icon.
		console.error( '[openstation-desktop] could not set the dock icon:', err );
	}
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

	// The desk is called OpenStation, whatever page happens to be loaded
	// under it. Electron's default is to adopt `document.title`, so the
	// window that holds the whole desktop was announcing itself to
	// Mission Control and the app switcher as `Plugins ‹ Site —
	// WordPress` — the tab title of one screen inside one of its
	// windows. Freed windows already refuse that (see `FreeWindows`);
	// this is the same refusal for the same reason, and the native-
	// window case there is the exact parallel: the page title belongs to
	// the page, not to the window hosting it.
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

	// Same routing as a freed window: a page asking for a new window
	// gets a real one, unless it asked for the browser by name. See
	// `routeNewWindow()`.
	shellWindow.webContents.setWindowOpenHandler( ( { url, frameName } ) =>
		routeNewWindow( url, frameName ),
	);

	// The address the user typed is a guess at where their site lives;
	// the server has the final word. `example.com` answering with a
	// redirect to `www.example.com` is ordinary canonicalization, and a
	// guard that refused it would break the connection outright — so the
	// first navigation chain runs unchecked and whatever it settles on
	// becomes the site. Every navigation after that is held to it.
	let settling = true;
	guardNavigation( shellWindow.webContents, () => settling );

	shellWindow.webContents.on( 'did-navigate', ( _event, url ) => {
		if ( settling ) {
			settling = false;
			// Only canonicalization is adopted — see `settledSiteUrl()`.
			// What settles here becomes the agent's allowed origin and
			// the navigation allowlist, so a chain that wandered off the
			// name the user typed leaves the configured site standing.
			const landed = settledSiteUrl( url, store.get( 'siteUrl' ) );
			if ( landed && landed !== store.get( 'siteUrl' ) ) {
				store.set( 'siteUrl', landed );
			}
		}

		// Once the user is actually signed in and looking at the desktop,
		// ask where they want to work. See `askWhereToOpen()`.
		if ( url.includes( '/wp-admin/' ) ) {
			void askWhereToOpen();
		}
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
 * Ask where the user wants to work, once — the first time they reach
 * the desktop signed in.
 *
 * Both answers connect. That is the point of asking rather than
 * assuming: the app is not only a place to view OpenStation, it is the
 * thing that can hand any window to the operating system, and it can
 * do that for a browser tab just as well as for its own. Someone who
 * lives in Chrome should not have to abandon Chrome to get native
 * windows — they should get a machine that can make them.
 *
 * So "Use my browser" is not a decline. It opens the site in the
 * default browser and keeps this process running as the local agent,
 * which is what that browser tab will call when the user picks "Send
 * to your Mac".
 *
 * Asked once per installation and remembered; the Station menu has an
 * item to change it.
 */
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

/**
 * Hand the session to the user's default browser and step back.
 *
 * The window is hidden rather than closed: closing it on Windows and
 * Linux would quit the app through `window-all-closed`, taking the
 * local agent with it — and the agent is exactly what the browser tab
 * they just opened is about to need.
 */
async function openInBrowser(): Promise< void > {
	const entry = shellEntryUrl( store.get( 'siteUrl' ) );
	if ( entry ) {
		await shell.openExternal( entry );
	}
	if ( shellWindow && ! shellWindow.isDestroyed() ) {
		shellWindow.hide();
	}
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
 * Decide what a `window.open()` from inside the app should do.
 *
 * Under a desktop host, "open a new window" should mean a new window
 * *of the desktop* — that is the whole proposition. So a page asking
 * for one gets a real one, not a browser tab.
 *
 * Two deliberate exceptions:
 *
 *   - **Off-site URLs** go to the browser. A link to some other site is
 *     not an OpenStation window and has no business becoming one.
 *   - **`desktop_mode_classic=1`** goes to the browser too, because
 *     that flag is the ⋯ menu's "Open in browser tab" saying so in as
 *     many words. Opening it here would refuse the one request the user
 *     made explicitly.
 *
 * @param url       Requested URL.
 * @param frameName `window.open()`'s name argument, used as the window id.
 * @return An Electron window-open handler verdict.
 */
function routeNewWindow(
	url: string,
	frameName?: string,
): { action: 'deny' } {
	if ( ! /^https?:/i.test( url ) ) {
		return { action: 'deny' };
	}

	const site = store?.get( 'siteUrl' ) ?? '';

	// Read as a query parameter, not as a substring of the whole URL.
	// A post slug, a fragment or an unrelated parameter that merely
	// contained the text would otherwise be routed to the browser —
	// the one thing this flag exists to request explicitly.
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

	// Same site, no explicit browser request: a window of the desktop.
	// `frameName` is whatever the opener named the window; falling back
	// to the URL keeps two different pages from colliding on one id.
	freeWindows?.free( {
		windowId: frameName || url,
		url,
		title: 'OpenStation',
	} );
	// Denied either way — Electron's own popup is never what we want;
	// the registry has already opened a window we control.
	return { action: 'deny' };
}

/**
 * Refuse to let a window we own navigate off the connected site.
 *
 * `setWindowOpenHandler` covers `window.open()` and nothing else. An
 * ordinary same-tab navigation — an un-`target`ed link, a
 * `location.href =`, a meta refresh, a 302 — is a different code path,
 * and without this it was not checked at all.
 *
 * That gap mattered because a preload survives navigation: the window
 * keeps whatever `contextBridge` exposed to it no matter which origin
 * the document now comes from. So a single link out of the site handed
 * `window.openStationDesktopHost` — the host bridge, `handshake()`
 * included — to a page nobody paired with. A window of the desktop
 * shows the site it belongs to; anything else belongs in the browser,
 * which is where this sends it.
 *
 * @param contents The window's `webContents`.
 * @param allowAny Predicate; return true to let a navigation through
 *                 unchecked. Used only while the shell settles its
 *                 first load — see `openShellWindow()`.
 */
function guardNavigation(
	contents: Electron.WebContents,
	allowAny: () => boolean = () => false,
): void {
	// Electron ≥25 passes an event object carrying `isMainFrame`; older
	// signatures pass a bare event and fire for the main frame only.
	// Reading it defensively means the check behaves the same either way
	// — and it must stay main-frame-only, because preloads do not run in
	// sub-frames and a cross-origin iframe is not a bridge holder.
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
		// The real OS title bar, carrying the window's OpenStation name.
		//
		// An earlier version used macOS's `hiddenInset` style to save
		// the vertical space, which left only floating traffic lights
		// over the content — the window had no name anywhere the OS
		// could show it, so Mission Control and the app switcher listed
		// an anonymous rectangle. The point of setting a window free is
		// that it becomes a window *of the desktop*, and a window of
		// the desktop has a name in the title bar like every other one.
		titleBarStyle: 'default',
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

	win.webContents.setWindowOpenHandler( ( { url, frameName } ) =>
		routeNewWindow( url, frameName ),
	);

	// A freed window is handed a URL the registry already checked, so it
	// starts on the site and has no settling to do — hold it there from
	// the first navigation on.
	guardNavigation( win.webContents );

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

	// From a freed window: open a sibling rather than stacking a second
	// window inside a surface that paints one. Same registry, same
	// URL checks — the only difference is which preload can reach it.
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
	// The About panel is the other place the OS shows an app's identity,
	// and it does not read `app.setName()` on its own.
	app.setAboutPanelOptions( {
		applicationName: 'OpenStation',
		applicationVersion: APP_VERSION,
		version: process.versions.electron,
		copyright: 'GPL-2.0-or-later',
	} );
	brandDock();

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
		siteUrl: () => store.get( 'siteUrl' ),
		hostId: () => store.hostId(),
		describe: () => ( {
			protocol: HOST_PROTOCOL_VERSION,
			platform: process.platform,
			arch: process.arch,
			appVersion: APP_VERSION,
			electronVersion: process.versions.electron,
			// The coordinates a *browser* needs to reach this machine.
			// They travel on the handshake so the site can hand them to
			// its own admin pages: that is the entire pairing.
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

	// The local agent — how a browser tab reaches this machine. Started
	// before the shell window so its URL is known by the time the shell
	// handshakes and hands the coordinates to the site.
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
	// macOS keeps the app running with no windows; everywhere else the
	// last window closing means "I'm done".
	if ( 'darwin' !== process.platform ) {
		app.quit();
	}
} );

app.on( 'before-quit', () => {
	freeWindows?.closeAll();
	agent?.stop();
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
	// Compared host-to-host, not as a string prefix: `https://example.com`
	// is a prefix of `https://example.com.attacker.example`, so a prefix
	// test would have offered the user a "continue anyway" button for a
	// lookalike domain's bad certificate.
	const isConfiguredSite = isSameSiteUrl( url, site );
	// Loopback earns the prompt only when the site itself is loopback —
	// a development setup spanning two local ports, which is the case
	// this allowance was written for. Accepting *any* localhost URL was
	// wider than the reasoning above it: a page on a real site could
	// point at `https://localhost:9999` and raise a certificate dialog
	// the user never went looking for.
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
