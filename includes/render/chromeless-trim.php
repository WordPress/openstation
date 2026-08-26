<?php
/**
 * OpenStation — chromeless asset trim.
 *
 * A window renders a real admin page with the admin bar suppressed:
 * `show_admin_bar` returns false and `wp_admin_bar_render` is removed
 * from `in_admin_header` (see `includes/helpers.php`), so `#wpadminbar`
 * never reaches the DOM inside a chromeless iframe. WordPress and the
 * host still enqueue the bar's scripts and styles, which then load,
 * parse and execute against markup that does not exist — once per
 * window, every window.
 *
 * Measured on a live WordPress.com install, one Settings window:
 *
 *   admin-bar.min.css               20.9 KB
 *   os-admin-bar.js (ours)          17.7 KB
 *   admin-bar.min.js                 3.4 KB
 *   wpcom-notes admin-bar-v2.js      3.1 KB   (cross-origin)
 *   wpcom-notes admin-bar-v2.css     2.4 KB   (cross-origin)
 *   wpcom-admin-bar.js               0.6 KB
 *   notes-common-lite.min.js         0.5 KB   (cross-origin)
 *   a8c-faux-inline-help.js          0.2 KB
 *                                   -------
 *                                   48.8 KB + three cross-origin round
 *                                             trips, for a bar the
 *                                             window does not draw.
 *
 * **Dequeue, never deregister.** A handle that stays registered can
 * still be pulled in as another script's dependency, which is exactly
 * the safety property we want: if some third-party script genuinely
 * depends on `admin-bar`, WordPress resolves it and that script keeps
 * working. Deregistering would strand the dependent instead. The cost
 * of that choice is that a dependency-pulled handle survives the trim
 * — correct behaviour, and the reason this list covers the whole
 * family rather than core's handle alone.
 *
 * Third-party handles ship in the defaults on purpose: they are
 * admin-bar-only by construction (a masterbar, a notifications panel),
 * and leaving them queued would drag core's `admin-bar` back in as a
 * dependency, undoing the trim. Sites that need one of them back can
 * filter it out.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Script handles dropped inside chromeless windows.
 *
 * @return string[]
 */
function openstation_chromeless_trimmed_scripts() {
	$handles = array(
		// Core's admin bar behaviour (hover intent, search, shortcuts).
		'admin-bar',
		// OpenStation's own toggle bundle. Also guarded at its enqueue
		// site in `includes/admin-bar.php`; listed here so the trim is
		// complete even if a plugin re-enqueues it.
		'os-admin-bar',
		// WordPress.com / Jetpack masterbar family.
		'wpcom-admin-bar',
		'wpcom-notes-common',
		'wpcom-notes-admin-bar',
		'a8c-faux-inline-help',
	);

	/**
	 * Filters the script handles dequeued inside chromeless windows.
	 *
	 * Everything here is chrome the window never renders. Add a handle
	 * to reclaim its parse/execute cost per window; remove one if your
	 * site genuinely needs it inside a window.
	 *
	 * @param string[] $handles Script handles to dequeue.
	 */
	return (array) apply_filters( 'openstation_chromeless_trimmed_scripts', $handles );
}

/**
 * Style handles dropped inside chromeless windows.
 *
 * @return string[]
 */
function openstation_chromeless_trimmed_styles() {
	$handles = array(
		// Core's admin-bar stylesheet. Dropping it also removes the
		// source of the 32px `html.wp-toolbar` padding; the
		// `!important` override in `chromeless.css` stays as the
		// belt-and-braces half of that pair and must not be removed.
		'admin-bar',
		'wpcom-notes-admin-bar',
	);

	/**
	 * Filters the style handles dequeued inside chromeless windows.
	 *
	 * @param string[] $handles Style handles to dequeue.
	 */
	return (array) apply_filters( 'openstation_chromeless_trimmed_styles', $handles );
}

/**
 * Drops chrome-only assets inside chromeless windows.
 *
 * Runs at `PHP_INT_MAX` on `admin_enqueue_scripts` so it sees the queue
 * after every plugin has had its say. No-op outside chromeless
 * requests — the shell itself draws a real admin bar and must keep all
 * of this.
 */
