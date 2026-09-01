<?php
/**
 * Tests for the Code Blue module: log parsing, source discovery,
 * tailing, and the REST surface.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group code-blue
 */
class Tests_OpenStation_CodeBlue extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/**
	 * Temp log files created per-test, removed on tearDown.
	 *
	 * @var string[]
	 */
	protected $temp_files = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );

		// The gate reads network-wide (`manage_network_options` on
		// multisite): the log is one file for the whole network, so a
		// site administrator is deliberately refused there. The admin
		// fixture is "the user allowed in", which multisite spells
		// super admin; test_gate_denies_site_admin_on_multisite pins
		// the refusal.
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}

		// Code Blue is gated behind Developer mode — the admin
		// fixture has it on; tests for the off state flip it
		// per-user themselves.
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => true ) );
	}

	public function tear_down() {
		foreach ( $this->temp_files as $file ) {
			if ( file_exists( $file ) ) {
				unlink( $file );
			}
		}
		$this->temp_files = array();
		parent::tear_down();
	}

	/**
	 * Create a temp log file with the given contents and register it
	 * as a Code Blue source for the duration of the test.
	 *
	 * @param string $contents Log text.
	 * @return string Absolute path.
	 */
	protected function make_temp_log( $contents ) {
		$path = wp_tempnam( 'code-blue-test-log' );
		file_put_contents( $path, $contents );
		$this->temp_files[] = $path;

		add_filter(
			'openstation_code_blue_log_sources',
			static function ( $sources ) use ( $path ) {
				$sources[] = array(
					'id'    => 'test-log',
					'label' => 'Test log',
					'path'  => $path,
				);
				return $sources;
			}
		);

		return $path;
	}

	// ------------------------------------------------------ parsing

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_warning_with_on_line_location() {
		$entries = openstation_code_blue_parse(
			'[22-Aug-2026 09:14:02 UTC] PHP Warning:  Undefined array key "foo" in /srv/wp-content/plugins/x/x.php on line 12'
		);

		$this->assertCount( 1, $entries );
		$entry = $entries[0];
		$this->assertSame( 'warning', $entry['level'] );
		$this->assertSame( 'PHP Warning', $entry['label'] );
		$this->assertSame( 'Undefined array key "foo"', $entry['message'] );
		$this->assertSame( '/srv/wp-content/plugins/x/x.php', $entry['file'] );
		$this->assertSame( 12, $entry['line'] );
		$this->assertSame( strtotime( '2026-08-22 09:14:02 UTC' ), $entry['timestamp'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_fatal_with_colon_location_and_stack_trace() {
		$raw = implode(
			"\n",
			array(
				'[22-Aug-2026 10:00:00 UTC] PHP Fatal error:  Uncaught TypeError: boom in /srv/wp-content/plugins/x/x.php:34',
				'Stack trace:',
				'#0 /srv/wp-includes/class-wp-hook.php(324): my_func()',
				'#1 {main}',
				'  thrown in /srv/wp-content/plugins/x/x.php on line 34',
			)
		);

		$entries = openstation_code_blue_parse( $raw );

		$this->assertCount( 1, $entries );
		$entry = $entries[0];
		$this->assertSame( 'fatal', $entry['level'] );
		$this->assertSame( 'Uncaught TypeError: boom', $entry['message'] );
		$this->assertSame( '/srv/wp-content/plugins/x/x.php', $entry['file'] );
		$this->assertSame( 34, $entry['line'] );
		$this->assertStringContainsString( 'Stack trace:', $entry['trace'] );
		$this->assertStringContainsString( '#1 {main}', $entry['trace'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_database_error_splits_query_into_trace() {
		$entries = openstation_code_blue_parse(
			"[22-Aug-2026 11:00:00 UTC] WordPress database error Unknown column 'foo' in 'field list' for query SELECT foo FROM wp_posts made by require('wp-blog-header.php')"
		);

		$this->assertCount( 1, $entries );
		$entry = $entries[0];
		$this->assertSame( 'error', $entry['level'] );
		$this->assertSame( 'Database error', $entry['label'] );
		$this->assertSame( "Unknown column 'foo' in 'field list'", $entry['message'] );
		$this->assertStringContainsString( 'Query: SELECT foo FROM wp_posts', $entry['trace'] );
		$this->assertStringContainsString( "Made by: require('wp-blog-header.php')", $entry['trace'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_xdebug_trace_lines_attach_to_previous_entry() {
		$raw = implode(
			"\n",
			array(
				'[22-Aug-2026 12:00:00 UTC] PHP Warning:  Something in /srv/x.php on line 5',
				'[22-Aug-2026 12:00:00 UTC] PHP Stack trace:',
				'[22-Aug-2026 12:00:00 UTC] PHP   1. {main}() /srv/index.php:0',
				'[22-Aug-2026 12:00:00 UTC] PHP   2. foo() /srv/x.php:5',
			)
		);

		$entries = openstation_code_blue_parse( $raw );

		$this->assertCount( 1, $entries );
		$this->assertStringContainsString( 'PHP Stack trace:', $entries[0]['trace'] );
		$this->assertStringContainsString( '2. foo()', $entries[0]['trace'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_custom_error_log_line_is_info() {
		$entries = openstation_code_blue_parse(
			'[22-Aug-2026 13:00:00 UTC] my-plugin: cache warmed in 2.3s'
		);

		$this->assertCount( 1, $entries );
		$this->assertSame( 'info', $entries[0]['level'] );
		$this->assertSame( 'my-plugin: cache warmed in 2.3s', $entries[0]['message'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_deprecated_and_notice_levels() {
		$raw = implode(
			"\n",
			array(
				'[22-Aug-2026 14:00:00 UTC] PHP Deprecated:  Function get_settings is deprecated in /srv/wp-includes/functions.php on line 1',
				'[22-Aug-2026 14:00:01 UTC] PHP Notice:  Undefined index: bar in /srv/x.php on line 2',
			)
		);

		$entries = openstation_code_blue_parse( $raw );

		$this->assertCount( 2, $entries );
		$this->assertSame( 'deprecated', $entries[0]['level'] );
		$this->assertSame( 'notice', $entries[1]['level'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_preserves_bare_angle_bracket_in_message() {
		$entries = openstation_code_blue_parse(
			"[22-Aug-2026 10:00:00 UTC] PHP Parse error:  syntax error, unexpected '<' in /srv/x.php on line 3"
		);

		$this->assertCount( 1, $entries );
		$this->assertSame( "syntax error, unexpected '<'", $entries[0]['message'] );
		$this->assertSame( '/srv/x.php', $entries[0]['file'] );
		$this->assertSame( 3, $entries[0]['line'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_untimestamped_plain_lines_become_individual_entries() {
		// error_log( $msg, 3, $path ) writes raw text with no
		// timestamp prefix — each line must be its own entry, not a
		// continuation of the first.
		$entries = openstation_code_blue_parse( "cache warmed in 2.3s\npayment webhook received\n" );

		$this->assertCount( 2, $entries );
		$this->assertSame( 'cache warmed in 2.3s', $entries[0]['message'] );
		$this->assertSame( 'payment webhook received', $entries[1]['message'] );
		$this->assertNull( $entries[0]['timestamp'] );
	}

	/**
	 * @covers ::openstation_code_blue_read_source
	 */
	public function test_read_source_entries_are_filterable() {
		$this->make_temp_log( "not a php log line\n" );
		add_filter(
			'openstation_code_blue_entries',
			static function ( $entries, $source, $raw ) {
				return array(
					openstation_code_blue_make_entry( 1000, 'error', 'Custom', trim( $raw ) ),
				);
			},
			10,
			3
		);

		$read = openstation_code_blue_read_source( openstation_code_blue_get_source( 'test-log' ) );

		$this->assertCount( 1, $read['entries'] );
		$this->assertSame( 'Custom', $read['entries'][0]['label'] );
	}

	/**
	 * @covers ::openstation_code_blue_parse
	 */
	public function test_parse_strips_html_tags_from_message() {
		$entries = openstation_code_blue_parse(
			'[22-Aug-2026 15:00:00 UTC] PHP Notice:  Function map_meta_cap was called <strong>incorrectly</strong>. The post type <code>foo</code> is bad.'
		);

		$this->assertCount( 1, $entries );
		$this->assertSame(
			'Function map_meta_cap was called incorrectly. The post type foo is bad.',
			$entries[0]['message']
		);
	}

	/**
	 * @covers ::openstation_code_blue_signature
	 */
	public function test_signature_collapses_numbers_and_hex() {
		$a = openstation_code_blue_signature( 'warning', 'Allowed memory size of 134217728 bytes exhausted', '/srv/x.php' );
		$b = openstation_code_blue_signature( 'warning', 'Allowed memory size of 268435456 bytes exhausted', '/srv/x.php' );
		$this->assertSame( $a, $b );

		$c = openstation_code_blue_signature( 'warning', 'Object 0xdeadbeef leaked', '' );
		$d = openstation_code_blue_signature( 'warning', 'Object 0xcafebabe leaked', '' );
		$this->assertSame( $c, $d );

		$other = openstation_code_blue_signature( 'notice', 'Allowed memory size of 134217728 bytes exhausted', '/srv/x.php' );
		$this->assertNotSame( $a, $other );
	}

	/**
	 * @covers ::openstation_code_blue_level_for_label
	 */
	public function test_level_for_label_mapping() {
		$this->assertSame( 'fatal', openstation_code_blue_level_for_label( 'Fatal error' ) );
		$this->assertSame( 'fatal', openstation_code_blue_level_for_label( 'Parse error' ) );
		$this->assertSame( 'error', openstation_code_blue_level_for_label( 'User error' ) );
		$this->assertSame( 'warning', openstation_code_blue_level_for_label( 'Warning' ) );
		$this->assertSame( 'deprecated', openstation_code_blue_level_for_label( 'User deprecated' ) );
		$this->assertSame( 'notice', openstation_code_blue_level_for_label( 'Notice' ) );
		$this->assertSame( 'info', openstation_code_blue_level_for_label( 'Something else' ) );
	}

	// ------------------------------------------------------- tailing

	/**
	 * @covers ::openstation_code_blue_tail
	 */
	public function test_tail_reads_whole_small_file() {
		$path = wp_tempnam( 'code-blue-tail' );
		$this->temp_files[] = $path;
		file_put_contents( $path, "line one\nline two\n" );

		$tail = openstation_code_blue_tail( $path, 1024 );

		$this->assertFalse( $tail['truncated'] );
		$this->assertSame( "line one\nline two\n", $tail['raw'] );
	}

	/**
	 * @covers ::openstation_code_blue_tail
	 */
	public function test_tail_drops_partial_first_line_when_truncated() {
		$path = wp_tempnam( 'code-blue-tail' );
		$this->temp_files[] = $path;
		file_put_contents( $path, "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n" );

		// 15 bytes from the end lands mid-way through the second line.
		$tail = openstation_code_blue_tail( $path, 15 );

		$this->assertTrue( $tail['truncated'] );
		$this->assertSame( "cccccccccc\n", $tail['raw'] );
	}

	// ------------------------------------------------------- sources

	/**
	 * @covers ::openstation_code_blue_log_sources
	 */
	public function test_filtered_source_is_normalized_with_file_metadata() {
		$path = $this->make_temp_log( "[22-Aug-2026 09:00:00 UTC] PHP Warning:  x in /srv/a.php on line 1\n" );

		$source = openstation_code_blue_get_source( 'test-log' );

		$this->assertNotNull( $source );
		$this->assertSame( 'Test log', $source['label'] );
		$this->assertSame( $path, $source['path'] );
		$this->assertTrue( $source['exists'] );
		$this->assertTrue( $source['readable'] );
		$this->assertSame( filesize( $path ), $source['size'] );
	}

	/**
	 * @covers ::openstation_code_blue_log_sources
	 */
	public function test_malformed_filtered_sources_are_skipped() {
		$this->make_temp_log( "valid\n" );
		add_filter(
			'openstation_code_blue_log_sources',
			static function ( $sources ) {
				$sources[] = array( 'label' => 'No id or path' );
				$sources[] = array(
					'id'   => 'no-path',
					'path' => '',
				);
				return $sources;
			}
		);

		$ids = wp_list_pluck( openstation_code_blue_log_sources(), 'id' );

		$this->assertContains( 'test-log', $ids );
		$this->assertNotContains( 'no-path', $ids );
		$this->assertNotContains( '', $ids );
	}

	/**
	 * @covers ::openstation_code_blue_read_source
	 */
	public function test_read_source_caps_entries_keeping_newest() {
		$lines = array();
		for ( $i = 1; $i <= 150; $i++ ) {
			$lines[] = sprintf( '[22-Aug-2026 09:%02d:%02d UTC] PHP Notice:  entry %d in /srv/a.php on line %d', floor( $i / 60 ), $i % 60, $i, $i );
		}
		$this->make_temp_log( implode( "\n", $lines ) . "\n" );
		add_filter(
			'openstation_code_blue_max_entries',
			static function () {
				return 100;
			}
		);

		$read = openstation_code_blue_read_source( openstation_code_blue_get_source( 'test-log' ) );

		$this->assertCount( 100, $read['entries'] );
		$this->assertSame( 50, $read['dropped_entries'] );
		$this->assertTrue( $read['truncated'] );
		$this->assertStringContainsString( 'entry 150', end( $read['entries'] )['message'] );
	}

	// ---------------------------------------------------- capability

	/**
	 * @covers ::openstation_code_blue_user_can_use
	 */
	public function test_gate_defaults_to_manage_options() {
		wp_set_current_user( self::$admin_id );
		$this->assertTrue( openstation_code_blue_user_can_use() );

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( openstation_code_blue_user_can_use() );
	}

	/**
	 * @covers ::openstation_code_blue_user_can_use
	 */
	public function test_gate_requires_developer_mode() {
		// An administrator WITHOUT Developer mode sees nothing.
		$plain_admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		if ( is_multisite() ) {
			grant_super_admin( $plain_admin );
		}
		wp_set_current_user( $plain_admin );
		$this->assertFalse( openstation_code_blue_user_can_use() );
		$this->assertFalse( openstation_code_blue_rest_permission() );

		// Flipping the switch in OpenStation Preferences unlocks it.
		openstation_save_os_settings( $plain_admin, array( 'developerModeEnabled' => true ) );
		$this->assertTrue( openstation_code_blue_user_can_use() );

		// Developer mode alone is not enough without the capability.
		openstation_save_os_settings( self::$editor_id, array( 'developerModeEnabled' => true ) );
		wp_set_current_user( self::$editor_id );
		$this->assertFalse( openstation_code_blue_user_can_use() );
	}

	/**
	 * @covers ::openstation_code_blue_user_can_use
	 */
	/**
	 * The log is one file for the whole network, so on multisite the
	 * gate is `manage_network_options` and a SITE administrator is
	 * refused even with Developer mode on.
	 *
	 * @covers ::openstation_code_blue_user_can_use
	 */
	public function test_gate_denies_site_admin_on_multisite() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite-only behavior.' );
		}
		$site_admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		openstation_save_os_settings( $site_admin, array( 'developerModeEnabled' => true ) );
		wp_set_current_user( $site_admin );
		$this->assertFalse( openstation_code_blue_user_can_use() );
		$this->assertFalse( openstation_code_blue_rest_permission() );
	}

	public function test_gate_is_filterable() {
		wp_set_current_user( self::$editor_id );
		add_filter( 'openstation_code_blue_user_can_use', '__return_true' );
		$this->assertTrue( openstation_code_blue_user_can_use() );
	}

	// ---------------------------------------------------------- REST

	/**
	 * @covers ::openstation_code_blue_register_routes
	 */
	public function test_routes_are_registered() {
		do_action( 'rest_api_init' );
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );

		$this->assertArrayHasKey( '/desktop-mode/v1/code-blue/sources', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/code-blue/entries', $routes );
	}

	/**
	 * @covers ::openstation_code_blue_rest_sources
	 */
	public function test_rest_sources_carries_environment_rows() {
		wp_set_current_user( self::$admin_id );

		$response = openstation_code_blue_rest_sources();
		$data     = $response->get_data();

		$this->assertArrayHasKey( 'sources', $data );
		$this->assertArrayHasKey( 'environment', $data );
		$keys = wp_list_pluck( $data['environment'], 'key' );
		$this->assertContains( 'wp_debug', $keys );
		$this->assertContains( 'php', $keys );
	}

	/**
	 * @covers ::openstation_code_blue_rest_entries
	 */
	public function test_rest_entries_returns_parsed_entries() {
		wp_set_current_user( self::$admin_id );
		$this->make_temp_log(
			"[22-Aug-2026 09:14:02 UTC] PHP Warning:  Undefined array key \"foo\" in /srv/x.php on line 12\n"
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/code-blue/entries' );
		$request->set_param( 'source', 'test-log' );
		$response = openstation_code_blue_rest_entries( $request );

		$this->assertNotWPError( $response );
		$data = $response->get_data();
		$this->assertCount( 1, $data['entries'] );
		$this->assertSame( 'warning', $data['entries'][0]['level'] );
		$this->assertFalse( $data['truncated'] );
	}

	/**
	 * @covers ::openstation_code_blue_rest_entries
	 */
	public function test_rest_entries_missing_file_is_empty_success() {
		wp_set_current_user( self::$admin_id );
		add_filter(
			'openstation_code_blue_log_sources',
			static function ( $sources ) {
				$sources[] = array(
					'id'    => 'ghost-log',
					'label' => 'Ghost log',
					'path'  => '/nonexistent/ghost.log',
				);
				return $sources;
			}
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/code-blue/entries' );
		$request->set_param( 'source', 'ghost-log' );
		$response = openstation_code_blue_rest_entries( $request );

		$this->assertNotWPError( $response );
		$data = $response->get_data();
		$this->assertSame( array(), $data['entries'] );
		$this->assertFalse( $data['truncated'] );
	}

	/**
	 * @covers ::openstation_code_blue_rest_clear
	 */
	public function test_rest_clear_missing_file_is_noop_success() {
		wp_set_current_user( self::$admin_id );
		add_filter(
			'openstation_code_blue_log_sources',
			static function ( $sources ) {
				$sources[] = array(
					'id'    => 'ghost-log',
					'label' => 'Ghost log',
					'path'  => '/nonexistent/ghost.log',
				);
				return $sources;
			}
		);

		$request = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/code-blue/entries' );
		$request->set_param( 'source', 'ghost-log' );
		$response = openstation_code_blue_rest_clear( $request );

		$this->assertNotWPError( $response );
		$this->assertTrue( $response->get_data()['cleared'] );
	}

	/**
	 * @covers ::openstation_code_blue_rest_entries
	 */
	public function test_rest_entries_unknown_source_is_404() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/code-blue/entries' );
		$request->set_param( 'source', 'nope' );
		$response = openstation_code_blue_rest_entries( $request );

		$this->assertWPError( $response );
		$this->assertSame( 404, $response->get_error_data()['status'] );
	}

	/**
	 * @covers ::openstation_code_blue_rest_clear
	 */
	public function test_rest_clear_truncates_the_file_and_fires_action() {
		wp_set_current_user( self::$admin_id );
		$path = $this->make_temp_log( "[22-Aug-2026 09:14:02 UTC] PHP Warning:  x in /srv/a.php on line 1\n" );

		$fired = array();
		add_action(
			'openstation_code_blue_log_cleared',
			static function ( $id, $cleared_path ) use ( &$fired ) {
				$fired = array( $id, $cleared_path );
			},
			10,
			2
		);

		$request = new WP_REST_Request( 'DELETE', '/desktop-mode/v1/code-blue/entries' );
		$request->set_param( 'source', 'test-log' );
		$response = openstation_code_blue_rest_clear( $request );

		$this->assertNotWPError( $response );
		$this->assertTrue( $response->get_data()['cleared'] );
		$this->assertSame( 0, filesize( $path ) );
		$this->assertSame( array( 'test-log', $path ), $fired );
	}

	/**
	 * @covers ::openstation_code_blue_rest_permission
	 */
	public function test_rest_permission_follows_the_gate() {
		wp_set_current_user( self::$editor_id );
		$this->assertFalse( openstation_code_blue_rest_permission() );

		wp_set_current_user( self::$admin_id );
		$this->assertTrue( openstation_code_blue_rest_permission() );
	}
}
