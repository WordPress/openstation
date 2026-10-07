<?php

class Tests_OpenStation_ShellBuildStamp extends WP_UnitTestCase {

	private $dir;

	public function set_up() {
		parent::set_up();
		$this->dir = trailingslashit( get_temp_dir() ) . 'os-shell-build-' . wp_generate_password( 8, false ) . '/';
		wp_mkdir_p( $this->dir . 'assets/css' );
		wp_mkdir_p( $this->dir . 'assets/js' );
		delete_transient( 'openstation_shell_build' );
	}

	public function tear_down() {
		foreach ( array( 'assets/css', 'assets/js' ) as $sub ) {
			foreach ( (array) glob( $this->dir . $sub . '/*' ) as $file ) {
				unlink( $file );
			}
			rmdir( $this->dir . $sub );
		}
		rmdir( $this->dir . 'assets' );
		rmdir( $this->dir );
		delete_transient( 'openstation_shell_build' );
		parent::tear_down();
	}

	private function write( $relative, $contents ) {
		file_put_contents( $this->dir . $relative, $contents );
	}

	public function test_is_sixteen_hex_characters_and_stable() {
		$this->write( 'assets/css/desktop.css', 'body { color: red; }' );
		$this->write( 'assets/js/desktop.min.js', 'console.log( 1 );' );

		$stamp = openstation_shell_build_stamp( $this->dir );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $stamp );
		$this->assertSame( $stamp, openstation_shell_build_stamp( $this->dir ) );
	}

	public function test_a_changed_mtime_with_the_same_bytes_is_the_same_stamp() {
		$this->write( 'assets/css/desktop.css', 'body { color: red; }' );
		$this->write( 'assets/js/desktop.min.js', 'console.log( 1 );' );
		$before = openstation_shell_build_stamp( $this->dir );

		touch( $this->dir . 'assets/css/desktop.css', time() + 3600 );
		touch( $this->dir . 'assets/js/desktop.min.js', time() + 3600 );
		clearstatcache();

		$this->assertSame( $before, openstation_shell_build_stamp( $this->dir ) );
	}

	public function test_changed_bytes_are_a_different_stamp() {
		$this->write( 'assets/css/desktop.css', 'body { color: red; }' );
		$this->write( 'assets/js/desktop.min.js', 'console.log( 1 );' );
		$before = openstation_shell_build_stamp( $this->dir );

		$this->write( 'assets/js/desktop.min.js', 'console.log( 2 ); /* a real change */' );
		clearstatcache();

		$this->assertNotSame( $before, openstation_shell_build_stamp( $this->dir ) );
	}

	public function test_an_added_file_is_a_different_stamp() {
		$this->write( 'assets/css/desktop.css', 'body { color: red; }' );
		$before = openstation_shell_build_stamp( $this->dir );

		$this->write( 'assets/js/mobile.min.js', 'console.log( "phone" );' );
		clearstatcache();

		$this->assertNotSame( $before, openstation_shell_build_stamp( $this->dir ) );
	}

	public function test_nothing_built_is_the_empty_string() {
		$this->assertSame( '', openstation_shell_build_stamp( $this->dir ) );
	}

	public function test_default_directory_is_the_plugin() {
		$stamp = openstation_shell_build_stamp();
		if ( '' === $stamp ) {
			$this->markTestSkipped( 'No built assets in the plugin directory.' );
		}
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $stamp );
	}
}
