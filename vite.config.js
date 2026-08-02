/**
 * Vite configuration for the WP Desktop Mode plugin.
 *
 * Builds the TypeScript entries listed in the `TARGETS` map below into
 * IIFE bundle pairs under `assets/js/`:
 *
 *   `<fileBase>.js`     (development, unminified — loaded when SCRIPT_DEBUG is true)
 *   `<fileBase>.min.js` (production, esbuild-minified — loaded otherwise)
 *
 * Which entry the current invocation builds is controlled by the
 * `DESKTOP_MODE_TARGET` env var (`desktop` is the default). `npm run build`
 * invokes every target — one `build:<target>` script per entry in
 * `package.json`, each running Vite twice (dev + prod mode).
 * `npm run dev` watches and rebuilds the unminified `desktop` bundle
 * only — other targets need a one-shot `npm run build:<target>`.
 *
 * **Source policy:** `assets/js/*.js` is build output. NEVER hand-edit
 * those files — only edit the TS sources under `src/` and run a build.
 *
 * @since 0.5.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * Strip `static help = { … };` blocks from production builds.
 *
 * Every `<wpd-*>` component class declares a `static help = { … }`
 * descriptor — title, summary, props/slots/parts/cssProps tables,
 * examples, status, since. ~82 kB of plain documentation across the
 * 47 components in the kit.
 *
 * That descriptor has exactly one runtime consumer: the OS Settings
 * → Help tab (`src/settings/sections/help.ts`), which iterates
 * `WPD_COMPONENT_TAGS` and renders the metadata. The same module
 * already handles components without a descriptor — it falls back
 * to a minimal stub built from `static props`. So in production we
 * can drop the descriptor from the bundle entirely and the help
 * screen still works, just without the rich copy.
 *
 * Dev builds keep `static help` intact so live exploration and the
 * component help screen stay fully informative during development.
 * Production builds get a one-liner: `static help = void 0;`.
 *
 * Conservative parser:
 *   - Only `.ts` files under `src/ui/components/` are inspected.
 *   - Block must begin with the exact source `\tstatic help = {`
 *     to avoid false-positives elsewhere.
 *   - Strings and nested object literals are balanced before the
 *     replacement; the trailing `;` is consumed if present.
 */
function stripStaticHelpInProd( enabled ) {
	if ( ! enabled ) {
		return null;
	}
	return {
		name: 'wp-desktop-mode-strip-static-help',
		enforce: 'pre',
		apply: 'build',
		transform( code, id ) {
			if ( ! id.endsWith( '.ts' ) ) {
				return null;
			}
			if ( ! id.includes( '/src/ui/components/' ) ) {
				return null;
			}
			const marker = 'static help';
			let start = code.indexOf( marker );
			if ( start < 0 ) {
				return null;
			}
			const eq = code.indexOf( '=', start );
			const braceOpen = code.indexOf( '{', eq );
			if ( eq < 0 || braceOpen < 0 || braceOpen - start > 32 ) {
				return null;
			}
			let depth = 1;
			let i = braceOpen + 1;
			while ( i < code.length && depth > 0 ) {
				const ch = code[ i ];
				if ( ch === '{' ) {
					depth++;
					i++;
				} else if ( ch === '}' ) {
					depth--;
					i++;
				} else if ( ch === '"' || ch === "'" || ch === '`' ) {
					const q = ch;
					i++;
					while ( i < code.length && code[ i ] !== q ) {
						if ( code[ i ] === '\\' ) {
							i += 2;
						} else {
							i++;
						}
					}
					i++;
				} else if ( ch === '/' && code[ i + 1 ] === '/' ) {
					const nl = code.indexOf( '\n', i );
					i = nl < 0 ? code.length : nl + 1;
				} else if ( ch === '/' && code[ i + 1 ] === '*' ) {
					const end = code.indexOf( '*/', i + 2 );
					i = end < 0 ? code.length : end + 2;
				} else {
					i++;
				}
			}
			// Trailing tokens: optional ` as const` (TypeScript widening
			// guard some component classes apply to the descriptor) and
			// the closing `;`. Walk forward until the next `;` or EOL,
			// whichever comes first — we control the source shape so a
			// stray `;` inside the descriptor would already have been
			// consumed by the string/object scanner above.
			let blockEnd = i;
			while ( blockEnd < code.length && code[ blockEnd ] !== ';' && code[ blockEnd ] !== '\n' ) {
				blockEnd++;
			}
			if ( code[ blockEnd ] === ';' ) {
				blockEnd++;
			}
			const replacement = 'static help = void 0;';
			const out = code.slice( 0, start ) + replacement + code.slice( blockEnd );
			return { code: out, map: null };
		},
	};
}

