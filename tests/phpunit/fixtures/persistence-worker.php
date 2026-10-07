<?php

$config = json_decode( stream_get_contents( STDIN ), true );
require $config['bootstrap'];
defined( 'ABSPATH' ) || exit;
$wpdb = new wpdb( $config['user'], $config['password'], $config['database'], $config['host'] );
$wpdb->set_prefix( $config['prefix'] );
$wpdb->set_blog_id( 1 );
require_once dirname( __DIR__, 3 ) . '/includes/presence-store.php';
require_once dirname( __DIR__, 3 ) . '/includes/desktop-files/reconcile.php';
file_put_contents( $config['started'], wp_json_encode( array( $wpdb->dbname, $wpdb->prefix ) ) );
$deadline = microtime( true ) + 15;
while ( ! file_exists( $config['go'] ) ) {
	if ( microtime( true ) > $deadline ) { exit( 2 ); }
	usleep( 1000 );
	clearstatcache();
}
if ( 'presence' === $config['mode'] ) {
	foreach ( $config['records'] as $entry ) {
		if ( ! openstation_presence_upsert( $entry[0], array( 'last_seen_ms' => $entry[1], 'last_active_ms' => $entry[2] ), $entry[3] ?? false ) ) { exit( 3 ); }
	}
} elseif ( 'prune' === $config['mode'] ) {
	require_once dirname( __DIR__, 3 ) . '/includes/presence.php';
	add_filter( 'pre_option_openstation_presence_storage', static function () { return array( 'ready' => true ); } );
	for ( $i = 0; $i < 100; ++$i ) {
		openstation_presence_cron_prune();
		if ( '' !== $wpdb->last_error ) { exit( 5 ); }
	}
} else {
	$result = openstation_stored_files_locked( static function () use ( $config ) {
		file_put_contents( $config['inside'], 'entered' );
		return true;
	} );
	if ( true !== $result ) { exit( 4 ); }
}
echo 'ok';
