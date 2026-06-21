/**
 * Desktop Mode — Starter Widget (skeleton / how-to template).
 *
 * Copy this file and styles.css into your own plugin under
 * src/plugins/my-widget/ and follow the numbered steps below.
 * Every decision that matters has a comment explaining why.
 *
 * Checklist:
 *   [ ] Step 1  — Choose a unique widget id
 *   [ ] Step 2  — Write your mount function
 *   [ ] Step 3  — Return a teardown that cleans up everything
 *   [ ] Step 4  — Register on window.desktopModeWidgets
 *   [ ] Step 5  — Add a PHP file in includes/widgets/
 *   [ ] Step 6  — Require the PHP file in desktop-mode.php
 *   [ ] Step 7  — Add a Vite target in vite.config.js
 *   [ ] Step 8  — Add a build script in package.json
 *
 * @since 0.26.0
 */
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

// ---------------------------------------------------------------------------
// Step 1: Widget ID
//
// Use a namespaced slug: 'yourplugin/widget-name'.
// This string is the localStorage key for the user's enabled list,
// the registry lookup key, and the PHP desktop_mode_register_widget() id.
// Do NOT rename it after users have the widget enabled or their
// preference resets on next load.
// ---------------------------------------------------------------------------
const WIDGET_ID = 'desktop-mode/starter';

// ---------------------------------------------------------------------------
// Step 2: Your mount function.
//
// `container` is the card body — already styled with the glass backdrop,
// rounded corners, and 12 px inner padding. Paint directly into it.
//
// `ctx` gives you:
//   ctx.id         — this widget's id string
//   ctx.pluginUrl  — absolute URL to the plugin root (no trailing slash)
//   ctx.storage    — namespaced localStorage wrapper (see WidgetStorage
//                    in src/widgets/types.ts). Use it to persist user
//                    preferences. Keys are scoped to this widget so
//                    two widgets can both use 'preferences' without collision.
//
// The function can be async — the shell awaits it and handles race
// conditions if the user removes the widget before mount resolves.
// ---------------------------------------------------------------------------
const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {

	// -----------------------------------------------------------------------
	// Render your initial UI.
	// Keep DOM creation simple — no framework needed for small widgets.
	// -----------------------------------------------------------------------
	const root = document.createElement( 'div' );
	root.className = 'dm-starter';

	const title = document.createElement( 'div' );
	title.className = 'dm-starter__title';
	title.textContent = 'Starter Widget';

	const body = document.createElement( 'div' );
	body.className = 'dm-starter__body';
	body.textContent = 'Replace this with your content.';

	root.appendChild( title );
	root.appendChild( body );
	container.appendChild( root );

	// -----------------------------------------------------------------------
	// Read a persisted value.
	// ctx.storage.get() returns null when the key doesn't exist yet.
	// Always provide a default — never assume storage is available.
	// -----------------------------------------------------------------------
	const clickCount = ctx.storage.get< number >( 'clicks' ) ?? 0;
	const counter = document.createElement( 'button' );
	counter.className = 'dm-starter__counter';
	counter.textContent = `Clicked ${ clickCount } times`;

	const onClick = (): void => {
		const next = ( ctx.storage.get< number >( 'clicks' ) ?? 0 ) + 1;
		ctx.storage.set( 'clicks', next );
		counter.textContent = `Clicked ${ next } times`;
	};
	counter.addEventListener( 'click', onClick );
	root.appendChild( counter );

	// -----------------------------------------------------------------------
	// Fetch data from the WP REST API.
	// Always use the nonce from wpApiSettings for authenticated requests.
	// -----------------------------------------------------------------------
	const s = ( window as unknown as { wpApiSettings?: { root?: string; nonce?: string } } )
		.wpApiSettings ?? {};

	let destroyed = false;

	const loadData = async (): Promise< void > => {
		try {
			const res = await fetch(
				( s.root ?? '/wp-json/' ).replace( /\/$/, '' ) + '/wp/v2/posts?per_page=1&_fields=title',
				{ headers: { 'X-WP-Nonce': s.nonce ?? '' }, credentials: 'same-origin' },
			);
			if ( ! res.ok || destroyed ) return;
			const posts = await res.json() as Array< { title: { rendered: string } } >;
			if ( destroyed ) return;
			if ( posts.length > 0 ) {
				body.textContent = 'Latest: ' + posts[ 0 ].title.rendered;
			}
		} catch {
			if ( ! destroyed ) body.textContent = 'Could not load data.';
		}
	};

	await loadData();

	// -----------------------------------------------------------------------
	// Set up polling with setInterval.
	// Store the handle so you can clear it in the teardown.
	// -----------------------------------------------------------------------
	const intervalId = setInterval( loadData, 60_000 );

	// -----------------------------------------------------------------------
	// Step 3: Return a teardown function.
	//
	// This is REQUIRED. The shell calls it when:
	//   - The user removes the widget via the × button
	//   - The page unloads
	//   - The widget is unmounted by the server-sync (plugin deactivated)
	//
	// Clear every interval, cancel every animation frame, disconnect every
	// observer, and remove every event listener set during mount.
	// Failing to clean up leaks memory and causes invisible background work.
	// -----------------------------------------------------------------------
	return () => {
		destroyed = true;
		clearInterval( intervalId );
		counter.removeEventListener( 'click', onClick );
	};
};

// ---------------------------------------------------------------------------
// Step 4: Register on the global.
//
// The shell's server-sync reads window.desktopModeWidgets after loading
// your script bundle, looks up the id you declared in PHP, and calls
// the mount function when the widget mounts.
// ---------------------------------------------------------------------------
const w = window as unknown as {
	desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;

// ---------------------------------------------------------------------------
// Step 5: PHP file  →  includes/widgets/widget-starter.php
//
// Copy includes/widgets/widget-comments.php and change:
//   - Function name prefix:  desktop_mode_register_comments_*
//     →  desktop_mode_register_starter_*
//   - Asset filename:        widget-recent-comments
//     →  widget-starter
//   - Widget id:             desktop-mode/recent-comments
//     →  desktop-mode/starter
//   - label / description / icon  to match your widget
//
// Step 6: desktop-mode.php
//   Add one line after the other widget requires:
//   require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-starter.php';
//
// Step 7: vite.config.js  →  add to the TARGETS object:
//   'widget-starter': {
//       entry:    'src/plugins/starter-widget/index.ts',
//       fileBase: 'widget-starter',
//       iifeName: 'desktopModeStarterWidget',
//   },
//
// Step 8: package.json  →  add to "scripts":
//   "build:widget-starter": "DESKTOP_MODE_TARGET=widget-starter vite build
//       --mode development && DESKTOP_MODE_TARGET=widget-starter vite build
//       --mode production",
//
// Then build:
//   npm run build:widget-starter
// ---------------------------------------------------------------------------
