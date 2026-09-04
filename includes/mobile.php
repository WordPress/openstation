<?php
/**
 * OpenStation — responsive mode: the server's half.
 *
 * The shell renders one of three experiences — `desktop`, `tablet`
 * (reported, rendered as desktop for now) or `mobile`, the phone
 * layer. The mode is a pure function of the viewport width and the
 * user's `mobileLayout` preference, computed in `src/mode/index.ts`.
 * PHP cannot see the viewport, so its job is three things:
 *
 *   1. Ship the inputs — the preference (filterable), the breakpoints
 *      (filterable) and the default tab-bar pins (filterable) — in
 *      the shell config.
 *   2. Print a head stamp: a few bytes of inline script that write
 *      `data-os-mode` on `<html>` from the same rule, before the
 *      body parses, so the first paint on a phone is already the
 *      phone layer and never a flash of desktop.
 *   3. Widen the admin viewport meta so the phone layer can paint
 *      under the notch and resize for the keyboard.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Widest viewport (CSS px, inclusive) that is a phone. */
const OPENSTATION_MODE_MOBILE_MAX_WIDTH = 767;

/** Widest viewport (CSS px, inclusive) that is a tablet. */
const OPENSTATION_MODE_TABLET_MAX_WIDTH = 1024;

/**
 * The user's mode preference: `auto`, `desktop` or `mobile`.
 *
 * @param int|null $user_id User id; defaults to the current user.
 * @return string One of `OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS`.
 */
function openstation_mode_preference( $user_id = null ) {
	$user_id  = null === $user_id ? get_current_user_id() : (int) $user_id;
	$settings = openstation_get_os_settings( $user_id );
	$saved    = isset( $settings['mobileLayout'] ) ? (string) $settings['mobileLayout'] : 'auto';

	/**
	 * Filters the user's mode preference before it reaches the shell.
	 *
	 * Lets a plugin force the phone layer for a role, or keep a kiosk
	 * user on the desktop whatever their device. Returning anything
	 * other than `auto`, `desktop` or `mobile` falls back to the
	 * saved value.
	 *
	 * @param string $preference The saved preference.
	 * @param int    $user_id    The user it applies to.
	 */
	$preference = apply_filters( 'openstation_mode_preference', $saved, $user_id );

	return in_array( $preference, OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS, true )
		? $preference
		: $saved;
}

/**
 * The breakpoints the mode is resolved against.
 *
 * The invariant `0 < mobile < tablet` is enforced after the filter so
 * the three bands stay disjoint whatever a plugin returned.
 *
 * @return array { mobile: int, tablet: int } — the widest viewport of each band.
 */
function openstation_mode_breakpoints() {
	$defaults = array(
		'mobile' => OPENSTATION_MODE_MOBILE_MAX_WIDTH,
		'tablet' => OPENSTATION_MODE_TABLET_MAX_WIDTH,
	);

	/**
	 * Filters the responsive breakpoints, in CSS pixels.
	 *
	 * `mobile` is the widest viewport that gets the phone layer;
	 * `tablet` the widest that reports as a tablet. Both inclusive.
	 *
	 * @param array $breakpoints { mobile: int, tablet: int }.
	 */
	$raw = apply_filters( 'openstation_mode_breakpoints', $defaults );
	$raw = is_array( $raw ) ? $raw : array();

	$mobile = isset( $raw['mobile'] ) && is_numeric( $raw['mobile'] ) && (int) $raw['mobile'] > 0
		? (int) $raw['mobile']
		: $defaults['mobile'];
	$tablet = isset( $raw['tablet'] ) && is_numeric( $raw['tablet'] ) && (int) $raw['tablet'] > 0
		? (int) $raw['tablet']
		: $defaults['tablet'];

	return array(
		'mobile' => $mobile,
		'tablet' => max( $mobile + 1, $tablet ),
	);
}

/**
 * The navigation ids pinned to the phone tab bar by default.
 *
 * The bar has five slots: Home, up to three pins, and the app
 * switcher. A user's own pins (`mobileTabs` in OpenStation
 * Preferences) override this list when set; this is what a user who
 * never chose gets.
 *
 * @return string[] Nav item ids, at most three.
 */
function openstation_mobile_tab_bar() {
	$defaults = array( 'menu-posts', 'menu-media', 'menu-comments' );

	/**
	 * Filters the default phone tab-bar pins.
	 *
	 * Ids are navigation item ids — the same ids `navOrder` uses: an
	 * admin menu's hook name (`menu-posts`, `menu-media`,
	 * `toplevel_page_woocommerce`) or a native window id
	 * (`desktop-mode-recycle-bin`). Each passes through
	 * `sanitize_key()`. Unknown ids are skipped by the shell, so a
	 * pin for a plugin that is not installed is harmless. Only the
	 * first three survive.
	 *
	 * @param string[] $ids Default pins.
	 */
	$ids = apply_filters( 'openstation_mobile_tab_bar', $defaults );
	if ( ! is_array( $ids ) ) {
		return $defaults;
	}

	$out  = array();
	$seen = array();
	foreach ( $ids as $id ) {
		if ( ! is_string( $id ) || '' === $id ) {
			continue;
		}
		$slug = sanitize_key( openstation_canonical_nav_id( $id ) );
		if ( '' === $slug || isset( $seen[ $slug ] ) ) {
			continue;
		}
		$seen[ $slug ] = true;
		$out[]         = $slug;
		if ( count( $out ) >= OPENSTATION_OS_SETTINGS_MOBILE_TABS_MAX ) {
			break;
		}
	}
	return $out;
}

