<?php

class Tests_OpenStation_ChromelessActivity extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$admin_id );
		$_GET['openstation_chromeless'] = '1';
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		parent::tear_down();
	}

	private function bridge_markup() {
		ob_start();
		openstation_chromeless_bridge_script();
		$printed = (string) ob_get_clean();

		if ( ! openstation_is_chromeless_request() ) {
			return $printed;
		}

		return $printed . (string) file_get_contents(
			OPENSTATION_DIR . 'src/chromeless-bridge.js'
		);
	}

	public function test_the_bridge_brackets_requests_for_the_status_ring() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( "type: 'os-iframe-activity', phase: 'start'", $markup );
		$this->assertStringContainsString( "phase: 'end'", $markup );
	}

	public function test_reads_never_reach_the_ring() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'osIsReadRequest', $markup );
		foreach ( array( 'GET', 'HEAD', 'OPTIONS', 'QUERY' ) as $method ) {
			$this->assertStringContainsString(
				"'" . $method . "' === m",
				$markup,
				$method . ' must be excluded from activity reporting.'
			);
		}
	}

	public function test_the_end_is_gated_on_the_begin_token() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'var osActivityEnd = function ( tracked, failed, status ) {', $markup );
		$this->assertStringContainsString( 'if ( ! tracked ) {', $markup );
	}

	public function test_an_http_error_settles_as_a_failure() {
		$markup = $this->bridge_markup();

		$this->assertStringContainsString( 'osActivityEnd( tracked, ! res.ok, res.status )', $markup );
	}

	private function navigation_ping_markup() {
		ob_start();
		openstation_chromeless_navigation_ping_script();
		return (string) ob_get_clean();
	}

	public function test_a_landing_document_reports_from_the_head() {
		$markup = $this->navigation_ping_markup();

		$this->assertStringContainsString( "type:'os-iframe-navigated'", $markup );
		$this->assertStringContainsString( 'window.parent!==window', $markup );
		$this->assertStringContainsString( 'window.location.origin', $markup );
	}

	public function test_classic_admin_is_left_alone() {
		unset( $_GET['openstation_chromeless'] );

		$this->assertSame( '', trim( $this->navigation_ping_markup() ) );
	}
}
