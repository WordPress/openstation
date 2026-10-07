<?php

class Tests_OpenStation_PresenceStorage extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		global $wpdb;
		delete_option( OPENSTATION_PRESENCE_OPTION );
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$wpdb->query( 'DELETE FROM ' . openstation_presence_table() );
	}

	private function record( $seen, $active ) {
		return array( 'last_seen_ms' => $seen, 'last_active_ms' => $active );
	}

	public function test_delayed_writers_preserve_independent_maximum_timestamps() {
		openstation_presence_upsert( 1, $this->record( 3000, 1000 ) );
		openstation_presence_upsert( 2, $this->record( 5000, 5000 ) );
		openstation_presence_upsert( 1, $this->record( 2000, 2000 ) );
		openstation_presence_upsert( 1, $this->record( 1000, 0 ) );
		$this->assertSame( array( 1 => $this->record( 3000, 2000 ), 2 => $this->record( 5000, 5000 ) ), openstation_presence_get_all() );
	}

	public function test_away_fences_older_active_requests_but_allows_new_activity() {
		openstation_presence_write_record( 1, $this->record( 2000, 2000 ) );
		openstation_presence_write_record( 1, $this->record( 4000, 0 ), true );
		openstation_presence_write_record( 1, $this->record( 3000, 3000 ) );
		openstation_presence_write_record( 1, $this->record( 5000, 0 ) );
		$this->assertSame( $this->record( 5000, 0 ), openstation_presence_get_all()[1] );
		openstation_presence_write_record( 1, $this->record( 6000, 6000 ) );
		$this->assertSame( $this->record( 6000, 6000 ), openstation_presence_get_all()[1] );
	}

	public function test_import_preserves_legacy_option_and_newer_destination_data() {
		$legacy = array( 1 => $this->record( 1000, 1000 ), 2 => $this->record( 2000, 0 ), -1 => 'bad' );
		update_option( OPENSTATION_PRESENCE_OPTION, $legacy, false );
		openstation_presence_upsert( 1, $this->record( 3000, 3000 ) );
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$this->assertSame( $legacy, get_option( OPENSTATION_PRESENCE_OPTION ) );
		$this->assertSame( array( 1 => $this->record( 3000, 3000 ), 2 => $this->record( 2000, 0 ) ), openstation_presence_get_all() );
		$state = get_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$this->assertSame( $state, get_option( OPENSTATION_PRESENCE_STORAGE_OPTION ) );
	}

	public function test_failed_migration_is_retryable_and_never_marked_ready( $pattern ) {
		global $wpdb;
		update_option( OPENSTATION_PRESENCE_OPTION, array( 1 => $this->record( 1000, 1000 ) ), false );
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$hit = false;
		$filter = static function ( $sql ) use ( $pattern, &$hit ) {
			if ( ! $hit && ( 'checkpoint' === $pattern ? ( false !== strpos( $sql, OPENSTATION_PRESENCE_STORAGE_OPTION ) && 0 === strpos( $sql, 'INSERT INTO' ) ) : false !== strpos( $sql, $pattern ) ) ) {
				$hit = true;
				return 'SELECT * FROM openstation_deliberately_missing_presence_table';
			}
			return $sql;
		};
		add_filter( 'query', $filter, 1 );
		$suppress = $wpdb->suppress_errors( true );
		try { $result = openstation_presence_migrate_storage(); } finally {
			remove_filter( 'query', $filter, 1 );
			$wpdb->suppress_errors( $suppress );
		}
		$this->assertTrue( $hit );
		$this->assertFalse( $result );
		$this->assertFalse( get_option( OPENSTATION_PRESENCE_STORAGE_OPTION ) );
		wp_cache_delete( 'failed:' . openstation_presence_cache_key(), 'openstation_presence_request' );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$this->assertSame( $this->record( 1000, 1000 ), openstation_presence_get_all()[1] );
	}

	public static function migration_failure_stages() {
		return array(
			'create' => array( 'CREATE TABLE IF NOT EXISTS' ),
			'legacy read' => array( "option_name = '_desktop_mode_presence'" ),
			'import' => array( 'ON DUPLICATE KEY UPDATE' ),
			'verification' => array( 'SELECT user_id, last_seen_ms' ),
			'checkpoint' => array( 'checkpoint' ),
		);
	}

	public function test_bounded_bridge_imports_late_legacy_writes_without_dual_writing() {
		$cut = (int) round( microtime( true ) * 1000 ) - 1000;
		update_option( OPENSTATION_PRESENCE_STORAGE_OPTION, array( 'ready' => true, 'completed_at_ms' => $cut ), false );
		$legacy = array( 1 => $this->record( $cut + 500, $cut + 500 ) );
		update_option( OPENSTATION_PRESENCE_OPTION, $legacy, false );
		openstation_presence_migration_tick();
		$this->assertSame( $legacy, openstation_presence_get_all() );
		openstation_presence_record( 2 );
		$this->assertSame( $legacy, get_option( OPENSTATION_PRESENCE_OPTION ) );
		update_option( OPENSTATION_PRESENCE_STORAGE_OPTION, array( 'ready' => true, 'completed_at_ms' => $cut - 600000 ), false );
		update_option( OPENSTATION_PRESENCE_OPTION, array( 3 => $this->record( $cut + 900, $cut + 900 ) ), false );
		openstation_presence_migration_tick();
		$this->assertArrayNotHasKey( 3, openstation_presence_get_all() );
	}

	public function test_prune_rechecks_expiry_at_delete_time() {
		$now = (int) round( microtime( true ) * 1000 );
		openstation_presence_upsert( 1, $this->record( $now - 30 * DAY_IN_SECONDS * 1000, 0 ) );
		$filter = null;
		$filter = function ( $sql ) use ( &$filter, $now ) {
			if ( false !== strpos( $sql, 'DELETE FROM ' . openstation_presence_table() ) ) {
				remove_filter( 'query', $filter );
				openstation_presence_upsert( 1, $this->record( $now, $now ) );
			}
			return $sql;
		};
		add_filter( 'query', $filter );
		try { openstation_presence_cron_prune(); } finally { remove_filter( 'query', $filter ); }
		$this->assertSame( $this->record( $now, $now ), openstation_presence_get_all()[1] );
	}

	public function test_rest_away_and_activity_keep_the_public_shape() {
		$id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $id );
		openstation_presence_record( $id );
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/presence' );
		$request->set_param( 'inactive', true );
		$this->assertSame( array( 'ok' => true ), openstation_presence_rest_post( $request )->get_data() );
		$this->assertSame( 'inactive', openstation_presence_status_for_user( $id ) );
		$this->assertSame( array( 'status', 'lastSeenMs', 'lastActiveMs' ), array_keys( openstation_presence_snapshot( array( $id ) )[ $id ] ) );
		usleep( 2000 );
		$request->set_param( 'inactive', false );
		$request->set_param( 'active', true );
		openstation_presence_rest_post( $request );
		$this->assertSame( 'online', openstation_presence_status_for_user( $id ) );
	}

	public function test_failed_write_does_not_announce_success_or_mutate_legacy_option() {
		global $wpdb;
		$recorded = 0;
		add_action( 'openstation_presence_recorded', static function () use ( &$recorded ) { ++$recorded; } );
		$filter = static function ( $sql ) {
			return false !== strpos( $sql, 'ON DUPLICATE KEY UPDATE' ) ? 'SELECT * FROM openstation_deliberately_missing_presence_table' : $sql;
		};
		add_filter( 'query', $filter );
		$suppress = $wpdb->suppress_errors( true );
		try { $result = openstation_presence_record( 1 ); } finally {
			remove_filter( 'query', $filter );
			$wpdb->suppress_errors( $suppress );
		}
		$this->assertFalse( $result );
		$this->assertSame( 0, $recorded );
		$this->assertSame( array(), openstation_presence_get_all() );
		$this->assertFalse( get_option( OPENSTATION_PRESENCE_OPTION ) );
	}

	public function test_unavailable_schema_retains_working_legacy_path_until_retry() {
		global $wpdb;
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$filter = static function ( $sql ) {
			return false !== strpos( $sql, 'CREATE TABLE IF NOT EXISTS' ) ? 'SELECT * FROM openstation_deliberately_missing_presence_table' : $sql;
		};
		add_filter( 'query', $filter, 1 );
		$suppress = $wpdb->suppress_errors( true );
		try {
			$this->assertTrue( openstation_presence_record( 1 ) );
			$this->assertSame( 'online', openstation_presence_status_for_user( 1 ) );
			$this->assertFalse( get_option( OPENSTATION_PRESENCE_STORAGE_OPTION ) );
			$this->assertArrayHasKey( 1, get_option( OPENSTATION_PRESENCE_OPTION ) );
		} finally {
			remove_filter( 'query', $filter, 1 );
			$wpdb->suppress_errors( $suppress );
		}
		wp_cache_delete( 'failed:' . openstation_presence_cache_key(), 'openstation_presence_request' );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$this->assertSame( 'online', openstation_presence_status_for_user( 1 ) );
	}

	public function test_tracking_veto_keeps_successful_rest_noop() {
		$id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $id );
		add_filter( 'openstation_presence_can_track', '__return_false' );
		$response = openstation_presence_rest_post( new WP_REST_Request( 'POST' ) );
		$this->assertSame( array( 'ok' => true ), $response->get_data() );
		$this->assertArrayNotHasKey( $id, openstation_presence_get_all() );
	}

	public function test_stale_negative_option_cache_does_not_reimport_after_cutover() {
		$state = get_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		update_option( OPENSTATION_PRESENCE_OPTION, array( 9 => $this->record( 9999, 9999 ) ), false );
		wp_cache_delete( OPENSTATION_PRESENCE_STORAGE_OPTION, 'options' );
		wp_cache_set( 'notoptions', array( OPENSTATION_PRESENCE_STORAGE_OPTION => true ), 'options' );
		$this->assertTrue( openstation_presence_migrate_storage() );
		$this->assertSame( $state, get_option( OPENSTATION_PRESENCE_STORAGE_OPTION ) );
		$this->assertArrayNotHasKey( 9, openstation_presence_get_all() );
	}

	public function test_multisite_presence_is_site_scoped() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite-only isolation test.' );
		}
		$id = self::factory()->blog->create();
		openstation_presence_upsert( 1, $this->record( 1000, 1000 ) );
		$table = openstation_presence_table();
		switch_to_blog( $id );
		try {
			$this->assertNotSame( $table, openstation_presence_table() );
			$this->assertSame( array(), openstation_presence_get_all() );
			openstation_presence_upsert( 1, $this->record( 2000, 2000 ) );
		} finally { restore_current_blog(); }
		$this->assertSame( $this->record( 1000, 1000 ), openstation_presence_get_all()[1] );
	}

	public function test_user_lists_share_one_request_snapshot_and_writes_invalidate_it() {
		global $wpdb;
		openstation_presence_upsert( 1, $this->record( 1000, 1000 ) );
		$queries = $wpdb->num_queries;
		for ( $uid = 1; $uid <= 20; ++$uid ) { openstation_presence_status_for_user( $uid ); }
		openstation_presence_get_all();
		openstation_presence_snapshot();
		$this->assertSame( 1, $wpdb->num_queries - $queries );
		openstation_presence_write_record( 1, $this->record( 2000, 2000 ) );
		$this->assertSame( $this->record( 2000, 2000 ), openstation_presence_get_all()[1] );
	}

	public function test_failed_installation_is_attempted_once_per_request() {
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$attempts = 0;
		$filter = static function ( $sql ) use ( &$attempts ) {
			if ( false !== strpos( $sql, 'SELECT GET_LOCK' ) ) { ++$attempts; return 'SELECT 0'; }
			return $sql;
		};
		add_filter( 'query', $filter );
		try {
			openstation_presence_migration_tick();
			openstation_presence_record( 1 );
			openstation_presence_get_all();
			openstation_presence_snapshot();
		} finally { remove_filter( 'query', $filter ); }
		$this->assertSame( 1, $attempts );
	}

	public function test_bridge_idle_tick_does_not_fence_new_activity_or_repeat_upserts() {
		$cut = (int) round( microtime( true ) * 1000 ) - 1000;
		update_option( OPENSTATION_PRESENCE_STORAGE_OPTION, array( 'ready' => true, 'completed_at_ms' => $cut ), false );
		openstation_presence_upsert( 1, $this->record( $cut + 100, $cut + 100 ) );
		update_option( OPENSTATION_PRESENCE_OPTION, array( 1 => $this->record( $cut + 200, 0 ) ), false );
		$count = 0;
		$filter = static function ( $sql ) use ( &$count ) {
			if ( false !== strpos( $sql, 'ON DUPLICATE KEY UPDATE' ) ) { ++$count; }
			return $sql;
		};
		add_filter( 'query', $filter );
		try { openstation_presence_migration_tick(); openstation_presence_migration_tick(); } finally { remove_filter( 'query', $filter ); }
		$this->assertSame( 1, $count );
		$this->assertSame( $this->record( $cut + 200, $cut + 100 ), openstation_presence_get_all()[1] );
	}

	public function test_stateful_veto_runs_once_and_remains_a_successful_noop() {
		wp_set_current_user( self::factory()->user->create() );
		$calls = 0;
		add_filter( 'openstation_presence_can_track', static function () use ( &$calls ) { return ++$calls > 1; } );
		$response = openstation_presence_rest_post( new WP_REST_Request( 'POST' ) );
		$this->assertSame( array( 'ok' => true ), $response->get_data() );
		$this->assertSame( 1, $calls );
	}

	public function test_future_away_fence_does_not_announce_online() {
		$future = (int) round( microtime( true ) * 1000 ) + 60000;
		openstation_presence_write_record( 1, $this->record( $future, 0 ), true );
		$changes = array();
		add_action( 'openstation_presence_changed', static function ( $id, $status ) use ( &$changes ) { $changes[] = $status; }, 10, 2 );
		$this->assertTrue( openstation_presence_record( 1 ) );
		$this->assertSame( 'inactive', openstation_presence_status_for_user( 1 ) );
		$this->assertSame( array(), $changes );
	}

	public function test_sqlite_noop_lock_does_not_prevent_idempotent_import() {
		delete_option( OPENSTATION_PRESENCE_STORAGE_OPTION );
		$filter = static function ( $sql ) { return false !== strpos( $sql, 'SELECT GET_LOCK' ) ? "SELECT '1=1'" : $sql; };
		add_filter( 'query', $filter );
		try { $this->assertTrue( openstation_presence_migrate_storage() ); } finally { remove_filter( 'query', $filter ); }
	}

	public function test_primary_routing_uses_each_dropins_supported_api() {
		global $wpdb;
		$original = $wpdb;
		$hyper = new class { public $primary = false; public function send_reads_to_masters() { $this->primary = true; } };
		$ludicrous = new class { public $primary = false; public function send_reads_to_primaries() { $this->primary = true; } public function send_reads_to_masters() { throw new Exception( 'Deprecated API' ); } };
		try {
			foreach ( array( $hyper, $ludicrous ) as $db ) {
				$wpdb = $db;
				openstation_storage_use_primary();
				$this->assertTrue( $db->primary );
			}
		} finally { $wpdb = $original; }
	}

}