function openstation_chromeless_trim_assets() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	foreach ( openstation_chromeless_trimmed_scripts() as $handle ) {
		wp_dequeue_script( $handle );
	}
	foreach ( openstation_chromeless_trimmed_styles() as $handle ) {
		wp_dequeue_style( $handle );
	}

	/**
	 * Fires after OpenStation trims chrome-only assets in a window.
	 *
	 * The point to dequeue anything else that only exists to decorate
	 * admin chrome a window does not draw.
	 */
	do_action( 'openstation_chromeless_trimmed_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_trim_assets', PHP_INT_MAX );

/**
 * Drops WordPress's emoji polyfill inside chromeless windows.
 *
 * **What this actually is**, because it is easy to overstate: the
 * inline detection script tests the browser against the newest Unicode
 * emoji set, and when anything is missing it pulls in
 * `wp-emoji-release.min.js` (Twemoji, 22 KB) to swap those characters
 * for images. It is a compatibility polyfill, not dead code — a live
 * measurement on current Chrome showed the 22 KB file genuinely
 * loading inside a window, because browsers routinely lag the newest
 * emoji.
 *
 * **Why dropping it in a window is still right.** Core sets the
 * precedent itself: `wp-admin/edit-form-blocks.php` removes this exact
 * action on the block-editor screen. The only thing lost inside a
 * window is that a very new emoji in admin content — a post title, a
 * comment — renders with the operating system's own glyph (or its
 * fallback) instead of a Twemoji image. And the shell that hosts these
 * windows already requires service workers, custom elements, ES2020
 * and `:has()`; a browser that clears that bar is not one that needs
 * help drawing emoji at all.
 *
 * Removal happens on `admin_init` because `wp_enqueue_emoji_styles`
 * rides `admin_enqueue_scripts` at the default priority — by the time
 * the handle trim above runs at `PHP_INT_MAX`, it has already fired.
 * This is the same hook and the same reasoning as the admin-bar
 * suppression in `includes/helpers.php`.
 */
function openstation_chromeless_suppress_emoji() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	/**
	 * Filters whether the emoji polyfill is dropped inside windows.
	 *
	 * Return `false` to keep Twemoji's image replacement for admin
	 * content shown in a window.
	 *
	 * @param bool $trim Defaults to `true`.
	 */
	if ( ! apply_filters( 'openstation_chromeless_trim_emoji', true ) ) {
		return;
	}

	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
	// Retained by Core for back-compat and normally unhooked by
	// `wp_enqueue_emoji_styles()`; removed here because we just took
	// that away, and it would otherwise print the styles instead.
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
}
add_action( 'admin_init', 'openstation_chromeless_suppress_emoji' );

/**
 * The Core command-palette root handles.
 *
 * `wp-commands` is the `core/commands` store package; `wp-core-commands`
 * registers WordPress's baseline command set on top of it. Everything
 * else in the family reaches the palette *through* one of these two, so
 * they are both the things to drop and the marker that identifies a
 * dependent as a palette contributor.
 *
 * @return string[]
 */
function openstation_command_palette_root_handles() {
	/**
	 * Filters the handles treated as command-palette roots.
	 *
	 * A queued script whose dependency closure reaches one of these is
	 * considered a palette contributor and is trimmed inside windows.
	 *
	 * @param string[] $handles Root handles.
	 */
	return (array) apply_filters(
		'openstation_command_palette_root_handles',
		array( 'wp-commands', 'wp-core-commands' )
	);
}

/**
 * Whether a handle is one of Core's own bundled packages.
 *
 * **This is the line between a palette contributor and a library, and
 * getting it wrong breaks the block editor.** `wp-block-editor` declares
 * `wp-commands` directly:
 *
 *     wp-block-editor => …, wp-blocks, wp-commands, wp-components, …
 *     wp-editor       => …, wp-block-editor, wp-commands, …
 *
 * It does so because the editor *registers* commands into the palette
 * store — the dependency runs the opposite way from a palette extension,
 * which *is* the palette. A closure walk cannot tell those apart, so
 * without this exclusion the walk convicts the whole block-editor stack
 * and drops it, taking every plugin's block-registration script with it.
 * Measured on `customize.php` before this rule existed: the block-widgets
 * panel lost `wp-block-editor`, and Contact Form 7's and MailPoet's block
 * scripts went with it.
 *
 * Core packages are therefore never *dependents* to be trimmed. They are
 * libraries, and `WP_Dependencies` already knows how to decide whether
 * one is needed: if something still queued requires it, it resolves and
 * stays; if the only thing that wanted it was the palette, it falls out
 * on its own. The roots themselves are exempt from this rule — they are
 * the palette, not a library it uses.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string          $handle       Handle to test.
 * @return bool
 */
