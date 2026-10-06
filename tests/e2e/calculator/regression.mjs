import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const base = process.env.OPENSTATION_URL || 'http://localhost:8890';
const artifacts = process.env.ARTIFACTS_DIR || '.scratch/calculator';
const browser = await chromium.launch( { channel: 'chrome', headless: true } );
const page = await browser.newPage( { viewport: { width: 1400, height: 1000 } } );
const errors = [];
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
try {
	await mkdir( artifacts, { recursive: true } );
	await page.goto( `${ base }/wp-login.php` );
	await page.locator( '#user_login' ).fill( process.env.WP_USERNAME || 'admin' );
	await page.locator( '#user_pass' ).fill( process.env.WP_PASSWORD || 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.getByRole( 'button', { name: 'Calculator', exact: true } ).click();
	const calculator = page.locator( '.os-calculator' );
	await calculator.waitFor();
	const output = calculator.locator( 'output' );
	const button = ( key ) => calculator.locator( `os-button[os-arg-key="${ key }"]` ).locator( 'button' );
	const requests = [];
	page.on( 'request', ( request ) => {
		if ( request.url().includes( '/apps/openstation-calculator/dispatch' ) ) {
			requests.push( request );
		}
	} );
	await page.waitForFunction( () => ! document.querySelector( '.os-calculator' )?.closest( '[aria-busy="true"]' ) );
	requests.length = 0;
	for ( const key of [ 'clear', '2', '0', '0', '+', '1', '0', '%', '=' ] ) {
		await button( key ).click();
	}
	assert.equal( await output.textContent(), '220' );
	await calculator.focus();
	await page.keyboard.press( 'Escape' );
	await page.keyboard.type( '0.1+0.2=' );
	assert.equal( await output.textContent(), '0.3' );
	await page.keyboard.press( 'Enter' );
	assert.equal( await output.textContent(), '0.5' );
	await button( 'clear' ).focus();
	await page.keyboard.press( 'Enter' );
	assert.equal( await output.textContent(), '0' );
	await calculator.focus();
	await page.keyboard.type( '8/0=' );
	assert.equal( await output.textContent(), 'Error' );
	await page.keyboard.type( '7*6=' );
	assert.equal( await output.textContent(), '42' );
	assert.equal( requests.length, 0, 'Calculator keys must not dispatch HTTP requests.' );
	const bounds = await calculator.boundingBox();
	assert.ok( bounds );
	for ( const key of await calculator.locator( 'os-button' ).all() ) {
		const rect = await key.locator( 'button' ).boundingBox();
		assert.ok( rect && rect.width >= 44 && rect.height >= 52, 'Every key must be a large touch target.' );
	}
	assert.equal( await calculator.evaluate( ( el ) => el.scrollWidth > el.clientWidth ), false );
	await calculator.screenshot( { path: `${ artifacts }/calculator-desktop.png` } );
	await calculator.evaluate( ( el ) => {
		el.style.inlineSize = '280px';
		el.style.direction = 'rtl';
	} );
	assert.equal( await calculator.evaluate( ( el ) => el.scrollWidth > el.clientWidth ), false );
	await calculator.screenshot( { path: `${ artifacts }/calculator-narrow-rtl.png` } );
	assert.deepEqual( errors, [] );
	console.log( 'Calculator native-window, arithmetic, keyboard, touch targets and narrow RTL checks passed.' );
} finally {
	await browser.close();
}
