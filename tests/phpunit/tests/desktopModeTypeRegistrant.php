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
 * @group desktop-mode
 */
class Tests_DesktopMode_TypeRegistrant extends WP_UnitTestCase {

	/**
	 * Absolute path to a throwaway plugin file used to register types
	 * from outside Desktop Mode's own directory.
	 *
	 * @var string
	 */
	protected static $fixture_file;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		// The tracker deliberately skips frames inside Desktop Mode —
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

	public function tear_down() {
		foreach ( array( 'dm_tracked', 'dm_selfattr' ) as $type ) {
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
	 * @covers ::desktop_mode_record_type_registrant
	 * @covers ::desktop_mode_type_registrant_file
	 */
	public function test_records_the_registering_plugin_file() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$file = desktop_mode_type_registrant_file( 'dm_tracked', 'post_type' );

		$this->assertNotNull( $file );
		$this->assertSame( wp_normalize_path( self::$fixture_file ), $file );
	}

	/**
	 * Taxonomies go through the same tracker.
	 *
	 * @covers ::desktop_mode_record_type_registrant
	 */
	public function test_records_taxonomies_too() {
		dm_registrant_fixture_register( 'dm_tracked_tax', 'taxonomy' );

		$this->assertSame(
			wp_normalize_path( self::$fixture_file ),
			desktop_mode_type_registrant_file( 'dm_tracked_tax', 'taxonomy' )
		);
	}

	/**
	 * The recorded path resolves to a group the site window can render
	 * a folder for.
	 *
	 * @covers ::desktop_mode_my_wordpress_post_type_group
	 */
	public function test_recorded_path_resolves_to_a_plugin_group() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$group = desktop_mode_my_wordpress_post_type_group( 'dm_tracked' );

		$this->assertIsArray( $group );
		$this->assertSame( 'plugin:dm-registrant-fixture', $group['id'] );
		$this->assertSame( 'dashicons-admin-plugins', $group['icon'] );
	}

	/**
	 * The backtrace walk starts inside `payload.php`, which lives under
	 * `WP_PLUGIN_DIR` — without skipping our own frames every type on
	 * the site would be attributed to Desktop Mode. Registering from
	 * this test file (which is inside the plugin) must record nothing.
	 *
	 * @covers ::desktop_mode_registrant_file_from_backtrace
	 */
	public function test_does_not_attribute_types_to_desktop_mode_itself() {
		register_post_type( 'dm_selfattr', array( 'public' => true ) );

		$this->assertNull(
			desktop_mode_type_registrant_file( 'dm_selfattr', 'post_type' )
		);
	}

	/**
	 * Core's own types are skipped before the backtrace even runs.
	 *
	 * @covers ::desktop_mode_record_type_registrant
	 */
	public function test_builtin_types_are_not_recorded() {
		$this->assertNull( desktop_mode_type_registrant_file( 'post', 'post_type' ) );
		$this->assertNull( desktop_mode_type_registrant_file( 'page', 'post_type' ) );
		$this->assertNull( desktop_mode_type_registrant_file( 'category', 'taxonomy' ) );
	}

	/**
	 * Unrecorded types read back as null rather than raising.
	 *
	 * @covers ::desktop_mode_type_registrant_file
	 */
	public function test_unknown_type_reads_back_null() {
		$this->assertNull(
			desktop_mode_type_registrant_file( 'dm_never_registered', 'post_type' )
		);
	}

	/**
	 * The dock's CPT attribution strategy — `edit.php?post_type=X` is
	 * rendered by Core, so the page hook never points at the
	 * registering plugin and this tracker is the only way to know.
	 * It silently never fired before the lazy rewrite.
	 *
	 * @covers ::desktop_mode_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_resolves_the_registering_plugin() {
		dm_registrant_fixture_register( 'dm_tracked', 'post_type' );

		$this->assertSame(
			'dm-registrant-fixture/dm-registrant-fixture.php',
			desktop_mode_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_tracked'
			)
		);
	}

	/**
	 * A type registered from outside `WP_PLUGIN_DIR` has no plugin to
	 * attribute it to — the dock must not invent one.
	 *
	 * @covers ::desktop_mode_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_returns_null_for_non_plugin_registrants() {
		$this->assertNull(
			desktop_mode_lookup_taxonomy_or_post_type_plugin_file(
				'edit.php?post_type=dm_never_registered'
			)
		);
	}

	/**
	 * @covers ::desktop_mode_lookup_taxonomy_or_post_type_plugin_file
	 */
	public function test_slug_lookup_ignores_non_type_slugs() {
		$this->assertNull(
			desktop_mode_lookup_taxonomy_or_post_type_plugin_file( 'plugins.php' )
		);
		$this->assertNull(
			desktop_mode_lookup_taxonomy_or_post_type_plugin_file( 'edit.php' )
		);
	}

	/**
	 * @covers ::desktop_mode_extension_dirs
	 */
	public function test_extension_dirs_cover_plugins_mu_plugins_and_themes() {
		$dirs = desktop_mode_extension_dirs();

		$this->assertContains( trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( WPMU_PLUGIN_DIR ) ), $dirs );
		$this->assertContains( trailingslashit( wp_normalize_path( get_theme_root() ) ), $dirs );
	}
}
