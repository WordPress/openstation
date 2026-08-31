<?php
/**
 * Tests for Code Blue — the Code Blue port written as an App
 * Framework `.os.php`: the log model, the gate, and the window's
 * dispatch cycle end to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group code-blue
 */

use OpenStation\App\State;
use function OpenStation\Apps\CodeBlue\level_map;
use function OpenStation\Apps\CodeBlue\make_entry;
use function OpenStation\Apps\CodeBlue\parse;
use function OpenStation\Apps\CodeBlue\read;
use function OpenStation\Apps\CodeBlue\signature;
use function OpenStation\Apps\CodeBlue\sources;
use function OpenStation\Apps\CodeBlue\tail;

class Tests_OpenStation_CodeBlue extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/**
	 * Temp log files created per-test, removed on tear_down.
	 *
	 * @var string[]
	 */
	protected $temp_files = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => true ) );
	}

	public function tear_down() {
		foreach ( $this->temp_files as $file ) {
			if ( file_exists( $file ) ) {
				unlink( $file );
			}
		}
		$this->temp_files = array();
		// `openstation_apps_register_windows()` registers Code Blue's
		// desktop icon into a process-scoped registry; left behind, it
		// counts as an unplaced shortcut for every later test that
		// auto-places orphans (`Tests_OpenStation_FilesStore`).
		openstation_unregister_icon( 'openstation-code-blue' );
		parent::tear_down();
	}

	/**
	 * Create a temp log and offer it as a Code Blue source.
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

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action.
	 * @param array  $state  Client state.
	 * @param array  $args   Trigger args.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'openstation-code-blue',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	// ----------------------------------------------------------- parsing

	/**
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_parse_warning_with_on_line_location() {
		$entries = parse( '[22-Aug-2026 09:14:02 UTC] PHP Warning:  Undefined array key "foo" in /srv/wp-content/plugins/x/x.php on line 12' );

		$this->assertCount( 1, $entries );
		$this->assertSame( 'warning', $entries[0]['level'] );
		$this->assertSame( 'PHP Warning', $entries[0]['label'] );
		$this->assertSame( 'Undefined array key "foo"', $entries[0]['message'] );
		$this->assertSame( '/srv/wp-content/plugins/x/x.php', $entries[0]['file'] );
		$this->assertSame( 12, $entries[0]['line'] );
		$this->assertSame( strtotime( '2026-08-22 09:14:02 UTC' ), $entries[0]['timestamp'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_parse_fatal_with_colon_location_and_attached_trace() {
		$raw     = "[22-Aug-2026 09:14:02 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function foo() in /srv/x.php:3\nStack trace:\n#0 {main}\n  thrown in /srv/x.php on line 3";
		$entries = parse( $raw );

		$this->assertCount( 1, $entries );
		$this->assertSame( 'fatal', $entries[0]['level'] );
		$this->assertSame( '/srv/x.php', $entries[0]['file'] );
		$this->assertSame( 3, $entries[0]['line'] );
		$this->assertStringContainsString( "Stack trace:\n#0 {main}", $entries[0]['trace'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_parse_database_error_moves_the_query_into_the_trace() {
		$entries = parse( "[22-Aug-2026 09:14:02 UTC] WordPress database error Table 'wp.nope' doesn't exist for query SELECT * FROM nope made by require('wp-blog-header.php')" );

		$this->assertSame( 'error', $entries[0]['level'] );
		$this->assertSame( "Table 'wp.nope' doesn't exist", $entries[0]['message'] );
		$this->assertSame( "Query: SELECT * FROM nope\nMade by: require('wp-blog-header.php')", $entries[0]['trace'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_parse_strips_markup_but_keeps_a_bare_angle_bracket() {
		$entries = parse( "[22-Aug-2026 09:14:02 UTC] PHP Notice:  Function <strong>foo</strong> is <code>bad</code> in /a.php on line 1\n[22-Aug-2026 09:14:03 UTC] PHP Parse error:  syntax error, unexpected '<' in /b.php on line 2" );

		$this->assertSame( 'Function foo is bad', $entries[0]['message'] );
		$this->assertSame( "syntax error, unexpected '<'", $entries[1]['message'] );
		$this->assertSame( '/b.php', $entries[1]['file'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_parse_keeps_untimestamped_lines_as_their_own_entries() {
		$entries = parse( "first plain line\nsecond plain line\n[22-Aug-2026 09:14:02 UTC] custom message" );

		$this->assertCount( 3, $entries );
		$this->assertSame( array( 'info', 'info', 'info' ), array_column( $entries, 'level' ) );
		$this->assertNull( $entries[0]['timestamp'] );
		$this->assertSame( 'custom message', $entries[2]['message'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\signature
	 */
	public function test_signature_collapses_numbers_and_addresses() {
		$this->assertSame(
			signature( 'warning', 'Allowed memory 0x1f exhausted at 12345', '/a.php' ),
			signature( 'warning', 'Allowed memory 0xff exhausted at 9', '/a.php' )
		);
		$this->assertNotSame( signature( 'warning', 'x', '/a.php' ), signature( 'notice', 'x', '/a.php' ) );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\tail
	 */
	public function test_tail_reads_the_end_and_drops_the_partial_first_line() {
		$path = $this->make_temp_log( str_repeat( "line one is here\n", 100 ) );
		$tail = tail( $path, 100 );

		$this->assertTrue( $tail['truncated'] );
		$this->assertStringStartsWith( 'line one', $tail['raw'] );
		$this->assertLessThan( 100, $tail['scanned_bytes'] );

		$whole = tail( $path, 1000000 );
		$this->assertFalse( $whole['truncated'] );
		$this->assertSame( 1700, $whole['scanned_bytes'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\sources
	 */
	public function test_sources_normalise_and_skip_malformed_entries() {
		$path = $this->make_temp_log( 'x' );
		add_filter(
			'openstation_code_blue_log_sources',
			static function ( $sources ) {
				$sources[] = array( 'id' => 'no-path' );
				$sources[] = array(
					'id'   => 'test-log',
					'path' => '/dup',
				);
				$sources[] = array(
					'id'   => 'ghost',
					'path' => '/definitely/missing.log',
				);
				return $sources;
			}
		);
		$list = sources( openstation_apps_os() );
		$ids  = array_column( $list, 'id' );

		$this->assertContains( 'test-log', $ids );
		$this->assertContains( 'ghost', $ids );
		$this->assertNotContains( 'no-path', $ids );
		$this->assertSame( 1, count( array_keys( $ids, 'test-log', true ) ) );
		$test = $list[ array_search( 'test-log', $ids, true ) ];
		$this->assertSame( $path, $test['path'] );
		$this->assertTrue( $test['readable'] );
		$this->assertSame( 1, $test['size'] );
		$ghost = $list[ array_search( 'ghost', $ids, true ) ];
		$this->assertFalse( $ghost['exists'] );
	}

	/**
	 * The source the `openstation_code_blue_log_sources` filter added.
	 *
	 * @param string $id Source id.
	 * @return array<string,mixed>
	 */
	protected function source( $id ) {
		foreach ( sources( openstation_apps_os() ) as $source ) {
			if ( $source['id'] === $id ) {
				return $source;
			}
		}
		$this->fail( "No log source registered under '$id'." );
	}

	// ------------------------------------------------------------ reading

	/**
	 * @covers \OpenStation\Apps\CodeBlue\level_map
	 * @covers \OpenStation\Apps\CodeBlue\parse
	 */
	public function test_every_php_error_label_maps_to_its_severity() {
		$lines = array();
		foreach ( array_keys( level_map() ) as $label ) {
			$lines[] = sprintf( '[22-Aug-2026 09:14:02 UTC] PHP %s:  %s happened', ucfirst( $label ), $label );
		}
		// An unknown label is not an error — it is just a log line.
		$lines[] = '[22-Aug-2026 09:14:03 UTC] PHP Something else:  who knows';

		$entries = parse( implode( "\n", $lines ) . "\n" );
		$levels  = array_column( $entries, 'level' );

		$this->assertSame( array_values( level_map() ), array_slice( $levels, 0, count( level_map() ) ) );
		$this->assertSame( 'info', end( $levels ) );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\read
	 */
	public function test_read_entries_are_filterable() {
		$this->make_temp_log( "not a php log line\n" );
		add_filter(
			'openstation_code_blue_entries',
			static function ( $entries, $source, $raw ) {
				return array( make_entry( 1000, 'error', 'Custom', trim( $raw ) ) );
			},
			10,
			3
		);

		$result = read( openstation_apps_os(), $this->source( 'test-log' ) );

		$this->assertCount( 1, $result['entries'] );
		$this->assertSame( 'Custom', $result['entries'][0]['label'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\read
	 */
	public function test_read_caps_entries_keeping_newest() {
		$lines = array();
		for ( $i = 1; $i <= 150; $i++ ) {
			$lines[] = sprintf(
				'[22-Aug-2026 09:%02d:%02d UTC] PHP Notice:  entry %d in /srv/a.php on line %d',
				(int) floor( $i / 60 ),
				$i % 60,
				$i,
				$i
			);
		}
		$this->make_temp_log( implode( "\n", $lines ) . "\n" );
		add_filter(
			'openstation_code_blue_max_entries',
			static function () {
				return 100;
			}
		);

		$result = read( openstation_apps_os(), $this->source( 'test-log' ) );

		$this->assertCount( 100, $result['entries'] );
		$this->assertSame( 50, $result['dropped'] );
		$this->assertTrue( $result['truncated'] );
		$this->assertStringContainsString( 'entry 150', end( $result['entries'] )['message'] );
	}

	// ------------------------------------------------------------- the app
	//
	// Grouping, filtering, sorting and the time buckets run in the
	// browser (`code-blue.os.ts`) and are covered by `code-blue.test.ts`.

	/**
	 * @covers ::openstation_app
	 */
	public function test_the_app_is_loaded_from_apps_with_its_chrome() {
		$app = openstation_app( 'openstation-code-blue' );
		$this->assertNotNull( $app );

		$manifest = $app->manifest();
		$this->assertSame( 'Code Blue', $manifest['title'] );
		$this->assertSame( 1060, $manifest['width'] );
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame( 24, $manifest['desktop_icon']['position'] );
		$this->assertSame( 'refresh', $manifest['title_bar_buttons'][0]['action'] );
		$this->assertSame( 'clear', $manifest['window_actions'][0]['action'] );
		$this->assertTrue( $manifest['window_actions'][0]['confirm']['danger'] );
		$this->assertStringEndsWith( 'apps/code-blue/code-blue.css', wp_normalize_path( $manifest['style'] ) );
		$this->assertStringEndsWith( 'apps/code-blue/code-blue.os.ts', wp_normalize_path( $manifest['client_source'] ), 'The body is a client view.' );
		$this->assertTrue( $manifest['has_data'] );
		$this->assertSame( array( 'refresh', 'source', 'clear' ), $manifest['actions'], 'Only the actions that need the server are server actions.' );
	}

	/**
	 * @covers ::openstation_apps_register_windows
	 */
	public function test_host_ships_the_client_view_with_the_window() {
		wp_set_current_user( self::$admin_id );
		openstation_apps_register_windows();

		$entry = openstation_native_window_registry( 'openstation-code-blue' );
		$this->assertIsArray( $entry );
		// `openstation_apps_client_bundle()` resolves to a file on disk,
		// so this asserts against real build output — `assets/js/apps/`
		// is gitignored, and CI's PHPUnit job runs `npm run build:apps`
		// before the suite for exactly this reason.
		$this->assertTrue(
			$entry['config']['client'],
			'No built client view found — run `npm run build:apps` (or `npm run build`) first.'
		);
		$this->assertSame( array( 'openstation-app-openstation-code-blue-client' ), $entry['scripts'], 'The .os.ts bundle rides as a companion script.' );
		$this->assertStringContainsString( 'assets/js/apps/code-blue', wp_scripts()->registered['openstation-app-openstation-code-blue-client']->src );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\can_use
	 */
	public function test_gate_requires_developer_mode_and_site_management() {
		$app = openstation_app( 'openstation-code-blue' );
		$os  = openstation_apps_os();

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( $app->allows( $os ) );

		wp_set_current_user( self::$admin_id );
		$this->assertTrue( $app->allows( $os ) );

		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => false ) );
		$this->assertFalse( $app->allows( $os ) );
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => true ) );

		add_filter( 'openstation_code_blue_user_can_use', '__return_false' );
		$this->assertFalse( $app->allows( $os ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_picks_the_first_usable_source_and_paints_the_log() {
		wp_set_current_user( self::$admin_id );
		$this->make_temp_log( "[22-Aug-2026 09:14:02 UTC] PHP Warning:  Needle in haystack in /srv/wp-content/plugins/x/x.php on line 12\n" );
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 5 );

		$response = $this->dispatch( 'mount', array( 'range' => 'all' ) );

		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'test-log', $response['state']['source'] );
		$this->assertSame( '', $response['html'], 'The body is painted by the client view, not the server.' );
		$data = $response['data'];
		$this->assertSame( 'test-log', $data['source']['id'] );
		$this->assertCount( 1, $data['entries'] );
		$this->assertSame( 'Needle in haystack', $data['entries'][0]['message'] );
		$this->assertSame( 12, $data['entries'][0]['line'] );
		$this->assertSame( 'WP_DEBUG', $data['environment'][0]['label'] );
		$this->assertSame( '', $data['readError'] );
		$this->assertFalse( $data['truncated'] );
		$this->assertIsInt( $data['now'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_the_instant_interactions_never_reach_the_server() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 5 );
		foreach ( array( 'toggle', 'series', 'range' ) as $local ) {
			$response = $this->dispatch( $local );
			$this->assertSame( array( 'unknown_action', 400 ), array( $response['error'], $response['status'] ), "$local is a client-side action." );
		}
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_switching_source_refreshes_the_data_and_collapses_rows() {
		wp_set_current_user( self::$admin_id );
		$this->make_temp_log( "[22-Aug-2026 09:14:02 UTC] PHP Fatal error:  Boom in /srv/x.php:3\nStack trace:\n#0 {main}\n" );
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 5 );

		$response = $this->dispatch( 'source', array( 'source' => 'test-log', 'expanded' => array( 'abc' ), 'error' => 'stale' ) );

		$this->assertSame( array(), $response['state']['expanded'] );
		$this->assertSame( '', $response['state']['error'] );
		$this->assertSame( "Stack trace:\n#0 {main}", $response['data']['entries'][0]['trace'] );
		$this->assertSame( 'fatal', $response['data']['entries'][0]['level'] );
	}

	/**
	 * @covers \OpenStation\Apps\CodeBlue\clear
	 */
	public function test_clear_truncates_the_log_and_toasts() {
		wp_set_current_user( self::$admin_id );
		$path = $this->make_temp_log( "[22-Aug-2026 09:14:02 UTC] PHP Warning:  Gone soon in /a.php on line 1\n" );
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 5 );
		$cleared = array();
		add_action(
			'openstation_code_blue_log_cleared',
			static function ( $id, $file ) use ( &$cleared ) {
				$cleared[] = array( $id, $file );
			},
			10,
			2
		);

		$response = $this->dispatch( 'clear', array( 'source' => 'test-log' ) );

		$this->assertTrue( $response['ok'] );
		$this->assertSame( '', file_get_contents( $path ) );
		$this->assertSame( array( array( 'test-log', $path ) ), $cleared );
		$this->assertSame( 'toast', $response['effects'][0]['type'] );
		$this->assertSame( array(), $response['data']['entries'], 'The data is re-read after the clear.' );
		$this->assertSame( 0, $response['data']['source']['size'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_state_from_the_client_is_bounded_by_the_schema() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 5 );

		$response = $this->dispatch(
			'mount',
			array(
				'range'   => array( 'not', 'a', 'string' ),
				'evil'    => 'payload',
				'hidden'  => 'info',
				'auto'    => 'on',
			)
		);

		$this->assertTrue( $response['ok'] );
		$this->assertSame( '24h', $response['state']['range'] );
		$this->assertSame( array(), $response['state']['hidden'] );
		$this->assertTrue( $response['state']['auto'] );
		$this->assertArrayNotHasKey( 'evil', $response['state'] );
		$this->assertNull( $response['data']['source'], 'No sources at all: the client paints its empty state.' );
	}

	/**
	 * @covers ::openstation_apps_rest_permission
	 */
	public function test_rest_route_is_closed_to_users_outside_the_gate() {
		wp_set_current_user( self::$editor_id );
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/apps/openstation-code-blue/dispatch' );
		$request->set_param( 'action', 'mount' );
		$this->assertSame( 403, rest_do_request( $request )->get_status() );
	}

	/**
	 * The app stays small. The TypeScript Code Blue it replaced was
	 * 3,235 lines (981 PHP + 1,726 TS + 528 CSS); the port has to stay
	 * under half of that and ship no JavaScript at all — "just add a
	 * little script" is the framework failing, not the app growing.
	 */
	public function test_the_app_stays_small_and_its_only_script_is_the_client_view() {
		$dir   = OPENSTATION_DIR . 'apps/code-blue/';
		$lines = 0;
		foreach ( array_merge( glob( $dir . '*.php' ), glob( $dir . '*.css' ), glob( $dir . '*.os.ts' ) ) as $file ) {
			$lines += count( file( $file ) );
		}
		$this->assertLessThan( 1600, $lines, sprintf( 'Code Blue is %d lines; the budget is under half of the 3,235-line original.', $lines ) );

		$scripts = array_map( 'basename', array_merge( glob( $dir . '*.js' ), glob( $dir . '*.ts' ) ) );
		$this->assertSame( array( 'code-blue.os.ts', 'code-blue.test.ts' ), $scripts, 'The only script an app ships is its .os.ts client view (plus its test).' );
	}
}
