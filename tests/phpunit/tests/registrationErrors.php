<?php

class Tests_OpenStation_RegistrationErrors extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	private function valid_window_args( array $overrides = array() ) {
		return array_merge(
			array(
				'title'    => 'Test Window',
				'icon'     => 'dashicons-admin-generic',
				'template' => static function () {
					echo '<p>body</p>';
				},
				'script'   => 'test-handle',
			),
			$overrides
		);
	}

	private function valid_widget_args( array $overrides = array() ) {
		return array_merge(
			array(
				'label'       => 'Test Widget',
				'description' => 'desc',
				'icon'        => 'dashicons-admin-generic',
				'script'      => 'test-handle',
			),
			$overrides
		);
	}

	private function valid_wallpaper_args( array $overrides = array() ) {
		return array_merge(
			array(
				'label'   => 'Test Wallpaper',
				'preview' => '#ffffff',
				'type'    => 'canvas',
				'script'  => 'test-handle',
			),
			$overrides
		);
	}

	public function test_window_missing_id_returns_wp_error() {
		$result = openstation_register_window( '', $this->valid_window_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	public function test_window_missing_title_returns_wp_error() {
		$result = openstation_register_window(
			'no-title',
			$this->valid_window_args( array( 'title' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_title', $result->get_error_code() );
	}

	public function test_window_without_script_registers() {
		$result = openstation_register_window(
			'declarative-only',
			$this->valid_window_args( array( 'script' => '' ) )
		);

		$this->assertTrue( $result );
	}

	public function test_window_non_callable_template_returns_wp_error() {
		$result = openstation_register_window(
			'bad-template',
			$this->valid_window_args( array( 'template' => 'not a callable' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_invalid_template', $result->get_error_code() );
	}

	public function test_window_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = openstation_register_window(
			'cap-gated',
			$this->valid_window_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
		$this->assertSame( 'manage_options', $result->get_error_data()['capability'] );
	}

	public function test_window_success_returns_true() {
		$result = openstation_register_window( 'ok-window', $this->valid_window_args() );

		$this->assertTrue( $result );
		$this->assertNotNull( openstation_native_window_registry( 'ok-window' ) );
	}

	public function test_widget_missing_id_returns_wp_error() {
		$result = openstation_register_widget( '', $this->valid_widget_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	public function test_widget_missing_label_returns_wp_error() {
		$result = openstation_register_widget(
			'no-label',
			$this->valid_widget_args( array( 'label' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_label', $result->get_error_code() );
	}

	public function test_widget_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = openstation_register_widget(
			'cap-gated',
			$this->valid_widget_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
	}

	public function test_widget_success_returns_true() {
		$result = openstation_register_widget( 'ok-widget', $this->valid_widget_args() );

		$this->assertTrue( $result );
	}

	public function test_wallpaper_missing_id_returns_wp_error() {
		$result = openstation_register_wallpaper( '', $this->valid_wallpaper_args() );

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_id', $result->get_error_code() );
	}

	public function test_wallpaper_missing_label_returns_wp_error() {
		$result = openstation_register_wallpaper(
			'no-label',
			$this->valid_wallpaper_args( array( 'label' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_label', $result->get_error_code() );
	}

	public function test_wallpaper_canvas_missing_script_returns_wp_error() {
		$result = openstation_register_wallpaper(
			'no-script',
			$this->valid_wallpaper_args( array( 'type' => 'canvas', 'script' => '' ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_missing_script', $result->get_error_code() );
	}

	public function test_wallpaper_css_without_script_succeeds() {
		$result = openstation_register_wallpaper(
			'css-only',
			array(
				'label'   => 'CSS only',
				'preview' => '#000000',
				'type'    => 'css',
			)
		);

		$this->assertTrue( $result );
	}

	public function test_wallpaper_capability_denied_returns_wp_error() {
		wp_set_current_user( self::$subscriber_id );

		$result = openstation_register_wallpaper(
			'cap-gated',
			$this->valid_wallpaper_args( array( 'capabilities' => array( 'manage_options' ) ) )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
	}

	public function test_wallpaper_success_returns_true() {
		$result = openstation_register_wallpaper( 'ok-wallpaper', $this->valid_wallpaper_args() );

		$this->assertTrue( $result );
	}

	public function test_wp_error_return_is_truthy_for_legacy_callers() {
		$w = openstation_register_window( '', $this->valid_window_args() );
		$g = openstation_register_widget( '', $this->valid_widget_args() );
		$p = openstation_register_wallpaper( '', $this->valid_wallpaper_args() );

		$this->assertTrue( (bool) $w );
		$this->assertTrue( (bool) $g );
		$this->assertTrue( (bool) $p );

		$this->assertTrue( is_wp_error( $w ) );
		$this->assertTrue( is_wp_error( $g ) );
		$this->assertTrue( is_wp_error( $p ) );
	}
}
