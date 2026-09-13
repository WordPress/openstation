/** Browser regression against a running local OpenStation development site. */
const assert = require( 'node:assert/strict' );
const { chromium } = require( 'playwright' );

const base = process.env.WP_BASE_URL || 'http://localhost:8889';
const id = 'openstation-dock-safe-area-regression';

( async () => {
	const browser = await chromium.launch( { channel: 'chrome', headless: true } );
	const page = await browser.newPage( { viewport: { width: 1440, height: 1000 } } );
	page.setDefaultTimeout( 30000 );
	page.on( 'pageerror', error => console.error( 'Browser:', error.stack ) );
	try {
		await page.goto( `${ base }/wp-login.php`, { waitUntil: 'domcontentloaded' } );
		await page.locator( '#user_login' ).fill( process.env.WP_USER || 'admin' );
		await page.locator( '#user_pass' ).fill( process.env.WP_PASSWORD || 'password' );
		await Promise.all( [
			page.waitForNavigation( { waitUntil: 'domcontentloaded' } ),
			page.locator( '#wp-submit' ).click(),
		] );
		await page.waitForFunction( () => window.wp?.os?.workArea?.get().rect.height > 0 );

		console.log( 'Shell ready' );

		// Exercise real settings application without persisting this test's
		// layout or window session. Local storage belongs to this fresh context.
		const urls = await page.evaluate( () => [
			window.openStationConfig.osSettingsUrl,
			window.openStationConfig.sessionUrl,
		] );
		for ( const url of urls ) {
			assert.ok( url, 'The shell must expose its persistence endpoints.' );
			await page.route( `${ url }*`, ( route ) => {
				if ( route.request().method() === 'POST' ) {
					return route.fulfill( { json: { success: true } } );
				}
				return route.continue();
			} );
		}
		await page.evaluate( () => window.wp.os.updateOsSettings( {
			desktopLayout: 'unified', dockPlacement: 'bottom',
			dockBehavior: 'static', dockSize: 'default',
		} ) );
		await page.waitForFunction( () => window.wp.os.workArea.get().insets.bottom > 0 );
		console.log( 'Static dock ready' );
		await page.evaluate( ( windowId ) => {
			window.wp.os.windowManager.open( {
				id: windowId, title: 'Dock safe area regression',
				url: `${ location.origin }/wp-admin/index.php`,
			} ).then( win => win.maximize() );
		}, id );

		async function checkBounds( state, clearDock = true ) {
			await page.waitForFunction( ( { windowId, expectedState, clear } ) => {
				const win = window.wp.os.windowManager.getById( windowId );
				if ( ! win ) { return false; }
				const work = window.wp.os.workArea.get().viewport;
				const box = win.element.getBoundingClientRect();
				const dock = document.querySelector( '#os-dock' ).getBoundingClientRect();
				const expectedWidth = expectedState === 'maximized' ? work.width : Math.floor( work.width / 2 );
				const expectedX = expectedState === 'snapped-right' ? work.x + work.width - expectedWidth : work.x;
				return win.state === expectedState &&
					Math.abs( box.height - work.height ) <= 1 &&
					Math.abs( box.width - expectedWidth ) <= 1 &&
					Math.abs( box.x - expectedX ) <= 1 &&
					Math.abs( box.y - work.y ) <= 1 &&
					( ! clear || box.bottom <= dock.top );
			}, { windowId: id, expectedState: state, clear: clearDock } );
		}

		await checkBounds( 'maximized' );
		console.log( 'PASS maximize clears the visible bottom dock' );
		await page.evaluate( () => window.wp.os.updateOsSettings( { dockSize: 'large' } ) );
		await checkBounds( 'maximized' );
		// A theme may keep the bottom tiles at a fixed height for every
		// size preference. Grow the outer dock padding to exercise a real
		// geometry change, including changes made by a custom rail renderer.
		const originalInset = await page.evaluate( () => window.wp.os.workArea.get().insets.bottom );
		await page.evaluate( () => { document.querySelector( '#os-dock' ).style.paddingBlock = '24px'; } );
		await page.waitForFunction( previous => window.wp.os.workArea.get().insets.bottom > previous, originalInset );
		await checkBounds( 'maximized' );
		console.log( 'PASS dock geometry changes reflow the maximized window' );
		await page.evaluate( () => document.querySelector( '#os-dock' ).style.removeProperty( 'padding-block' ) );
		await page.setViewportSize( { width: 1200, height: 800 } );
		await page.waitForFunction( () => window.wp.os.workArea.get().area.width === 1200 );
		await checkBounds( 'maximized' );
		console.log( 'PASS viewport resize keeps bottom actions clear' );

		for ( const zone of [ 'left', 'right' ] ) {
			await page.evaluate( ( { windowId, side } ) => window.wp.os.windowManager.getById( windowId ).applySnap( side ), { windowId: id, side: zone } );
			await checkBounds( `snapped-${ zone }` );
		}
		console.log( 'PASS both snapped halves clear the dock' );
		await page.evaluate( ( windowId ) => window.wp.os.windowManager.getById( windowId ).maximize(), id );
		await page.evaluate( () => window.wp.os.updateOsSettings( { dockBehavior: 'dynamic' } ) );
		await page.waitForFunction( () => window.wp.os.workArea.get().insets.bottom === 0 );
		await checkBounds( 'maximized', false );
		await page.evaluate( () => window.wp.os.updateOsSettings( { dockBehavior: 'static' } ) );
		await page.waitForFunction( () => window.wp.os.workArea.get().insets.bottom > 0 );
		await checkBounds( 'maximized' );
		console.log( 'PASS Dynamic reclaims space and Static reserves it again' );
		if ( process.env.SCREENSHOT ) {
			await page.screenshot( { path: process.env.SCREENSHOT } );
		}
	} catch ( error ) {
		console.error( JSON.stringify( await page.evaluate( () => ( { url: location.href, workArea: window.wp?.os?.workArea?.get(), windows: window.wp?.os?.windowManager?.getAll().map( w => ( { id: w.id, state: w.state, box: w.element.getBoundingClientRect().toJSON() } ) ), dock: document.querySelector( '#os-dock' )?.outerHTML.slice( 0, 400 ) } ) ), null, 2 ) );
		await page.screenshot( { path: '/tmp/dock-safe-area-failure.png', timeout: 5000 } ).catch( () => {} );
		throw error;
	} finally {
		await browser.close();
	}
} )().catch( ( error ) => {
	console.error( error );
	process.exitCode = 1;
} );
