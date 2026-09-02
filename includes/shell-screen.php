<?php
/**
 * OpenStation — the shell screen.
 *
 * The desktop shell is served by an admin screen OpenStation owns:
 * `admin.php?page=openstation`, a menu-hidden page whose only enqueues
 * are OpenStation's own plus the every-admin-page baseline. The shell
 * used to be painted OVER whatever admin screen the portal forwarded
 * to — the Dashboard by default, the last-focused window's URL
 * otherwise — and so inherited that screen's entire script and style
 * queue, its server-side render, and its hidden HTML. On a site running
 * the Gutenberg plugin that meant the whole editor closure printed,
 * parsed and executed in the shell's realm, where nothing ever rendered
 * it (162 requests / 20 MB raw on the QA instance, against 32 requests
 * / 1.8 MB for OpenStation's own assets).
 *
 * The portal keeps its URL and its frozen query vars. The target it
 * already resolves becomes a parameter the shell screen reads instead
 * of a screen the shell rides on:
 *
 *   /openstation/?target=…
 *     → admin.php?page=openstation&target=<admin path>&intent=1
 *   /openstation/
 *     → admin.php?page=openstation            (screen resolves the entry)
 *   /wp-admin/edit.php                        (plain admin GET)
 *     → admin.php?page=openstation&target=/wp-admin/edit.php&intent=1
 *   /wp-admin/index.php?desktop_mode_portal=1 (pre-screen bookmark)
 *     → admin.php?page=openstation&target=/wp-admin/index.php
 *
 * Why an admin page rather than a standalone document served from
 * `parse_request`: `is_admin()` must be true and `admin_menu` /
 * `admin_enqueue_scripts` must fire, because those are the documented
 * contract behind every `openstation_register_*` call, the menu-payload
 * harvest, and every plugin that gates its registration on `is_admin()`
 * at load time. The admin page keeps all of that for free.
 *
 * `openstation_is_shell_request()` is the one predicate for "this
 * request paints the shell". It replaces the implicit "enabled, not
 * chromeless, not classic" that several render hooks used to spell out
 * on their own, each meaning "shell" without saying so.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `page=` slug of the shell screen.
 */
const OPENSTATION_SHELL_PAGE_SLUG = 'openstation';

/**
 * The screen id WordPress assigns to the shell screen —
 * `get_current_screen()->id` and the `$hook_suffix` passed to
 * `admin_enqueue_scripts` on a shell boot.
 *
 * A submenu page registered under an empty parent gets the `admin_`
 * prefix, so this is `admin_page_openstation` rather than a
 * `toplevel_page_*` or `<parent>_page_*` name.
 */
const OPENSTATION_SHELL_SCREEN_ID = 'admin_page_openstation';

/**
 * Query arg on the shell screen carrying the admin URL to open first.
 * Same name and same value shape as the portal's own `target`, so the
 * two are validated by the same sanitiser.
 */
const OPENSTATION_SHELL_TARGET_ARG = 'target';

/**
 * Query arg on the shell screen marking `target` as the user's own
 * navigation intent (a followed link, a bookmark) rather than a
 * destination the portal picked. Mirrors the portal's intent flag; the
 * shell reads it as `fromPortalIntent`.
 */
const OPENSTATION_SHELL_INTENT_ARG = 'intent';

/**
 * Query arg asking the shell screen to boot straight into overview: how
 * a switch from another site's overview lands in this one's, tiles and
 * all (on a network every site is its own OpenStation, see
 * docs/multisite.md). One-shot like the two above — read here, handed
 * to the shell as `landInOverview`, stripped from the address bar.
 */
const OPENSTATION_SHELL_OVERVIEW_ARG = 'openstation_overview';

/**
 * Whether this shell-screen request asked to boot into overview.
 *
 * @return bool
 */
function openstation_shell_lands_in_overview() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing flag.
	return openstation_is_shell_screen_request() && ! empty( $_GET[ OPENSTATION_SHELL_OVERVIEW_ARG ] );
}

