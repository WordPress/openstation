/** Run with node; PLAYWRIGHT_MODULE may point at an installed Playwright module. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { resolve } from 'node:path';
const { chromium } = await import( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const server = await createServer( {
	configFile: false,
	resolve: { alias: { '@openstation/app': resolve( 'src/app-runtime/client.ts' ) } },
	optimizeDeps: { entries: [ 'tests/e2e/forms/fixture.html' ] },
	server: { host: '127.0.0.1', port: 0 },
} );
await server.listen();
const browser = await chromium.launch( { channel: 'chrome', headless: true } );
const page = await browser.newPage();
const errors = [];
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
try {
	await page.goto( `${ server.resolvedUrls.local[ 0 ] }tests/e2e/forms/fixture.html` );
	const form = page.locator( 'os-form' );
	const title = page.locator( 'os-text-field[name="title"] input' );
	await title.fill( 'Edited' );
	await page.locator( '[role="switch"]' ).click();
	assert.deepEqual( await page.evaluate( () => window.changes.at( -1 ) ), { name: 'pinned', value: false } );
	await title.press( 'Enter' );
	await form.evaluate( ( el ) => el.submit() );
	assert.equal( await page.evaluate( () => window.submissions.length ), 1 );
	assert.equal( await form.locator( '.fields' ).getAttribute( 'inert' ), '' );

	// Browser hit testing and focus must both honor inert across the slot.
	const box = await title.boundingBox();
	await page.mouse.click( box.x + box.width / 2, box.y + box.height / 2 );
	await page.keyboard.type( 'Should not land' );
	await title.evaluate( ( el ) => el.focus() );
	assert.equal( await title.evaluate( ( el ) => el.getRootNode().activeElement === el ), false );
	assert.equal( await title.inputValue(), 'Edited' );
	await page.keyboard.press( 'Enter' );
	assert.equal( await page.evaluate( () => window.submissions.length ), 1 );

	await form.evaluate( ( el ) => el.setBusy( false ) );
	await title.fill( 'Retry' );
	assert.equal( await page.locator( 'os-text-field[name="locked"] input' ).isDisabled(), true );
	await form.locator( '[data-os-form-action="submit"] button' ).click();
	assert.equal( await page.evaluate( () => window.submissions.length ), 2 );
	assert.equal( await page.evaluate( () => window.submissions[ 1 ].title ), 'Retry' );

	await form.evaluate( ( el ) => {
		el.setBusy( false );
		for ( let attempt = 0; attempt < 2; attempt++ ) {
			const tags = el.querySelector( 'os-tag-input' );
			tags.value[ 0 ].label = 'Mutated';
			tags.value.push( { label: 'Added' } );
			el.reset();
		}
	} );
	assert.deepEqual( await form.evaluate( ( el ) => el.getValues() ), {
		title: 'Initial', locked: 'Fixed', pinned: true, tags: [ { id: 7, label: 'Initial' } ],
	} );
	assert.equal( await page.locator( '[role="switch"]' ).getAttribute( 'aria-checked' ), 'true' );

	// Inspect rendered pixels: computed styles alone cannot establish that
	// the browser-owned calendar glyph actually uses the inherited token.
	const assertGlyphColor = async ( input, colorOverride ) => {
		const expected = await input.evaluate( ( el, colorOverride ) => {
			const probe = document.createElement( 'span' );
			probe.style.color = colorOverride || getComputedStyle( el ).getPropertyValue( '--os-ui-fg-muted' );
			probe.style.forcedColorAdjust = 'none';
			document.body.append( probe );
			const rgb = getComputedStyle( probe ).color.match( /\d+/g ).slice( 0, 3 ).map( Number );
			probe.remove();
			return rgb;
		}, colorOverride );
		const png = ( await input.screenshot() ).toString( 'base64' );
		const matchingPixels = await page.evaluate( async ( { png, expected } ) => {
			const image = new Image();
			image.src = `data:image/png;base64,${ png }`;
			await image.decode();
			const canvas = document.createElement( 'canvas' );
			canvas.width = image.width;
			canvas.height = image.height;
			const ctx = canvas.getContext( '2d' );
			ctx.drawImage( image, 0, 0 );
			const pixels = ctx.getImageData( image.width - 30, 5, 25, image.height - 10 ).data;
			let matches = 0;
			for ( let i = 0; i < pixels.length; i += 4 ) {
				if ( expected.every( ( channel, j ) => Math.abs( pixels[ i + j ] - channel ) <= 2 ) ) matches++;
			}
			return matches;
		}, { png, expected } );
		assert.ok( matchingPixels >= 10, `Calendar glyph must use the theme foreground (${ expected }); found ${ matchingPixels } pixels` );
	};
	for ( const input of await page.locator( '#date-themes input' ).all() ) {
		await assertGlyphColor( input );
	}
	const customDate = page.locator( '[data-theme="default"] os-text-field[type="date"]' );
	await customDate.evaluate( ( el ) => el.style.setProperty( '--os-ui-fg-muted', 'rgb(10, 200, 50)' ) );
	await assertGlyphColor( customDate.locator( 'input' ) );
	await customDate.evaluate( ( el ) => el.style.removeProperty( '--os-ui-fg-muted' ) );
	await customDate.locator( 'input' ).fill( '2026-09-16' );
	assert.equal( await customDate.getAttribute( 'value' ), '2026-09-16' );
	if ( process.env.FORM_SCREENSHOT ) {
		await page.locator( '#date-themes' ).screenshot( { path: process.env.FORM_SCREENSHOT } );
	}
	await page.emulateMedia( { forcedColors: 'active' } );
	await assertGlyphColor( customDate.locator( 'input' ), 'ButtonText' );
	assert.deepEqual( errors, [] );
	console.log( 'Form browser regressions passed: input, busy lock, retry, reset, and theme-colored calendar glyphs.' );
} finally {
	await browser.close();
	await server.close();
}