function openstation_is_core_package_handle( $dependencies, $handle ) {
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		return false;
	}
	$src = $dependencies->registered[ $handle ]->src;

	return ( is_string( $src ) && false !== strpos( $src, '/wp-includes/js/dist/' ) );
}

/**
 * Whether `$handle`'s dependency closure reaches any of `$roots`.
 *
 * `$memo` is passed by reference and shared across every candidate in a
 * single {@see openstation_command_palette_family()} call, so each node
 * is decided once per call rather than once per candidate that happens
 * to sit above it. The Gutenberg graph is dense with shared nodes, and
 * the walk runs twice per request (dequeue, then print list), so a
 * per-candidate guard re-walks the same subgraph repeatedly.
 *
 * A handle currently being walked is memoized as `null`, which reads as
 * "not yet known" and breaks a dependency cycle the same way a visited
 * set would.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string          $handle       Handle to test.
 * @param string[]        $roots        Root handles to look for.
 * @param array           $memo         Handle => verdict, by reference.
 * @return bool
 */
function openstation_handle_depends_on( $dependencies, $handle, $roots, &$memo ) {
	if ( array_key_exists( $handle, $memo ) ) {
		// `null` means "in progress" — a cycle, which reaches nothing new.
		return ( true === $memo[ $handle ] );
	}
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		$memo[ $handle ] = false;
		return false;
	}

	$memo[ $handle ] = null;
	$result          = false;

	foreach ( $dependencies->registered[ $handle ]->deps as $dep ) {
		if ( in_array( $dep, $roots, true ) ) {
			$result = true;
			break;
		}

		/*
		 * Never route through a Core package. Reaching the palette *via*
		 * `wp-block-editor` says something about the editor, not about
		 * this handle: Contact Form 7's block script declares
		 * `wp-block-editor`, and traversing into it would convict the
		 * block script of being a palette extension. A real palette
		 * extension names the palette in its own chain — Astra's and
		 * WooCommerce's both list `wp-commands` directly.
		 */
		if ( openstation_is_core_package_handle( $dependencies, $dep ) ) {
			continue;
		}
		if ( openstation_handle_depends_on( $dependencies, $dep, $roots, $memo ) ) {
			$result = true;
			break;
		}
	}

	$memo[ $handle ] = $result;
	return $result;
}

/**
 * The command-palette family present in a given handle list.
 *
 * Returns the roots plus every handle in `$handles` that reaches one of
 * them without routing through a Core package — Astra's
 * `astra-command-palette`, WooCommerce's `command-palette`, and anything
 * else a plugin registers *against* the palette. See
 * {@see openstation_is_core_package_handle()} for why that second
 * condition is load-bearing rather than a tidiness rule.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string[]        $handles      Handles to scan.
 * @return string[] Handles to drop.
 */
function openstation_command_palette_family( $dependencies, $handles ) {
	$roots  = openstation_command_palette_root_handles();
	$family = $roots;
	$memo   = array();

	foreach ( $handles as $handle ) {
		if ( in_array( $handle, $family, true )
			|| openstation_is_core_package_handle( $dependencies, $handle ) ) {
			continue;
		}
		if ( openstation_handle_depends_on( $dependencies, $handle, $roots, $memo ) ) {
			$family[] = $handle;
		}
	}

	/**
	 * Filters the command-palette handles dropped inside windows.
	 *
	 * Remove a handle here to keep it inside windows — the escape hatch
	 * for a script that registers commands *and* renders part of its own
	 * admin screen, which the dependency walk cannot tell apart.
	 *
	 * @param string[] $family  Handles about to be dropped.
	 * @param string[] $handles The handles that were scanned.
	 */
	return (array) apply_filters( 'openstation_command_palette_family', $family, $handles );
}

/**
 * The palette contributors among `$handles` — the family, less the
 * roots.
 *
 * A contributor is a script whose reason to exist is the command
 * palette: Astra's `command-palette.js`, WooCommerce's
 * `command-palette.js` / `command-palette-analytics.js`. The roots are
 * the palette itself, not contributions to it, so they are excluded.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string[]        $handles      Handles to scan.
 * @return string[] Contributor handles.
 */
