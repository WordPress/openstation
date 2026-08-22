<?php
/**
 * OpenStation — Asset guard.
 *
 * Guarantees that every OpenStation style and script that was
 * enqueued for the current admin page actually prints, even when a
 * third-party plugin force-dequeues foreign assets on its own
 * screens.
 *
 * The canonical offender is MailPoet's `ConflictResolver`: on every
 * MailPoet page it dequeues each style and script whose `src` does
 * not match an internal allowlist, hooked at `PHP_INT_MAX` on the
 * enqueue hooks and `PHP_INT_MIN` on the print hooks. Inside a
 * chromeless iframe that strips `os-chromeless` (so the raw admin
 * chrome — the sidebar menu, the classic layout — reappears inside
 * the window), and on a full shell page it would strip the desktop
 * itself. Several "admin cleanup" plugins ship the same pattern, so
 * this is a class of conflict, not a single bug — and no enqueue
 * priority can win a war both sides fight with `PHP_INT_MAX`.
 *
 * The guard therefore doesn't fight at enqueue time at all. It works
 * in two moves:
 *
 *   1. Snapshot. On `admin_enqueue_scripts` it records every queued
 *      handle whose registered `src` lives under `OPENSTATION_URL` —
 *      "these are ours, and this page meant to load them". The
 *      snapshot runs twice: right after our own enqueue callback
 *      (priority 11), and again at `PHP_INT_MAX` so late legitimate
 *      enqueues are seen too. Within the `PHP_INT_MAX` bucket our
 *      callback is registered at plugin load, long before any
 *      stripper registers its own, so it observes the queue first.
 *
 *   2. Re-assert. The `print_styles_array` / `print_scripts_array`
 *      filters run inside `WP_Dependencies::do_items()` — after
 *      every dequeue at every priority has already had its say.
 *      Any snapshotted handle missing from the to-print list (and
 *      not already printed) is appended there, dependencies first.
 *
 * Appending re-asserted styles at the end of the list also puts them
 * after the stripper plugin's own stylesheets in the cascade, which
 * is exactly where the chromeless overrides want to be.
 *
 * The guard never touches assets that aren't ours: a stripper is
 * usually stripping for a reason (its screens break under foreign
 * CSS), and re-asserting the whole queue would recreate the very
 * conflicts it resolves. OpenStation's chromeless and shell sheets
 * are scoped to the `os-chromeless` / `os-active` body classes, so
 * re-asserting them cannot bleed into the host page's own UI.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Accessor for the guard's snapshot of expected handles.
 *
 * @param array|null $set When given, replaces the stored snapshot.
 * @return array {
 *     Handles the current page enqueued from this plugin.
 *
 *     @type string[] $styles  Style handles.
 *     @type string[] $scripts Script handles.
 * }
 */
function openstation_asset_guard_store( $set = null ) {
	static $expected = array(
		'styles'  => array(),
		'scripts' => array(),
	);
	if ( null !== $set ) {
		$expected = $set;
	}
	return $expected;
}

/**
 * Records every queued OpenStation handle as expected to print.
 *
 * A handle is ours when its registered `src` sits under
 * `OPENSTATION_URL`. Third-party chromeless overrides (enqueued on
 * `openstation_chromeless_styles`) deliberately don't match — a
 * plugin that wants its own handles guarded adds them via the
 * `openstation_guarded_styles` / `openstation_guarded_scripts`
 * filters instead.
 */
function openstation_asset_guard_snapshot() {
	$store = openstation_asset_guard_store();
	$pools = array(
		'styles'  => wp_styles(),
		'scripts' => wp_scripts(),
	);
	foreach ( $pools as $type => $dependencies ) {
		foreach ( $dependencies->queue as $handle ) {
			if ( in_array( $handle, $store[ $type ], true ) ) {
				continue;
			}
			if ( ! isset( $dependencies->registered[ $handle ] ) ) {
				continue;
			}
			$src = $dependencies->registered[ $handle ]->src;
			if ( is_string( $src ) && 0 === strpos( $src, OPENSTATION_URL ) ) {
				$store[ $type ][] = $handle;
			}
		}
	}
	openstation_asset_guard_store( $store );
}
add_action( 'admin_enqueue_scripts', 'openstation_asset_guard_snapshot', 11 );
add_action( 'admin_enqueue_scripts', 'openstation_asset_guard_snapshot', PHP_INT_MAX );

