<?php

class Tests_OpenStation_TypeRegistrant extends WP_UnitTestCase {

	protected static $fixture_file;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {

		$dir                = trailingslashit( WP_PLUGIN_DIR ) . 'dm-registrant-fixture';
		self::$fixture_file = $dir . '/dm-registrant-fixture.php';

		if ( ! is_dir( $dir ) ) {
			mkdir( $dir, 0777, true );
		}
		file_put_contents(
			self::$fixture_file,
			"<?php\n" .
			"/**\n * Plugin Name: DM Registrant Fixture\n */\n" .
			"function dm_registrant_fixture_register( \$slug, \$kind ) {\n" .
			"\tif ( 'taxonomy' === \$kind ) {\n" .
			"\t\tregister_taxonomy( \$slug, 'post' );\n" .
			"\t\treturn;\n" .
			"\t}\n" .
			"\tregister_post_type( \$slug, array( 'public' => true ) );\n" .
			"}\n"
		);
		require_once self::$fixture_file;
	}

	public static function wpTearDownAfterClass() {
		if ( self::$fixture_file && file_exists( self::$fixture_file ) ) {
			unlink( self::$fixture_file );
			rmdir( dirname( self::$fixture_file ) );
		}
	}

	public function set_up() {
		parent::set_up();

		set_current_screen( 'dashboard' );
	}

	public function tear_down() {
		set_current_screen( 'front' );
		remove_all_filters( 'openstation_track_type_registrants' );
		foreach ( array( 'dm_tracked', 'dm_selfattr', 'dm_frontonly', 'dm_managed' ) as $type ) {
			if ( post_type_exists( $type ) ) {
				unregister_post_type( $type );
			}
		}
		if ( taxonomy_exists( 'dm_tracked_tax' ) ) {
			unregister_taxonomy( 'dm_tracked_tax' );
		}
		parent::tear_down();
	}

	public function test_records_the_registering_plugin_file() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$file = openstation_type_registrant_file( 'dm_tracked', 'post_type' );

		$this->assertNotNull( $file );
		$this->assertSame( wp_normalize_path( self::$fixture_file ), $file );
	}

	public function test_records_taxonomies_too() {
		dm_registrant_fixture_register( 'dm_tracked_tax', 'taxonomy' );

		$this->assertSame(
			wp_normalize_path( self::$fixture_file ),
			openstation_type_registrant_file( 'dm_tracked_tax', 'taxonomy' )
		);
	}

	public function test_recorded_path_resolves_to_a_plugin_group() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$group = openstation_my_wordpress_post_type_group( 'dm_tracked' );

		$this->assertIsArray( $group );
		$this->assertSame( 'plugin:dm-registrant-fixture', $group['id'] );
		$this->assertSame( 'dashicons-admin-plugins', $group['icon'] );
	}

	public function test_attributes_a_plugin_linked_in_from_outside_the_plugins_dir() {
		global $wp_plugin_paths;

		$managed = get_temp_dir() . 'dm-managed-' . wp_generate_password( 8, false );
		$target  = $managed . '/1.0.0';
		$link    = WP_PLUGIN_DIR . '/dm-managed-fixture';
		mkdir( $target, 0777, true );
		file_put_contents(
			$target . '/dm-managed-fixture.php',
			"<?php\n/**\n * Plugin Name: DM Managed Fixture\n */\nfunction dm_managed_fixture_register() {\n\tregister_post_type( 'dm_managed', array( 'public' => true ) );\n}\n"
		);
		symlink( $target, $managed . '/latest' );
		symlink( $managed . '/latest', $link );
		$saved_paths = $wp_plugin_paths;

		try {

			wp_register_plugin_realpath( $link . '/dm-managed-fixture.php' );
			require_once $link . '/dm-managed-fixture.php';
			dm_managed_fixture_register();

			$this->assertSame(
				wp_normalize_path( $link . '/dm-managed-fixture.php' ),
				openstation_type_registrant_file( 'dm_managed', 'post_type' )
			);
			$this->assertSame(
				'plugin:dm-managed-fixture',
				openstation_my_wordpress_post_type_group( 'dm_managed' )['id']
			);

			wp_cache_delete( 'plugins', 'plugins' );
			$this->assertSame(
				'dm-managed-fixture/dm-managed-fixture.php',
				openstation_plugin_file_for_callback( 'dm_managed_fixture_register' )
			);
		} finally {
			wp_cache_delete( 'plugins', 'plugins' );
			$wp_plugin_paths = $saved_paths;
			unlink( $link );
			unlink( $managed . '/latest' );
			unlink( $target . '/dm-managed-fixture.php' );
			rmdir( $target );
			rmdir( $managed );
		}
	}

	public function test_does_not_attribute_types_to_openstation_itself() {
		register_post_type( 'dm_selfattr', array( 'public' => true ) );

		$this->assertNull(
			openstation_type_registrant_file( 'dm_selfattr', 'post_type' )
		);
	}

	public function test_builtin_types_are_not_recorded() {
		$this->assertNull( openstation_type_registrant_file( 'post', 'post_type' ) );
		$this->assertNull( openstation_type_registrant_file( 'page', 'post_type' ) );
		$this->assertNull( openstation_type_registrant_file( 'category', 'taxonomy' ) );
	}

	public function test_unknown_type_reads_back_null() {
		$this->assertNull(
			openstation_type_registrant_file( 'dm_never_registered', 'post_type' )
		);
	}

	public function test_slug_lookup_resolves_the_registering_plugin() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$this->assertSame(
			'dm-registrant-fixture/dm-registrant-fixture.php',
			openstation_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_tracked'
			)
		);
	}

	public function test_slug_lookup_returns_null_for_non_plugin_registrants() {
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_never_registered'
			)
		);
	}

	public function test_slug_lookup_ignores_non_type_slugs() {
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file( 'plugins.php' )
		);
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file( 'edit.php' )
		);
	}

	public function test_tracking_is_skipped_off_the_admin() {
		$this->assertTrue(
			openstation_should_track_type_registrants(),
			'admin context tracks'
		);

		set_current_screen( 'front' );
		$this->assertFalse(
			openstation_should_track_type_registrants(),
			'front-end skips'
		);

		dm_registrant_fixture_register( 'dm_frontonly', 'post_type' );
		$this->assertNull(
			openstation_type_registrant_file( 'dm_frontonly', 'post_type' ),
			'nothing recorded off the admin'
		);
	}

	public function test_tracking_is_filterable() {
		set_current_screen( 'front' );
		add_filter( 'openstation_track_type_registrants', '__return_true' );

		$this->assertTrue( openstation_should_track_type_registrants() );
	}

	public function test_extension_dirs_cover_plugins_mu_plugins_and_themes() {
		$dirs = openstation_extension_dirs();

		$this->assertContains( trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( WPMU_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( get_theme_root() ) ), $dirs );
	}
}
