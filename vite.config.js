/**
 * Vite configuration for the WP Desktop Mode plugin.
 *
 * Builds two TypeScript entries into IIFE bundles:
 *
 *   `src/desktop.ts` →
 *     - `assets/js/desktop.js`     (development, unminified — loaded when SCRIPT_DEBUG is true)
 *     - `assets/js/desktop.min.js` (production, esbuild-minified — loaded otherwise)
 *
 *   `src/iframe-bridge-standalone.ts` →
 *     - `assets/js/iframe-bridge.js`     (development)
 *     - `assets/js/iframe-bridge.min.js` (production)
 *
 * Which entry the current invocation builds is controlled by the
 * `DESKTOP_MODE_TARGET` env var (`desktop` — default — or `iframe-bridge`).
 * `npm run build` runs Vite four times (two targets × two modes).
 * `npm run dev` watches and rebuilds the unminified `desktop` bundle
 * only — iframe-bridge changes are rare so a one-shot
 * `npm run build:iframe-bridge` covers them.
 *
 * **Source policy:** `assets/js/*.js` is build output. NEVER hand-edit
 * those files — only edit the TS sources under `src/` and run a build.
 *
 * @since 0.5.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

const TARGETS = {
	desktop: {
		entry:    'src/desktop.ts',
		fileBase: 'desktop',
		// Exports from the entry land on `window.desktopMode` — a no-op
		// today (no external consumers) but leaves the door open for
		// tests or devtools probing.
		iifeName: 'desktopMode',
	},
	'iframe-bridge': {
		entry:    'src/iframe-bridge-standalone.ts',
		fileBase: 'iframe-bridge',
		iifeName: 'desktopModeIframeBridge',
	},
	// Recycle Bin app — a thin bundle that registers a render
	// callback on `window.desktopModeNativeWindows['desktop-mode-recycle-bin']`
	// and renders a `<wpd-table>` populated from the REST list. The
	// `<wpd-*>` elements themselves are defined by the main desktop
	// bundle, so this module just consumes them.
	'recycle-bin': {
		entry:    'src/recycle-bin/index.ts',
		fileBase: 'recycle-bin',
		iifeName: 'desktopModeRecycleBin',
	},
	// Native Posts window — `<wpd-table>`-driven replacement for the
	// chromeless `edit.php` iframe, opt-in per user via OS Settings →
	// Features. Same shape as recycle-bin: registers a render
	// callback on `window.desktopModeNativeWindows['desktop-mode-posts']`
	// and consumes the `<wpd-*>` tags defined by the main bundle.
	'posts-window': {
		entry:    'src/posts-window/index.ts',
		fileBase: 'posts-window',
		iifeName: 'desktopModePostsWindow',
	},
	// "My WordPress" file-explorer window — registers a render
	// callback on `window.desktopModeNativeWindows['desktop-mode-my-wordpress']`
	// and reuses the `<wpd-*>` tags defined by the main desktop bundle.
	'my-wordpress': {
		entry:    'src/my-wordpress/index.ts',
		fileBase: 'my-wordpress',
		iifeName: 'desktopModeMyWordpress',
	},
	// Content Graph — PixiJS-driven force-directed map of every post
	// and page (and any opt-in public CPT) wired together by their
	// internal hyperlinks. Lazy-loads PixiJS via the same module
	// registry the wallpapers + posts-window mindmap use. Registers a
	// render callback on `window.desktopModeNativeWindows['desktop-mode-content-graph']`.
	'content-graph': {
		entry:    'src/content-graph/index.ts',
		fileBase: 'content-graph',
		iifeName: 'desktopModeContentGraph',
	},
	// Service worker — own bundle so it can be served from a stable
	// path with the `Service-Worker-Allowed: /` header. The IIFE
	// wrapper is harmless inside a SW context: top-level
	// `self.addEventListener` calls happen synchronously when the
	// IIFE runs, which is exactly what the SW spec wants.
	'pwa-sw': {
		entry:    'src/pwa/sw.ts',
		fileBase: 'sw',
		iifeName: 'desktopModeServiceWorker',
	},
	// Native Comments window — replaces the chromeless
	// `edit-comments.php` iframe with a `<wpd-table>`-driven moderation
	// queue: Pending/All/Spam/Trash/Mine tabs, bulk + undo,
	// inline reply, keyboard nav, spam confidence score, author
	// insights drawer. Same shape as posts-window: registers a
	// render callback on
	// `window.desktopModeNativeWindows['desktop-mode-comments']`.
	'comments-window': {
		entry:    'src/comments-window/index.ts',
		fileBase: 'comments-window',
		iifeName: 'desktopModeCommentsWindow',
	},
	// Native Plugins window — replaces the chromeless `plugins.php`
	// and `plugin-install.php` iframes with a `<wpd-tabs>`-driven
	// installed list + browse-the-repo gallery + detail flyout. Same
	// shape as posts-window: registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-plugins']` and
	// consumes the `<wpd-*>` tags defined by the main desktop bundle.
	'plugins-window': {
		entry:    'src/plugins-window/index.ts',
		fileBase: 'plugins-window',
		iifeName: 'desktopModePluginsWindow',
	},
	// AI Assistant — moved out of the main bundle in 0.8.4. The
	// main `desktop[.min].js` bundle ships a tiny `AiAssistantStub`
	// matching the public `wp.desktop.ai` contract; this bundle
	// holds the 38 kB implementation and is `<script>`-injected by
	// the stub on the user's first invocation. Publishes
	// `window.desktopModeCreateAiAssistant`.
	'ai-assistant': {
		entry:    'src/ai-assistant/entry.ts',
		fileBase: 'ai-assistant',
		iifeName: 'desktopModeAiAssistant',
	},
	// Animated WP Logo wallpaper — built-in canvas wallpaper moved
	// out of the main bundle in 0.8.4. PHP registers the wallpaper
	// via `desktop_mode_register_wallpaper()` with a `script` handle;
	// the shell's wallpaper sync loads this bundle only when the
	// user selects (or hovers in OS Settings) the wallpaper. The
	// bundle's only side effect is publishing the `WallpaperDef` on
	// `window.desktopModeWallpapers['wp-animated-logo']`.
	'animated-logo-wallpaper': {
		entry:    'src/plugins/animated-logo-wallpaper/index.ts',
		fileBase: 'animated-logo-wallpaper',
		iifeName: 'desktopModeAnimatedLogoWallpaper',
	},
	// About-scene — the PixiJS particle scene rendered inside OS
	// Settings → About. ~25 kB of code that only ever runs after the
	// user explicitly opens that tab. Loaded by the main-bundle
	// `about-scene-loader.ts` on first mount; publishes
	// `window.desktopModeMountAboutScene`.
	'about-scene': {
		entry:    'src/settings/sections/about-scene-entry.ts',
		fileBase: 'about-scene',
		iifeName: 'desktopModeAboutScene',
	},
};

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const targetKey = process.env.DESKTOP_MODE_TARGET || 'desktop';
	const target = TARGETS[ targetKey ];
	if ( ! target ) {
		throw new Error(
			`vite.config.js: unknown DESKTOP_MODE_TARGET="${ targetKey }". ` +
				`Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`,
		);
	}

	// Bundle treemap: `BUNDLE_REPORT=1 npm run build:desktop` writes an
	// HTML treemap next to the bundle so we can see which modules are
	// pulling weight. Off by default — has zero impact on shipped code.
	const wantReport = process.env.BUNDLE_REPORT === '1' && isProd;
	const reportPlugins = wantReport
		? [
			visualizer( {
				filename: `assets/js/${ target.fileBase }.report.html`,
				template: 'treemap',
				gzipSize: true,
				brotliSize: false,
				sourcemap: false,
				emitFile: false,
				open: false,
			} ),
		]
		: [];

	return {
		plugins: reportPlugins,
		resolve: {
			alias: {
				'@/':              resolve( __dirname, 'src/' ) + '/',
				'@api/':           resolve( __dirname, 'src/api/' ) + '/',
				'@boot/':          resolve( __dirname, 'src/boot/' ) + '/',
				'@core/':          resolve( __dirname, 'src/core/' ) + '/',
				'@features/':      resolve( __dirname, 'src/features/' ) + '/',
				'@layout/':        resolve( __dirname, 'src/layout/' ) + '/',
				'@protocol/':      resolve( __dirname, 'src/protocol/' ) + '/',
				'@ui/':            resolve( __dirname, 'src/ui/' ) + '/',
				'@window-system/': resolve( __dirname, 'src/window-system/' ) + '/',
			},
		},
		build: {
			outDir: 'assets/js',
			// Every run writes into the same dir — don't let later runs
			// delete what earlier ones produced.
			emptyOutDir: false,
			target: 'es2020',
			// esbuild minification is ~10x faster than terser with comparable
			// output for plain TS; no separate dep needed.
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, target.entry ),
				// IIFE wraps the module so it runs on script load without any
				// module-system glue. WordPress admin can't reliably import
				// <script type="module">, so we ship a self-contained bundle.
				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () =>
					isProd
						? `${ target.fileBase }.min.js`
						: `${ target.fileBase }.js`,
			},
		},
	};
} );