/**
 * Minify the contents of `css\`...\`` tagged-template literals.
 *
 * Esbuild's JS minifier treats template literals as opaque string
 * data — it won't touch their content even when that content is CSS.
 * Every `*.styles.ts` file in `src/ui/components/` defines its
 * stylesheet inside one of these templates, so its CSS comments and
 * indentation ship into the bundle byte-for-byte. This transform
 * runs at the Vite `transform` stage (before esbuild) and rewrites
 * each `css\`…\`` body with a minimal CSS minifier: strip `/* … *\/`
 * block comments, collapse runs of whitespace, drop whitespace
 * adjacent to `{ } : ; , >`.
 *
 * Conservative on purpose:
 *   - Only `.ts` files are inspected.
 *   - Only tagged templates whose tag is the bare identifier `css`
 *     are touched (no `someObj.css\`\``, no `customCss\`\``).
 *   - Interpolation slots (`${…}`) are preserved verbatim — we
 *     minify the literal segments between them and leave the
 *     expression text alone.
 *   - Disabled in dev so source still maps cleanly during debug.
 */
function minifyCssTemplates() {
	// Minify one CSS chunk *between* template interpolations.
	//
	// Crucially, we do NOT `.trim()` here — chunks that end right
	// before a `${…}` slot need to keep their trailing whitespace,
	// and chunks that start right after a `${…}` slot need to keep
	// their leading whitespace. Otherwise a literal like
	//
	//   calc( 100% - ${ CHEVRON_W } )
	//
	// minifies to `calc(100% -${CHEVRON_W} )` and resolves at
	// runtime to `calc(100% -10px)`, which CSS rejects because `-`
	// in `calc()` requires whitespace on both sides (without it,
	// `-10px` parses as a single negative-length token). The
	// `wpd-crumb-chain` chevron polygon broke exactly this way.
	//
	// We still collapse adjacent whitespace and strip it around
	// punctuation that doesn't care (`{ } : ; , >`), so the
	// per-chunk minification is unchanged everywhere else. The
	// leading/trailing whitespace of the WHOLE template gets
	// trimmed once at the call site.
	const minifyCssChunk = ( text ) =>
		text
			.replace( /\/\*[\s\S]*?\*\//g, '' )
			.replace( /\s+/g, ' ' )
			.replace( /\s*([{}:;,>])\s*/g, '$1' )
			.replace( /;}/g, '}' );

	return {
		name: 'wp-desktop-mode-minify-css-templates',
		enforce: 'pre',
		apply: 'build',
		transform( code, id ) {
			if ( ! id.endsWith( '.ts' ) ) {
				return null;
			}
			if ( ! code.includes( 'css`' ) ) {
				return null;
			}

			let out = '';
			let i = 0;
			let changed = false;
			while ( i < code.length ) {
				// Look for the literal `css\`` not preceded by an
				// identifier character — avoids matching `.css\``,
				// `myCss\``, etc.
				const m = code.indexOf( 'css`', i );
				if ( m < 0 ) {
					out += code.slice( i );
					break;
				}
				const prev = m === 0 ? '' : code[ m - 1 ];
				if ( /[A-Za-z0-9_$.]/.test( prev ) ) {
					// Not the bare `css` tag — keep walking.
					out += code.slice( i, m + 4 );
					i = m + 4;
					continue;
				}
				out += code.slice( i, m + 4 ); // up to and including ``css``
				let j = m + 4;
				let segStart = j;
				let interpStart = -1;
				let interpDepth = 0;
				let closed = false;
				while ( j < code.length ) {
					const ch = code[ j ];
					if ( interpDepth === 0 ) {
						if ( ch === '\\' ) {
							j += 2;
							continue;
						}
						if ( ch === '`' ) {
							out += minifyCssChunk( code.slice( segStart, j ) );
							out += '`';
							i = j + 1;
							changed = true;
							closed = true;
							break;
						}
						if ( ch === '$' && code[ j + 1 ] === '{' ) {
							out += minifyCssChunk( code.slice( segStart, j ) );
							interpStart = j;
							interpDepth = 1;
							j += 2;
							continue;
						}
						j++;
					} else {
						if ( ch === '{' ) {
							interpDepth++;
						} else if ( ch === '}' ) {
							interpDepth--;
							if ( interpDepth === 0 ) {
								out += code.slice( interpStart, j + 1 );
								segStart = j + 1;
								interpStart = -1;
							}
						}
						j++;
					}
				}
				if ( ! closed ) {
					// Unterminated template (shouldn't happen on valid TS,
					// but be defensive) — keep the original rest.
					out += code.slice( m + 4 );
					i = code.length;
				}
			}
			return changed ? { code: out, map: null } : null;
		},
	};
}

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
	// Gutenberg drop-receiver — tiny iframe-side bundle enqueued only
	// on post.php / post-new.php. Listens for `desktop-mode-drop`
	// messages from the shell and inserts the corresponding block via
	// `wp.data.dispatch('core/block-editor').insertBlocks(...)`. See
	// `src/drag/iframe-drop-targets.ts` for the shell side.
	'gutenberg-drop-receiver': {
		entry:    'src/gutenberg-drop-receiver.ts',
		fileBase: 'gutenberg-drop-receiver',
		iifeName: 'desktopModeGutenbergDropReceiver',
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
	// WooCommerce integration for the site window — subscribes to the
	// window's `preview-extras` / `group-extras` actions to paint
	// merchant panels. Enqueued only when WooCommerce is active, and
	// deliberately separate from the `my-wordpress` bundle so stores
	// without WooCommerce ship none of it.
	'my-wordpress-woocommerce': {
		entry:    'src/my-wordpress/integrations/woocommerce.ts',
		fileBase: 'my-wordpress-woocommerce',
		iifeName: 'desktopModeMyWordpressWoo',
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
	// Games hub — launcher grid + scoreboard + challenges client.
	// Registers a render callback on
	// `window.desktopModeNativeWindows['desktop-mode-games']`; the
	// games registry itself is shared cross-bundle via
	// `createSharedStore`. `<wpd-*>` tags come from the main bundle.
	games: {
		entry:    'src/games/entry.ts',
		fileBase: 'games',
		iifeName: 'desktopModeGames',
	},
	// Inkfall — the built-in typing game. Lazy-loaded by the games
	// framework on first launch; publishes its GameDef on
	// `window.desktopModeGames.inkfall`. Loads PixiJS through the
	// module registry like content-graph / the canvas wallpapers.
	'game-inkfall': {
		entry:    'src/games/inkfall/index.ts',
		fileBase: 'game-inkfall',
		iifeName: 'desktopModeGameInkfall',
	},
	// Alphabet Soup — the built-in daily word search. Seeded by the
	// current date (dd-mm-yyyy) so the puzzle is identical worldwide;
	// lazy-loaded by the games framework on first launch; publishes
	// its GameDef on `window.desktopModeGames['alphabet-soup']`.
	// Loads PixiJS through the module registry like Inkfall.
	'game-alphabet-soup': {
		entry:    'src/games/alphabet-soup/index.ts',
		fileBase: 'game-alphabet-soup',
		iifeName: 'desktopModeGameAlphabetSoup',
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
	// Living Tree wallpaper — built-in canvas wallpaper that renders the
	// site as a growing plant organism (posts=leaves, comments=flowers,
	// tags=lianas, users=fireflies, traffic=wind). PixiJS-driven, lazy-
	// loaded by the wallpaper server-sync when selected. Publishes the
	// `WallpaperDef` on `window.desktopModeWallpapers['wp-living-tree']`.
	// See docs/living-tree-algorithm.md.
	'living-tree-wallpaper': {
		entry:    'src/plugins/living-tree-wallpaper/index.ts',
		fileBase: 'living-tree-wallpaper',
		iifeName: 'desktopModeLivingTreeWallpaper',
	},
	// Snow wallpaper — built-in canvas wallpaper: PixiJS snowfall that
	// accumulates on window tops (via `wp.desktop.getWallpaperSurfaces`)
	// and melts away. Lazy-loaded by the wallpaper server-sync when
	// selected. Publishes the `WallpaperDef` on
	// `window.desktopModeWallpapers['wp-snow']`; first built-in
	// consumer of the `renderConfig` wallpaper-settings dialog.
	'snow-wallpaper': {
		entry:    'src/plugins/snow-wallpaper/index.ts',
		fileBase: 'snow-wallpaper',
		iifeName: 'desktopModeSnowWallpaper',
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
	// OS Settings panel — the big lazy bundle (Stage 8). Hosts every
	// section renderer + the `<wpd-*>` components only the panel
	// uses (color/range field, swatch, swatch-grid, section,
	// segmented, tabs, panel, empty-state, checkbox-label, button,
	// select, text-field). Loaded on the user's first Settings open
	// by the `OsSettings.renderPanel()` stub. Publishes
	// `window.desktopModeRenderOsSettingsPanel`.
	'os-settings-panel': {
		entry:    'src/settings/panel-entry.ts',
		fileBase: 'os-settings-panel',
		iifeName: 'desktopModeOsSettingsPanel',
	},
	// Mio — the desk companion: a PixiJS soft-body blob with a
	// chroma neon outline that floats over the wallpaper, falls onto
	// nearby windows, watches the pointer, and can be dragged around.
	// Off by default and toggled from Mio's dock tile; the
	// main bundle only carries `src/mio/controller.ts`, which
	// script-injects this bundle on the first switch-on. Publishes
	// `window.desktopModeMountMio`. See docs/mio.md.
	mio: {
		entry:    'src/mio/entry.ts',
		fileBase: 'mio',
		iifeName: 'desktopModeMio',
	},
	// Item-visibility menu — the right-click "hide from dock /
	// desktop" menu + plugin provenance actions. Pure interaction UI
	// that can never be on screen at first paint; injected by the
	// main bundle's `src/item-visibility-menu-loader.ts` shim on the
	// first right-click. Publishes
	// `window.desktopModeItemVisibilityMenu`.
	'item-visibility-menu': {
		entry:    'src/item-visibility-menu-entry.ts',
		fileBase: 'item-visibility-menu',
		iifeName: 'desktopModeItemVisibilityMenu',
	},
	// Release card — the vinyl core-update announcement (card DOM +
	// animation CSS + art resolver). Only needed when an update is
	// pending; injected by `maybeShowUpdate()` in
	// `src/update-notice.ts` after it confirms there is something to
	// announce. Publishes `window.desktopModeReleaseCard`.
	'release-card': {
		entry:    'src/release-card-entry.ts',
		fileBase: 'release-card',
		iifeName: 'desktopModeReleaseCardBundle',
	},
	// Shell overlays — toast, confirm dialog, context menus (Stage 9).
	// Components for action-triggered overlays that aren't constructed
	// at first paint. Preloaded by main after first paint via
	// `preloadShellOverlays( … )` so the first toast / wpdConfirm /
	// right-click feels instant. Side-effect-only bundle: each leaf
	// import runs its `defineComponent( … )` call at top level.
	'shell-overlays': {
		entry:    'src/shell-overlays/entry.ts',
		fileBase: 'shell-overlays',
		iifeName: 'desktopModeShellOverlays',
	},
	// Window system (Stage 11) — the `Window` class + DOM / pointer
	// / tab / chrome helpers. Largest single module in the pre-0.8.4
	// main bundle (~68 kB pre-min just for `window/index.ts`).
	// Loaded on demand by the first call to
	// `WindowManager.open()` / `openNew()` — both async since
	// 0.8.4. Publishes `window.desktopModeWindowSystem`. Pre-loaded
	// by `desktop.ts` after first paint via
	// `preloadWindowSystem( … )` so any "user clicks the first icon"
	// click typically lands on the sync fast path.
	'window-system': {
		entry:    'src/window-system/entry.ts',
		fileBase: 'window-system',
		iifeName: 'desktopModeWindowSystemBundle',
	},
	// Heartbeat widget — built-in PixiJS widget moved out of the
	// main bundle in 0.18.0. Same registration shape third-party
	// widgets use: PHP declares it via `desktop_mode_register_widget()`
	// with the `desktop-mode-heartbeat-widget` script handle; the
	// shell's widgets server-sync loads the bundle on demand. The
	// bundle ships JS + a co-located `styles.css` chunk so widget
	// chrome stays out of the main `desktop.css`.
	'widget-heartbeat': {
		entry:    'src/plugins/heartbeat-widget/index.ts',
		fileBase: 'widget-heartbeat',
		iifeName: 'desktopModeHeartbeatWidget',
	},
	'widget-recent-comments': {
		entry:    'src/plugins/recent-comments-widget/index.ts',
		fileBase: 'widget-recent-comments',
		iifeName: 'desktopModeRecentCommentsWidget',
	},
	'widget-drafts': {
		entry:    'src/plugins/drafts-widget/index.ts',
		fileBase: 'widget-drafts',
		iifeName: 'desktopModeDraftsWidget',
	},
	'widget-post-stats': {
		entry:    'src/plugins/post-stats-widget/index.ts',
		fileBase: 'widget-post-stats',
		iifeName: 'desktopModePostStatsWidget',
	},
	'widget-site-views': {
		entry:    'src/plugins/site-views-widget/index.ts',
		fileBase: 'widget-site-views',
		iifeName: 'desktopModeSiteViewsWidget',
	},

	'widget-jazz-quote': {
		entry:    'src/plugins/jazz-quote-widget/index.ts',
		fileBase: 'widget-jazz-quote',
		iifeName: 'desktopModeJazzQuoteWidget',
	},
	'widget-starter': {
		entry:    'src/plugins/starter-widget/index.ts',
		fileBase: 'widget-starter',
		iifeName: 'desktopModeStarterWidget',
	},
	// Note Pad widget — the pinned-notes composer. Ships JS + a
	// co-located `styles.css` chunk (`widget-notes[.min].css`) that
	// `includes/widgets/widget-notes.php` registers.
	'widget-notes': {
		entry:    'src/plugins/notes-widget/index.ts',
		fileBase: 'widget-notes',
		iifeName: 'desktopModeNotesWidget',
	},
	// Focus Timer widget — a countdown that links to a window and
	// shakes it (via Window.shake()) with an alarm when time is up.
	// Ships JS + a co-located `styles.css` chunk (widget-focus-timer[.min].css)
	// that includes/widgets/widget-focus-timer.php registers.
	'widget-focus-timer': {
		entry:    'src/plugins/focus-timer-widget/index.ts',
		fileBase: 'widget-focus-timer',
		iifeName: 'desktopModeFocusTimerWidget',
	},

	// "Agent chat" window — conversation surface for the agents
	// framework (extended option `agents`). Registers a render
	// callback on `window.desktopModeNativeWindows['desktop-mode-agent-run']`
	// and consumes the `<wpd-*>` tags defined by the main bundle plus
	// the cross-bundle `desktop-mode/agents-chat` shared store seeded
	// by the My WordPress Agents section.
	'agent-run-window': {
		entry:    'src/agent-run-window.ts',
		fileBase: 'agent-run-window',
		iifeName: 'desktopModeAgentRunWindow',
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
		plugins: [
			minifyCssTemplates(),
			stripStaticHelpInProd( isProd ),
			...reportPlugins,
		].filter( Boolean ),
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
			rollupOptions: {
				output: {
					// Vite's lib mode defaults `style.css` for bundled CSS.
					// Rename to match the target's fileBase so a widget
					// bundle and its co-located CSS share a name —
					// `widget-heartbeat[.min].css` next to the JS,
					// matching what `wp_register_style()` looks for in
					// `includes/widgets/heartbeat.php`.
					assetFileNames: ( asset ) => {
						if ( asset.name && asset.name.endsWith( '.css' ) ) {
							return isProd
								? `${ target.fileBase }.min.css`
								: `${ target.fileBase }.css`;
						}
						return '[name].[hash][extname]';
					},
				},
			},
		},
	};
} );
