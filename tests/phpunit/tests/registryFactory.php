<?php

class Tests_OpenStation_RegistryFactory extends WP_UnitTestCase {

	public function test_create_registry_basic_read_write() {
		$reg = openstation_create_registry();

		$this->assertSame( array(), $reg( '' ) );
		$this->assertNull( $reg( 'missing' ) );

		$reg( 'a', array( 'label' => 'A' ) );
		$this->assertSame( array( 'label' => 'A' ), $reg( 'a' ) );

		$this->assertSame(
			array( 'a' => array( 'label' => 'A' ) ),
			$reg( '' )
		);
	}

	public function test_create_registry_replace_semantics() {
		$reg = openstation_create_registry();
		$reg( 'x', 'first' );
		$reg( 'x', 'second' );
		$this->assertSame( 'second', $reg( 'x' ) );
		$this->assertCount( 1, $reg( '' ) );
	}

	public function test_create_registry_flush_clears_state() {
		$reg = openstation_create_registry();
		$reg( 'a', 1 );
		$reg( 'b', 2 );
		$this->assertCount( 2, $reg( '' ) );
		$reg( '__flush__' );
		$this->assertSame( array(), $reg( '' ) );
		$this->assertNull( $reg( 'a' ) );
	}

	public function test_create_registry_instances_are_isolated() {
		$a = openstation_create_registry();
		$b = openstation_create_registry();
		$a( 'shared', 'A-value' );
		$this->assertNull( $b( 'shared' ) );
	}

	public function test_create_registry_accepts_initial_entries() {
		$reg = openstation_create_registry( array( 'seed' => 'value' ) );
		$this->assertSame( 'value', $reg( 'seed' ) );
	}

	public function test_create_script_registry_read_write_default_false() {
		$reg = openstation_create_script_registry();

		$this->assertFalse( $reg( 'missing' ) );
		$reg( 'handle-a', true );
		$this->assertTrue( $reg( 'handle-a' ) );

		$reg( 'handle-b', 1 );
		$this->assertTrue( $reg( 'handle-b' ) );
	}

	public function test_create_script_registry_flush() {
		$reg = openstation_create_script_registry();
		$reg( 'h', true );
		$reg( '__flush__' );
		$this->assertSame( array(), $reg( '' ) );
	}
}
