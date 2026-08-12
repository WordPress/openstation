/**
 * Editor-preview regression, against the live dev site at :8889 with
 * real WordPress autosave, real TinyMCE and the real shell.
 *
 * Two cases, and BOTH matter — a fix that silences the spurious refresh
 * by never refreshing at all would pass case A and fail case B.
 *
 *   A. Eye clicked with nothing to save  -> the companion must NOT be
 *      refreshed. Core declines to autosave, so there is nothing the
 *      companion's first load does not already show.
 *   B. Eye clicked after a real edit     -> the companion MUST be
 *      refreshed, because its first load raced the save.
 *
 * In both cases the user's gesture (into the preview, back to the
 * editor) is performed on the real timeline, since the reported symptom
 * was a refresh that lands between those two clicks.
 *
 * Usage:  node preview-regression.mjs
 * Exit 0 = both cases behave.
 */
import { launch, login, until, sleep, BASE, PRODUCT_ID } from './lib.mjs';

const EDITOR_WIN = `post-php-post-${ PRODUCT_ID }`;
let failed = false;

function report( name, ok, detail ) {
	console.log( `${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }` );
	if ( ! ok ) failed = true;
}

async function run( { dirty } ) {
	const { browser, page } = await launch();
	try {
		await login( page );
		await page.goto( `${ BASE }/wp-admin/post.php?post=${ PRODUCT_ID }&action=edit`, {
			waitUntil: 'domcontentloaded',
		} );
		await until( page, () => !! window.wp?.os?.windowManager, { label: 'shell' } );
		await sleep( 8000 );

		const ef = () =>
			page
				.frames()
				.find(
					( f ) =>
						f.url().includes( `post=${ PRODUCT_ID }` ) && f.url().includes( 'chromeless' )
				);

		if ( dirty ) {
			const ebox = await page.evaluate( ( id ) => {
				const r = window.wp.os.windowManager.getById( id ).iframe.getBoundingClientRect();
				return { x: r.x, y: r.y };
			}, EDITOR_WIN );
			const cbox = await ef().evaluate( () => {
				const r = document.getElementById( 'content_ifr' ).getBoundingClientRect();
				return { x: r.x, y: r.y, w: r.width, h: r.height };
			} );
			await page.mouse.click(
				ebox.x + cbox.x + Math.round( cbox.w / 2 ),
				ebox.y + cbox.y + Math.min( 60, Math.round( cbox.h / 2 ) )
			);
			await page.keyboard.type( ' EDIT-' + Date.now().toString().slice( -5 ) );
			await sleep( 1500 );
			// The edit must actually have registered, or case B proves
			// nothing.
			const isDirty = await ef().evaluate(
				() => !! window.tinymce?.get?.( 'content' )?.isDirty?.()
			);
			if ( ! isDirty ) throw new Error( 'case B setup failed: TinyMCE is not dirty' );
		}

		await page.evaluate( () => {
			const w = window;
			w.__t0 = performance.now();
			w.__ev = [];
			w.__refresh = 0;
			const at = () => Math.round( performance.now() - w.__t0 );
			w.__note = ( s ) => w.__ev.push( `T+${ at() }ms  ${ s }` );
			document.addEventListener( 'os-window-opened', ( e ) => {
				const id = e.detail?.windowId || '';
				if ( ! id.startsWith( 'editor-preview-' ) ) return;
				const win = w.wp.os.windowManager.getById( id );
				for ( const m of [ 'swapReload', 'reload', 'navigateTo' ] ) {
					const orig = win[ m ].bind( win );
					win[ m ] = ( ...a ) => {
						w.__refresh++;
						w.__note( `PREVIEW ${ m }()` );
						return orig( ...a );
					};
				}
			} );
		} );

		await page.evaluate( ( id ) => {
			const el = document.getElementById( `wp-window-${ id }` );
			const btn = [ ...el.querySelectorAll( '.os-window__btn--custom' ) ].find(
				( b ) => b.getAttribute( 'aria-label' ) === 'Preview'
			);
			window.__note( 'EYE CLICK' );
			btn.click();
		}, EDITOR_WIN );

		const previewId = await until(
			page,
			() => {
				const mgr = window.wp.os.windowManager;
				const all = mgr.getAll ? mgr.getAll() : mgr._stack;
				const w = [ ...all ].find( ( x ) => x.id.startsWith( 'editor-preview-' ) );
				return w ? w.id : null;
			},
			{ label: 'preview window', timeout: 60000 }
		);

		const clickIn = async ( winId, label ) => {
			const box = await page.evaluate( ( id ) => {
				const w = window.wp.os.windowManager.getById( id );
				if ( ! w?.iframe ) return null;
				const r = w.iframe.getBoundingClientRect();
				return { x: r.x, y: r.y, w: r.width, h: r.height };
			}, winId );
			if ( ! box ) return;
			await page.evaluate( ( l ) => window.__note( 'CLICK INTO ' + l ), label );
			await page.mouse.click( box.x + Math.round( box.w / 2 ), box.y + Math.round( box.h * 0.8 ) );
		};

		await sleep( 4000 );
		await clickIn( previewId, 'PREVIEW' );
		await sleep( 3000 );
		await clickIn( EDITOR_WIN, 'EDITOR' );
		// Past the 5 s backstop + the 400 ms schedule debounce, with room
		// to spare: the spurious refresh landed at ~T+5.4 s.
		await sleep( 20000 );

		const { ev, refresh } = await page.evaluate( () => ( {
			ev: window.__ev,
			refresh: window.__refresh,
		} ) );
		console.log( `\n[case ${ dirty ? 'B: real edit' : 'A: nothing to save' }] timeline:` );
		ev.forEach( ( e ) => console.log( '   ' + e ) );
		return refresh;
	} finally {
		await browser.close();
	}
}

const a = await run( { dirty: false } );
report( 'A: eye with nothing to save does not refresh the preview', a === 0, `${ a } refresh(es)` );

const b = await run( { dirty: true } );
report( 'B: eye after a real edit still refreshes the preview', b >= 1, `${ b } refresh(es)` );

console.log( failed ? '\nREGRESSION FAILED' : '\nAll good.' );
process.exit( failed ? 1 : 0 );
