/** Authenticated WordPress browser regression; see README.md for setup. */
import assert from 'node:assert/strict';
const { chromium } = await import( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const base = process.env.OPENSTATION_TEST_URL || 'http://localhost:8891';
const shell = `${ base }/wp-admin/admin.php?page=openstation`;
const browser = await chromium.launch( { channel: 'chrome', headless: true } );
const context = await browser.newContext( { viewport: { width: 1300, height: 900 } } );
await context.grantPermissions( [ 'clipboard-read', 'clipboard-write' ], { origin: base } );
const page = await context.newPage();
const errors = [];
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
let originalSetting;
try {
	await page.goto( `${ base }/wp-login.php` );
	await page.locator( '#user_login' ).fill( process.env.WP_TEST_USER || 'admin' );
	await page.locator( '#user_pass' ).fill( process.env.WP_TEST_PASSWORD || 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /wp-admin/ );
	await page.goto( `${ shell }&app=desktop-mode-os-settings` );
	const preferences = page.locator( '#wp-window-desktop-mode-os-settings' );
	await preferences.locator( 'os-tab[value="windows"]' ).click();
	const checkbox = preferences.getByRole( 'checkbox', { name: 'Show app links', exact: true } );
	originalSetting = await checkbox.isChecked();
	await checkbox.check();
	const nativeRow = preferences.locator( ':scope > .os-window__app-link' );
	await nativeRow.waitFor( { state: 'visible' } );
	const nativeLink = await nativeRow.textContent();
	assert.equal( nativeLink, `${ shell }&app=desktop-mode-os-settings` );
	assert.equal( new URL( page.url() ).searchParams.has( 'app' ), false );
	// The status bar sits along the bottom edge, below the content.
	assert.equal( await nativeRow.evaluate( ( row ) => row.previousElementSibling.classList.contains( 'os-window__body' ) ), true );
	const nativeText = nativeRow.locator( '.os-window__app-link-text' );
	await nativeText.focus();
	await page.keyboard.press( process.platform === 'darwin' ? 'Meta+a' : 'Control+a' );
	assert.equal( await nativeText.evaluate( ( row ) => row.ownerDocument.defaultView.getSelection().toString() ), nativeLink );
	// The bar is the window's last stop; Shift+Tab steps back into its content.
	await page.keyboard.press( 'Shift+Tab' );
	assert.ok( await preferences.evaluate( ( win ) => win.contains( win.ownerDocument.activeElement ) ) );
	assert.equal( await nativeText.evaluate( ( text ) => text === text.ownerDocument.activeElement ), false );
	// The icon at the start of the bar copies the address.
	await nativeRow.getByRole( 'button', { name: 'Copy link' } ).click();
	await nativeRow.getByRole( 'button', { name: 'Link copied' } ).waitFor();
	assert.equal( await page.evaluate( () => navigator.clipboard.readText() ), nativeLink );
	assert.ok( ( await nativeRow.boundingBox() ).height <= 22 );
	await page.screenshot( { path: '/tmp/os-app-links-native.png' } );

	// Save is debounced; wait until the server has acknowledged the change.
	await page.waitForFunction( () => window.wp.os.getOsSettings().showAppLinks === true );
	await page.waitForTimeout( 600 );
	const target = '/wp-admin/edit.php?post_type=page';
	// A plain admin URL is the iframe window's address, and opens as one.
	await page.goto( `${ base }${ target }` );
	const iframeWindow = page.locator( '.os-window' ).filter( {
		has: page.locator( '.os-window__iframe[src*="edit.php"][src*="post_type=page"]' ),
	} ).last();
	await iframeWindow.waitFor( { state: 'visible' } );
	const frame = await iframeWindow.locator( '.os-window__iframe' ).elementHandle();
	const content = await frame.contentFrame();
	await content.waitForLoadState( 'load' );
	const iframeRow = iframeWindow.locator( ':scope > .os-window__app-link' );
	await iframeRow.waitFor( { state: 'visible' } );
	const iframeLink = await iframeRow.textContent();
	assert.equal( iframeLink, `${ base }${ target }` );

	// A real iframe document navigation refreshes its address, without reopening it.
	await content.goto( `${ base }/wp-admin/edit.php?post_type=page&post_status=draft&openstation_chromeless=1` );
	await page.waitForFunction( () => document.querySelector( '.os-window--focused > .os-window__app-link' )?.textContent === `${ document.location.origin }/wp-admin/edit.php?post_type=page&post_status=draft` );
	await page.screenshot( { path: '/tmp/os-app-links-iframe.png' } );

	// Following a shared app address from a loaded desktop opens the app again.
	await page.goto( nativeLink );
	await page.waitForFunction( () => document.querySelector( '#wp-window-desktop-mode-os-settings' )?.classList.contains( 'os-window--focused' ) );
	assert.equal( new URL( page.url() ).searchParams.has( 'app' ), false );
	await preferences.locator( 'os-tab[value="windows"]' ).click();
	await preferences.getByRole( 'checkbox', { name: 'Show app links', exact: true } ).uncheck();
	assert.equal( await page.locator( '.os-window__app-link:visible' ).count(), 0 );
	assert.deepEqual( errors, [] );
	console.log( 'PASS: canonical native and iframe app links, bottom status bar, copy icon, navigation, selection, live toggle, and one-shot routing.' );
} finally {
	if ( originalSetting !== undefined ) {
		await page.evaluate( ( value ) => window.wp?.os?.updateOsSettings( { showAppLinks: value } ), originalSetting );
		await page.waitForTimeout( 600 );
	}
	await browser.close();
}
