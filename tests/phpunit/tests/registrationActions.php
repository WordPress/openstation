<?php
/**
 * Tests for the post-registration action hooks fired by
 * `desktop_mode_register_*()` on success.
 *
 * The contract: `desktop_mode_<thing>_registered` fires exactly once,
 * after the registry write, with `( $id, $entry )` as arguments. It
 * does NOT fire when the underlying registration returns a
 * `WP_Error`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-registration-actions
 */
class Tests_DesktopMode_RegistrationActions extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_actions( 'desktop_mode_native_window_registered' );
		remove_all_actions( 'desktop_mode_widget_registered' );
		remove_all_actions( 'desktop_mode_wallpaper_registered' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_native_window_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'desktop_mode_native_window_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = desktop_mode_register_window( 'act-win', array(
			'title'    => 'Act Window',
			'template' => static function () {
				echo '<p>t</p>';
			},
			'script'   => 'x',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-win', $calls[0]['id'] );
		$this->assertSame( 'Act Window', $calls[0]['entry']['title'] );
		$this->assertIsCallable( $calls[0]['entry']['template'] );
	}

	/**
	 * @covers ::desktop_mode_register_window
	 */
	public function test_native_window_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'desktop_mode_native_window_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		// Missing title — returns WP_Error.
		$result = desktop_mode_register_window( 'broken', array(
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'desktop_mode_widget_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = desktop_mode_register_widget( 'act-widget', array(
			'label' => 'Act Widget',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-widget', $calls[0]['id'] );
		$this->assertSame( 'Act Widget', $calls[0]['entry']['label'] );
	}

	/**
	 * @covers ::desktop_mode_register_widget
	 */
	public function test_widget_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'desktop_mode_widget_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = desktop_mode_register_widget( 'broken-widget', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'desktop_mode_wallpaper_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = desktop_mode_register_wallpaper( 'act-wallpaper', array(
			'label'   => 'Act Wallpaper',
			'preview' => '#aabbcc',
			'type'    => 'css',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-wallpaper', $calls[0]['id'] );
		$this->assertSame( 'css', $calls[0]['entry']['type'] );
	}

	/**
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_wallpaper_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'desktop_mode_wallpaper_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = desktop_mode_register_wallpaper( 'broken-wp', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * Each action fires exactly once per successful call, even when a
	 * handler mutates state that the registration also touches.
	 *
	 * @covers ::desktop_mode_register_window
	 */
	public function test_native_window_action_fires_once_per_call() {
		$count = 0;
		add_action( 'desktop_mode_native_window_registered', static function () use ( &$count ) {
			$count++;
		} );

		desktop_mode_register_window( 'once-a', array(
			'title'    => 'A',
			'template' => static function () {},
			'script'   => 'x',
		) );
		desktop_mode_register_window( 'once-b', array(
			'title'    => 'B',
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertSame( 2, $count );
	}
}
