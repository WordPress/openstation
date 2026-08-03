<?php
/**
 * Tests for the post-registration action hooks fired by
 * `open_station_register_*()` on success.
 *
 * The contract: `open_station_<thing>_registered` fires exactly once,
 * after the registry write, with `( $id, $entry )` as arguments. It
 * does NOT fire when the underlying registration returns a
 * `WP_Error`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-registration-actions
 */
class Tests_OpenStation_RegistrationActions extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_actions( 'open_station_native_window_registered' );
		remove_all_actions( 'open_station_widget_registered' );
		remove_all_actions( 'open_station_wallpaper_registered' );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_register_window
	 */
	public function test_native_window_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'open_station_native_window_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = open_station_register_window( 'act-win', array(
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
	 * @covers ::open_station_register_window
	 */
	public function test_native_window_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'open_station_native_window_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		// Missing title — returns WP_Error.
		$result = open_station_register_window( 'broken', array(
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * @covers ::open_station_register_widget
	 */
	public function test_widget_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'open_station_widget_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = open_station_register_widget( 'act-widget', array(
			'label' => 'Act Widget',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-widget', $calls[0]['id'] );
		$this->assertSame( 'Act Widget', $calls[0]['entry']['label'] );
	}

	/**
	 * @covers ::open_station_register_widget
	 */
	public function test_widget_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'open_station_widget_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = open_station_register_widget( 'broken-widget', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * @covers ::open_station_register_wallpaper
	 */
	public function test_wallpaper_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'open_station_wallpaper_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = open_station_register_wallpaper( 'act-wallpaper', array(
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
	 * @covers ::open_station_register_wallpaper
	 */
	public function test_wallpaper_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'open_station_wallpaper_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = open_station_register_wallpaper( 'broken-wp', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	/**
	 * Each action fires exactly once per successful call, even when a
	 * handler mutates state that the registration also touches.
	 *
	 * @covers ::open_station_register_window
	 */
	public function test_native_window_action_fires_once_per_call() {
		$count = 0;
		add_action( 'open_station_native_window_registered', static function () use ( &$count ) {
			$count++;
		} );

		open_station_register_window( 'once-a', array(
			'title'    => 'A',
			'template' => static function () {},
			'script'   => 'x',
		) );
		open_station_register_window( 'once-b', array(
			'title'    => 'B',
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertSame( 2, $count );
	}
}
