<?php
/**
 * Tests for the generic registry factory in
 * `includes/core/registry-factory.php`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-registry-factory
 */
class Tests_OpenStation_RegistryFactory extends WP_UnitTestCase {

	/**
	 * @covers ::open_station_create_registry
	 */
	public function test_create_registry_basic_read_write() {
		$reg = open_station_create_registry();

		// Empty initial state.
		$this->assertSame( array(), $reg( '' ) );
		$this->assertNull( $reg( 'missing' ) );

		// Write + read one.
		$reg( 'a', array( 'label' => 'A' ) );
		$this->assertSame( array( 'label' => 'A' ), $reg( 'a' ) );

		// Read all.
		$this->assertSame(
			array( 'a' => array( 'label' => 'A' ) ),
			$reg( '' )
		);
	}

	/**
	 * @covers ::open_station_create_registry
	 */
	public function test_create_registry_replace_semantics() {
		$reg = open_station_create_registry();
		$reg( 'x', 'first' );
		$reg( 'x', 'second' );
		$this->assertSame( 'second', $reg( 'x' ) );
		$this->assertCount( 1, $reg( '' ) );
	}

	/**
	 * @covers ::open_station_create_registry
	 */
	public function test_create_registry_flush_clears_state() {
		$reg = open_station_create_registry();
		$reg( 'a', 1 );
		$reg( 'b', 2 );
		$this->assertCount( 2, $reg( '' ) );
		$reg( '__flush__' );
		$this->assertSame( array(), $reg( '' ) );
		$this->assertNull( $reg( 'a' ) );
	}

	/**
	 * @covers ::open_station_create_registry
	 */
	public function test_create_registry_instances_are_isolated() {
		$a = open_station_create_registry();
		$b = open_station_create_registry();
		$a( 'shared', 'A-value' );
		$this->assertNull( $b( 'shared' ) );
	}

	/**
	 * @covers ::open_station_create_registry
	 */
	public function test_create_registry_accepts_initial_entries() {
		$reg = open_station_create_registry( array( 'seed' => 'value' ) );
		$this->assertSame( 'value', $reg( 'seed' ) );
	}

	/**
	 * @covers ::open_station_create_script_registry
	 */
	public function test_create_script_registry_read_write_default_false() {
		$reg = open_station_create_script_registry();

		$this->assertFalse( $reg( 'missing' ) );
		$reg( 'handle-a', true );
		$this->assertTrue( $reg( 'handle-a' ) );

		// Booleans are coerced.
		$reg( 'handle-b', 1 );
		$this->assertTrue( $reg( 'handle-b' ) );
	}

	/**
	 * @covers ::open_station_create_script_registry
	 */
	public function test_create_script_registry_flush() {
		$reg = open_station_create_script_registry();
		$reg( 'h', true );
		$reg( '__flush__' );
		$this->assertSame( array(), $reg( '' ) );
	}
}
