<?php

defined( 'ABSPATH' ) || exit;

function openstation_storage_use_primary() {
	global $wpdb;
	if ( is_callable( array( $wpdb, 'send_reads_to_primaries' ) ) ) {
		$wpdb->send_reads_to_primaries();
	} elseif ( is_callable( array( $wpdb, 'send_reads_to_masters' ) ) ) {
		$wpdb->send_reads_to_masters();
	}
}
