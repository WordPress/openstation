<?php
/**
 * Tests for the CPT / taxonomy registration tracker that attributes a
 * type to whoever registered it.
 *
 * The tracker records an absolute file path rather than a plugin file:
 * `registered_post_type` fires during `init`, and Core does not load
 * `wp-admin/includes/plugin.php` — where `get_plugins()` lives — until
 * `wp-admin/admin.php` runs it afterwards. Resolving eagerly meant the
 * tracker recorded nothing at all.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_TypeRegistrant extends WP_UnitTestCase {

	/**
	 * Absolute path to a throwaway plugin file used to register types
	 * from outside OpenStation's own directory.
	 *
	 * @var string
	 */
	protected static $fixture_file;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		// The tracker deliberately skips frames inside OpenStation —
		// otherwise every type on the site would be attributed to us,
		// since the backtrace starts in our own `payload.php`. Every
		// test file lives inside the plugin, so simulating a
		// third-party registrant needs a file that doesn't.
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
		// Registrant tracking only runs where something reads the map.
		// `is_admin()` consults `$current_screen` first, and the test
		// suite starts on the front end.
		set_current_screen( 'dashboard' );
	}

	public function tear_down() {
		set_current_screen( 'front' );
		remove_all_filters( 'openstation_track_type_registrants' );
		foreach ( array( 'dm_tracked', 'dm_selfattr', 'dm_frontonly' ) as $type ) {
			if ( post_type_exists( $type ) ) {
				unregister_post_type( $type );
			}
		}
		if ( taxonomy_exists( 'dm_tracked_tax' ) ) {
			unregister_taxonomy( 'dm_tracked_tax' );
		}
		parent::tear_down();
	}

	/**
	 * A plugin that registers a type is recorded by file path, with no
	 * `get_plugins()` involved — the regression this rewrite fixes.
	 * Before it, the tracker bailed on every request because
	 * `get_plugins()` does not exist yet at `init`.
	 *
	 * @covers ::openstation_record_type_registrant
	 * @covers ::openstation_type_registrant_file
	 */
	public function test_records_the_registering_plugin_file() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$file = openstation_type_registrant_file( 'dm_tracked', 'post_type' );

		$this->assertNotNull( $file );
		$this->assertSame( wp_normalize_path( self::$fixture_file ), $file );
	}

	/**
	 * Taxonomies go through the same tracker.
	 *
	 * @covers ::openstation_record_type_registrant
	 */
	public function test_records_taxonomies_too() {
		dm_registrant_fixture_register( 'dm_tracked_tax', 'taxonomy' );

		$this->assertSame(
			wp_normalize_path( self::$fixture_file ),
			openstation_type_registrant_file( 'dm_tracked_tax', 'taxonomy' )
		);
	}

	/**
	 * The recorded path resolves to a group the site window can render
	 * a folder for.
	 *
	 * @covers ::openstation_my_wordpress_post_type_group
	 */
	public function test_recorded_path_resolves_to_a_plugin_group() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$group = openstation_my_wordpress_post_type_group( 'dm_tracked' );

		$this->assertIsArray( $group );
		$this->assertSame( 'plugin:dm-registrant-fixture', $group['id'] );
		$this->assertSame( 'dashicons-admin-plugins', $group['icon'] );
	}

	/**
	 * The backtrace walk starts inside `payload.php`, which lives under
	 * `WP_PLUGIN_DIR` — without skipping our own frames every type on
	 * the site would be attributed to OpenStation. Registering from
	 * this test file (which is inside the plugin) must record nothing.
	 *
	 * @covers ::openstation_registrant_file_from_backtrace
	 */
	public function test_does_not_attribute_types_to_openstation_itself() {
		register_post_type( 'dm_selfattr', array( 'public' => true ) );

		$this->assertNull(
			openstation_type_registrant_file( 'dm_selfattr', 'post_type' )
		);
	}

	/**
	 * Core's own types are skipped before the backtrace even runs.
	 *
	 * @covers ::openstation_record_type_registrant
	 */
	public function test_builtin_types_are_not_recorded() {
		$this->assertNull( openstation_type_registrant_file( 'post', 'post_type' ) );
		$this->assertNull( openstation_type_registrant_file( 'page', 'post_type' ) );
		$this->assertNull( openstation_type_registrant_file( 'category', 'taxonomy' ) );
	}

	/**
	 * Unrecorded types read back as null rather than raising.
	 *
	 * @covers ::openstation_type_registrant_file
	 */
	public function test_unknown_type_reads_back_null() {
		$this->assertNull(
			openstation_type_registrant_file( 'dm_never_registered', 'post_type' )
		);
	}

	/**
	 * The dock's CPT attribution strategy — `edit.php?post_type=X` is
	 * rendered by Core, so the page hook never points at the
	 * registering plugin and this tracker is the only way to know.
	 * It silently never fired before the lazy rewrite.
	 *
	 * @covers ::openstation_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_resolves_the_registering_plugin() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$this->assertSame(
			'dm-registrant-fixture/dm-registrant-fixture.php',
			openstation_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_tracked'
			)
		);
	}

	/**
	 * A type registered from outside `WP_PLUGIN_DIR` has no plugin to
	 * attribute it to — the dock must not invent one.
	 *
	 * @covers ::openstation_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_returns_null_for_non_plugin_registrants() {
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_never_registered'
			)
		);
	}

	/**
	 * @covers ::openstation_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_ignores_non_type_slugs() {
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file( 'plugins.php' )
		);
		$this->assertNull(
			openstation_lookup_taxonomy_or_post_type_plugin_file( 'edit.php' )
		);
	}

	/**
	 * The map is only read by admin-side surfaces (the dock payload,
	 * the site window's section list). A front-end page view registers
	 * the same types and would pay a `debug_backtrace()` per
	 * registration for a map nothing reads — the predecessor of this
	 * code avoided that by accident, bailing whenever `get_plugins()`
	 * was undefined.
	 *
	 * @covers ::openstation_should_track_type_registrants
	 */
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

		// Its own slug: the map is a per-request static, so a slug an
		// earlier test in this class recorded would read back stale.
		dm_registrant_fixture_register( 'dm_frontonly', 'post_type' );
		$this->assertNull(
			openstation_type_registrant_file( 'dm_frontonly', 'post_type' ),
			'nothing recorded off the admin'
		);
	}

	/**
	 * @covers ::openstation_should_track_type_registrants
	 */
	public function test_tracking_is_filterable() {
		set_current_screen( 'front' );
		add_filter( 'openstation_track_type_registrants', '__return_true' );

		$this->assertTrue( openstation_should_track_type_registrants() );
	}

	/**
	 * @covers ::openstation_extension_dirs
	 */
	public function test_extension_dirs_cover_plugins_mu_plugins_and_themes() {
		$dirs = openstation_extension_dirs();

		$this->assertContains( trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( WPMU_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( get_theme_root() ) ), $dirs );
	}
}