/**
 * Collects `$handle` (dependencies first) into `$missing` unless it
 * is already queued to print, already printed, or unregistered.
 *
 * @param WP_Dependencies $dependencies The styles or scripts registry.
 * @param string          $handle       Handle to collect.
 * @param string[]        $to_do        Handles already queued to print.
 * @param string[]        $missing      Collected handles, in print order. Passed by reference.
 */
function openstation_asset_guard_collect( $dependencies, $handle, $to_do, &$missing ) {
	if (
		in_array( $handle, $to_do, true )
		|| in_array( $handle, $missing, true )
		|| in_array( $handle, $dependencies->done, true )
		|| ! isset( $dependencies->registered[ $handle ] )
	) {
		return;
	}
	foreach ( $dependencies->registered[ $handle ]->deps as $dep ) {
		openstation_asset_guard_collect( $dependencies, $dep, $to_do, $missing );
	}
	$missing[] = $handle;
}

/**
 * Appends any expected-but-missing handles to a to-print list.
 *
 * @param WP_Dependencies $dependencies The styles or scripts registry.
 * @param string[]        $to_do        Handles about to be printed.
 * @param string[]        $handles      Handles that must be among them.
 * @return string[] The to-print list with missing handles appended.
 */
function openstation_asset_guard_merge( $dependencies, $to_do, $handles ) {
	$missing = array();
	foreach ( $handles as $handle ) {
		if ( is_string( $handle ) && '' !== $handle ) {
			openstation_asset_guard_collect( $dependencies, $handle, $to_do, $missing );
		}
	}
	if ( empty( $missing ) ) {
		return $to_do;
	}
	return array_merge( $to_do, $missing );
}

/**
 * Re-asserts snapshotted OpenStation styles into the to-print list.
 *
 * Runs inside `WP_Styles::all_deps()`, after any force-dequeue has
 * already happened — the last word before output.
 *
 * @param string[] $to_do Style handles about to be printed.
 * @return string[]
 */
function openstation_asset_guard_print_styles( $to_do ) {
	$store = openstation_asset_guard_store();

	/**
	 * Filters the style handles the asset guard re-asserts at print
	 * time.
	 *
	 * Defaults to every style this plugin enqueued for the current
	 * page. A plugin whose chromeless overrides are stripped by an
	 * asset-cleanup plugin can append its own handles here.
	 *
	 * @param string[] $handles Style handles expected to print.
	 */
	$handles = apply_filters( 'openstation_guarded_styles', $store['styles'] );

	if ( empty( $handles ) || ! is_array( $handles ) ) {
		return $to_do;
	}
	return openstation_asset_guard_merge( wp_styles(), $to_do, $handles );
}
add_filter( 'print_styles_array', 'openstation_asset_guard_print_styles' );

/**
 * Re-asserts snapshotted OpenStation scripts into the to-print list.
 *
 * Only acts during the admin footer pass: every OpenStation bundle
 * is registered `in_footer`, and handles appended during the head
 * pass would print there without their group bookkeeping. Re-added
 * handles are stamped into the footer group so
 * `WP_Scripts::do_item()` finds the entry it expects.
 *
 * @param string[] $to_do Script handles about to be printed.
 * @return string[]
 */
function openstation_asset_guard_print_scripts( $to_do ) {
	if ( ! doing_action( 'admin_print_footer_scripts' ) ) {
		return $to_do;
	}
	$store = openstation_asset_guard_store();

	/**
	 * Filters the script handles the asset guard re-asserts at print
	 * time.
	 *
	 * Defaults to every script this plugin enqueued for the current
	 * page. A plugin whose iframe-side scripts are stripped by an
	 * asset-cleanup plugin can append its own handles here.
	 *
	 * @param string[] $handles Script handles expected to print.
	 */
	$handles = apply_filters( 'openstation_guarded_scripts', $store['scripts'] );

	if ( empty( $handles ) || ! is_array( $handles ) ) {
		return $to_do;
	}
	$scripts = wp_scripts();
	$merged  = openstation_asset_guard_merge( $scripts, $to_do, $handles );
	foreach ( array_diff( $merged, $to_do ) as $handle ) {
		$scripts->groups[ $handle ] = 1;
	}
	return $merged;
}
add_filter( 'print_scripts_array', 'openstation_asset_guard_print_scripts' );
