/**
 * =============================================================================
 * Desktop Mode — Starter Widget
 * A copy-paste starting point for building your own widget.
 * =============================================================================
 *
 * WHAT THIS FILE DOES
 * -------------------
 * This file is a fully working widget that also teaches you how to build one.
 * When you add it from the widget picker it shows a header, a body that fetches
 * your latest post title, and a click-counter button that persists across page
 * reloads. Every part of it has a comment explaining the why, not just the what.
 *
 * HOW TO BUILD YOUR OWN WIDGET — QUICK START
 * -------------------------------------------
 * 1. Copy this folder (src/plugins/starter-widget/) to src/plugins/my-widget/
 * 2. Copy includes/widgets/widget-starter.php to includes/widgets/widget-my.php
 * 3. Find every occurrence of "starter" and "STARTER" and replace with your name
 * 4. Find the WIDGET_ID constant below and give it a unique namespaced slug
 * 5. Add a Vite target + npm build script (see the bottom of this file)
 * 6. Require your new PHP file in desktop-mode.php
 * 7. Run: npm run build:widget-my
 *
 * HOW A WIDGET WORKS — THE BIG PICTURE
 * --------------------------------------
 * PHP side  →  Tells Desktop Mode the widget EXISTS (label, icon, size limits,
 *              which JS handle to load). Lives in includes/widgets/.
 *
 * JS side   →  Does the actual work. Registers a mount() function on
 *              window.desktopModeWidgets[ id ]. The shell calls mount() when
 *              the user adds the widget, passing a container element to paint
 *              into. mount() must return a teardown() function that cleans up
 *              everything when the widget is removed.
 *
 * Storage   →  ctx.storage gives your widget its own namespaced localStorage
 *              pocket. Two different widgets can both store a key called
 *              "preferences" without colliding.
 *
 * @since 0.26.0
 */
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

// =============================================================================
// STEP 1 — WIDGET ID
// =============================================================================
//
// Pick a unique namespaced slug in the format 'yourplugin/widget-name'.
// This same string must appear in THREE places:
//   1. Here, as WIDGET_ID
//   2. In your PHP file, as the first argument to desktop_mode_register_widget()
//   3. In the window.desktopModeWidgets registration at the bottom of this file
//
// WARNING: Do not rename this after your widget is live. It is the key used
// to store the user's enabled/disabled preference in localStorage. Renaming it
// makes every user's widget disappear on next page load.
//
const WIDGET_ID = 'desktop-mode/starter';


