<?php
/**
 * OpenStation — generic content-change realtime layer.
 *
 * Records create/update/trash mutations of posts, pages, CPTs,
 * comments, and WooCommerce orders into a per-request changelog and
 * relays them to the parent shell as cross-window broadcasts
 * (`os.<type>.changed`, payload `{ source, action, ids }`),
 * so every window listing that content type can refresh without an F5.
 *
 * Three delivery paths, mirroring the Recycle Bin realtime layer
 * (`includes/recycle-bin/realtime.php`) which delegates its own
 * changelog into this module:
 *
 *   1. **Chromeless footer — fast path.** At `admin_footer` on a
 *      chromeless render, one inline script postMessages a
 *      `os-broadcast` envelope per `[type][action]` entry
 *      to the parent shell. Because the dominant admin mutation flow
 *      is form-POST → 302 → GET (the mutating request renders no
 *      footer), the changelog is buffered across the redirect in a
 *      short-TTL per-user transient and flushed on the next
 *      chromeless footer render (~500 ms after the click).
 *
 *   2. **Block editor — client-side.** Gutenberg saves over REST with
 *      no navigation; the chromeless bridge's save-watcher
 *      (`includes/render/chromeless-bridge.php`) posts the broadcast
 *      directly on save success. This module still records the REST
 *      save server-side for path 3.
 *
 *   3. **Heartbeat — catch-all.** Every record is appended to a
 *      pruned changelog option; the Heartbeat response answers
 *      "entries newer than your seen ts" for opted-in shells. Covers
 *      Quick Edit, AJAX status flips, other browser tabs, REST and
 *      WP-CLI mutations within one tick (15–60 s).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

const OPENSTATION_CONTENT_CHANGES_LOG_OPTION = '_desktop_mode_content_changes_log';

/**
 * Milliseconds of heartbeat-changelog history to retain.
 */
const OPENSTATION_CONTENT_CHANGES_LOG_WINDOW_MS = 300000;

/**
 * Maximum retained heartbeat-changelog entries.
 */
const OPENSTATION_CONTENT_CHANGES_LOG_MAX = 100;

/**
 * TTL for the redirect-surviving per-user changelog buffer.
 */
const OPENSTATION_CONTENT_CHANGES_BUFFER_TTL = 60;

/**
 * Per-request state shared by the recorder, the footer emitter, and
 * the shutdown handler.
 *
 * Function-static-by-reference so it survives across hook callbacks
 * within one PHP request — same pattern as the Recycle Bin changelog.
 *
 * Shape:
 *   - `log`     — `[ type ][ action ] = int[] ids` for this request.
 *   - `seen`    — `"type:id" => true` first-writer-wins dedupe set.
 *   - `staged`  — flat `{ type, action, id }` rows for the heartbeat log.
 *   - `flushed` — true once the footer emitter consumed `log`, so the
 *                 shutdown handler doesn't buffer it a second time.
 *
 * @return array Per-request state, by reference.
 */
function &openstation_content_changes_state() {
	static $state = null;
	if ( null === $state ) {
		$state = array(
			'log'     => array(),
			'seen'    => array(),
			'staged'  => array(),
			'flushed' => false,
		);
	}
	return $state;
}

/**
 * Resets the per-request state. Test isolation only.
 *
 * @internal
 */
function openstation_content_changes_reset() {
	$state = &openstation_content_changes_state();
	$state = array(
		'log'     => array(),
		'seen'    => array(),
		'staged'  => array(),
		'flushed' => false,
	);
}

