<?php

class Tests_OpenStation_RegistrationActions extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_actions( 'openstation_native_window_registered' );
		remove_all_actions( 'openstation_widget_registered' );
		remove_all_actions( 'openstation_wallpaper_registered' );
		parent::tear_down();
	}

	public function test_native_window_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'openstation_native_window_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = openstation_register_window( 'act-win', array(
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

	public function test_native_window_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'openstation_native_window_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = openstation_register_window( 'broken', array(
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	public function test_widget_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'openstation_widget_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = openstation_register_widget( 'act-widget', array(
			'label' => 'Act Widget',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-widget', $calls[0]['id'] );
		$this->assertSame( 'Act Widget', $calls[0]['entry']['label'] );
	}

	public function test_widget_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'openstation_widget_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = openstation_register_widget( 'broken-widget', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	public function test_wallpaper_registered_action_fires_on_success() {
		$calls = array();
		add_action( 'openstation_wallpaper_registered', static function ( $id, $entry ) use ( &$calls ) {
			$calls[] = array( 'id' => $id, 'entry' => $entry );
		}, 10, 2 );

		$result = openstation_register_wallpaper( 'act-wallpaper', array(
			'label'   => 'Act Wallpaper',
			'preview' => '#aabbcc',
			'type'    => 'css',
		) );

		$this->assertTrue( $result );
		$this->assertCount( 1, $calls );
		$this->assertSame( 'act-wallpaper', $calls[0]['id'] );
		$this->assertSame( 'css', $calls[0]['entry']['type'] );
	}

	public function test_wallpaper_registered_action_does_not_fire_on_error() {
		$calls = 0;
		add_action( 'openstation_wallpaper_registered', static function () use ( &$calls ) {
			$calls++;
		} );

		$result = openstation_register_wallpaper( 'broken-wp', array() );

		$this->assertWPError( $result );
		$this->assertSame( 0, $calls );
	}

	public function test_native_window_action_fires_once_per_call() {
		$count = 0;
		add_action( 'openstation_native_window_registered', static function () use ( &$count ) {
			$count++;
		} );

		openstation_register_window( 'once-a', array(
			'title'    => 'A',
			'template' => static function () {},
			'script'   => 'x',
		) );
		openstation_register_window( 'once-b', array(
			'title'    => 'B',
			'template' => static function () {},
			'script'   => 'x',
		) );

		$this->assertSame( 2, $count );
	}
}