function openstation_command_palette_contributors( $dependencies, $handles ) {
	return array_values(
		array_diff(
			openstation_command_palette_family( $dependencies, $handles ),
			openstation_command_palette_root_handles()
		)
	);
}

/**
 * The plugin or theme directory a handle's `src` lives in.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string          $handle       Handle to resolve.
 * @return string Directory slug, or '' for core / unregistered handles.
 */
function openstation_command_palette_handle_owner( $dependencies, $handle ) {
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		return '';
	}
	$src = $dependencies->registered[ $handle ]->src;
	if ( ! is_string( $src ) || '' === $src ) {
		return '';
	}
	if ( preg_match( '#/wp-content/(?:plugins|mu-plugins|themes)/([^/]+)/#', $src, $matches ) ) {
		return $matches[1];
	}
	return '';
}

/**
 * Whether a contributor's own plugin owns the current admin screen.
 *
 * The exemption that lets a plugin keep its palette script *under its
 * own route*: on its own screen a plugin registers screen-specific
 * commands, rather than the site-wide ones the shell already carries
 * once for everybody.
 *
 * The default is deliberately conservative, because a false positive
 * costs that window the whole chain: it matches when the request is for
 * a file inside the plugin's own directory, or when the `page` query
 * var is prefixed by the plugin's directory slug — the two shapes a
 * plugin-owned admin route actually takes. A plugin whose menu slug
 * resembles nothing in its folder name should claim its route through
 * the filter rather than by loosening this.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string          $handle       Contributor handle.
 * @return bool
 */
function openstation_command_palette_owns_screen( $dependencies, $handle ) {
	$owner = openstation_command_palette_handle_owner( $dependencies, $handle );

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only screen routing.
	$page = isset( $_GET['page'] )
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only screen routing.
		? sanitize_text_field( wp_unslash( $_GET['page'] ) )
		: '';
	$uri  = isset( $_SERVER['REQUEST_URI'] )
		? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) )
		: '';

	$owns = false;
	if ( '' !== $owner ) {
		if ( false !== strpos( $uri, '/wp-content/plugins/' . $owner . '/' )
			|| false !== strpos( $uri, '/wp-content/themes/' . $owner . '/' ) ) {
			$owns = true;
		} elseif ( '' !== $page && 0 === strpos( $page, $owner ) ) {
			$owns = true;
		}
	}

	/**
	 * Filters whether a palette contributor may load in this window.
	 *
	 * Return true to keep the contributor — and, necessarily, the
	 * palette runtime it depends on — inside a window on this screen.
	 *
	 * @param bool   $owns   Whether the contributor owns this screen.
	 * @param string $handle Contributor handle.
	 * @param string $owner  The handle's plugin/theme directory slug.
	 * @param string $page   The `page` query var, if any.
	 */
	return (bool) apply_filters( 'openstation_command_palette_contributor_owns_screen', $owns, $handle, $owner, $page );
}

/**
 * The palette handles to drop from a window's queue.
 *
 * Empty when a contributor owns the current screen: keeping that
 * contributor means keeping the roots it depends on, so there is
 * nothing left to drop. That is the deliberate price of the exemption
 * — the plugin's own admin screen pays for the runtime its commands
 * need, and no other window does.
 *
 * @param WP_Dependencies $dependencies The scripts registry.
 * @param string[]        $handles      Handles to scan.
 * @return string[] Handles to drop; empty when a contributor owns the screen.
 */
function openstation_chromeless_command_palette_drops( $dependencies, $handles ) {
	foreach ( openstation_command_palette_contributors( $dependencies, $handles ) as $handle ) {
		if ( openstation_command_palette_owns_screen( $dependencies, $handle ) ) {
			return array();
		}
	}

	return openstation_command_palette_family( $dependencies, $handles );
}