/**
 * Records a content change into the per-request changelog.
 *
 * This is the public entry point for third-party plugins with their
 * own storage (an HPOS-style custom table, a settings screen, …):
 * call it from your mutation path and every open window listing your
 * type refreshes, exactly like core content. Pair it with a
 * `openstation_soft_reload_rules` filter entry if your list screen
 * is not a standard `edit.php?post_type=<type>` page.
 *
 * Dedupe is first-writer-wins per `type:id` within the request: core
 * fires the trash verbs (`wp_trash_post`, `untrash_post`) BEFORE the
 * internal status write reaches `wp_after_insert_post`, so the more
 * specific verb is recorded and the follow-up `updated` for the same
 * id is dropped. The same mechanism collapses WooCommerce legacy-mode
 * double-fires (post hooks + `woocommerce_update_order`).
 *
 * @param string $type   Content type slug — a post type, `comment`,
 *                       or `shop_order`. Becomes the broadcast topic
 *                       `os.<type>.changed`.
 * @param int    $id     Mutated object id.
 * @param string $action One of 'created', 'updated', 'trashed',
 *                       'untrashed', 'deleted'.
 * @return bool Whether the change was recorded.
 */
function openstation_content_changes_record( $type, $id, $action ) {
	$type   = (string) $type;
	$id     = (int) $id;
	$action = (string) $action;

	if ( '' === $type || $id <= 0 || '' === $action ) {
		return false;
	}

	/**
	 * Filters whether a content change is recorded into the realtime
	 * changelog.
	 *
	 * Return false to keep a mutation out of the cross-window refresh
	 * system entirely (footer broadcast AND heartbeat log) — e.g. a
	 * high-churn internal type whose list windows manage their own
	 * realtime.
	 *
	 * @param bool   $record Whether to record. Default true.
	 * @param string $type   Content type slug.
	 * @param int    $id     Mutated object id.
	 * @param string $action Verb (created/updated/trashed/untrashed/deleted).
	 */
	if ( ! apply_filters( 'openstation_content_changes_should_record', true, $type, $id, $action ) ) {
		return false;
	}

	$state = &openstation_content_changes_state();
	$key   = $type . ':' . $id;
	if ( isset( $state['seen'][ $key ] ) ) {
		return false;
	}
	$state['seen'][ $key ] = true;

	if ( ! isset( $state['log'][ $type ] ) ) {
		$state['log'][ $type ] = array();
	}
	if ( ! isset( $state['log'][ $type ][ $action ] ) ) {
		$state['log'][ $type ][ $action ] = array();
	}
	$state['log'][ $type ][ $action ][] = $id;

	$state['staged'][] = array(
		'type'   => $type,
		'action' => $action,
		'id'     => $id,
	);

	/**
	 * Fires after a content change is recorded into the realtime
	 * changelog.
	 *
	 * Subscribers can push their own real-time signal (websocket,
	 * SSE, …) without re-hooking every mutation path individually.
	 *
	 * @param string $type   Content type slug.
	 * @param int    $id     Mutated object id.
	 * @param string $action Verb (created/updated/trashed/untrashed/deleted).
	 */
	do_action( 'openstation_content_change_recorded', $type, $id, $action );

	return true;
}

/**
 * Returns the per-request changelog: `[ type ][ action ] = int[] ids`.
 *
 * @return array
 */
function openstation_content_changes_log() {
	$state = &openstation_content_changes_state();
	return $state['log'];
}

/**
 * Merges changelog `$b` into changelog `$a` (both
 * `[ type ][ action ] = int[] ids`).
 *
 * @param array $a Base changelog.
 * @param array $b Changelog to merge in.
 * @return array
 */
function openstation_content_changes_merge( $a, $b ) {
	foreach ( (array) $b as $type => $by_action ) {
		foreach ( (array) $by_action as $action => $ids ) {
			$existing               = isset( $a[ $type ][ $action ] ) ? (array) $a[ $type ][ $action ] : array();
			$a[ $type ][ $action ] = array_values( array_unique( array_merge( $existing, array_map( 'intval', (array) $ids ) ) ) );
		}
	}
	return $a;
}

/**
 * Transient key of the redirect-surviving changelog buffer for a user.
 *
 * @param int $user_id User id.
 * @return string
 */
function openstation_content_changes_buffer_key( $user_id ) {
	return 'openstation_content_buf_' . (int) $user_id;
}