// =============================================================================
// STEP 2 — THE MOUNT FUNCTION
// =============================================================================
//
// This is the heart of your widget. The shell calls mount() when the user
// adds your widget to their desktop. It receives two arguments:
//
//   container  — The card body element. The shell has already given it the
//                glass backdrop, rounded corners, and 12px inner padding.
//                Build your UI inside this element.
//
//   ctx        — The execution context. Gives you:
//                  ctx.id         Your widget's id string (same as WIDGET_ID)
//                  ctx.pluginUrl  Absolute URL to the plugin root, no trailing slash.
//                                 Use this to reference your own assets:
//                                 ctx.pluginUrl + '/assets/images/icon.svg'
//                  ctx.storage    A namespaced localStorage wrapper. See STEP 2c.
//
// mount() can be async. The shell awaits it and handles the race condition
// where a user adds then immediately removes a widget before mount resolves.
//
const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {

	// -------------------------------------------------------------------------
	// STEP 2a — DECLARE `destroyed` AT THE VERY TOP
	// -------------------------------------------------------------------------
	// This boolean is set to true by the teardown function (Step 3). Every
	// async operation in this function must check it immediately after each
	// `await` — the user might remove the widget while a fetch is in flight.
	// If destroyed is true, stop. Do not touch the DOM. Do not set intervals.
	//
	// This is the single most important pattern to get right in a widget.
	// Skipping these checks causes memory leaks and silent background work.
	//
	let destroyed = false;

	// -------------------------------------------------------------------------
	// STEP 2b — BUILD YOUR UI
	// -------------------------------------------------------------------------
	// Use plain DOM methods. No framework is needed for a widget this size,
	// and keeping it dependency-free means your bundle stays tiny and loads fast.
	//
	// CSS class names: prefix everything with your widget's namespace (e.g.
	// dm-starter__) to avoid collisions with the shell's own styles.
	//
	const root = document.createElement( 'div' );
	root.className = 'dm-starter';

	// A header bar — small, uppercase, using the subtle text colour CSS var.
	const header = document.createElement( 'div' );
	header.className = 'dm-starter__header';
	header.textContent = 'Starter Widget';

	// A body area where you display your content.
	const body = document.createElement( 'div' );
	body.className = 'dm-starter__body';
	body.textContent = 'Loading…';

	root.appendChild( header );
	root.appendChild( body );
	container.appendChild( root );

	// -------------------------------------------------------------------------
	// STEP 2c — USE ctx.storage TO PERSIST DATA
	// -------------------------------------------------------------------------
	// ctx.storage is a namespaced localStorage wrapper with get/set/remove/clear.
	// Keys are scoped to your widget id automatically:
	//   ctx.storage.set( 'clicks', 5 )
	//   → stored as 'desktop-mode.widget.desktop-mode/starter.clicks'
	//
	// get() returns null when the key does not exist yet. Always provide a
	// fallback default — never assume storage is available (private browsing,
	// quota exceeded, etc.).
	//
	// Values are JSON-serialised. Primitives, plain objects, and arrays work.
	// Class instances, Dates, and Maps do not — convert them first.
	//
	const clickCount = ctx.storage.get< number >( 'clicks' ) ?? 0;

	const counter = document.createElement( 'button' );
	counter.className = 'dm-starter__counter';
	counter.textContent = `Clicked ${ clickCount } ${ clickCount === 1 ? 'time' : 'times' }`;

	const onClick = (): void => {
		// Always re-read from storage before incrementing — another tab
		// might have updated the value since this tab last wrote it.
		const current = ctx.storage.get< number >( 'clicks' ) ?? 0;
		const next    = current + 1;
		ctx.storage.set( 'clicks', next );
		counter.textContent = `Clicked ${ next } ${ next === 1 ? 'time' : 'times' }`;
	};
	counter.addEventListener( 'click', onClick );
	root.appendChild( counter );

	// -------------------------------------------------------------------------
	// STEP 2d — FETCH DATA FROM THE WP REST API
	// -------------------------------------------------------------------------
	// wpApiSettings is injected by WordPress on every admin page. It gives you:
	//   wpApiSettings.root   — the REST root URL, e.g. https://example.com/wp-json/
	//   wpApiSettings.nonce  — the nonce for authenticated requests
	//
	// Always pass the nonce as X-WP-Nonce. Without it, authenticated endpoints
	// (posts, users, comments) return 401 Unauthorized for non-public content.
	//
	// The replace(/\/$/, '') strips a trailing slash from root so your path
	// concatenation never produces double slashes.
	//
	const s = ( window as unknown as { wpApiSettings?: { root?: string; nonce?: string } } )
		.wpApiSettings ?? {};

	const loadData = async (): Promise< void > => {
		// Guard at the start of every async function that touches the DOM.
		if ( destroyed ) return;

		try {
			const res = await fetch(
				( s.root ?? '/wp-json/' ).replace( /\/$/, '' ) +
					'/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=id,title',
				{
					headers: { 'X-WP-Nonce': s.nonce ?? '' },
					credentials: 'same-origin',
				},
			);

			// Check destroyed after EVERY await, not just before the request.
			// The user may have removed the widget while the network request
			// was in flight. Without this check you would write to a detached
			// DOM element — a silent memory leak.
			if ( destroyed ) return;

			if ( ! res.ok ) {
				body.textContent = 'Could not load posts (' + res.status + ').';
				return;
			}

			const posts = await res.json() as Array< { title: { rendered: string } } >;

			// Check again after the second await (res.json() is also async).
			if ( destroyed ) return;

			body.textContent = posts.length > 0
				? 'Latest post: ' + posts[ 0 ].title.rendered
				: 'No posts found.';

		} catch {
			// Network error, JSON parse failure, etc.
			if ( ! destroyed ) {
				body.textContent = 'Could not load data.';
			}
		}
	};

	// Run an immediate fetch so the widget shows real content on first mount.
	await loadData();

	// -------------------------------------------------------------------------
	// STEP 2e — POLLING WITH setInterval
	// -------------------------------------------------------------------------
	// Store the interval handle in a variable so you can clear it in the
	// teardown. An interval that is never cleared will keep firing after the
	// widget is removed, making network requests nobody will ever see.
	//
	// Choose your interval carefully:
	//   Comments / notifications  → 60 seconds is reasonable
	//   Stats / charts            → 5–10 minutes
	//   Slow-changing content     → longer is better for performance
	//
	const intervalId = setInterval( loadData, 60_000 );


	// =============================================================================
	// STEP 3 — RETURN A TEARDOWN FUNCTION
	// =============================================================================
	//
	// This function is called by the shell when:
	//   - The user clicks the × button on your widget card
	//   - The page is about to unload (pagehide event)
	//   - The plugin that registered the widget is deactivated mid-session
	//
	// Your teardown MUST reverse every side effect from mount:
	//   clearInterval / clearTimeout   for every timer you set
	//   cancelAnimationFrame           for any RAF loops
	//   observer.disconnect()          for ResizeObserver, MutationObserver, etc.
	//   element.removeEventListener()  for every listener you attached
	//
	// Setting destroyed = true first ensures any in-flight async operations
	// (fetches, setTimeout callbacks) bail out when they next check the flag.
	//
	return () => {
		destroyed = true;
		clearInterval( intervalId );
		counter.removeEventListener( 'click', onClick );
		// If you used a ResizeObserver, disconnect it here:
		//   ro.disconnect();
		// If you used requestAnimationFrame, cancel it:
		//   cancelAnimationFrame( rafId );
	};
};