/**
 * Builds the shell screen URL, optionally carrying a target.
 *
 * `$target` is an absolute same-origin admin URL or a request-URI-shaped
 * path (`/wp-admin/edit.php?post_type=page`). Either way only its path
 * and query travel: the screen re-validates the value on read through
 * {@see openstation_sanitize_portal_target()}, so the parameter is
 * never trusted from the URL alone. An empty target yields the bare
 * screen URL and the screen resolves the entry itself.
 *
 * The screen exists in both admins, so the URL follows the one the
 * caller is in. `$network` overrides that for callers with no context
 * of their own: `admin-ajax.php` is never the network admin, whatever
 * the click that reached it.
 *
 * @param string    $target  Admin URL to open first, or '' for none.
 * @param bool      $intent  Whether the target is the user's navigation intent.
 * @param bool|null $network Force the network screen (true) or the site
 *                           one (false). Null follows the request.
 * @return string Absolute shell screen URL.
 */
function openstation_shell_url( $target = '', $intent = false, $network = null ) {
	$target = is_string( $target ) ? openstation_shell_normalize_admin_url( $target ) : '';
	$path   = '' !== $target ? wp_parse_url( $target, PHP_URL_PATH ) : '';

	if ( null === $network ) {
		// Follow the admin the TARGET lives in, falling back to the
		// request's own. The network dashboard opened on the site
		// screen would be one admin inside another's shell, which is
		// what the bridge refuses on a link click for the same reason.
		$network = is_string( $path ) && '' !== $path
			? false !== strpos( $path, '/wp-admin/network/' )
			: is_network_admin();
	}

	$screen = 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG;
	$url    = $network ? network_admin_url( $screen ) : admin_url( $screen );

	if ( '' !== $target ) {
		$query = wp_parse_url( $target, PHP_URL_QUERY );
		if ( is_string( $path ) && '' !== $path ) {
			$relative = $path . ( is_string( $query ) && '' !== $query ? '?' . $query : '' );
			$url      = add_query_arg( OPENSTATION_SHELL_TARGET_ARG, rawurlencode( $relative ), $url );
			if ( $intent ) {
				$url = add_query_arg( OPENSTATION_SHELL_INTENT_ARG, '1', $url );
			}
		}
	}

	return $url;
}

/**
 * Rebuilds a URL's query through `http_build_query()`, so every value
 * is percent-encoded exactly once.
 *
 * The portal sanitiser hands back a URL whose query values are decoded
 * (`plugin=dir/file.php`): `add_query_arg()` re-encodes what was already
 * in a query string but not the args it is given. WordPress's own links
 * spell that value `dir%2Ffile.php`, and the shell used to build
 * `currentPage` with `http_build_query( $_GET )`, which does too. Both
 * the redirect the screen is reached by and the page it opens go through
 * here, so the same URL reads the same on every hop.
 *
 * @param string $url URL, absolute or request-URI-shaped.
 * @return string The URL with a normalised query; '' for a non-string.
 */
function openstation_shell_normalize_admin_url( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return '';
	}
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	if ( ! is_string( $query ) || '' === $query ) {
		return $url;
	}
	parse_str( $query, $args );
	$base = substr( $url, 0, (int) strpos( $url, '?' ) );
	$hash = wp_parse_url( $url, PHP_URL_FRAGMENT );

	return $base
		. ( ! empty( $args ) ? '?' . http_build_query( $args ) : '' )
		. ( is_string( $hash ) && '' !== $hash ? '#' . $hash : '' );
}

/**
 * Whether `$url` addresses the shell screen.
 *
 * Accepts absolute URLs and request-URI-shaped paths. Used wherever a
 * URL is about to become a window or a redirect target: the shell must
 * never open itself inside a window, and a saved session or a `target`
 * pointing at the screen must fall back rather than loop.
 *
 * @param string $url URL or path to test.
 * @return bool
 */
