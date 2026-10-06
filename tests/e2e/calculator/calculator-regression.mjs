import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { resolve } from 'node:path';

const { chromium } = await import( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const server = await createServer( {
	configFile: false,
	resolve: { alias: { '@openstation/app': resolve( 'src/app-runtime/client.ts' ) } },
	server: { host: '127.0.0.1', port: 0 },
} );
await server.listen();
let browser;
try {
	browser = await chromium.launch( { channel: 'chrome', headless: true } );
	const page = await browser.newPage( { viewport: { width: 900, height: 700 } } );
	const errors = [];
	page.on( 'pageerror', ( error ) => errors.push( error.message ) );
	await page.goto( `${ server.resolvedUrls.local[ 0 ] }tests/e2e/calculator/fixture.html` );
	await page.waitForFunction( () => window.ready );
	const result = page.locator( 'output' );
	const key = ( value ) => page.locator( `os-button[os-arg-key="${ value }"]` ).locator( 'button' );
	for ( const value of [ '7', '*', '6', '=' ] ) {
		await key( value ).click();
	}
	assert.equal( await result.textContent(), '42' );
	await page.keyboard.press( 'Escape' );
	await page.keyboard.type( '0.1+0.2' );
	await page.keyboard.press( 'Enter' );
	assert.equal( await result.textContent(), '0.3' );
	await page.keyboard.press( 'Escape' );
	await page.keyboard.type( '8/0' );
	await page.keyboard.press( 'Enter' );
	assert.equal( await result.textContent(), 'Error' );
	await key( '9' ).click();
	assert.equal( await result.textContent(), '9' );
	await key( 'clear' ).click();
	await page.keyboard.press( 'Tab' );
	assert.ok( await page.locator( '.os-calculator__keys' ).evaluate( ( element ) => element.contains( document.activeElement ) ) );
	await page.keyboard.press( 'Space' );
	assert.equal( await result.textContent(), '-0' );
	for ( const width of [ 380, 280, 360 ] ) {
		await page.locator( '#app' ).evaluate( ( element, size ) => element.style.width = `${ size }px`, width );
		const buttons = await page.locator( 'os-button button' ).evaluateAll( ( elements ) => elements.map( ( element ) => {
			const rect = element.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		} ) );
		assert.equal( buttons.length, 20 );
		assert.ok( buttons.every( ( button ) => button.width >= 44 && button.height >= 56 ) );
		assert.equal( await page.locator( '.os-calculator' ).evaluate( ( element ) => element.scrollWidth > element.clientWidth ), false );
	}
	await page.locator( '#app' ).evaluate( ( element ) => element.style.direction = 'rtl' );
	await key( 'clear' ).click();
	await key( '8' ).click();
	await key( '-' ).click();
	await key( '3' ).click();
	await key( '=' ).click();
	assert.equal( await result.textContent(), '5' );
	assert.equal( await page.evaluate( () => window.requests ), 0 );
	assert.deepEqual( errors, [] );
	await page.locator( '#app' ).evaluate( ( element ) => { element.style.width = '380px'; element.style.direction = 'ltr'; } );
	await page.locator( '#app' ).screenshot( { path: '/tmp/openstation-calculator.png' } );
	process.stdout.write( 'Calculator browser checks passed: keypad, keyboard, error recovery, focus, responsive sizes, RTL, and local-only arithmetic.\n' );
} finally {
	await browser?.close();
	await server.close();
}