// =============================================================================
// STEP 4 — REGISTER ON THE GLOBAL
// =============================================================================
//
// The shell's server-sync (src/widgets/server-sync.ts) loads your script
// bundle lazily when the picker opens or the widget mounts. After loading,
// it looks for window.desktopModeWidgets[ your_id ] and calls it as the
// mount function.
//
// This must happen at module evaluation time (top level, not inside mount).
// The key here must exactly match WIDGET_ID and your PHP registration id.
//
const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;


// =============================================================================
// STEPS 5–8 — WIRING UP THE REST OF THE SYSTEM
// =============================================================================
//
// STEP 5 — Create your PHP file
// Copy includes/widgets/widget-starter.php to includes/widgets/widget-my.php
// Change every occurrence of:
//   "starter"         → your widget name  (e.g. "trending-posts")
//   "desktop-mode/starter" → your widget id (e.g. "myplugin/trending-posts")
//   label/description/icon → your widget's picker metadata
//
//
// STEP 6 — Require the PHP file in desktop-mode.php
// Find the block of require_once lines for widgets and add:
//   require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-my.php';
//
//
// STEP 7 — Add a Vite build target in vite.config.js
// Inside the TARGETS object, add a new entry:
//
//   'widget-my': {
//       entry:    'src/plugins/my-widget/index.ts',
//       fileBase: 'widget-my',
//       iifeName: 'desktopModeMyWidget',
//   },
//
// The fileBase controls the output filenames:
//   assets/js/widget-my.js       (development)
//   assets/js/widget-my.min.js   (production)
//   assets/js/widget-my.css      (development)
//   assets/js/widget-my.min.css  (production)
//
// The iifeName is the global variable Vite wraps the bundle in. It only
// needs to be unique — nothing outside the bundle reads it by name.
//
//
// STEP 8 — Add a build script in package.json
// Inside "scripts", add:
//
//   "build:widget-my": "DESKTOP_MODE_TARGET=widget-my vite build
//       --mode development && DESKTOP_MODE_TARGET=widget-my vite build
//       --mode production"
//
// Then build your widget:
//   npm run build:widget-my
//
// On your next browser reload the widget will appear in the picker.
// =============================================================================
