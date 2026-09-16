/** Run with node; PLAYWRIGHT_MODULE may point at an installed Playwright module. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { resolve } from 'node:path';
const { chromium } = await import( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const server = await createServer( { configFile: false, resolve: { alias: { '@openstation/app': resolve( 'src/app-runtime/client.ts' ) } }, server: { host: '127.0.0.1', port: 0 } } );
await server.listen();
const browser = await chromium.launch( { channel: 'chrome', headless: true } );
const page = await browser.newPage( { viewport: { width: 1200, height: 1000 } } );
const errors = [];
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
const rect = ( selector ) => page.locator( selector ).boundingBox();
const close = ( a, b ) => assert.ok( Math.abs( a - b ) < 2, `${ a } != ${ b }` );
try {
	await page.goto( `${ server.resolvedUrls.local[ 0 ] }tests/e2e/layout/fixture.html` );
	await page.waitForFunction( () => window.ready );
	await page.waitForFunction( () => document.querySelector( '#grid' ).style.getPropertyValue( '--_os-grid-tracks' ) === '3' );
	const grid = await rect( '#grid' );
	close( ( await rect( '#wide' ) ).width, ( grid.width - 24 ) / 3 * 2 + 12 );
	assert.ok( ( await rect( '#tall' ) ).height > ( await rect( '#wide' ) ).height );
	await page.locator( '#grid' ).evaluate( ( el ) => el.style.width = '300px' );
	await page.waitForFunction( () => document.querySelector( '#grid' ).hasAttribute( 'data-single-column' ) );
	close( ( await rect( '#wide' ) ).width, 300 );
	assert.equal( await page.locator( '#tall' ).evaluate( ( el ) => getComputedStyle( el ).gridRow ), 'auto' );
	assert.equal( await page.locator( '#grid' ).evaluate( ( el ) => el.scrollWidth > el.clientWidth ), false );

	const footer = await rect( '#frame footer' );
	await page.locator( '#frame' ).evaluate( ( el ) => el.shadowRoot.querySelector( '.content' ).scrollTop = 500 );
	close( ( await rect( '#frame footer' ) ).y, footer.y );
	assert.ok( await page.locator( '#frame' ).evaluate( ( el ) => el.shadowRoot.querySelector( '.content' ).scrollTop > 0 ) );

	const split = page.locator( '#split' );
	const divider = split.locator( '[role="separator"]' );
	await divider.focus();
	await page.keyboard.press( 'ArrowRight' );
	assert.equal( await split.getAttribute( 'position' ), '37' );
	await split.evaluate( ( el ) => { el.style.direction = 'rtl'; window.changes = []; el.addEventListener( 'os-split-change', ( e ) => window.changes.push( e.detail ) ); } );
	await page.keyboard.press( 'ArrowLeft' );
	assert.equal( await split.getAttribute( 'position' ), '39' );
	const handle = await divider.boundingBox();
	await page.mouse.move( handle.x + handle.width / 2, handle.y + 30 );
	await page.mouse.down();
	await page.mouse.move( handle.x - 70, handle.y + 30, { steps: 4 } );
	await page.mouse.up();
	assert.ok( Number( await split.getAttribute( 'position' ) ) > 45 );
	assert.equal( await page.evaluate( () => window.changes.length ), 2 );
	const restored = Number( await split.getAttribute( 'position' ) );
	const handle2 = await divider.boundingBox();
	await page.mouse.move( handle2.x + 4, handle2.y + 30 );
	await page.mouse.down();
	await page.mouse.move( handle2.x - 30, handle2.y + 30 );
	await page.keyboard.press( 'Escape' );
	await page.mouse.up();
	close( Number( await split.getAttribute( 'position' ) ), restored );

	await divider.focus();
	await split.evaluate( ( el ) => el.setAttribute( 'narrow', 'end' ) );
	await page.locator( '#split-frame' ).evaluate( ( el ) => el.style.width = '360px' );
	await page.waitForFunction( () => document.querySelector( '#split' ).shadowRoot.querySelector( '.compact.end' ) );
	assert.equal( await split.locator( '.pane.start' ).isVisible(), false );
	assert.equal( await split.locator( '.pane.end' ).isVisible(), true );
	assert.equal( await split.evaluate( ( el ) => el.shadowRoot.activeElement?.className ), 'pane end' );
	close( ( await split.locator( '.pane.end' ).boundingBox() ).width, 360 );
	await page.locator( '#split-frame' ).evaluate( ( el ) => el.style.width = '900px' );
	await page.waitForFunction( () => ! document.querySelector( '#split' ).shadowRoot.querySelector( '.compact' ) );
	close( Number( await divider.getAttribute( 'aria-valuenow' ) ), restored );

	// Layout reflows during a gesture must not roll it back or poison the next drag.
	const robust = page.locator( '#robust' );
	const robustDivider = robust.locator( '[role="separator"]' );
	await robust.scrollIntoViewIfNeeded();
	for ( let attempt = 0; attempt < 12; attempt++ ) {
		const before = Number( await robustDivider.getAttribute( 'aria-valuenow' ) );
		const box = await robustDivider.boundingBox();
		const delta = attempt % 2 === 0 ? 25 : -25;
		await page.mouse.move( box.x + 4, box.y + 30 );
		await page.mouse.down();
		await page.mouse.move( box.x + 4 + delta, box.y + 30, { steps: 3 } );
		await robust.evaluate( ( el, width ) => el.style.width = width, attempt % 2 === 0 ? '860px' : '900px' );
		await page.waitForFunction( ( width ) => Math.abs( Number( document.querySelector( '#robust' ).shadowRoot.querySelector( '[role=separator]' ).getAttribute( 'aria-valuemin' ) ) - 160 / ( width - 8 ) * 100 ) < 0.01, attempt % 2 === 0 ? 860 : 900 );
		assert.equal( await robust.locator( '.shield' ).isVisible(), true );
		await page.mouse.move( box.x + 4 + delta * 2, box.y + 30, { steps: 3 } );
		await page.mouse.up();
		const after = Number( await robustDivider.getAttribute( 'aria-valuenow' ) );
		assert.ok( delta > 0 ? after > before : after < before, `drag ${ attempt } snapped back` );
		assert.equal( await robust.locator( '.shield' ).isVisible(), false );
	}
	const embedded = await robust.locator( 'iframe' ).boundingBox();
	const handleOverFrame = await robustDivider.boundingBox();
	const beforeFrame = Number( await robustDivider.getAttribute( 'aria-valuenow' ) );
	await page.mouse.move( handleOverFrame.x + 4, handleOverFrame.y + 30 );
	await page.mouse.down();
	await page.mouse.move( embedded.x + embedded.width * 0.75, embedded.y + 50, { steps: 5 } );
	await page.mouse.up();
	assert.ok( Number( await robustDivider.getAttribute( 'aria-valuenow' ) ) > beforeFrame );
	assert.equal( await robust.locator( '.shield' ).isVisible(), false );
	const visuals = await robustDivider.evaluate( ( el ) => ( {
		seam: getComputedStyle( el, '::before' ).width,
		grip: getComputedStyle( el, '::after' ).height,
		background: getComputedStyle( el ).backgroundColor,
	} ) );
	assert.deepEqual( visuals, { seam: '1px', grip: '28px', background: 'rgba(0, 0, 0, 0)' } );

	// Reproduce a release that reaches the browser but not the separator:
	// native lostpointercapture must commit, not undo, the visible resize.
	await robust.evaluate( ( el ) => {
		el.setAttribute( 'position', '50' );
		window.releaseChanges = [];
		el.addEventListener( 'os-split-change', ( e ) => window.releaseChanges.push( e.detail.position ) );
	} );
	for ( let attempt = 0; attempt < 8; attempt++ ) {
		const box = await robustDivider.boundingBox();
		const before = Number( await robustDivider.getAttribute( 'aria-valuenow' ) );
		const delta = attempt % 2 === 0 ? -40 : 40;
		await page.mouse.move( box.x + 4, box.y + 30 );
		await page.mouse.down();
		await page.mouse.move( box.x + 4 + delta, box.y + 30, { steps: 4 } );
		const dragged = Number( await robustDivider.getAttribute( 'aria-valuenow' ) );
		assert.ok( delta < 0 ? dragged < before : dragged > before );
		if ( attempt % 2 === 0 ) {
			await page.evaluate( () => document.addEventListener( 'pointerup', ( e ) => e.stopImmediatePropagation(), { capture: true, once: true } ) );
		}
		await page.mouse.up();
		await page.waitForFunction( () => document.querySelector( '#robust' ).shadowRoot.querySelector( '.shield' ).hidden );
		assert.equal( Number( await robustDivider.getAttribute( 'aria-valuenow' ) ), dragged, 'release must preserve the last visible size' );
		assert.equal( await page.evaluate( () => window.releaseChanges.length ), attempt + 1 );
	}

	const vertical = page.locator( '#vertical' );
	await vertical.locator( '[role="separator"]' ).focus();
	await page.keyboard.press( 'ArrowDown' );
	assert.equal( await vertical.getAttribute( 'position' ), '37' );
	assert.equal( await vertical.locator( '[role="separator"]' ).getAttribute( 'aria-orientation' ), 'horizontal' );
	await vertical.evaluate( ( el ) => { el.setAttribute( 'compact', '' ); el.setAttribute( 'narrow', 'end' ); } );
	await page.waitForFunction( () => document.querySelector( '#vertical' ).shadowRoot.querySelector( '.compact.end' ) );
	assert.equal( await vertical.locator( '.pane.start' ).isVisible(), false );
	close( ( await vertical.locator( '.pane.end' ).boundingBox() ).height, 340 );
	await vertical.evaluate( ( el ) => el.removeAttribute( 'compact' ) );
	await page.setViewportSize( { width: 390, height: 844 } );
	await page.waitForFunction( () => document.querySelector( '#split' ).shadowRoot.querySelector( '.compact' ) );
	assert.equal( await page.evaluate( () => document.documentElement.scrollWidth > innerWidth ), false );
	await page.screenshot( { path: '/tmp/os-layout-mobile.png', fullPage: true } );
	// Render the actual Comments view and its production CSS with deterministic data.
	await page.setViewportSize( { width: 1200, height: 900 } );
	await page.goto( `${ server.resolvedUrls.local[ 0 ] }tests/e2e/layout/comments-fixture.html` );
	await page.waitForFunction( () => window.ready );
	const comments = page.locator( 'os-app-frame.os-comments' );
	const commentsSplit = comments.locator( 'os-split' );
	await commentsSplit.locator( '[role="separator"]' ).waitFor();
	const composer = comments.locator( '.os-comments__composer' );
	const composerBefore = await composer.boundingBox();
	const frameBox = await comments.boundingBox();
	assert.ok( composerBefore.y + composerBefore.height <= frameBox.y + frameBox.height + 1 );
	await comments.locator( '.os-comments__thread-scroll' ).evaluate( ( el ) => el.scrollTop = 400 );
	close( ( await composer.boundingBox() ).y, composerBefore.y );
	await commentsSplit.locator( '[role="separator"]' ).focus();
	await page.keyboard.press( 'ArrowRight' );
	assert.equal( await commentsSplit.getAttribute( 'position' ), '37' );
	await page.locator( '#app' ).evaluate( ( el ) => el.style.width = '380px' );
	await commentsSplit.locator( '.layout.compact.end' ).waitFor();
	assert.equal( await commentsSplit.locator( '.pane.start' ).isVisible(), false );
	await comments.locator( '.os-comments__convo-back' ).click();
	await commentsSplit.locator( '.layout.compact.start' ).waitFor();
	await comments.locator( '.os-comments__thread' ).first().click();
	await commentsSplit.locator( '.layout.compact.end' ).waitFor();
	assert.equal( await commentsSplit.getAttribute( 'position' ), '37' );
	assert.equal( await comments.evaluate( ( el ) => el.scrollWidth > el.clientWidth ), false );
	await page.screenshot( { path: '/tmp/os-layout-comments.png' } );
	assert.deepEqual( errors, [] );
	console.log( 'PASS: grid spans/reflow, frame scrolling, split sizing, pointer, keyboard, RTL, cancellation, narrow panes, vertical split, phone overflow, repeated reflow drags, real iframe crossing, actual Comments composer and narrow navigation.' );
} finally {
	await browser.close();
	await server.close();
}