/**
 * Whether this request should drop the Core command-palette runtime.
 *
 * **Why a window never needs it.** ⌘K inside a window belongs to the
 * shell: the desktop owns the palette, the keystroke is handled in the
 * parent frame, and the parent only asks a window for its commands when
 * the palette is actually opened (`os-commands-subscribe`, sent from
 * `onPaletteOpened()` in `src/commands/iframe-bridge.ts`). The runtime
 * that answers that request was nevertheless loaded eagerly in every
 * window, on the chance the user might one day press ⌘K while that
 * window happened to hold focus.
 *
 * What that cost, measured on a live install opening Settings in a
 * window: 43 files, 10.66 MB raw / 1.94 MB gzipped — react, react-dom,
 * `components.js` (3.7 MB), `block-editor.js` (3.7 MB), `core-data`,
 * `blocks`, `sync` — **73.6% of everything the window downloaded**, then
 * parsed and executed again in each window's own JavaScript realm,
 * where an HTTP cache hit buys nothing.
 *
 * **Block-editor screens are exempt.** `post.php`, `post-new.php`, the
 * site editor and the widgets screen load that same chain for their own
 * reasons, so the palette rides along for the cost of `commands.js` +
 * `core-commands.js` (~150 KB) — and those are exactly the screens whose
 * stores hold commands worth harvesting ("Duplicate block", pattern
 * commands). Trimming there would cost real functionality and save
 * nothing. Everywhere else the store only ever holds the WordPress
 * baseline, which the shell already publishes itself from its own
 * lazily-loaded runtime (`src/commands/shell-harvester.ts`).
 *
 * @return bool
 */
function openstation_chromeless_should_trim_command_palette() {
	if ( ! openstation_is_chromeless_request() ) {
		return false;
	}

	$trim = ! openstation_chromeless_screen_uses_block_editor();

	/**
	 * Filters whether the Core command-palette runtime is dropped in a
	 * window.
	 *
	 * Return `false` to keep Core's palette — and its Gutenberg
	 * dependency chain — inside windows on this screen.
	 *
	 * @param bool $trim Whether to trim. Defaults to true off block-editor screens.
	 */
	return (bool) apply_filters( 'openstation_chromeless_trim_command_palette', $trim );
}

/**
 * Whether the current admin screen renders the block editor.
 *
 * `WP_Screen::is_block_editor()` covers `post.php` / `post-new.php`.
 * The site editor and the block-based widgets screen load the same
 * runtime without setting that flag, so they are named explicitly.
 *
 * **`customize.php` is deliberately not in this list.** It was, on the
 * assumption that the block-widgets panel made it an editor screen.
 * Measured, it is not one worth exempting: the Customizer keeps its own
 * Gutenberg chain either way — that chain has real consumers there, and
 * they hold it — so the trim removes only the palette and the palette
 * extensions, and the exemption bought nothing. Verified on a live
 * install that `wp-block-editor`, `wp-blocks`, `wp-components` and every
 * plugin block script survive the trim on that screen.
 *
 * @return bool
 */
function openstation_chromeless_screen_uses_block_editor() {
	global $pagenow;

	if ( in_array( $pagenow, array( 'site-editor.php', 'widgets.php' ), true ) ) {
		return true;
	}
	if ( ! function_exists( 'get_current_screen' ) ) {
		return false;
	}
	$screen = get_current_screen();

	return ( $screen instanceof WP_Screen && $screen->is_block_editor() );
}

/**
 * Keeps Core's boot-time palette enqueue off window pages.
 *
 * Removing the callback rather than dequeuing its handles afterwards
 * also skips the work it does *before* enqueuing anything: a walk of
 * `$menu` and `$submenu` running `current_user_can()` and
 * `menu_page_url()` per entry, serialized into a 19.6 KB inline
 * `wp.coreCommands.initializeCommandPalette( … )` blob — per window.
 *
 * Priority 0, ahead of Core's default 10. The shell's own deferral
 * lives in {@see openstation_defer_core_command_palette()}; this is
 * the window half of the same idea.
 */