/**
 * `wp_after_insert_post` handler — posts, pages, and every `show_ui`
 * custom post type.
 *
 * `wp_after_insert_post` (not `save_post`) so terms and meta are
 * already persisted when subscribers refetch. Trash-status writes are
 * skipped — the Recycle Bin hooks own the trash verbs and record them
 * first (`wp_trash_post` fires before the internal status update
 * reaches this hook).
 *
 * Post types without `show_ui` are skipped: they have no list screen
 * to refresh, and internal types (notes, …) run their own realtime.
 * Plugins that want one tracked anyway can call
 * `openstation_content_changes_record()` from their own hooks.
 *
 * @param int          $post_id     Post id.
 * @param WP_Post      $post        Saved post.
 * @param bool         $update      Whether this is an update.
 * @param WP_Post|null $post_before Pre-save post, null on creation.
 */
function openstation_content_changes_on_after_insert_post( $post_id, $post, $update, $post_before ) {
	if ( ! $post instanceof WP_Post ) {
		return;
	}
	if ( wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
		return;
	}
	if ( function_exists( 'wp_doing_autosave' ) && wp_doing_autosave() ) {
		return;
	}
	if ( in_array( $post->post_status, array( 'auto-draft', 'trash' ), true ) ) {
		return;
	}
	$post_type_object = get_post_type_object( $post->post_type );
	if ( ! $post_type_object || empty( $post_type_object->show_ui ) ) {
		return;
	}

	// The first real save of a new post arrives as an "update" of the
	// auto-draft shell `post-new.php` created — report it as created.
	$is_created = ! $update || ( $post_before instanceof WP_Post && 'auto-draft' === $post_before->post_status );

	openstation_content_changes_record( $post->post_type, (int) $post_id, $is_created ? 'created' : 'updated' );
}

/**
 * `transition_comment_status` handler.
 *
 * Trash transitions are skipped in both directions: the Recycle Bin's
 * `trashed_comment` / `untrashed_comment` hooks record those verbs,
 * and they fire AFTER the transition — without the skip the dedupe
 * set would keep this handler's less-specific `updated`.
 *
 * @param string     $new_status New comment status.
 * @param string     $old_status Old comment status.
 * @param WP_Comment $comment    Comment object.
 */
function openstation_content_changes_on_comment_transition( $new_status, $old_status, $comment ) {
	if ( 'trash' === $new_status || 'trash' === $old_status ) {
		return;
	}
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}
	openstation_content_changes_record( 'comment', (int) $comment->comment_ID, 'updated' );
}

/**
 * Wires the WooCommerce order hooks. No-op unless WooCommerce is
 * active.
 *
 * The `woocommerce_*` family is required for HPOS, where orders live
 * in custom tables and none of the post hooks fire. Under legacy
 * (posts-table) storage the post hooks fire too; the recorder's
 * per-request dedupe collapses the double-fire. The type is always
 * recorded as `shop_order` so one broadcast topic
 * (`os.shop_order.changed`) serves both storage modes.
 *
 * @return bool Whether the hooks were registered.
 */
function openstation_content_changes_register_wc_hooks() {
	if ( ! class_exists( 'WooCommerce' ) || ! function_exists( 'wc_get_order' ) ) {
		return false;
	}

	add_action( 'woocommerce_new_order', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'created' );
	} );
	add_action( 'woocommerce_update_order', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'updated' );
	} );
	// Some AJAX status-flip paths reach `woocommerce_order_status_changed`
	// without `woocommerce_update_order`; the dedupe set absorbs the
	// overlap when both fire.
	add_action( 'woocommerce_order_status_changed', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'updated' );
	} );
	add_action( 'woocommerce_trash_order', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'trashed' );
	} );
	add_action( 'woocommerce_untrash_order', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'untrashed' );
	} );
	add_action( 'woocommerce_delete_order', function ( $order_id ) {
		openstation_content_changes_record( 'shop_order', (int) $order_id, 'deleted' );
	} );

	return true;
}

