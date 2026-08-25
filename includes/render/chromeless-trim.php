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