function openstation_url_is_shell_screen( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}
	$path  = wp_parse_url( $url, PHP_URL_PATH );
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	if ( ! is_string( $path ) || ! is_string( $query ) ) {
		return false;
	}
	if ( 'admin.php' !== basename( $path ) ) {
		return false;
	}
	parse_str( $query, $args );
	return isset( $args['page'] ) && OPENSTATION_SHELL_PAGE_SLUG === $args['page'];
}

/**
 * Whether the current request is for the shell screen.
 *
 * Reads the current screen once it exists. Before `set_current_screen()`
 * — on `admin_init`, where the portal redirect runs — the screen is
 * not there yet, so the `$plugin_page` global (populated from `?page=`
 * by `admin.php` before `admin_menu`) is the early answer.
 *
 * Says nothing about whether the shell renders here: a disabled user, a
 * chromeless load or a classic-flagged request can all address this
 * screen. {@see openstation_is_shell_request()} is that answer.
 *
 * @return bool
 */
function openstation_is_shell_screen_request() {
	if ( ! is_admin() ) {
		return false;
	}
	if ( function_exists( 'get_current_screen' ) ) {
		$screen = get_current_screen();
		if ( $screen instanceof WP_Screen ) {
			// WordPress suffixes screen ids in the network admin, so
			// the network shell is `admin_page_openstation-network`.
			return in_array(
				$screen->id,
				array( OPENSTATION_SHELL_SCREEN_ID, OPENSTATION_SHELL_SCREEN_ID . '-network' ),
				true
			);
		}
	}
	global $pagenow, $plugin_page;
	return 'admin.php' === $pagenow
		&& isset( $plugin_page )
		&& OPENSTATION_SHELL_PAGE_SLUG === $plugin_page;
}

/**
 * Whether the current request paints the desktop shell.
 *
 * True on the shell screen for a user with OpenStation enabled, and on
 * a solo request (`?openstation_solo=<id>`, the native host's
 * one-window boot, which renders in place wherever it lands). Never
 * inside a window (chromeless) and never on a classic-flagged request.
 *
 * Every hook that used to gate on "enabled, not chromeless, not
 * classic" reads this instead: the shell markup, its assets, the
 * `os-active` body class, native-window templates, the palette
 * deferral, the PWA head tags, desktop-theme styles.
 *
 * @return bool
 */
function openstation_is_shell_request() {
	if ( ! is_admin() ) {
		return false;
	}
	if ( ! openstation_is_enabled() ) {
		return false;
	}
	if ( openstation_is_chromeless_request() || openstation_is_classic_request() ) {
		return false;
	}
	if ( openstation_is_shell_screen_request() ) {
		return true;
	}
	return function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request();
}

/**
 * Registers the shell screen.
 *
 * An empty parent slug keeps the page out of the menu: WordPress only
 * paints submenus of entries that exist in `$menu`, so `$submenu['']`
 * is registered, routable and highlighted nowhere. The `read`
 * capability is the same floor the portal applies, so every user who
 * can enter the desktop can reach its screen.
 */
function openstation_register_shell_screen() {
	$hook = add_submenu_page(
		'',
		__( 'OpenStation', 'desktop-mode' ),
		__( 'OpenStation', 'desktop-mode' ),
		'read',
		OPENSTATION_SHELL_PAGE_SLUG,
		'openstation_render_shell_screen'
	);

	if ( $hook ) {
		add_action( "load-{$hook}", 'openstation_shell_screen_set_title' );
	}
}
add_action( 'admin_menu', 'openstation_register_shell_screen' );
// The network admin builds its menu from its own hook, and the desktop
// is reachable there for the same reason it is on a site: it is where
// the network's own admin pages are. `network/admin.php` routes
// `?page=` exactly as `admin.php` does.
add_action( 'network_admin_menu', 'openstation_register_shell_screen' );