/**
 * Emits the chromeless-footer broadcast script.
 *
 * Merges the in-memory changelog with the redirect-surviving buffer
 * (consumed on read), builds one broadcast envelope per
 * `[ type ][ action ]`, and prints one inline script that postMessages
 * each to the parent shell. The parent's broadcast receiver fans them
 * out as `os.<type>.changed` — iframe list pages soft-reload
 * and native list windows refetch.
 *
 * Runs at `admin_footer` priority 100, same slot as the Recycle Bin's
 * bin-specific ts signal.
 */
function openstation_content_changes_emit_footer() {
	if ( ! function_exists( 'openstation_is_chromeless_request' ) || ! openstation_is_chromeless_request() ) {
		return;
	}

	$state = &openstation_content_changes_state();
	$log   = $state['log'];

	$user_id = get_current_user_id();
	if ( $user_id > 0 ) {
		$key      = openstation_content_changes_buffer_key( $user_id );
		$buffered = get_transient( $key );
		if ( is_array( $buffered ) && ! empty( $buffered ) ) {
			delete_transient( $key );
			$log = openstation_content_changes_merge( $buffered, $log );
		}
	}

	// The in-memory log is consumed regardless of whether anything is
	// emitted — the shutdown handler must not re-buffer what the
	// footer already had the chance to flush.
	$state['flushed'] = true;

	if ( empty( $log ) ) {
		return;
	}

	$broadcasts = array();
	foreach ( $log as $type => $by_action ) {
		foreach ( $by_action as $action => $ids ) {
			/**
			 * Filters the broadcast topic for a content-change type.
			 *
			 * @param string $topic  Default `os.<type>.changed`.
			 * @param string $type   Content type slug.
			 * @param string $action Verb for this envelope.
			 */
			$topic = (string) apply_filters( 'openstation_content_change_topic', 'os.' . $type . '.changed', $type, $action );

			$broadcasts[] = array(
				'topic'   => $topic,
				'payload' => array(
					'source' => 'admin',
					'action' => (string) $action,
					'ids'    => array_values( array_unique( array_map( 'intval', (array) $ids ) ) ),
				),
			);
		}
	}

	/**
	 * Filters the full set of content-change broadcast envelopes just
	 * before the chromeless footer emits them.
	 *
	 * Each entry is `array( 'topic' => string, 'payload' => array )`.
	 * Return an empty array to suppress the emit.
	 *
	 * @param array $broadcasts Broadcast envelopes.
	 */
	$broadcasts = (array) apply_filters( 'openstation_content_changes_broadcasts', $broadcasts );
	if ( empty( $broadcasts ) ) {
		return;
	}

	$broadcasts_json = wp_json_encode( array_values( $broadcasts ) );
	if ( ! $broadcasts_json ) {
		return;
	}

	?>
	<script id="os-content-changes-signal">
		( function () {
			if ( window.parent === window ) {
				return;
			}
			var origin = window.location.origin;
			var broadcasts = <?php echo $broadcasts_json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_json_encode output. ?>;
			for ( var i = 0; i < broadcasts.length; i++ ) {
				try {
					window.parent.postMessage( {
						type: 'os-broadcast',
						topic: broadcasts[ i ].topic,
						payload: broadcasts[ i ].payload
					}, origin );
				} catch ( _err ) { /* parent gone */ }
			}
		} )();
	</script>
	<?php

	/**
	 * Fires after the chromeless footer emitted the content-change
	 * broadcast envelopes.
	 *
	 * @param array $broadcasts Emitted broadcast envelopes.
	 */
	do_action( 'openstation_content_changes_emitted', $broadcasts );
}

/**
 * `shutdown` handler — persists the heartbeat changelog and buffers
 * an unflushed in-request changelog across the coming redirect.
 *
 * One `update_option` per mutating request; requests that recorded
 * nothing pay a static-array read and return.
 */
