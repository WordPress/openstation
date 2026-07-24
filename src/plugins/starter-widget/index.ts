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
 * 3. Find every occurrence of "starter" and replace with your widget name
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
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { decodeHTML } from '../../utils';

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

	const header = document.createElement( 'div' );
	header.className = 'dm-starter__header';
	header.textContent = 'Starter Widget';

	const body = document.createElement( 'div' );
	body.className = 'dm-starter__body';
	body.textContent = 'Loading\u2026';

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
		const current = ctx.storage.get< number >( 'clicks' ) ?? 0;
		const next = current + 1;
		ctx.storage.set( 'clicks', next );
		counter.textContent = `Clicked ${ next } ${ next === 1 ? 'time' : 'times' }`;
	};
	counter.addEventListener( 'click', onClick );
	root.appendChild( counter );

	// -------------------------------------------------------------------------
	// STEP 2d — FETCH DATA FROM THE WP REST API
	// -------------------------------------------------------------------------
	// Always use trackedFetch from '../../tracked-fetch', never raw fetch().
	//
	// Why: the repo's ESLint config bans raw fetch() calls (no-restricted-syntax
	// rule). trackedFetch routes requests through the framework so they feed the
	// loading spinner + activity bus. It also injects the REST nonce
	// (X-WP-Nonce) automatically via injectRestNonce — no manual header needed.
	//
	// Pass silent: true for background polls the user did not initiate, so
	// they do not see a spurious loading indicator on every refresh tick.
	//
	// Pass source: 'yourplugin/widget-name' so the devtools activity panel
	// can attribute requests to your widget by name.
	//
	const rootUrl = ( window as unknown as { wpApiSettings?: { root?: string } } )
		.wpApiSettings?.root ?? '/wp-json/';

	const loadData = async (): Promise< void > => {
		if ( destroyed ) {
			return;
		}
		try {
			const res = await trackedFetch(
				rootUrl.replace( /\/$/, '' ) +
					'/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=id,title',
				{ credentials: 'same-origin' },
				{ source: 'desktop-mode/starter', silent: true },
			);
			// Check destroyed after EVERY await, not just before the request.
			// The widget may have been removed while the network request was in
			// flight. Without this check you write to a detached DOM element.
			if ( destroyed ) {
				return;
			}
			if ( ! res.ok ) {
				body.textContent = 'Could not load posts (' + res.status + ').';
				return;
			}
			const posts = await res.json() as Array< { title: { rendered: string } } >;
			// Check again after the second await (res.json() is also async).
			if ( destroyed ) {
				return;
			}
			body.textContent = posts.length > 0
				? 'Latest post: ' + decodeHTML( posts[ 0 ].title.rendered )
				: 'No posts found.';
		} catch {
			if ( ! destroyed ) {
				body.textContent = 'Could not load data.';
			}
		}
	};

	await loadData();

	// -------------------------------------------------------------------------
	// STEP 2e — POLLING WITH setInterval
	// -------------------------------------------------------------------------
	// Store the interval handle in a variable so you can clear it in the
	// teardown. An interval that is never cleared keeps firing after the
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
	return () => {
		destroyed = true;
		clearInterval( intervalId );
		counter.removeEventListener( 'click', onClick );
	};
};

// =============================================================================
// STEP 4 — REGISTER ON THE GLOBAL
// =============================================================================
//
// The shell's server-sync loads your script bundle lazily when the picker
// opens or the widget mounts, then looks for window.desktopModeWidgets[ id ]
// and calls it as the mount function.
//
// This must happen at module evaluation time (top level, not inside mount).
// The key must exactly match WIDGET_ID and your PHP registration id.
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
//   Copy includes/widgets/widget-starter.php → includes/widgets/widget-my.php
//   Replace "starter" with your name throughout. Update label/description/icon.
//
// STEP 6 — Require it in desktop-mode.php
//   require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-my.php';
//
// STEP 7 — Add a Vite target in vite.config.js (inside the TARGETS object):
//   'widget-my': {
//       entry:    'src/plugins/my-widget/index.ts',
//       fileBase: 'widget-my',
//       iifeName: 'desktopModeMyWidget',
//   },
//
// STEP 8 — Add a build script in package.json (inside "scripts"):
//   "build:widget-my": "DESKTOP_MODE_TARGET=widget-my vite build --mode development
//       && DESKTOP_MODE_TARGET=widget-my vite build --mode production"
//
// Then: npm run build:widget-my
// =============================================================================