/**
 * Names the shell document, before `admin-header.php` asks for a name.
 *
 * `get_admin_page_title()` finds no title for a page whose parent is the
 * empty menu — it walks `$menu` and `$submenu` for an entry that paints,
 * and this screen deliberately has none. So the global `$title` stayed
 * null, and `admin-header.php` line 41 runs `strip_tags( $title )` on it
 * unconditionally.
 *
 * On PHP 8.1+ that is a deprecation notice, and with `WP_DEBUG_DISPLAY`
 * on it PRINTS — before `<!DOCTYPE html>`, because the header has not
 * emitted it yet. A document whose first bytes are not the doctype loads
 * in QUIRKS MODE, and quirks mode is not a cosmetic difference here: the
 * quirks UA stylesheet stops `<table>` inheriting `color` and `font-*`
 * from its ancestors. Every `<os-table>` in a native window therefore
 * dropped the palette's `--os-ui-fg` and fell back to core's
 * `body { color: #3c434a }` — near-black text on the station's dark
 * surfaces, at 1.3:1 against a table header (#697 → the Pages window).
 *
 * `load-{$hook}` fires in `admin.php` before `admin-header.php` is
 * required, so a real string is in place by the time core reads it.
 * `get_admin_page_title()` then returns early on its own `! empty()`
 * check, which is also what gives the document the word before the
 * chevron: "OpenStation ‹ Site — WordPress".
 *
 * Set unconditionally: the screen wants its name whether or not the
 * shell paints on this request ({@see openstation_render_shell_screen()}
 * answers with a pointer at the portal when it does not).
 */
function openstation_shell_screen_set_title() {
	$GLOBALS['title'] = __( 'OpenStation', 'desktop-mode' ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- naming an admin screen IS writing $title; every core screen does it (options-general.php, edit.php), and admin-header.php reads it moments later.
}

/**
 * The shell screen's page callback.
 *
 * Prints nothing when the shell renders: the markup goes out from
 * `in_admin_header @ 5` ({@see openstation_render_shell()}), the same
 * hook as always, so it lands before the notices and the admin bar
 * rather than after them — moving it here would change stacking and
 * the timing of the `os-active` body class. The callback only speaks
 * when the screen is reached without the shell: a user with
 * OpenStation off, or a classic-flagged request. Then it points at the
 * portal, which is the opt-in surface.
 */
function openstation_render_shell_screen() {
	if ( openstation_is_shell_request() ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'OpenStation', 'desktop-mode' ); ?></h1>
		<p>
			<?php esc_html_e( 'OpenStation is not active for your account on this request.', 'desktop-mode' ); ?>
			<a href="<?php echo esc_url( openstation_portal_url() ); ?>"><?php esc_html_e( 'Open the desktop', 'desktop-mode' ); ?></a>
		</p>
	</div>
	<?php
}

/**
 * Resolves what the shell boots with on this request.
 *
 * On the shell screen the boot page comes from the `target` query arg
 * — validated through the portal's sanitiser and refused when it names
 * the shell screen itself — and falls back to
 * {@see openstation_portal_entry_url()} exactly as the portal used to:
 * the session's focused window, else the default window, else the
 * Dashboard. `fromPortal` is true by construction there (the screen is
 * only ever reached through a redirect), and `fromPortalIntent` is the
 * `intent` arg, honoured only when the target was valid.
 *
 * Off the screen — a solo boot rendering in place — the page is the
 * request's own URL, built from `$pagenow` and `$_GET` with the frozen
 * portal flags stripped so the derived window id matches the dock's.
 *
 * @return array {
 *     @type string $url              Absolute admin URL the shell opens first.
 *     @type bool   $fromPortal       Whether the shell was reached through a redirect.
 *     @type bool   $fromPortalIntent Whether `url` is the user's own navigation intent.
 * }
 */
function openstation_shell_boot_target() {
	if ( openstation_is_shell_screen_request() ) {
		$target = '';
		$intent = false;
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing arg, validated below.
		if ( ! empty( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) && is_scalar( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) ) {
			// `esc_url_raw`, not `sanitize_text_field`, for the reason
			// recorded on the portal handler: the latter strips every
			// percent-encoded sequence and mangles `plugin=dir%2Ffile.php`.
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing arg, validated below.
			$target = openstation_sanitize_portal_target( esc_url_raw( wp_unslash( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) ) );
			if ( '' !== $target ) {
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing arg.
				$intent = ! empty( $_GET[ OPENSTATION_SHELL_INTENT_ARG ] );
			}
		}
		if ( '' === $target ) {
			// The network screen has its own dashboard to fall back to;
			// the saved session belongs to a site, so it would open one
			// admin's window on the other's desktop.
			$target = is_network_admin()
				? network_admin_url( 'index.php' )
				: openstation_portal_entry_url( get_current_user_id() );
		}
		$target = openstation_shell_normalize_admin_url( $target );

		// An admin URL alone names the directory; `$pagenow` on that
		// request is `index.php`, and the dock derives the Dashboard's
		// window id from the file. Keep both sides deriving the same id,
		// naming the file inside the target's OWN admin so a network
		// URL does not resolve to the site's dashboard.
		$path = wp_parse_url( $target, PHP_URL_PATH );
		if ( is_string( $path ) && '/' === substr( $path, -1 ) ) {
			$query  = wp_parse_url( $target, PHP_URL_QUERY );
			$parts  = explode( '?', $target, 2 );
			$target = rtrim( $parts[0], '/' ) . '/index.php'
				. ( is_string( $query ) && '' !== $query ? '?' . $query : '' );
		}

		return array(
			'url'              => $target,
			'fromPortal'       => true,
			'fromPortalIntent' => $intent,
		);
	}

	global $pagenow;
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only, rebuilds the request's own URL.
	$query = $_GET;
	unset( $query[ OPENSTATION_PORTAL_FLAG ], $query[ OPENSTATION_PORTAL_INTENT_FLAG ] );

	return array(
		'url'              => admin_url( (string) $pagenow ) . ( ! empty( $query ) ? '?' . http_build_query( $query ) : '' ),
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
		'fromPortal'       => ! empty( $_GET[ OPENSTATION_PORTAL_FLAG ] ),
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only request flag.
		'fromPortalIntent' => ! empty( $_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] ),
	);
}

