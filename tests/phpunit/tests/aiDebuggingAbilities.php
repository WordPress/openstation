<?php
/**
 * Tests for the error-investigation skill — the four read-only
 * abilities that let an assistant or an agent work a stack trace.
 *
 * The properties worth pinning are the boundaries, not the happy path:
 * that the whole skill is read-only (it may propose a fix and can never
 * apply one), that it is gated exactly like the window it reads for,
 * and that `read_source_excerpt` refuses everything it is supposed to
 * refuse. A regression in any of those is a security regression, and
 * the last one would be a file-read tool wearing a debugging label.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 * @group code-blue
 */
class Tests_OpenStation_AiDebuggingAbilities extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/** @var string[] */
	protected $temp_files = array();

	/** The ability names this skill contributes. */
	const ABILITIES = array(
		'desktop-mode/list-log-issues',
		'desktop-mode/get-log-issue',
		'desktop-mode/read-source-excerpt',
		'desktop-mode/get-site-context',
	);

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => true ) );
	}

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
		wp_set_current_user( self::$admin_id );
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
	 * Offer a temp file as the only Code Blue log source.
	 *
	 * @param string $contents Log text.
	 * @return string Absolute path.
	 */
	protected function make_temp_log( $contents ) {
		$path = wp_tempnam( 'code-blue-abilities-log' );
		file_put_contents( $path, $contents );
		$this->temp_files[] = $path;
		add_filter(
			'openstation_code_blue_log_sources',
			static function () use ( $path ) {
				return array(
					array(
						'id'    => 'test-log',
						'label' => 'Test log',
						'path'  => $path,
					),
				);
			},
			20
		);
		return $path;
	}

	/**
	 * A log naming a real file inside the install, so the source-reading
	 * ability has something it is allowed to open.
	 *
	 * @return string The file the log names.
	 */
	protected function log_naming_a_core_file() {
		$file = ABSPATH . 'wp-includes/version.php';
		$this->make_temp_log(
			"[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function boom() in {$file}:12\n"
				. "Stack trace:\n#0 {main}\n  thrown in {$file} on line 12\n"
		);
		return $file;
	}

	/**
	 * The skill's whole safety story: a model handed these tools can
	 * describe a fix and has no route to apply one. If a mutating
	 * ability ever joins this list, that stops being true silently.
	 */
	public function test_every_ability_in_the_skill_is_read_only() {
		foreach ( self::ABILITIES as $name ) {
			$ability = wp_get_ability( $name );
			$this->assertInstanceOf( 'WP_Ability', $ability, "{$name} should be registered." );
			$meta = (array) $ability->get_meta();
			$this->assertTrue(
				! empty( $meta['annotations']['readonly'] ),
				"{$name} must be read-only: the skill proposes fixes, it never applies them."
			);
			$this->assertArrayNotHasKey(
				'mcp',
				$meta,
				"{$name} must not be exposed over MCP: this site's log and source are not an external agent's business."
			);
			$this->assertSame( 'openstation', $ability->get_category() );
			$this->assertNotEmpty( $ability->get_description() );
			$this->assertNotEmpty( $ability->get_input_schema() );
			$this->assertNotEmpty( $ability->get_output_schema() );
		}
	}

	/**
	 * Being read-only is what gets them offered to the Copilot's model
	 * at all — the loop advertises every read-only ability.
	 */
	public function test_the_skill_is_offered_to_the_copilot() {
		$names = openstation_ai_search_ability_names();
		foreach ( self::ABILITIES as $name ) {
			$this->assertContains( $name, $names );
		}
	}

	/**
	 * The gate is Code Blue's, not a new one: a user who cannot open
	 * the log window cannot read the log through an assistant either.
	 */
	public function test_gate_matches_the_code_blue_window() {
		$this->assertTrue( openstation_ai_debug_can_use() );

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( openstation_ai_debug_can_use(), 'An editor cannot use the debugging skill.' );

		// An administrator with Developer mode off is refused too — the
		// window is hidden for them, and so is its tool surface.
		wp_set_current_user( self::$admin_id );
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => false ) );
		$this->assertFalse( openstation_ai_debug_can_use() );
		openstation_save_os_settings( self::$admin_id, array( 'developerModeEnabled' => true ) );
	}

	/**
	 * The filter that moves the window moves the tools with it.
	 */
	public function test_the_code_blue_filter_moves_both() {
		add_filter( 'openstation_code_blue_user_can_use', '__return_false' );
		$this->assertFalse( openstation_ai_debug_can_use() );
	}

	public function test_list_groups_repeated_failures_into_one_issue() {
		$this->make_temp_log(
			"[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function boom() in /var/www/html/wp-content/plugins/acme/acme.php:12\n"
				. "[01-Sep-2026 10:00:05 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function boom() in /var/www/html/wp-content/plugins/acme/acme.php:12\n"
				. "[01-Sep-2026 10:00:09 UTC] PHP Warning:  Undefined variable \$x in /var/www/html/wp-content/themes/acme-theme/functions.php on line 4\n"
		);

		$out = wp_get_ability( 'desktop-mode/list-log-issues' )->execute( array( 'limit' => 10 ) );

		$this->assertCount( 2, $out['issues'], 'Two occurrences of one error are one issue.' );
		// Issues come back most-recently-seen first, so the warning
		// leads here — pick the fatal by what it is, not by position.
		$this->assertSame( 'warning', $out['issues'][0]['level'] );
		$fatal = $out['issues'][1];
		$this->assertSame( 2, $fatal['count'] );
		$this->assertSame( 'fatal', $fatal['level'] );
		$this->assertSame( 'plugin', $fatal['origin']['kind'] );
		$this->assertSame( 'acme', $fatal['origin']['slug'] );
		$this->assertArrayNotHasKey( 'trace', $fatal, 'The triage list leaves the trace to get_log_issue.' );
		$this->assertSame( 'test-log', $out['source']['id'] );
	}

	public function test_list_filters_by_level() {
		$this->make_temp_log(
			"[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Boom in /a/b.php:1\n"
				. "[01-Sep-2026 10:00:01 UTC] PHP Deprecated:  Old thing in /a/b.php:2\n"
		);

		$out = wp_get_ability( 'desktop-mode/list-log-issues' )->execute(
			array(
				'limit' => 10,
				'level' => 'fatal',
			)
		);
		$this->assertCount( 1, $out['issues'] );
		$this->assertSame( 'fatal', $out['issues'][0]['level'] );
	}

	/**
	 * No log is an answer, not an error: the assistant has to be able to
	 * tell the user their install is not writing one.
	 */
	public function test_list_explains_a_missing_log_instead_of_failing() {
		add_filter( 'openstation_code_blue_log_sources', '__return_empty_array', 20 );

		$out = wp_get_ability( 'desktop-mode/list-log-issues' )->execute( array( 'limit' => 10 ) );

		$this->assertSame( array(), $out['issues'] );
		$this->assertNotEmpty( $out['message'] );
	}

	public function test_get_issue_returns_the_trace_for_one_signature() {
		$this->make_temp_log(
			"[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Uncaught Error: Boom in /a/b.php:12\n"
				. "Stack trace:\n#0 /a/c.php(4): boom()\n#1 {main}\n"
		);

		$list      = wp_get_ability( 'desktop-mode/list-log-issues' )->execute( array( 'limit' => 10 ) );
		$signature = $list['issues'][0]['signature'];

		$out = wp_get_ability( 'desktop-mode/get-log-issue' )->execute( array( 'signature' => $signature ) );

		$this->assertSame( $signature, $out['issue']['signature'] );
		$this->assertStringContainsString( '#0 /a/c.php(4): boom()', $out['issue']['trace'] );
	}

	public function test_get_issue_says_so_when_the_signature_is_gone() {
		$this->make_temp_log( "[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Boom in /a/b.php:1\n" );

		$out = wp_get_ability( 'desktop-mode/get-log-issue' )->execute( array( 'signature' => 'nope' ) );

		$this->assertArrayNotHasKey( 'issue', $out );
		$this->assertNotEmpty( $out['message'] );
	}

	public function test_read_source_returns_numbered_lines_around_the_logged_line() {
		$file = $this->log_naming_a_core_file();

		$out = wp_get_ability( 'desktop-mode/read-source-excerpt' )->execute(
			array(
				'file'    => $file,
				'line'    => 12,
				'context' => 3,
			)
		);

		$this->assertSame( 9, $out['start_line'] );
		$this->assertSame( 15, $out['end_line'] );
		$this->assertCount( 7, $out['lines'] );
		$this->assertSame( 9, $out['lines'][0]['number'] );
		$this->assertArrayHasKey( 'text', $out['lines'][0] );
	}

	/**
	 * The boundary that makes this a debugging tool rather than a file
	 * reader: a path only becomes readable because the install already
	 * wrote it into its own error log.
	 */
	public function test_read_source_refuses_a_file_the_log_never_named() {
		$this->log_naming_a_core_file();

		$out = wp_get_ability( 'desktop-mode/read-source-excerpt' )->execute(
			array(
				'file' => ABSPATH . 'wp-settings.php',
				'line' => 1,
			)
		);

		$this->assertWPError( $out );
		$this->assertSame( 'openstation_ai_debug_unknown_file', $out->get_error_code() );
	}

	/**
	 * A fatal inside wp-config.php names wp-config.php, so the log
	 * allowlist alone would hand over the database password. It is
	 * refused on its own account.
	 */
	public function test_read_source_refuses_configuration_even_when_the_log_names_it() {
		$config = ABSPATH . 'wp-config.php';
		$this->make_temp_log( "[01-Sep-2026 10:00:00 UTC] PHP Parse error:  syntax error in {$config} on line 3\n" );

		$out = wp_get_ability( 'desktop-mode/read-source-excerpt' )->execute(
			array(
				'file' => $config,
				'line' => 3,
			)
		);

		$this->assertWPError( $out );
		$this->assertSame( 'openstation_ai_debug_secret_file', $out->get_error_code() );
	}

	/**
	 * `realpath()` runs before the prefix test, so a traversal that the
	 * log happens to contain still lands outside and is refused.
	 */
	public function test_read_source_refuses_a_path_outside_the_install() {
		$outside = dirname( ABSPATH ) . '/outside.php';
		$this->make_temp_log( "[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Boom in {$outside}:1\n" );

		$out = wp_get_ability( 'desktop-mode/read-source-excerpt' )->execute(
			array(
				'file' => $outside,
				'line' => 1,
			)
		);

		$this->assertWPError( $out );
		// Missing on disk or outside the root — either refusal is correct
		// here; what must never happen is a successful read.
		$this->assertContains(
			$out->get_error_code(),
			array( 'openstation_ai_debug_unreadable', 'openstation_ai_debug_outside_root' )
		);
	}

	/**
	 * A log can name a `.log` or a `.sql`. Those are data, and data is
	 * where credentials end up.
	 */
	public function test_read_source_refuses_a_non_source_extension() {
		$dump = WP_CONTENT_DIR . '/uploads/dump.sql';
		$this->make_temp_log( "[01-Sep-2026 10:00:00 UTC] PHP Fatal error:  Boom in {$dump}:1\n" );

		$out = wp_get_ability( 'desktop-mode/read-source-excerpt' )->execute(
			array(
				'file' => $dump,
				'line' => 1,
			)
		);

		$this->assertWPError( $out );
	}

	public function test_site_context_carries_versions_and_no_credentials() {
		$out = wp_get_ability( 'desktop-mode/get-site-context' )->execute( array() );

		$this->assertSame( get_bloginfo( 'version' ), $out['wordpress']['version'] );
		$this->assertSame( PHP_VERSION, $out['php']['version'] );
		$this->assertArrayHasKey( 'WP_DEBUG', $out['debug'] );
		$this->assertArrayHasKey( 'name', $out['theme'] );
		$this->assertIsArray( $out['plugins'] );

		$encoded = wp_json_encode( $out );
		foreach ( array( DB_PASSWORD, DB_USER, AUTH_KEY ) as $secret ) {
			if ( '' !== (string) $secret ) {
				$this->assertStringNotContainsString( (string) $secret, $encoded );
			}
		}
	}

	/**
	 * The instructions reach a caller who can use the tools, and only
	 * that caller — an unused protocol is paid for on every turn.
	 */
	public function test_prompt_appendix_is_added_only_for_users_who_hold_the_tools() {
		$appendix = apply_filters( 'openstation_ai_system_prompt_appendix', '', array() );
		$this->assertStringContainsString( 'list_log_issues', $appendix );
		$this->assertStringContainsString( 'read-only', $appendix );

		wp_set_current_user( self::$editor_id );
		$this->assertSame( '', apply_filters( 'openstation_ai_system_prompt_appendix', '', array() ) );
	}

	/**
	 * The appendix stacks rather than replaces — another plugin's
	 * appendix must survive ours.
	 */
	public function test_prompt_appendix_stacks() {
		$out = openstation_ai_debug_prompt_appendix( 'Existing house rules.', array() );
		$this->assertStringStartsWith( 'Existing house rules.', $out );
		$this->assertStringContainsString( 'Investigating an error', $out );
	}
}
