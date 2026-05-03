<?php
/**
 * Desktop Mode — Routines: trigger listener.
 *
 * On `init`, walk every enabled routine and wire its trigger to the
 * executor. Two trigger kinds:
 *
 *   - `hook` — direct `add_action` on the named hook with the
 *     declared (or default) priority and accepted_args.
 *   - `broadcast` — listens for the broadcast topic via a thin
 *     `wp_desktop_recycle_bin_signal`-style action emitted by the
 *     shell's broadcast bridge. We hook a meta-action
 *     `wp_desktop_broadcast_received` that the shell PHP layer
 *     emits for each cross-window broadcast.
 *
 * Trigger args are passed through the trigger's `binder` (when
 * declared) or fall back to positional `arg0..argN`. The bound
 * payload is what the routine sees as `payload.…`.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Wire all enabled routines to their triggers.
 *
 * Hooked on `init` priority 25 — after the CPT, registries, and
 * trigger declarations have all run.
 *
 * @since 0.22.0
 */
function wpdm_routine_install_triggers() {
	if ( wp_doing_cron() ) {
		// Skip during cron — routines are installed per-request and
		// cron requests don't normally fire user-facing triggers.
		// Specific cron-driven triggers can be wired separately.
	}

	$routines = wpdm_routine_get_all( array( 'enabled' => true, 'per_page' => 500 ) );
	foreach ( $routines as $routine ) {
		wpdm_routine_install_one_trigger( $routine );
	}
}
add_action( 'init', 'wpdm_routine_install_triggers', 25 );

/**
 * Wire a single routine's trigger.
 *
 * Public so callers (tests, the live-refresh bridge once Phase 2
 * lands) can re-install a single routine after it's saved/enabled
 * mid-request without rebuilding the whole listener set.
 *
 * @since 0.22.0
 *
 * @param array $routine Routine row.
 */
function wpdm_routine_install_one_trigger( $routine ) {
	$def        = $routine['def'];
	$trigger    = $def['trigger'];
	$trigger_id = (string) $trigger['id'];
	$kind       = (string) $trigger['kind'];
	$routine_id = (int) $routine['id'];

	$declared      = wpdm_routine_trigger_registry( $trigger_id );
	$accepted_args = is_array( $declared ) ? (int) $declared['accepted_args'] : 4;
	$priority      = (int) $trigger['priority'];

	$callback = static function () use ( $routine_id, $trigger_id, $declared, $kind ) {
		$args    = func_get_args();
		$payload = wpdm_routine_bind_payload( $args, $declared, $kind );
		wpdm_routine_run( $routine_id, $payload, $trigger_id, false );
	};

	if ( 'broadcast' === $kind ) {
		// Broadcast topics are funneled through a single meta-hook
		// `wp_desktop_broadcast_received` with `( $topic, $payload )`.
		// We add a wrapper that filters by topic first.
		add_action(
			'wp_desktop_broadcast_received',
			static function ( $topic, $payload ) use ( $trigger_id, $callback ) {
				if ( $topic === $trigger_id ) {
					$callback( $payload );
				}
			},
			$priority,
			2
		);
		return;
	}

	add_action( $trigger_id, $callback, $priority, $accepted_args );
}

/**
 * Bind raw hook args into a friendly payload.
 *
 * Order of preference:
 *
 *   1. `binder` callable on the declared trigger entry.
 *   2. Positional fallback: `[ 'arg0' => $arg0, 'arg1' => $arg1, ... ]`
 *      with a friendly mirror at `payload[0]`, `payload[1]` for
 *      conditions that just want the raw values.
 *
 * @since 0.22.0
 *
 * @param array      $args     Raw hook args.
 * @param array|null $declared Declared trigger entry.
 * @param string     $kind     Trigger kind.
 * @return array
 */
function wpdm_routine_bind_payload( $args, $declared, $kind ) {
	if ( is_array( $declared ) && isset( $declared['binder'] ) && is_callable( $declared['binder'] ) ) {
		try {
			$bound = call_user_func_array( $declared['binder'], $args );
		} catch ( \Throwable $e ) {
			$bound = null;
		}
		if ( is_array( $bound ) ) {
			return $bound;
		}
	}
	$out = array();
	foreach ( array_values( $args ) as $i => $val ) {
		$out[ 'arg' . $i ] = $val;
		$out[ $i ]         = $val;
	}
	return $out;
}

/**
 * Re-install all triggers — called after a routine is saved,
 * enabled, or disabled mid-request. Triggers added with `add_action`
 * during a request stay attached for the rest of that request only,
 * so the catch-up only matters when the same request fires the
 * trigger after the save (rare in practice; full reinstall on the
 * next request is the dominant path).
 *
 * @since 0.22.0
 *
 * @param int $routine_id Saved routine id.
 */
function wpdm_routine_reinstall_after_save( $routine_id ) {
	$routine = wpdm_routine_get( (int) $routine_id );
	if ( null === $routine || ! $routine['enabled'] ) {
		return;
	}
	wpdm_routine_install_one_trigger( $routine );
}
add_action( 'wp_desktop_routine_saved', 'wpdm_routine_reinstall_after_save', 10, 1 );