/**
 * Finds the dock entry — a top-level item or one of its submenu
 * children — whose URL is the boot page, so the entry window opens
 * with that entry's title and icon rather than the screen's own.
 *
 * On the shell screen `$title` is "OpenStation" and `$parent_file` is
 * empty, which used to be the host screen's title and menu icon: the
 * first window would flash "OpenStation" until the iframe reported its
 * own title. Matching against the dock is the same identity the shell
 * uses to fold the entry window into its tile.
 *
 * @param string $url        Absolute admin URL the shell opens first.
 * @param array  $dock_items Dock payload from `openstation_build_dock_items()`.
 * @return array{title:string,icon:string} Empty strings when nothing matches.
 */
function openstation_shell_boot_target_meta( $url, $dock_items ) {
	$none = array(
		'title' => '',
		'icon'  => '',
	);
	if ( ! is_string( $url ) || '' === $url || ! is_array( $dock_items ) ) {
		return $none;
	}
	$key = openstation_shell_url_match_key( $url );
	if ( '' === $key ) {
		return $none;
	}
	foreach ( $dock_items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}
		$icon = isset( $item['icon'] ) && is_string( $item['icon'] ) ? $item['icon'] : '';
		if ( isset( $item['url'] ) && openstation_shell_url_match_key( $item['url'] ) === $key ) {
			return array(
				'title' => isset( $item['title'] ) ? (string) $item['title'] : '',
				'icon'  => $icon,
			);
		}
		if ( empty( $item['submenu'] ) || ! is_array( $item['submenu'] ) ) {
			continue;
		}
		foreach ( $item['submenu'] as $sub ) {
			if ( is_array( $sub ) && isset( $sub['url'] ) && openstation_shell_url_match_key( $sub['url'] ) === $key ) {
				return array(
					'title' => isset( $sub['title'] ) ? (string) $sub['title'] : '',
					'icon'  => $icon,
				);
			}
		}
	}
	return $none;
}

