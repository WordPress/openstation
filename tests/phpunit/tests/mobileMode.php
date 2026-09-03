<?php
/**
 * Tests for the responsive mode's server half — `includes/mobile.php`
 * and the `mobileLayout` / `mobileTabs` settings keys.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-mobile
 */
class Tests_OpenStation_MobileMode extends WP_UnitTestCase {

	/** @var int */
	private static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		delete_user_meta( self::$user_id, 'desktop_mode_os_settings' );
	}

	public function tear_down() {
		remove_all_filters( 'openstation_mode_preference' );
		remove_all_filters( 'openstation_mode_breakpoints' );
		remove_all_filters( 'openstation_mobile_tab_bar' );
		parent::tear_down();
	}

	// --------------------------------------------------------------
	// Settings keys
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_default_os_settings
	 */
	public function test_defaults_carry_the_mobile_keys() {
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'auto', $defaults['mobileLayout'] );
		$this->assertSame( array(), $defaults['mobileTabs'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_accepts_the_enum_and_rejects_junk() {
		$clean = openstation_sanitize_os_settings( array( 'mobileLayout' => 'mobile' ) );
		$this->assertSame( 'mobile', $clean['mobileLayout'] );

		$clean = openstation_sanitize_os_settings( array( 'mobileLayout' => 'phone' ) );
		$this->assertSame( 'auto', $clean['mobileLayout'] );
	}

	/**
	 * @covers ::openstation_sanitize_os_settings
	 */
	public function test_sanitize_caps_and_dedupes_the_pins() {
		$clean = openstation_sanitize_os_settings(
			array(
				'mobileTabs' => array( 'menu-posts', 'dock:menu-posts', 'menu-media', 'Menu-Comments', 'menu-users', 7, '' ),
			)
		);
		$this->assertSame( array( 'menu-posts', 'menu-media', 'menu-comments' ), $clean['mobileTabs'] );

		$clean = openstation_sanitize_os_settings( array( 'mobileTabs' => 'menu-posts' ) );
		$this->assertSame( array(), $clean['mobileTabs'] );
	}

	/**
	 * @covers ::openstation_save_os_settings
	 * @covers ::openstation_get_os_settings
	 */
	public function test_the_keys_round_trip_through_user_meta() {
		openstation_save_os_settings(
			self::$user_id,
			array(
				'mobileLayout' => 'desktop',
				'mobileTabs'   => array( 'menu-media' ),
			)
		);
		$saved = openstation_get_os_settings( self::$user_id );
		$this->assertSame( 'desktop', $saved['mobileLayout'] );
		$this->assertSame( array( 'menu-media' ), $saved['mobileTabs'] );
	}

	// --------------------------------------------------------------
	// Preference
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_mode_preference
	 */
	public function test_preference_reads_the_setting_and_honours_the_filter() {
		$this->assertSame( 'auto', openstation_mode_preference( self::$user_id ) );

		openstation_save_os_settings( self::$user_id, array( 'mobileLayout' => 'mobile' ) );
		$this->assertSame( 'mobile', openstation_mode_preference( self::$user_id ) );

		add_filter(
			'openstation_mode_preference',
			static function ( $preference, $user_id ) {
				return 'desktop';
			},
			10,
			2
		);
		$this->assertSame( 'desktop', openstation_mode_preference( self::$user_id ) );
	}

	/**
	 * @covers ::openstation_mode_preference
	 */
	public function test_preference_filter_cannot_return_junk() {
		add_filter( 'openstation_mode_preference', '__return_empty_string' );
		$this->assertSame( 'auto', openstation_mode_preference( self::$user_id ) );
	}

	// --------------------------------------------------------------
	// Breakpoints
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_mode_breakpoints
	 */
	public function test_breakpoints_default_and_keep_the_invariant() {
		$this->assertSame(
			array(
				'mobile' => OPENSTATION_MODE_MOBILE_MAX_WIDTH,
				'tablet' => OPENSTATION_MODE_TABLET_MAX_WIDTH,
			),
			openstation_mode_breakpoints()
		);

		add_filter(
			'openstation_mode_breakpoints',
			static function () {
				return array(
					'mobile' => 900,
					'tablet' => 700,
				);
			}
		);
		$this->assertSame(
			array(
				'mobile' => 900,
				'tablet' => 901,
			),
			openstation_mode_breakpoints()
		);
	}

	/**
	 * @covers ::openstation_mode_breakpoints
	 */
	public function test_breakpoints_filter_junk_falls_back() {
		add_filter( 'openstation_mode_breakpoints', '__return_false' );
		$this->assertSame( OPENSTATION_MODE_MOBILE_MAX_WIDTH, openstation_mode_breakpoints()['mobile'] );
	}

	// --------------------------------------------------------------
	// Tab bar
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_mobile_tab_bar
	 */
	public function test_tab_bar_defaults_and_filter() {
		$this->assertSame( array( 'menu-posts', 'menu-media', 'menu-comments' ), openstation_mobile_tab_bar() );

		add_filter(
			'openstation_mobile_tab_bar',
			static function ( $ids ) {
				return array( 'toplevel_page_woocommerce', 'menu-posts', 'menu-posts', 'menu-users', 'menu-plugins' );
			}
		);
		$this->assertSame( array( 'toplevel_page_woocommerce', 'menu-posts', 'menu-users' ), openstation_mobile_tab_bar() );

		add_filter( 'openstation_mobile_tab_bar', '__return_false', 20 );
		$this->assertSame( array( 'menu-posts', 'menu-media', 'menu-comments' ), openstation_mobile_tab_bar() );
	}

	/**
	 * @covers ::openstation_mode_config
	 */
	public function test_config_shape() {
		$config = openstation_mode_config( self::$user_id );
		$this->assertSame( 'auto', $config['preference'] );
		$this->assertArrayHasKey( 'mobile', $config['breakpoints'] );
		$this->assertArrayHasKey( 'tablet', $config['breakpoints'] );
		$this->assertIsArray( $config['tabBar'] );
	}

	// --------------------------------------------------------------
	// Head stamp + viewport
	// --------------------------------------------------------------

	/**
	 * @covers ::openstation_mode_stamp_script
	 */
	public function test_stamp_script_mirrors_resolve_mode() {
		$script = openstation_mode_stamp_script(
			'auto',
			array(
				'mobile' => 767,
				'tablet' => 1024,
			)
		);
		$this->assertStringContainsString( 'p="auto"', $script );
		$this->assertStringContainsString( 'w<=767?"mobile"', $script );
		$this->assertStringContainsString( 'w<=1024?"tablet"', $script );
		$this->assertStringContainsString( 'setAttribute("data-os-mode",m)', $script );

		$forced = openstation_mode_stamp_script(
			'phone',
			array(
				'mobile' => 767,
				'tablet' => 1024,
			)
		);
		$this->assertStringContainsString( 'p="auto"', $forced, 'junk preference falls back to auto' );
	}

	/**
	 * @covers ::openstation_mode_viewport_meta
	 */
	public function test_viewport_meta_is_untouched_off_the_shell() {
		$this->assertSame(
			'width=device-width,initial-scale=1.0',
			openstation_mode_viewport_meta( 'width=device-width,initial-scale=1.0' )
		);
	}

	/**
	 * @covers ::openstation_mode_hint_is_mobile
	 */
	public function test_prefetch_hint_follows_a_forced_preference() {
		openstation_save_os_settings( self::$user_id, array( 'mobileLayout' => 'mobile' ) );
		$this->assertTrue( openstation_mode_hint_is_mobile( self::$user_id ) );

		openstation_save_os_settings( self::$user_id, array( 'mobileLayout' => 'desktop' ) );
		$this->assertFalse( openstation_mode_hint_is_mobile( self::$user_id ) );
	}
}
