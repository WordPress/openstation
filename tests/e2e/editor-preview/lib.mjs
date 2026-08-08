/**
 * Shared rig for the editor-preview regression runs against the live
 * dev site at :8889.
 */
import puppeteer from 'puppeteer';

export const BASE = 'http://localhost:8889';
export const PRODUCT_ID = process.env.PRODUCT_ID || '2087';

export async function launch( { headless = true } = {} ) {
	const browser = await puppeteer.launch( {
		headless,
		defaultViewport: { width: 1600, height: 1000 },
		args: [ '--no-sandbox', '--disable-dev-shm-usage' ],
	} );
	const page = await browser.newPage();
	page.setDefaultTimeout( 45000 );
	return { browser, page };
}

export async function login( page ) {
	// `networkidle*` never settles here: the shell runs a heartbeat and
	// the preview companion polls, so every wait is on an explicit
	// signal instead.
	await page.goto( `${ BASE }/wp-login.php`, { waitUntil: 'domcontentloaded' } );
	if ( ! page.url().includes( 'wp-login.php' ) ) {
		return;
	}
	await page.waitForSelector( '#user_login' );
	await page.type( '#user_login', 'admin' );
	await page.type( '#user_pass', 'password' );
	await Promise.all( [
		page.waitForNavigation( { waitUntil: 'domcontentloaded' } ),
		page.click( '#wp-submit' ),
	] );
}

/** Poll a predicate in the page until it returns truthy. */
export async function until( page, fn, { timeout = 45000, every = 400, label = 'condition' } = {} ) {
	const started = Date.now();
	for ( ;; ) {
		const v = await page.evaluate( fn ).catch( () => null );
		if ( v ) {
			return v;
		}
		if ( Date.now() - started > timeout ) {
			throw new Error( `timed out waiting for ${ label }` );
		}
		await new Promise( ( r ) => setTimeout( r, every ) );
	}
}

export const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

/**
 * Installs counters in the parent shell.
 *
 * Distinguishes the two candidate causes rather than assuming one:
 *   - `liveSaved`  : the editor iframe announced a save.
 *   - `broadcast`  : a content-change broadcast reached the shell.
 *   - `swapReload` / `reload` / `navigateTo`: what the preview window
 *     was actually asked to do, and by which path.
 *   - `frameLoads` : real iframe loads observed in the preview window.
 */
export async function instrument( page, previewId ) {
	await page.evaluate( ( pid ) => {
		const w = window;
		w.__probe = {
			liveSaved: 0,
			broadcast: 0,
			swapReload: 0,
			reload: 0,
			navigateTo: 0,
			frameLoads: 0,
			log: [],
		};
		const note = ( what, extra ) =>
			w.__probe.log.push(
				`${ Math.round( performance.now() ) }ms ${ what }${ extra ? ' ' + extra : '' }`
			);

		w.addEventListener(
			'message',
			( e ) => {
				const t = e && e.data && e.data.type;
				if ( t === 'os-editor-live-saved' ) {
					w.__probe.liveSaved++;
					note( 'os-editor-live-saved', e.data.watchId || '' );
				}
			},
			true
		);

		const mgr = w.wp && w.wp.os && w.wp.os.windowManager;
		const win = mgr && mgr.getById && mgr.getById( pid );
		if ( win ) {
			for ( const m of [ 'swapReload', 'reload', 'navigateTo' ] ) {
				if ( typeof win[ m ] === 'function' ) {
					const orig = win[ m ].bind( win );
					win[ m ] = ( ...args ) => {
						w.__probe[ m ]++;
						note( `Window.${ m }()`, JSON.stringify( args ) );
						note( new Error( 'stack' ).stack.split( '\n' ).slice( 2, 7 ).join( ' | ' ) );
						return orig( ...args );
					};
				}
			}
			if ( win.iframe ) {
				win.iframe.addEventListener( 'load', () => {
					w.__probe.frameLoads++;
					note( 'preview iframe load' );
				} );
			}
			w.__probeWin = win;
		} else {
			note( 'NO PREVIEW WINDOW FOUND for ' + pid );
		}
	}, previewId );
}

export async function readProbe( page ) {
	return page.evaluate( () => window.__probe || null );
}

export async function resetProbe( page ) {
	await page.evaluate( () => {
		if ( ! window.__probe ) return;
		Object.assign( window.__probe, {
			liveSaved: 0,
			broadcast: 0,
			swapReload: 0,
			reload: 0,
			navigateTo: 0,
			frameLoads: 0,
			log: [],
		} );
	} );
}