function openstation_content_changes_on_shutdown() {
	$state = &openstation_content_changes_state();

	if ( ! empty( $state['staged'] ) ) {
		$now = (int) round( microtime( true ) * 1000 );

		// Group staged rows into per-[type][action] heartbeat entries.
		$grouped = array();
		foreach ( $state['staged'] as $row ) {
			$grouped[ $row['type'] . '|' . $row['action'] ][] = (int) $row['id'];
		}

		$log     = get_option( OPENSTATION_CONTENT_CHANGES_LOG_OPTION, array() );
		$entries = ( is_array( $log ) && isset( $log['entries'] ) && is_array( $log['entries'] ) ) ? $log['entries'] : array();

		foreach ( $grouped as $group_key => $ids ) {
			list( $type, $action ) = explode( '|', $group_key, 2 );
			$entries[]             = array(
				'ts'     => $now,
				'type'   => $type,
				'action' => $action,
				'ids'    => array_values( array_unique( $ids ) ),
			);
		}

		// Prune: drop entries older than the retention window, cap the
		// tail. The option stays small no matter how chatty the site.
		$cutoff  = $now - OPENSTATION_CONTENT_CHANGES_LOG_WINDOW_MS;
		$entries = array_values( array_filter( $entries, function ( $entry ) use ( $cutoff ) {
			return isset( $entry['ts'] ) && (int) $entry['ts'] >= $cutoff;
		} ) );
		if ( count( $entries ) > OPENSTATION_CONTENT_CHANGES_LOG_MAX ) {
			$entries = array_slice( $entries, -OPENSTATION_CONTENT_CHANGES_LOG_MAX );
		}

		update_option(
			OPENSTATION_CONTENT_CHANGES_LOG_OPTION,
			array(
				'ts'      => $now,
				'entries' => $entries,
			),
			false
		);
	}

	if ( $state['flushed'] || empty( $state['log'] ) ) {
		return;
	}
	$user_id = get_current_user_id();
	if ( $user_id <= 0 ) {
		return;
	}

	$key      = openstation_content_changes_buffer_key( $user_id );
	$existing = get_transient( $key );
	$merged   = openstation_content_changes_merge( is_array( $existing ) ? $existing : array(), $state['log'] );
	set_transient( $key, $merged, OPENSTATION_CONTENT_CHANGES_BUFFER_TTL );
}

/**
 * Heartbeat handler — answers "which content changed since you last
 * heard from me?".
 *
 * Opt-in via the client-sent `openstation_content_changes_seen_ts`
 * key; requests without it early-return so non-desktop tabs pay zero
 * per tick. The response carries the server high-water mark plus the
 * entries newer than the client's seen ts; the shell re-broadcasts
 * each as `os.<type>.changed`.
 *
 * @param array $response Heartbeat response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function openstation_content_changes_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! isset( $data['openstation_content_changes_seen_ts'] ) ) {
		return $response;
	}

	$seen = (int) $data['openstation_content_changes_seen_ts'];
	$log  = get_option( OPENSTATION_CONTENT_CHANGES_LOG_OPTION, array() );

	$ts      = ( is_array( $log ) && isset( $log['ts'] ) ) ? (int) $log['ts'] : 0;
	$entries = ( is_array( $log ) && isset( $log['entries'] ) && is_array( $log['entries'] ) ) ? $log['entries'] : array();

	$fresh = array();
	foreach ( $entries as $entry ) {
		if ( isset( $entry['ts'] ) && (int) $entry['ts'] > $seen ) {
			$fresh[] = $entry;
		}
	}

	$response['openstation_content_changes'] = array(
		'ts'      => $ts,
		'entries' => $fresh,
	);

	return $response;
}

/**
 * Converts a plugin file path to a stable positive integer suitable
 * for use as the `$id` parameter of
 * `openstation_content_changes_record()`.
 *
 * The record function requires a positive integer for its ID slot (used
 * for per-request deduplication keyed as `type:id`). Plugin files are
 * strings (`akismet/akismet.php`), so we derive a deterministic integer
 * via `crc32`. Using the actual hash rather than a fixed value (e.g. 1)
 * prevents every distinct plugin in a bulk operation from collapsing to
 * the same dedup key.
 *
 * @param string $plugin_file Plugin file path (relative to plugins dir).
 * @return int Positive integer ID.
 */