function openstation_chromeless_defer_command_palette() {
	if ( ! openstation_chromeless_should_trim_command_palette() ) {
		return;
	}
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_defer_command_palette', 0 );

/**
 * Drops the command-palette family inside windows.
 *
 * Unhooking Core's enqueue above is necessary but nowhere near
 * sufficient, and a live measurement showed exactly why: with Core's
 * palette deferred, a Settings window still pulled 14.28 MB of the
 * original 14.49 MB, because Astra's `command-palette.js` and
 * WooCommerce's `command-palette.js` / `command-palette-analytics.js`
 * each declare `wp-commands` as a dependency and were still queued.
 * `WP_Dependencies::all_deps()` then pulls the entire chain back in on
 * their behalf. Dropping the roots alone saves nothing while a single
 * dependent survives — which is the same lesson the admin-bar trim
 * above records, and the reason both are family trims.
 *
 * Runs at `PHP_INT_MAX` so it sees the queue after every plugin has
 * had its say. Dequeue, never deregister: a handle that stays
 * registered can still be resolved as a dependency by something that
 * genuinely needs it.
 */
function openstation_chromeless_trim_command_palette() {
	if ( ! openstation_chromeless_should_trim_command_palette() ) {
		return;
	}

	$scripts = wp_scripts();
	if ( ! $scripts ) {
		return;
	}

	$drops = openstation_chromeless_command_palette_drops( $scripts, $scripts->queue );
	foreach ( $drops as $handle ) {
		wp_dequeue_script( $handle );
	}
	if ( ! empty( $drops ) ) {
		foreach ( openstation_command_palette_root_handles() as $handle ) {
			wp_dequeue_style( $handle );
		}
	}

	/**
	 * Fires after OpenStation drops the command-palette family in a window.
	 */
	do_action( 'openstation_chromeless_trimmed_command_palette' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_trim_command_palette', PHP_INT_MAX );

/**
 * Second pass: strip the palette family from the actual print list.
 *
 * Same two survivors as the named trim below — late enqueues and
 * dependency pull-back — but the family has to be recomputed here
 * rather than reused, because a handle enqueued after
 * `admin_enqueue_scripts` was never in the queue the dequeue pass
 * scanned. The walk runs against the to-print list, which is the last
 * word before output.
 *
 * @param string[] $handles Script handles about to print.
 * @return string[]
 */
function openstation_chromeless_filter_palette_print_list( $handles ) {
	if ( ! is_array( $handles ) || ! openstation_chromeless_should_trim_command_palette() ) {
		return $handles;
	}
	$scripts = wp_scripts();
	if ( ! $scripts ) {
		return $handles;
	}
	$drops = openstation_chromeless_command_palette_drops( $scripts, $handles );

	return array_values( array_diff( $handles, $drops ) );
}
add_filter( 'print_scripts_array', 'openstation_chromeless_filter_palette_print_list' );

/**
 * Second pass: strip the palette style roots from the print list.
 *
 * @param string[] $handles Style handles about to print.
 * @return string[]
 */
function openstation_chromeless_filter_palette_style_print_list( $handles ) {
	if ( ! is_array( $handles ) || ! openstation_chromeless_should_trim_command_palette() ) {
		return $handles;
	}
	// A contributor that owns this screen keeps the runtime, and its
	// stylesheet with it — otherwise the palette it is allowed to show
	// would render unstyled.
	$scripts = wp_scripts();
	if ( $scripts
		&& empty( openstation_chromeless_command_palette_drops( $scripts, $scripts->queue ) ) ) {
		return $handles;
	}

	return array_values(
		array_diff( $handles, openstation_command_palette_root_handles() )
	);
}
add_filter( 'print_styles_array', 'openstation_chromeless_filter_palette_style_print_list' );

/**
 * Second pass: strip trimmed handles from the actual print list.
 *
 * The dequeue above cannot be the whole story, and a live install
 * showed exactly why. Two things survive it:
 *
 *   1. **Late enqueues.** A host mu-plugin that queues its masterbar
 *      assets after `admin_enqueue_scripts` has already run is simply
 *      not in the queue yet when we dequeue. WordPress.com's
 *      `wpcom-notes-*` handles behave this way.
 *   2. **Dependency pull-back.** `WP_Dependencies::all_deps()` pulls a
 *      dequeued-but-registered handle back in when something still
 *      queued declares it as a dependency. Core's `admin-bar`
 *      stylesheet rode back in on the notes stylesheet exactly so.
 *
 * `print_scripts_array` / `print_styles_array` run inside `do_items()`
 * after every enqueue, dequeue and dependency walk has finished, so
 * they are the last word. Scope stays the same list — a handle nobody
 * asked us to trim is never touched — and because the list covers the
 * whole family, removing one member never strands another member that
 * depended on it.
 *
 * @param string[] $handles Handles WordPress is about to print.
 * @param string   $kind    'scripts' or 'styles'.
 * @return string[] Filtered handles.
 */
function openstation_chromeless_filter_print_list( $handles, $kind ) {
	if ( ! is_array( $handles ) || ! openstation_is_chromeless_request() ) {
		return $handles;
	}
	$trim = 'scripts' === $kind
		? openstation_chromeless_trimmed_scripts()
		: openstation_chromeless_trimmed_styles();

	return array_values( array_diff( $handles, $trim ) );
}

add_filter(
	'print_scripts_array',
	static function ( $handles ) {
		return openstation_chromeless_filter_print_list( $handles, 'scripts' );
	}
);
add_filter(
	'print_styles_array',
	static function ( $handles ) {
		return openstation_chromeless_filter_print_list( $handles, 'styles' );
	}
);

/**
 * Hoists the shell's palette contributors into the deferred manifest.
 *
 * The shell already defers Core's own palette runtime and replays it on
 * the first ⌘K. Plugin contributors defeated that completely: they are
 * enqueued normally, they declare `wp-commands`, and
 * `WP_Dependencies::all_deps()` therefore pulled the palette chain back
 * into the boot document on their behalf — the deferral was in place
 * and paying for nothing.
 *
 * Worse, it did not even work. A contributor that ran at boot
 * registered its commands against a `core/commands` store that does not
 * exist yet, and lost them. Hoisting fixes the bug and the cost
 * together: the contributor now executes as part of the replay, *after*
 * the store exists, so a plugin's commands reach the palette **once, on
 * the shell**, and cost no window anything.
 *
 * Runs at `PHP_INT_MAX` so every plugin has enqueued. Appends to
 * `openStationConfig.commandPalette.scripts` through a `before` inline
 * on our own bundle, which prints after the localized config object and
 * before the bundle that reads it. `src/commands/palette-assets.ts`
 * de-duplicates by handle, so a dependency the Core manifest already
 * lists is never executed twice — and re-running `wp-data` would wipe
 * every store registered against the first copy.
 */
function openstation_shell_hoist_command_palette_contributors() {
	if ( ! openstation_is_enabled()
		|| openstation_is_chromeless_request()
		|| openstation_is_classic_request() ) {
		return;
	}
	$scripts = wp_scripts();
	if ( ! $scripts || ! wp_script_is( 'openstation', 'enqueued' ) ) {
		return;
	}

	$contributors = openstation_command_palette_contributors( $scripts, $scripts->queue );
	if ( empty( $contributors ) ) {
		return;
	}

	// Resolve each contributor's ordered chain on a clone, so the
	// request's real `$to_do` / `$done` state is untouched.
	$probe        = clone $scripts;
	$probe->to_do = array();
	$probe->done  = array();
	$probe->all_deps( $contributors );

	// `all_deps()` bails out wholesale if any single dependency is
	// unregistered — and every contributor depends on `wp-commands`,
	// which a pre-6.9 site simply does not have. Falling back to the
	// contributors themselves keeps the hoist working there: their Core
	// dependencies are already carried by the Core manifest this list is
	// appended to, so the contributor script is the only part that has
	// to come from here.
	$chain = $probe->to_do;
	foreach ( $contributors as $handle ) {
		if ( ! in_array( $handle, $chain, true ) ) {
			$chain[] = $handle;
		}
	}

	$entries = array();
	foreach ( $chain as $handle ) {
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url']
			&& empty( $payload['before'] )
			&& empty( $payload['after'] )
			&& empty( $payload['l10n'] ) ) {
			continue;
		}
		$entries[] = array(
			'handle'       => (string) $handle,
			'url'          => $payload['url'],
			'before'       => $payload['before'],
			'after'        => $payload['after'],
			'l10n'         => $payload['l10n'],
			'translations' => $payload['translations'],
		);
	}

	// Unwind: none of it prints at boot any more. Dequeue, never
	// deregister — anything that genuinely depends on one of these
	// still resolves it.
	foreach ( $contributors as $handle ) {
		wp_dequeue_script( $handle );
	}

	if ( empty( $entries ) ) {
		return;
	}

	wp_add_inline_script(
		'openstation',
		sprintf(
			'(function(c){if(!c||!c.commandPalette)return;var s=c.commandPalette.scripts;if(!s)return;Array.prototype.push.apply(s,%s);})(window.openStationConfig);',
			wp_json_encode( $entries )
		),
		'before'
	);

	/**
	 * Fires after the shell hoists palette contributors into the
	 * deferred manifest.
	 *
	 * @param string[] $contributors Handles moved off the boot document.
	 */
	do_action( 'openstation_command_palette_contributors_hoisted', $contributors );
}
add_action( 'admin_enqueue_scripts', 'openstation_shell_hoist_command_palette_contributors', PHP_INT_MAX );
