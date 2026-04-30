<?php
/**
 * Desktop Mode — Recycle Bin: real-time signal layer.
 *
 * Two non-polling paths feed the open Recycle Bin window:
 *
 *   1. **Fast path — chromeless iframe**
 *      Every recycle-bin-relevant action (`wp_trash_post`,
 *      `untrash_post`, `before_delete_post`, plus our four
 *      `wp_desktop_recycle_bin_*` actions) flips a per-request
 *      static flag. At `admin_footer`, if the request is chromeless
 *      AND the flag is set, we emit a 12-line inline script that
 *      `postMessage`s the parent shell with `type:
 *      'wp-desktop-recycle-bin-changed'`. The parent dispatches our
 *      `CustomEvent`, the open window refreshes. Cost: ~zero unless
 *      a delete actually happened in this request.
 *
 *   2. **Catch-all path — Heartbeat**
 *      Every delete also bumps a single autoload=false option
 *      `_wpdm_recycle_bin_change_ts` (a millisecond timestamp).
 *      The Heartbeat `heartbeat_received` filter checks the client's
 *      last-seen ts — if the option is newer, the response includes
 *      `wpdm_recycle_bin: { changed, ts }`. The bin only subscribes
 *      while its window is open, so users without the bin open pay
 *      zero. The cost per tick is one cached option read.
 *
 * Why two paths: chromeless iframes that produce a footer (form
 * POST → redirect → re-render, the dominant pattern for "Move to
 * Trash" buttons) get instant updates. Everything else (AJAX list
 * actions, REST `DELETE`, other browser tabs, WP-CLI, cron) drips
 * in within the heartbeat cadence (15s active, 60s away).
 *
 * @package WPDesktopMode
 * @since   0.20.0
 */

defined( 'ABSPATH' ) || exit;

const WPDM_RECYCLE_BIN_CHANGE_OPTION = '_wpdm_recycle_bin_change_ts';

/**
 * Per-request "did this request trigger a recycle-bin change" flag.
 *
 * Backed by a function-static so it survives across hook callbacks
 * within the same PHP request. Reading without args returns the
 * current value; passing `true` sets it.
 *
 * @since 0.20.0
 *
 * @param bool|null $set Set the flag.
 * @return bool
 */
function wpdm_recycle_bin_request_dirty( $set = null ) {
	static $dirty = false;
	if ( null !== $set ) {
		$dirty = (bool) $set;
	}
	return $dirty;
}

/**
 * Bump the global change timestamp + flip the per-request flag.
 *
 * Called from every recycle-bin-relevant hook. The timestamp is a
 * milliseconds-since-epoch integer so client comparisons are
 * straightforward and we don't need locale/timezone parsing.
 *
 * Stored as autoload=false to keep the option out of the always-
 * loaded options query — recycle-bin polling is a "you opened the
 * window, you opted in" cost, not a per-pageload cost.
 *
 * @since 0.20.0
 */
function wpdm_recycle_bin_signal_change() {
	$ts = (int) round( microtime( true ) * 1000 );
	update_option( WPDM_RECYCLE_BIN_CHANGE_OPTION, $ts, false );
	wpdm_recycle_bin_request_dirty( true );

	/**
	 * Fires after the recycle bin's "something changed" signal is
	 * bumped. Subscribers can use this to push their own real-time
	 * signal (websocket, SSE, etc.) without re-hooking every delete
	 * action individually.
	 *
	 * @since 0.20.0
	 *
	 * @param int $ts Milliseconds-since-epoch timestamp of the change.
	 */
	do_action( 'wp_desktop_recycle_bin_signal', $ts );
}

/**
 * Wrapper for `wp_trash_post`-style actions that pass `$post_id`.
 *
 * Captures the post id + post type into the per-request changelog
 * so the chromeless footer can emit one `wp-desktop-broadcast`
 * postMessage per affected domain (e.g. one for `post`, one for
 * `attachment`, …). Subscribers — the recycle bin window, plus
 * any plugin that registered a domain listener — react.
 *
 * @since 0.20.0
 *
 * @param int    $post_id Post id being mutated.
 * @param string $action  One of 'trashed', 'untrashed', 'deleted'.
 */
function wpdm_recycle_bin_signal_change_for_post( $post_id, $action = 'trashed' ) {
	$post = get_post( $post_id );
	if ( $post instanceof WP_Post ) {
		wpdm_recycle_bin_record_change( (string) $post->post_type, (int) $post_id, (string) $action );
	}
	wpdm_recycle_bin_signal_change();
}

/**
 * Per-request changelog: `[ post_type ][ action ] = int[] ids`.
 *
 * Reads when called without args; mutates when called with a
 * post_type. Static-store pattern, same shape as the dirty
 * helper above so test introspection is symmetric.
 *
 * @since 0.21.0
 *
 * @param string $post_type Optional. Mutate this domain.
 * @param int    $post_id   Optional. Id to record.
 * @param string $action    Optional. Verb (trashed/untrashed/deleted).
 * @return array Full changelog when called with no args.
 */
