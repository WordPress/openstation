<?php

class Tests_OpenStation_PersistenceConcurrency extends WP_UnitTestCase {
	private $db;
	private $prefix;
	private $dir;
	private $workers = array();

	public function set_up() {
		parent::set_up();
		global $wpdb;
		$this->prefix = $wpdb->prefix . 'osrace_' . substr( md5( wp_generate_uuid4() ), 0, 8 ) . '_';
		$this->db = new wpdb( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
		$this->db->set_prefix( $this->prefix );
		$this->db->set_blog_id( 1 );

		$this->assertTrue( mysqli_query( $this->db->dbh, "CREATE TABLE {$this->prefix}openstation_presence (
			user_id BIGINT UNSIGNED PRIMARY KEY, last_seen_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
			last_active_ms BIGINT UNSIGNED NOT NULL DEFAULT 0, inactive_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0)" ) );
		$this->assertTrue( mysqli_query( $this->db->dbh, "CREATE TABLE {$this->prefix}desktop_mode_stored_files (
			id BIGINT PRIMARY KEY, owner_id BIGINT NOT NULL, disk_name VARCHAR(64) NOT NULL) ENGINE=InnoDB" ) );
		$this->dir = get_temp_dir() . 'os-persistence-' . wp_generate_uuid4();
		mkdir( $this->dir );
	}

	public function tear_down() {
		foreach ( $this->workers as $worker ) {
			if ( is_resource( $worker[0] ) ) {
				proc_terminate( $worker[0] );
				foreach ( $worker[1] as $pipe ) { if ( is_resource( $pipe ) ) { fclose( $pipe ); } }
				proc_close( $worker[0] );
			}
		}
		mysqli_query( $this->db->dbh, 'DROP TABLE IF EXISTS ' . $this->prefix . 'openstation_presence' );
		mysqli_query( $this->db->dbh, 'DROP TABLE IF EXISTS ' . $this->prefix . 'desktop_mode_stored_files' );
		$this->db->close();
		if ( $this->dir && is_dir( $this->dir ) ) {
			foreach ( glob( $this->dir . '/*' ) as $path ) { unlink( $path ); }
			rmdir( $this->dir );
		}
		parent::tear_down();
	}

	private function start_worker( $id, $mode, $records = array() ) {
		$config = array(
			'bootstrap' => ABSPATH . 'wp-load.php', 'user' => DB_USER, 'password' => DB_PASSWORD,
			'database' => DB_NAME, 'host' => DB_HOST, 'prefix' => $this->prefix,
			'started' => $this->dir . '/started-' . $id, 'go' => $this->dir . '/go',
			'inside' => $this->dir . '/inside-' . $id, 'mode' => $mode, 'records' => $records,
		);
		$process = proc_open( array( PHP_BINARY, dirname( __DIR__ ) . '/fixtures/persistence-worker.php' ), array( array( 'pipe', 'r' ), array( 'pipe', 'w' ), array( 'pipe', 'w' ) ), $pipes );
		$this->assertIsResource( $process );
		fwrite( $pipes[0], wp_json_encode( $config ) );
		fclose( $pipes[0] );
		$this->workers[] = array( $process, $pipes );
		return array( $process, $pipes );
	}

	private function wait_started( $id ) {
		$deadline = microtime( true ) + 10;
		while ( ! file_exists( $this->dir . '/started-' . $id ) && microtime( true ) < $deadline ) {
			usleep( 1000 );
			clearstatcache();
		}
		$this->assertFileExists( $this->dir . '/started-' . $id );
	}

	private function finish_worker( $worker ) {
		list( $process, $pipes ) = $worker;
		$output = stream_get_contents( $pipes[1] );
		$error = stream_get_contents( $pipes[2] );
		fclose( $pipes[1] );
		fclose( $pipes[2] );
		$this->assertSame( 0, proc_close( $process ), $error );
		$this->assertSame( 'ok', $output, $error );
	}

	public function test_independent_workers_do_not_lose_users_or_regress_timestamps() {
		$left = $right = array();
		for ( $i = 1; $i <= 100; ++$i ) {
			$left[] = array( 1, $i * 100, $i * 100 );
			$left[] = array( 3, $i * 100, $i * 100 );
			$right[] = array( 2, $i * 200, $i * 200 );
			$right[] = array( 3, 30000 - $i * 100, 0 );
		}
		$a = $this->start_worker( 1, 'presence', $left );
		$b = $this->start_worker( 2, 'presence', $right );
		$this->wait_started( 1 );
		$this->wait_started( 2 );
		file_put_contents( $this->dir . '/go', 'go' );
		$this->finish_worker( $a );
		$this->finish_worker( $b );
		$rows = $this->db->get_results( 'SELECT * FROM ' . $this->prefix . 'openstation_presence ORDER BY user_id', ARRAY_A );
		$this->assertCount( 3, $rows );
		$this->assertSame( array( '10000', '20000', '29900' ), array_column( $rows, 'last_seen_ms' ) );
		$this->assertSame( array( '10000', '20000', '10000' ), array_column( $rows, 'last_active_ms' ) );
	}

	public function test_heartbeat_and_pruning_workers_preserve_refreshed_users() {
		$now = (int) round( microtime( true ) * 1000 );
		$this->db->insert( $this->prefix . 'openstation_presence', array( 'user_id' => 1, 'last_seen_ms' => $now - 30 * DAY_IN_SECONDS * 1000 ) );
		$records = array();
		for ( $i = 1; $i <= 100; ++$i ) {
			$records[] = array( 1, $now + $i, $now + $i );
			$records[] = array( 2, $now + $i, $now + $i );
		}
		$a = $this->start_worker( 1, 'presence', $records );
		$b = $this->start_worker( 2, 'prune' );
		$this->wait_started( 1 );
		$this->wait_started( 2 );
		file_put_contents( $this->dir . '/go', 'go' );
		$this->finish_worker( $a );
		$this->finish_worker( $b );
		$rows = $this->db->get_results( 'SELECT * FROM ' . $this->prefix . 'openstation_presence ORDER BY user_id', ARRAY_A );
		$this->assertCount( 2, $rows );
		$this->assertSame( array( (string) ( $now + 100 ), (string) ( $now + 100 ) ), array_column( $rows, 'last_seen_ms' ) );
	}

	public function test_byte_revalidation_ignores_an_old_transaction_snapshot() {
		global $wpdb;
		$name = wp_generate_uuid4();
		$path = $this->dir . '/' . $name;
		file_put_contents( $path, 'registered after snapshot' );
		touch( $path, time() - 2 * DAY_IN_SECONDS );
		$table = $this->prefix . 'desktop_mode_stored_files';
		$this->db->query( 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' );
		$this->db->query( 'START TRANSACTION' );
		$this->assertSame( '0', $this->db->get_var( "SELECT COUNT(*) FROM $table" ) );
		$writer = new wpdb( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
		$this->assertSame( 1, $writer->insert( $table, array( 'id' => 1, 'owner_id' => 1, 'disk_name' => $name ) ) );
		$original = $wpdb;
		$wpdb = $this->db;
		$suppress = $this->db->suppress_errors( true );
		try {
			$result = openstation_stored_files_locked( function () use ( $path ) {
				global $wpdb;
				$checked = openstation_stored_files_reconcile_bytes( 1, $path, time() - DAY_IN_SECONDS );
				return array( $checked, $wpdb->last_error );
			} );
			$this->assertIsArray( $result );
			if ( ! $result[0] ) {

				$this->assertNotEmpty( $result[1] );
			}
		} finally {
			$wpdb = $original;
			$this->db->query( 'ROLLBACK' );
			$this->db->suppress_errors( $suppress );
			$writer->close();
		}
		$this->assertFileExists( $path );
	}

	public function test_upload_writer_waits_for_cleanup_connection_to_release_lock() {
		global $wpdb;
		$original = $wpdb;
		$wpdb = $this->db;
		$worker = null;
		try {
			$result = openstation_stored_files_locked( function () use ( &$worker ) {
				$worker = $this->start_worker( 1, 'lock' );
				$this->wait_started( 1 );
				$this->assertSame( array( $this->db->dbname, $this->db->prefix ), json_decode( file_get_contents( $this->dir . '/started-1' ), true ) );
				file_put_contents( $this->dir . '/go', 'go' );
				usleep( 150000 );
				clearstatcache();
				$this->assertFileDoesNotExist( $this->dir . '/inside-1' );
				return true;
			} );
		} finally { $wpdb = $original; }
		$this->assertTrue( $result );
		$this->finish_worker( $worker );
		$this->assertFileExists( $this->dir . '/inside-1' );
	}
}
