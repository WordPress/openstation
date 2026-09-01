<?php
/**
 * Tests for custom post types appearing as sections in the site
 * window, grouped by the plugin or theme that registered them.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressPostTypes extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		foreach ( array( 'dm_book', 'dm_hidden', 'dm_private', 'dm_norest' ) as $type ) {
			if ( post_type_exists( $type ) ) {
				unregister_post_type( $type );
			}
		}
		remove_all_filters( 'openstation_my_wordpress_post_types' );
		remove_all_filters( 'openstation_my_wordpress_post_type_entity' );
		remove_all_filters( 'openstation_my_wordpress_post_type_group' );
		remove_all_filters( 'openstation_my_wordpress_post_type_groups' );
		remove_all_filters( 'openstation_my_wordpress_post_type_rest_enabled' );
		remove_all_filters( 'openstation_my_wordpress_entities' );
		parent::tear_down();
	}

	/**
	 * Register a CPT with sane browsable defaults.
	 *
	 * @param string $slug Post type slug.
	 * @param array  $args Overrides.
	 * @return WP_Post_Type
	 */
	protected function register_type( $slug, $args = array() ) {
		return register_post_type(
			$slug,
			array_merge(
				array(
					'label'        => ucfirst( $slug ),
					'public'       => true,
					'show_ui'      => true,
					'show_in_rest' => true,
					'supports'     => array( 'title', 'editor', 'thumbnail' ),
				),
				$args
			)
		);
	}

	/**
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_eligible_includes_public_cpt() {
		$this->register_type( 'dm_book' );

		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayHasKey( 'dm_book', $types );
	}

	/**
	 * Core builtins are already root sections (post, page, attachment)
	 * or editor infrastructure (wp_block, wp_template).
	 *
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_eligible_excludes_builtin_types() {
		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayNotHasKey( 'post', $types );
		$this->assertArrayNotHasKey( 'page', $types );
		$this->assertArrayNotHasKey( 'attachment', $types );
		$this->assertArrayNotHasKey( 'wp_block', $types );
	}

	/**
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_eligible_excludes_types_without_ui() {
		$this->register_type( 'dm_hidden', array( 'show_ui' => false ) );

		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayNotHasKey( 'dm_hidden', $types );
	}

	/**
	 * OpenStation's own bookkeeping post types are `show_ui => false`,
	 * so they never surface as browsable folders.
	 *
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_eligible_excludes_plugin_internal_types() {
		$types = openstation_my_wordpress_eligible_post_types();

		if ( defined( 'OPENSTATION_NOTES_POST_TYPE' ) ) {
			$this->assertArrayNotHasKey( OPENSTATION_NOTES_POST_TYPE, $types );
		}
		if ( defined( 'OPENSTATION_AGENT_CHAT_POST_TYPE' ) ) {
			$this->assertArrayNotHasKey( OPENSTATION_AGENT_CHAT_POST_TYPE, $types );
		}
	}

	/**
	 * A user who can't edit the type never sees its folder.
	 *
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_eligible_respects_capability() {
		$this->register_type(
			'dm_private',
			array(
				'capability_type' => 'dm_private',
				'map_meta_cap'    => true,
			)
		);

		wp_set_current_user( self::$subscriber_id );
		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayNotHasKey( 'dm_private', $types );
	}

	/**
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_post_types_filter_can_drop_a_type() {
		$this->register_type( 'dm_book' );

		add_filter(
			'openstation_my_wordpress_post_types',
			static function ( $slugs ) {
				return array_values( array_diff( $slugs, array( 'dm_book' ) ) );
			}
		);

		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayNotHasKey( 'dm_book', $types );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_rest_path
	 */
	public function test_rest_path_uses_wp_v2_for_rest_exposed_types() {
		$this->register_type( 'dm_book', array( 'rest_base' => 'books' ) );

		$path = openstation_my_wordpress_post_type_rest_path( get_post_type_object( 'dm_book' ) );

		$this->assertSame( 'wp/v2/books', $path );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_rest_path
	 */
	public function test_rest_path_uses_bridge_for_non_rest_types() {
		$this->register_type( 'dm_norest', array( 'show_in_rest' => false ) );

		$path = openstation_my_wordpress_post_type_rest_path( get_post_type_object( 'dm_norest' ) );

		$this->assertSame( 'desktop-mode/v1/post-type/dm_norest', $path );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_is_bridged
	 */
	public function test_rest_exposed_types_are_not_bridged() {
		$this->register_type( 'dm_book' );

		$this->assertFalse( openstation_my_wordpress_post_type_is_bridged( 'dm_book' ) );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_is_bridged
	 */
	public function test_bridge_can_be_vetoed_per_type() {
		$this->register_type( 'dm_norest', array( 'show_in_rest' => false ) );

		$this->assertTrue( openstation_my_wordpress_post_type_is_bridged( 'dm_norest' ) );

		add_filter(
			'openstation_my_wordpress_post_type_rest_enabled',
			static function ( $enabled, $post_type ) {
				return 'dm_norest' === $post_type ? false : $enabled;
			},
			10,
			2
		);

		$this->assertFalse( openstation_my_wordpress_post_type_is_bridged( 'dm_norest' ) );
	}

	/**
	 * A vetoed non-REST type has no endpoint left, so it must not
	 * render a folder that can't open.
	 *
	 * @covers ::openstation_my_wordpress_eligible_post_types
	 */
	public function test_vetoed_non_rest_type_is_not_eligible() {
		$this->register_type( 'dm_norest', array( 'show_in_rest' => false ) );

		add_filter( 'openstation_my_wordpress_post_type_rest_enabled', '__return_false' );

		$types = openstation_my_wordpress_eligible_post_types();

		$this->assertArrayNotHasKey( 'dm_norest', $types );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_entity
	 */
	public function test_entity_shape() {
		$this->register_type( 'dm_book', array( 'menu_icon' => 'dashicons-book' ) );

		$entity = openstation_my_wordpress_post_type_entity( get_post_type_object( 'dm_book' ) );

		$this->assertSame( 'cpt-dm_book', $entity['id'] );
		$this->assertSame( 'Dm_book', $entity['label'] );
		$this->assertSame( 'dashicons-book', $entity['icon'] );
		$this->assertSame( 'post', $entity['kind'] );
		$this->assertSame( 'dm_book', $entity['post_type'] );
		$this->assertTrue( $entity['thumbnails'] );
	}

	/**
	 * Types without thumbnail support opt out of featured-image tiles.
	 *
	 * @covers ::openstation_my_wordpress_post_type_entity
	 */
	public function test_entity_thumbnails_follows_post_type_support() {
		$this->register_type( 'dm_book', array( 'supports' => array( 'title' ) ) );

		$entity = openstation_my_wordpress_post_type_entity( get_post_type_object( 'dm_book' ) );

		$this->assertFalse( $entity['thumbnails'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_icon
	 */
	public function test_icon_falls_back_when_menu_icon_is_absent_or_none() {
		$this->register_type( 'dm_book', array( 'menu_icon' => 'none' ) );

		$this->assertSame(
			'dashicons-admin-post',
			openstation_my_wordpress_post_type_icon( get_post_type_object( 'dm_book' ) )
		);
	}

	/**
	 * A data-URI or URL `menu_icon` passes through untouched — the
	 * bundle's `renderIcon()` handles all three shapes.
	 *
	 * @covers ::openstation_my_wordpress_post_type_icon
	 */
	public function test_icon_passes_through_data_uris() {
		$uri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
		$this->register_type( 'dm_book', array( 'menu_icon' => $uri ) );

		$this->assertSame(
			$uri,
			openstation_my_wordpress_post_type_icon( get_post_type_object( 'dm_book' ) )
		);
	}

	/**
	 * @covers ::openstation_my_wordpress_append_post_type_entities
	 */
	public function test_entities_filter_appends_cpt_sections() {
		$this->register_type( 'dm_book' );

		$entities = openstation_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );

		$this->assertContains( 'posts', $ids );
		$this->assertContains( 'cpt-dm_book', $ids );
	}

	/**
	 * A section already covering the post type wins — no duplicate
	 * folder for a CPT a plugin registered by hand.
	 *
	 * @covers ::openstation_my_wordpress_append_post_type_entities
	 */
	public function test_existing_section_is_not_duplicated() {
		$this->register_type( 'dm_book' );

		add_filter(
			'openstation_my_wordpress_entities',
			static function ( $entities ) {
				$entities[] = array(
					'id'        => 'my-books',
					'label'     => 'My books',
					'icon'      => 'dashicons-book',
					'restPath'  => 'wp/v2/dm_book',
					'kind'      => 'post',
					'post_type' => 'dm_book',
				);
				return $entities;
			},
			1
		);

		$ids = wp_list_pluck( openstation_my_wordpress_entities(), 'id' );

		$this->assertContains( 'my-books', $ids );
		$this->assertNotContains( 'cpt-dm_book', $ids );
	}

	/**
	 * @covers ::openstation_my_wordpress_group_for_path
	 */
	public function test_group_for_path_resolves_a_plugin_folder() {
		$group = openstation_my_wordpress_group_for_path(
			trailingslashit( wp_normalize_path( WP_PLUGIN_DIR ) ) . 'acme-shop/includes/types.php'
		);

		$this->assertIsArray( $group );
		$this->assertSame( 'plugin:acme-shop', $group['id'] );
		$this->assertSame( 'dashicons-admin-plugins', $group['icon'] );
		// Not an installed plugin — falls back to the folder slug.
		$this->assertSame( 'acme-shop', $group['label'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_group_for_path
	 */
	public function test_group_for_path_resolves_a_theme() {
		$theme = wp_get_theme();
		$group = openstation_my_wordpress_group_for_path(
			trailingslashit( wp_normalize_path( get_theme_root() ) ) .
				$theme->get_stylesheet() . '/functions.php'
		);

		$this->assertIsArray( $group );
		$this->assertSame( 'theme:' . $theme->get_stylesheet(), $group['id'] );
		$this->assertSame( 'dashicons-admin-appearance', $group['icon'] );
		$this->assertSame( (string) $theme->get( 'Name' ), $group['label'] );
	}

	/**
	 * Core / drop-in / unknown paths stay ungrouped so the type
	 * renders loose at the root rather than in an invented folder.
	 *
	 * @covers ::openstation_my_wordpress_group_for_path
	 */
	public function test_group_for_path_returns_null_outside_extensions() {
		$this->assertNull(
			openstation_my_wordpress_group_for_path( ABSPATH . 'wp-includes/post.php' )
		);
		$this->assertNull( openstation_my_wordpress_group_for_path( '' ) );
	}

	/**
	 * @covers ::openstation_my_wordpress_post_type_group
	 */
	public function test_group_filter_can_override_attribution() {
		$this->register_type( 'dm_book' );

		add_filter(
			'openstation_my_wordpress_post_type_group',
			static function () {
				return array(
					'id'    => 'plugin:acme-suite',
					'label' => 'Acme Suite',
					'icon'  => 'dashicons-star-filled',
					'order' => 5,
				);
			}
		);

		$entity = openstation_my_wordpress_post_type_entity( get_post_type_object( 'dm_book' ) );

		$this->assertSame( 'plugin:acme-suite', $entity['group'] );
		$this->assertSame( 'Acme Suite', $entity['groupLabel'] );
		$this->assertSame( 'dashicons-star-filled', $entity['groupIcon'] );
		$this->assertSame( 5, $entity['groupOrder'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_collect_groups
	 */
	public function test_collect_groups_dedupes_and_orders() {
		$entities = array(
			array( 'id' => 'posts' ),
			array(
				'id'         => 'cpt-b',
				'group'      => 'theme:twenty',
				'groupLabel' => 'Twenty',
				'groupIcon'  => 'dashicons-admin-appearance',
				'groupOrder' => 30,
			),
			array(
				'id'         => 'cpt-a',
				'group'      => 'plugin:acme',
				'groupLabel' => 'Acme',
				'groupIcon'  => 'dashicons-admin-plugins',
				'groupOrder' => 20,
			),
			array(
				'id'         => 'cpt-a2',
				'group'      => 'plugin:acme',
				'groupLabel' => 'Acme',
				'groupIcon'  => 'dashicons-admin-plugins',
				'groupOrder' => 20,
			),
		);

		$groups = openstation_my_wordpress_collect_groups( $entities );

		$this->assertCount( 2, $groups );
		$this->assertSame( 'plugin:acme', $groups[0]['id'] );
		$this->assertSame( 'theme:twenty', $groups[1]['id'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_collect_groups
	 */
	public function test_collect_groups_is_filterable() {
		add_filter(
			'openstation_my_wordpress_post_type_groups',
			static function () {
				return array();
			}
		);

		$groups = openstation_my_wordpress_collect_groups(
			array( array( 'id' => 'cpt-a', 'group' => 'plugin:acme' ) )
		);

		$this->assertSame( array(), $groups );
	}

}