function wpdm_recycle_bin_record_change( $post_type = '', $post_id = 0, $action = '' ) {
	static $log = array();

	if ( '' === $post_type ) {
		return $log;
	}
	if ( ! isset( $log[ $post_type ] ) ) {
		$log[ $post_type ] = array();
	}
	if ( ! isset( $log[ $post_type ][ $action ] ) ) {
		$log[ $post_type ][ $action ] = array();
	}
	$log[ $post_type ][ $action ][] = (int) $post_id;
	return $log;
}

/**
 * Whether the current chromeless request should emit the footer
 * postMessage. Filterable so plugins can suppress the fast path
 * (e.g. heavy load testing where 1 extra postMessage matters).
 *
 * NOTE: We emit on EVERY chromeless render — not only when this
 * specific request mutated state. The reason is the dominant
 * "delete" flow is form-POST → 302 → fresh GET: the request that
 * actually trashed doesn't render a footer, only the redirect
 * target does. By always emitting the current `..._change_ts`
 * the parent shell gets a fresh ground-truth on the next page
 * paint inside the iframe (typically <500ms after the click) and
 * can refresh if its `seenTs` is older. The cost is one cached
 * `get_option` + ~12 lines of inline JS per chromeless render.
 *
 * @since 0.20.0
 *
 * @return bool
 */
function wpdm_recycle_bin_should_emit_footer_signal() {
	if ( ! function_exists( 'desktop_mode_is_chromeless_request' ) ) {
		return false;
	}
	if ( ! desktop_mode_is_chromeless_request() ) {
		return false;
	}

	/**
	 * Filter whether to emit the chromeless footer postMessage on
	 * the current request.
	 *
	 * @since 0.20.0
	 *
	 * @param bool $emit Default true on any chromeless render. The
	 *                   `wpdm_recycle_bin_request_dirty()` helper
	 *                   reports whether THIS request itself mutated
	 *                   state — useful inside the filter for plugins
	 *                   that only want to ride the "this request
	 *                   trashed something" signal.
	 */
	return (bool) apply_filters( 'wp_desktop_recycle_bin_emit_footer_signal', true );
}

/**
 * Emits the chromeless-iframe → parent footer signal.
 *
 * Runs at `admin_footer` priority 100 — well after most plugin
 * footers so we don't race against unrelated emits. The inline
 * script is ~14 lines uncompressed, doesn't import jQuery, and is
 * a no-op when `window.parent === window` (defensive — the same
 * gate the existing chromeless bridge uses).
 *
 * @since 0.20.0
 */
function wpdm_recycle_bin_emit_footer_signal() {
	if ( ! wpdm_recycle_bin_should_emit_footer_signal() ) {
		return;
	}

	$ts        = (int) get_option( WPDM_RECYCLE_BIN_CHANGE_OPTION, 0 );
	$changelog = wpdm_recycle_bin_record_change();

	if ( $ts <= 0 && empty( $changelog ) ) {
		// Nothing has ever been trashed via this site — no point
		// teaching the parent shell about a 0 high-water mark.
		return;
	}

	// Per-domain broadcast envelope: one entry per affected
	// post_type, with verb-keyed id lists. The parent shell's
	// `installBroadcastReceiver` translates each into a
	// `wp-desktop.<post_type>.changed` broadcast — the bin (and
	// any plugin that subscribes to that exact topic) reacts.
	$broadcasts = array();
	foreach ( $changelog as $post_type => $by_action ) {
		foreach ( $by_action as $action => $ids ) {
			$broadcasts[] = array(
				'topic'   => 'wp-desktop.' . $post_type . '.changed',
				'payload' => array(
					'source' => 'admin',
					'action' => (string) $action,
					'ids'    => array_values( array_unique( array_map( 'intval', $ids ) ) ),
				),
			);
		}
	}
	$broadcasts_json = wp_json_encode( $broadcasts );
	?>
	<script id="wpdm-recycle-bin-realtime-signal">
		( function () {
			if ( window.parent === window ) {
				return;
			}
			var origin = window.location.origin;
			try {
				window.parent.postMessage(
					{
						type: 'wp-desktop-recycle-bin-changed',
						ts: <?php echo (int) $ts; ?>,
						source: 'chromeless'
					},
					origin
				);
			} catch ( _err ) { /* swallow */ }

			/*
			 * Per-domain broadcast envelopes — one postMessage per
			 * affected post type. The parent shell's broadcast
			 * receiver fans these out as `wp-desktop.<type>.changed`
			 * subscriptions. Only emitted when the request actually
			 * mutated something: a no-op chromeless render skips this
			 * branch entirely.
			 */
			var broadcasts = <?php echo $broadcasts_json ? $broadcasts_json : '[]'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
			for ( var i = 0; i < broadcasts.length; i++ ) {
				try {
					window.parent.postMessage( {
						type: 'wp-desktop-broadcast',
						topic: broadcasts[ i ].topic,
						payload: broadcasts[ i ].payload
					}, origin );
				} catch ( _err ) { /* swallow */ }
			}
		} )();
	</script>
	<?php
}