/**
 * Comparable key for two admin URLs: path plus sorted query, with the
 * chromeless and portal flags dropped — the PHP twin of the shell's
 * `urlMatchKey()`.
 *
 * @param string $url URL to key.
 * @return string '' when the URL has no path.
 */
function openstation_shell_url_match_key( $url ) {
	if ( ! is_string( $url ) ) {
		return '';
	}
	$path = wp_parse_url( $url, PHP_URL_PATH );
	if ( ! is_string( $path ) || '' === $path ) {
		return '';
	}
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	$args  = array();
	if ( is_string( $query ) && '' !== $query ) {
		parse_str( $query, $args );
		unset( $args['openstation_chromeless'], $args[ OPENSTATION_PORTAL_FLAG ], $args[ OPENSTATION_PORTAL_INTENT_FLAG ] );
		ksort( $args );
	}
	return rtrim( $path, '/' ) . '?' . http_build_query( $args );
}

/**
 * Drops operator-named handles from the shell screen's queues.
 *
 * With no host screen, what still prints on the shell is OpenStation's
 * own assets, Core's every-admin-page set, and whatever plugins enqueue
 * on every admin page — a global nag, a tracker, a chat bubble. The
 * framework does not guess which of those "belongs" in the shell; the
 * site says so, through `openstation_shell_dequeue_handles`.
 *
 * Runs at `PHP_INT_MAX` so every plugin has enqueued, and only on a
 * shell boot: windows keep the chromeless trims, classic pages keep
 * everything. A named handle that a surviving script or style still
 * depends on is refused with a `_doing_it_wrong()` rather than dropped,
 * the same closure rule the chromeless trim applies — dequeuing it
 * would strand the dependent. Dequeue, never deregister: a handle that
 * stays registered can still be resolved as a dependency.
 */
function openstation_shell_dequeue_assets() {
	if ( ! openstation_is_shell_request() || ! openstation_is_shell_screen_request() ) {
		return;
	}

	foreach ( array( 'script', 'style' ) as $kind ) {
		/**
		 * Filters the handles dequeued from the shell screen.
		 *
		 * Called once for scripts and once for styles. Default empty:
		 * the shell removes nothing it did not put there unless told
		 * to. A handle a surviving asset depends on is refused.
		 *
		 * @param string[] $handles Handles to dequeue. Default empty.
		 * @param string   $kind    `script` or `style`.
		 */
		$handles = apply_filters( 'openstation_shell_dequeue_handles', array(), $kind );
		$handles = array_values( array_unique( array_filter( (array) $handles, 'is_string' ) ) );
		if ( empty( $handles ) ) {
			continue;
		}

		$registry = 'script' === $kind ? wp_scripts() : wp_styles();
		if ( ! $registry ) {
			continue;
		}

		$drops = array_values( array_intersect( $handles, (array) $registry->queue ) );
		if ( empty( $drops ) ) {
			continue;
		}
		$safe    = openstation_protect_survivor_dependencies( $registry, $registry->queue, $drops );
		$refused = array_diff( $drops, $safe );
		foreach ( $refused as $handle ) {
			_doing_it_wrong(
				__FUNCTION__,
				sprintf(
					/* translators: 1: script or style handle, 2: script or style */
					esc_html__( 'The %2$s handle "%1$s" cannot leave the shell screen: something still enqueued depends on it.', 'desktop-mode' ),
					esc_html( $handle ),
					esc_html( $kind )
				),
				''
			);
		}
		foreach ( $safe as $handle ) {
			if ( 'script' === $kind ) {
				wp_dequeue_script( $handle );
			} else {
				wp_dequeue_style( $handle );
			}
		}
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_shell_dequeue_assets', PHP_INT_MAX );
