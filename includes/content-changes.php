<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_CONTENT_CHANGES_LOG_OPTION = '_desktop_mode_content_changes_log';

const OPENSTATION_CONTENT_CHANGES_LOG_WINDOW_MS = 300000;

const OPENSTATION_CONTENT_CHANGES_LOG_MAX = 100;

const OPENSTATION_CONTENT_CHANGES_BUFFER_TTL = 60;

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

function openstation_content_changes_reset() {
	$state = &openstation_content_changes_state();
	$state = array(
		'log'     => array(),
		'seen'    => array(),
		'staged'  => array(),
		'flushed' => false,
	);
}

function openstation_content_changes_record( $type, $id, $action ) {
	$type   = (string) $type;
	$id     = (int) $id;
	$action = (string) $action;

	if ( '' === $type || $id <= 0 || '' === $action ) {
		return false;
	}

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

	do_action( 'openstation_content_change_recorded', $type, $id, $action );

	return true;
}

function openstation_content_changes_log() {
	$state = &openstation_content_changes_state();
	return $state['log'];
}

function openstation_content_changes_merge( $a, $b ) {
	foreach ( (array) $b as $type => $by_action ) {
		foreach ( (array) $by_action as $action => $ids ) {
			$existing              = isset( $a[ $type ][ $action ] ) ? (array) $a[ $type ][ $action ] : array();
			$a[ $type ][ $action ] = array_values( array_unique( array_merge( $existing, array_map( 'intval', (array) $ids ) ) ) );
		}
	}
	return $a;
}

function openstation_content_changes_buffer_key( $user_id ) {
	return 'openstation_content_buf_' . (int) $user_id;
}

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

	$is_created = ! $update || ( $post_before instanceof WP_Post && 'auto-draft' === $post_before->post_status );

	openstation_content_changes_record( $post->post_type, (int) $post_id, $is_created ? 'created' : 'updated' );
}

function openstation_content_changes_on_comment_transition( $new_status, $old_status, $comment ) {
	if ( 'trash' === $new_status || 'trash' === $old_status ) {
		return;
	}
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}
	openstation_content_changes_record( 'comment', (int) $comment->comment_ID, 'updated' );
}

function openstation_content_changes_register_wc_hooks() {
	if ( ! class_exists( 'WooCommerce' ) || ! function_exists( 'wc_get_order' ) ) {
		return false;
	}

	add_action(
		'woocommerce_new_order',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'created' );
		}
	);
	add_action(
		'woocommerce_update_order',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'updated' );
		}
	);

	add_action(
		'woocommerce_order_status_changed',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'updated' );
		}
	);
	add_action(
		'woocommerce_trash_order',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'trashed' );
		}
	);
	add_action(
		'woocommerce_untrash_order',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'untrashed' );
		}
	);
	add_action(
		'woocommerce_delete_order',
		function ( $order_id ) {
			openstation_content_changes_record( 'shop_order', (int) $order_id, 'deleted' );
		}
	);

	return true;
}

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

	$state['flushed'] = true;

	if ( empty( $log ) ) {
		return;
	}

	$broadcasts = array();
	foreach ( $log as $type => $by_action ) {
		foreach ( $by_action as $action => $ids ) {

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
			var broadcasts = <?php echo $broadcasts_json;                                                                                            ?>;
			for ( var i = 0; i < broadcasts.length; i++ ) {
				try {
					window.parent.postMessage( {
						type: 'os-broadcast',
						topic: broadcasts[ i ].topic,
						payload: broadcasts[ i ].payload
					}, origin );
				} catch ( _err ) {                   }
			}
		} )();
	</script>
	<?php

	do_action( 'openstation_content_changes_emitted', $broadcasts );
}

function openstation_content_changes_on_shutdown() {
	$state = &openstation_content_changes_state();

	if ( ! empty( $state['staged'] ) ) {
		$now = (int) round( microtime( true ) * 1000 );

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

		$cutoff  = $now - OPENSTATION_CONTENT_CHANGES_LOG_WINDOW_MS;
		$entries = array_values(
			array_filter(
				$entries,
				function ( $entry ) use ( $cutoff ) {
					return isset( $entry['ts'] ) && (int) $entry['ts'] >= $cutoff;
				}
			)
		);
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

function openstation_content_changes_plugin_id( $plugin_file ) {
	$hash = abs( crc32( (string) $plugin_file ) );
	return max( 1, $hash );
}

function openstation_content_changes_register_plugin_hooks() {
	add_action(
		'activated_plugin',
		function ( $plugin_file ) {
			openstation_content_changes_record(
				'plugin',
				openstation_content_changes_plugin_id( $plugin_file ),
				'activated'
			);
		}
	);

	add_action(
		'deactivated_plugin',
		function ( $plugin_file ) {
			openstation_content_changes_record(
				'plugin',
				openstation_content_changes_plugin_id( $plugin_file ),
				'deactivated'
			);
		}
	);

	add_action(
		'deleted_plugin',
		function ( $plugin_file, $deleted ) {
			if ( $deleted ) {
				openstation_content_changes_record(
					'plugin',
					openstation_content_changes_plugin_id( $plugin_file ),
					'deleted'
				);
			}
		},
		10,
		2
	);

	add_action(
		'upgrader_process_complete',
		function ( $upgrader, $options ) {
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
		},
		10,
		2
	);
}

function openstation_content_changes_register_hooks() {
	add_action( 'wp_after_insert_post', 'openstation_content_changes_on_after_insert_post', 10, 4 );

	add_action(
		'wp_insert_comment',
		function ( $comment_id ) {
			openstation_content_changes_record( 'comment', (int) $comment_id, 'created' );
		}
	);
	add_action(
		'edit_comment',
		function ( $comment_id ) {
			openstation_content_changes_record( 'comment', (int) $comment_id, 'updated' );
		}
	);
	add_action( 'transition_comment_status', 'openstation_content_changes_on_comment_transition', 10, 3 );

	openstation_content_changes_register_wc_hooks();
	openstation_content_changes_register_plugin_hooks();

	add_action( 'admin_footer', 'openstation_content_changes_emit_footer', 100 );
	add_action( 'shutdown', 'openstation_content_changes_on_shutdown' );
	add_filter( 'heartbeat_received', 'openstation_content_changes_heartbeat_received', 10, 2 );
}
add_action( 'init', 'openstation_content_changes_register_hooks', 5 );