/**
 * Heartbeat handler — answers "did anything change since you last
 * heard from me?".
 *
 * The Heartbeat API runs server-side every 15s (active window),
 * 60s (background tab), or 120s (idle). The bin's tab opts in by
 * sending `wpdm_recycle_bin_seen_ts` in its outgoing data; if the
 * key is absent we early-return so users without the bin open pay
 * zero per tick.
 *
 * @since 0.20.0
 *
 * @param array $response Heartbeat response (passed by ref via filter).
 * @param array $data     Client-sent payload.
 * @return array
 */
function wpdm_recycle_bin_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! isset( $data['wpdm_recycle_bin_seen_ts'] ) ) {
		return $response;
	}
	if ( function_exists( 'wpdm_recycle_bin_user_can_use' ) && ! wpdm_recycle_bin_user_can_use() ) {
		return $response;
	}

	$seen   = (int) $data['wpdm_recycle_bin_seen_ts'];
	$latest = (int) get_option( WPDM_RECYCLE_BIN_CHANGE_OPTION, 0 );

	// Authoritative count travels on every tick — it's the cheapest
	// way to keep the dock/icon badge truthful when the bin window
	// is closed. `wpdm_recycle_bin_count()` is a fast COUNT(*) that
	// hits the same option-cached query each post-status.
	$response['wpdm_recycle_bin'] = array(
		'changed' => $latest > $seen,
		'ts'      => $latest,
		'count'   => wpdm_recycle_bin_count(),
	);

	return $response;
}

/**
 * Wire the deletion hooks. We listen for both the WordPress core
 * verbs (`wp_trash_post`, `untrash_post`, `before_delete_post`) and
 * our own `wp_desktop_recycle_bin_*` lifecycle actions — the former
 * catches deletes that bypass our REST endpoints (Quick Edit, REST
 * `DELETE`, WP-CLI, list-table bulk actions); the latter catches
 * the bin's own restore/purge so other tabs see the change.
 *
 * Hooked together inside one bootstrap to make the wiring auditable
 * — `grep wpdm_recycle_bin_signal_change` finds every emitter.
 *
 * @since 0.20.0
 */
function wpdm_recycle_bin_register_realtime_hooks() {
	add_action( 'wp_trash_post', function ( $post_id ) {
		wpdm_recycle_bin_signal_change_for_post( $post_id, 'trashed' );
	} );
	add_action( 'untrash_post', function ( $post_id ) {
		wpdm_recycle_bin_signal_change_for_post( $post_id, 'untrashed' );
	} );
	add_action( 'before_delete_post', function ( $post_id ) {
		wpdm_recycle_bin_signal_change_for_post( $post_id, 'deleted' );
	} );

	// Comments use a different verb space — `trashed_comment` /
	// `untrashed_comment` / `deleted_comment` fire from
	// `wp_set_comment_status`. Map each into our changelog so the
	// chromeless footer can broadcast `wp-desktop.comment.changed`
	// to the Comments-list iframe; the bin doesn't capture comments
	// today, but having the topic available means a third-party
	// "comment trash" plugin can opt in by hooking the changelog.
	add_action( 'trashed_comment', function ( $comment_id ) {
		wpdm_recycle_bin_record_change( 'comment', (int) $comment_id, 'trashed' );
		wpdm_recycle_bin_signal_change();
	} );
	add_action( 'untrashed_comment', function ( $comment_id ) {
		wpdm_recycle_bin_record_change( 'comment', (int) $comment_id, 'untrashed' );
		wpdm_recycle_bin_signal_change();
	} );
	add_action( 'deleted_comment', function ( $comment_id ) {
		wpdm_recycle_bin_record_change( 'comment', (int) $comment_id, 'deleted' );
		wpdm_recycle_bin_signal_change();
	} );

	add_action( 'wp_desktop_recycle_bin_item_captured', 'wpdm_recycle_bin_signal_change' );
	add_action( 'wp_desktop_recycle_bin_after_restore', 'wpdm_recycle_bin_signal_change' );
	add_action( 'wp_desktop_recycle_bin_after_purge', 'wpdm_recycle_bin_signal_change' );
	add_action( 'wp_desktop_recycle_bin_emptied', 'wpdm_recycle_bin_signal_change' );

	add_action( 'admin_footer', 'wpdm_recycle_bin_emit_footer_signal', 100 );

	add_filter( 'heartbeat_received', 'wpdm_recycle_bin_heartbeat_received', 10, 2 );
}
add_action( 'init', 'wpdm_recycle_bin_register_realtime_hooks', 5 );
