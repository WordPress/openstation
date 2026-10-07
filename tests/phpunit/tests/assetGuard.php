<?php

class Tests_OpenStation_AssetGuard extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		openstation_asset_guard_store(
			array(
				'styles'  => array(),
				'scripts' => array(),
			)
		);
	}

	public function tear_down() {
		openstation_asset_guard_store(
			array(
				'styles'  => array(),
				'scripts' => array(),
			)
		);
		foreach ( array( 'os-test-own', 'os-test-own-dep', 'os-test-foreign' ) as $handle ) {
			wp_dequeue_style( $handle );
			wp_deregister_style( $handle );
			wp_dequeue_script( $handle );
			wp_deregister_script( $handle );
		}
		remove_all_filters( 'openstation_guarded_styles' );
		remove_all_filters( 'openstation_guarded_scripts' );
		parent::tear_down();
	}

	public function test_snapshot_records_only_openstation_handles() {
		wp_register_style( 'os-test-own', OPENSTATION_URL . 'assets/css/test.css', array(), '1.0' );
		wp_register_style( 'os-test-foreign', 'https://example.org/foreign.css', array(), '1.0' );
		wp_enqueue_style( 'os-test-own' );
		wp_enqueue_style( 'os-test-foreign' );
		wp_register_script( 'os-test-own', OPENSTATION_URL . 'assets/js/test.js', array(), '1.0', true );
		wp_enqueue_script( 'os-test-own' );

		openstation_asset_guard_snapshot();

		$store = openstation_asset_guard_store();
		$this->assertContains( 'os-test-own', $store['styles'] );
		$this->assertNotContains( 'os-test-foreign', $store['styles'] );
		$this->assertContains( 'os-test-own', $store['scripts'] );
	}

	public function test_snapshot_is_idempotent() {
		wp_register_style( 'os-test-own', OPENSTATION_URL . 'assets/css/test.css', array(), '1.0' );
		wp_enqueue_style( 'os-test-own' );

		openstation_asset_guard_snapshot();
		openstation_asset_guard_snapshot();

		$store = openstation_asset_guard_store();
		$this->assertSame(
			array( 'os-test-own' ),
			array_values( array_intersect( $store['styles'], array( 'os-test-own' ) ) )
		);
		$this->assertCount( 1, array_keys( $store['styles'], 'os-test-own', true ) );
	}

	public function test_print_styles_reasserts_dequeued_handle_with_deps() {
		wp_register_style( 'os-test-own-dep', OPENSTATION_URL . 'assets/css/dep.css', array(), '1.0' );
		wp_register_style( 'os-test-own', OPENSTATION_URL . 'assets/css/test.css', array( 'os-test-own-dep' ), '1.0' );
		openstation_asset_guard_store(
			array(
				'styles'  => array( 'os-test-own' ),
				'scripts' => array(),
			)
		);

		$to_do = openstation_asset_guard_print_styles( array( 'mailpoet-admin' ) );

		$this->assertSame(
			array( 'mailpoet-admin', 'os-test-own-dep', 'os-test-own' ),
			$to_do
		);
	}

	public function test_print_styles_skips_present_and_done_handles() {
		wp_register_style( 'os-test-own', OPENSTATION_URL . 'assets/css/test.css', array(), '1.0' );
		openstation_asset_guard_store(
			array(
				'styles'  => array( 'os-test-own' ),
				'scripts' => array(),
			)
		);

		$this->assertSame(
			array( 'os-test-own' ),
			openstation_asset_guard_print_styles( array( 'os-test-own' ) )
		);

		wp_styles()->done[] = 'os-test-own';
		$this->assertSame(
			array(),
			openstation_asset_guard_print_styles( array() )
		);
		wp_styles()->done = array_values( array_diff( wp_styles()->done, array( 'os-test-own' ) ) );
	}

	public function test_print_styles_skips_unregistered_handles() {
		openstation_asset_guard_store(
			array(
				'styles'  => array( 'os-test-never-registered' ),
				'scripts' => array(),
			)
		);

		$this->assertSame(
			array(),
			openstation_asset_guard_print_styles( array() )
		);
	}

	public function test_guarded_styles_filter_extends_the_snapshot() {
		wp_register_style( 'os-test-foreign', 'https://example.org/foreign.css', array(), '1.0' );
		add_filter(
			'openstation_guarded_styles',
			static function ( $handles ) {
				$handles[] = 'os-test-foreign';
				return $handles;
			}
		);

		$this->assertSame(
			array( 'os-test-foreign' ),
			openstation_asset_guard_print_styles( array() )
		);
	}

	public function test_print_scripts_is_inert_outside_the_footer_pass() {
		wp_register_script( 'os-test-own', OPENSTATION_URL . 'assets/js/test.js', array(), '1.0', true );
		openstation_asset_guard_store(
			array(
				'styles'  => array(),
				'scripts' => array( 'os-test-own' ),
			)
		);

		$this->assertSame(
			array(),
			openstation_asset_guard_print_scripts( array() )
		);
	}

	public function test_print_scripts_reasserts_in_footer_pass() {
		wp_register_script( 'os-test-own', OPENSTATION_URL . 'assets/js/test.js', array(), '1.0', true );
		openstation_asset_guard_store(
			array(
				'styles'  => array(),
				'scripts' => array( 'os-test-own' ),
			)
		);

		$result = null;

		remove_action( 'admin_print_footer_scripts', '_wp_footer_scripts' );
		add_action(
			'admin_print_footer_scripts',
			static function () use ( &$result ) {
				$result = openstation_asset_guard_print_scripts( array() );
			},
			1
		);
		ob_start();
		do_action( 'admin_print_footer_scripts' );
		ob_end_clean();

		$this->assertSame( array( 'os-test-own' ), $result );
		$this->assertSame( 1, wp_scripts()->groups['os-test-own'] );
	}
}