function openstation_content_changes_plugin_id( $plugin_file ) {
	$hash = abs( crc32( (string) $plugin_file ) );
	return max( 1, $hash );
}

/**
 * Wires plugin lifecycle hooks so installs, activations, deactivations,
 * and deletions are recorded into the realtime changelog.
 *
 * Every open window listing plugins (native Plugins window Installed tab,
 * classic `plugins.php`) will then refresh via the
 * `os.plugin.changed` broadcast — the same mechanism
 * posts/pages use for `os.post.changed`.
 */
function openstation_content_changes_register_plugin_hooks() {
	add_action( 'activated_plugin', function ( $plugin_file ) {
		openstation_content_changes_record(
			'plugin',
			openstation_content_changes_plugin_id( $plugin_file ),
			'activated'
		);
	} );

	add_action( 'deactivated_plugin', function ( $plugin_file ) {
		openstation_content_changes_record(
			'plugin',
			openstation_content_changes_plugin_id( $plugin_file ),
			'deactivated'
		);
	} );

	add_action( 'deleted_plugin', function ( $plugin_file, $deleted ) {
		if ( $deleted ) {
			openstation_content_changes_record(
				'plugin',
				openstation_content_changes_plugin_id( $plugin_file ),
				'deleted'
			);
		}
	}, 10, 2 );

	// `upgrader_process_complete` covers installs from wp-admin/plugin-install.php
	// (AJAX path, no page navigation) and bulk installs from update.php.
	add_action( 'upgrader_process_complete', function ( $upgrader, $options ) {
		if (
			! isset( $options['type'], $options['action'] ) ||
			'plugin' !== $options['type'] ||
			'install' !== $options['action']
		) {
			return;
		}
		$plugins = ! empty( $options['plugins'] ) ? (array) $options['plugins'] : array();
		if ( empty( $plugins ) && is_callable( array( $upgrader, 'plugin_info' ) ) ) {
			$info = $upgrader->plugin_info();
			if ( $info ) {
				$plugins = array( $info );
			}
		}
		foreach ( $plugins as $plugin_file ) {
			openstation_content_changes_record(
				'plugin',
				openstation_content_changes_plugin_id( (string) $plugin_file ),
				'installed'
			);
		}
	}, 10, 2 );
}

/**
 * Wires every content-change hook.
 *
 * One bootstrap so the wiring is auditable —
 * `grep openstation_content_changes_record` finds every emitter.
 */
function openstation_content_changes_register_hooks() {
	add_action( 'wp_after_insert_post', 'openstation_content_changes_on_after_insert_post', 10, 4 );

	add_action( 'wp_insert_comment', function ( $comment_id ) {
		openstation_content_changes_record( 'comment', (int) $comment_id, 'created' );
	} );
	add_action( 'edit_comment', function ( $comment_id ) {
		openstation_content_changes_record( 'comment', (int) $comment_id, 'updated' );
	} );
	add_action( 'transition_comment_status', 'openstation_content_changes_on_comment_transition', 10, 3 );

	openstation_content_changes_register_wc_hooks();
	openstation_content_changes_register_plugin_hooks();

	add_action( 'admin_footer', 'openstation_content_changes_emit_footer', 100 );
	add_action( 'shutdown', 'openstation_content_changes_on_shutdown' );
	add_filter( 'heartbeat_received', 'openstation_content_changes_heartbeat_received', 10, 2 );
}
add_action( 'init', 'openstation_content_changes_register_hooks', 5 );
