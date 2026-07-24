<?php
/**
 * Tests for the games schema: table creation, version stamping,
 * idempotency.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-games
 */
class Tests_DesktopMode_GamesSchema extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		desktop_mode_games_install_schema();
	}

	/**
	 * @covers ::desktop_mode_games_install_schema
	 */
	public function test_schema_creates_both_tables() {
		global $wpdb;
		$tables = desktop_mode_games_table_names();
		$this->assertCount( 2, $tables );
		foreach ( $tables as $name ) {
			$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $name ) );
			$this->assertSame( $name, $found );
		}
	}

	/**
	 * @covers ::desktop_mode_games_install_schema
	 */
	public function test_schema_stamps_version_option() {
		$this->assertSame(
			DESKTOP_MODE_GAMES_SCHEMA_VERSION,
			get_option( DESKTOP_MODE_GAMES_SCHEMA_OPTION )
		);
	}

	/**
	 * @covers ::desktop_mode_games_install_schema
	 */
	public function test_install_is_idempotent() {
		// A second run must not throw or drop data.
		global $wpdb;
		$tables = desktop_mode_games_table_names();
		$wpdb->insert(
			$tables['scores'],
			array(
				'game'          => 'test-game',
				'user_id'       => 1,
				'score'         => 5,
				'meta'          => '{}',
				'created_at_ms' => 1,
			)
		);
		desktop_mode_games_install_schema();
		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$tables['scores']}" );
		$this->assertSame( 1, $count );
	}

	/**
	 * @covers ::desktop_mode_games_maybe_install_schema
	 */
	public function test_maybe_install_noops_on_matching_version() {
		$fired = 0;
		add_action(
			'desktop_mode_games_schema_installed',
			static function () use ( &$fired ) {
				$fired++;
			}
		);
		desktop_mode_games_maybe_install_schema();
		$this->assertSame( 0, $fired );

		update_option( DESKTOP_MODE_GAMES_SCHEMA_OPTION, '0' );
		desktop_mode_games_maybe_install_schema();
		$this->assertSame( 1, $fired );
	}

	/**
	 * @covers ::desktop_mode_games_now_ms
	 */
	public function test_now_ms_is_epoch_milliseconds() {
		$now = desktop_mode_games_now_ms();
		$this->assertIsInt( $now );
		$this->assertGreaterThan( 1_000_000_000_000, $now );
	}
}