/**
 * The `mode` entry of the shell config blob.
 *
 * @param int|null $user_id User id; defaults to the current user.
 * @return array { preference: string, breakpoints: array, tabBar: string[] }
 */
function openstation_mode_config( $user_id = null ) {
	return array(
		'preference'  => openstation_mode_preference( $user_id ),
		'breakpoints' => openstation_mode_breakpoints(),
		'tabBar'      => openstation_mobile_tab_bar(),
	);
}

/**
 * Whether the server would GUESS this request is a phone.
 *
 * A hint, never a decision: it gates a `prefetch` link for the phone
 * bundle. The real mode is resolved from the viewport by the head
 * stamp and the shell. `wp_is_mobile()` is a user-agent sniff that
 * also matches tablets, which is fine for a low-priority prefetch.
 *
 * @param int|null $user_id User id; defaults to the current user.
 * @return bool
 */
function openstation_mode_hint_is_mobile( $user_id = null ) {
	$preference = openstation_mode_preference( $user_id );
	if ( 'mobile' === $preference ) {
		return true;
	}
	if ( 'desktop' === $preference ) {
		return false;
	}
	return function_exists( 'wp_is_mobile' ) && wp_is_mobile();
}

/**
 * The inline script that stamps `data-os-mode` and `data-os-display`
 * on `<html>`.
 *
 * Mirrors `resolveMode()` and `resolveDisplay()` in
 * `src/mode/index.ts`: a forced preference wins; otherwise the width
 * is compared with the two breakpoints. The display is `standalone`
 * when the document runs as an installed app — the `display-mode`
 * media query matches, or Safari's `navigator.standalone` says the
 * page was launched from the home screen — and `browser` otherwise.
 * Kept to one statement with no dependencies so it can run before
 * anything else in the document.
 *
 * @param string $preference  `auto`, `desktop` or `mobile`.
 * @param array  $breakpoints { mobile: int, tablet: int }.
 * @return string JavaScript source.
 */
function openstation_mode_stamp_script( $preference, $breakpoints ) {
	$preference = in_array( $preference, OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS, true )
		? $preference
		: 'auto';
	$mobile     = (int) $breakpoints['mobile'];
	$tablet     = (int) $breakpoints['tablet'];

	return '(function(){var p=' . wp_json_encode( $preference ) . ','
		. 'w=window.innerWidth||0,'
		. 'm=p==="mobile"?"mobile":p==="desktop"?"desktop":'
		. 'w<=' . $mobile . '?"mobile":w<=' . $tablet . '?"tablet":"desktop",'
		. 'd=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)'
		. '||navigator.standalone===true?"standalone":"browser",'
		. 'h=document.documentElement;'
		. 'h.setAttribute("data-os-mode",m);h.setAttribute("data-os-display",d);})();';
}

/**
 * Prints the head stamp on shell requests.
 *
 * Hooked early on `admin_head` so it precedes every other head
 * script. `<html>` exists by the time `<head>` is being parsed, so
 * the attribute lands before the body — and therefore before the
 * first paint — whatever the stylesheet order.
 */
function openstation_print_mode_stamp() {
	if ( ! function_exists( 'openstation_is_shell_request' ) || ! openstation_is_shell_request() ) {
		return;
	}
	$script = openstation_mode_stamp_script(
		openstation_mode_preference(),
		openstation_mode_breakpoints()
	);
	if ( function_exists( 'wp_print_inline_script_tag' ) ) {
		wp_print_inline_script_tag( $script, array( 'id' => 'os-mode-stamp' ) );
		return;
	}
	// phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript -- a two-line head stamp on pre-5.7 hosts; there is no enqueue slot that runs before the body parses.
	echo '<script id="os-mode-stamp">' . $script . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built by openstation_mode_stamp_script() from integers and a wp_json_encode()d enum.
}
add_action( 'admin_head', 'openstation_print_mode_stamp', 0 );

/**
 * Widens the admin viewport meta on shell requests.
 *
 * `viewport-fit=cover` lets the phone layer paint under the notch
 * and read `env(safe-area-inset-*)`; `interactive-widget=
 * resizes-content` makes the on-screen keyboard shrink the layout
 * rather than overlay it (Chrome for Android; ignored elsewhere).
 * `maximum-scale=1,user-scalable=no` turns page zoom off: the shell
 * is an application surface, not a document — a pinch or a focus
 * zoom leaves the dock, the tab bar and every window half off
 * screen with no way back. Mobile Safari honours the pair for the
 * focus zoom and, in a home-screen app, for the pinch; where it
 * does not, `src/mode/zoom-guard.ts` cancels the gesture itself.
 * Desktop browsers ignore both and keep their own zoom.
 *
 * @param string $meta The viewport meta content.
 * @return string
 */
function openstation_mode_viewport_meta( $meta ) {
	if ( ! function_exists( 'openstation_is_shell_request' ) || ! openstation_is_shell_request() ) {
		return $meta;
	}
	$meta = (string) $meta;
	if ( false === strpos( $meta, 'viewport-fit' ) ) {
		$meta .= ',viewport-fit=cover';
	}
	if ( false === strpos( $meta, 'interactive-widget' ) ) {
		$meta .= ',interactive-widget=resizes-content';
	}
	if ( false === strpos( $meta, 'maximum-scale' ) ) {
		$meta .= ',maximum-scale=1';
	}
	if ( false === strpos( $meta, 'user-scalable' ) ) {
		$meta .= ',user-scalable=no';
	}
	return $meta;
}
add_filter( 'admin_viewport_meta', 'openstation_mode_viewport_meta' );
