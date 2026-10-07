<?php

class Tests_OpenStation_MyWordpress extends WP_UnitTestCase {

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
		remove_all_filters( 'openstation_my_wordpress_user_can_use' );
		remove_all_filters( 'openstation_my_wordpress_entities' );
		remove_all_filters( 'openstation_site_title' );
		parent::tear_down();
	}

	public function test_legacy_window_and_launcher_are_gone() {
		$this->assertFalse(
			function_exists( 'openstation_my_wordpress_register_window' ),
			'The legacy registrar was deleted with the window.'
		);
		$this->assertNull(
			openstation_native_window_registry( 'desktop-mode-my-wordpress' ),
			'No native window under the legacy id.'
		);
		$this->assertNull(
			openstation_desktop_icon_registry( 'desktop-mode-my-wordpress' ),
			'No launcher under the legacy id — the app owns the pinned slot.'
		);
	}

	public function test_helpers_still_carry_the_identity() {
		$this->assertSame( 'WP Explorer', openstation_my_wordpress_app_title() );

		$svg = openstation_my_wordpress_icon_svg();
		$this->assertStringContainsString( 'currentColor', $svg );
		$this->assertStringNotContainsString( 'fill="#', $svg );

		$uri = 'data:image/svg+xml;base64,' . base64_encode( $svg );
		$this->assertSame( $uri, openstation_sanitize_dock_icon( $uri ) );
	}

	public function test_default_entities_are_posts_pages_and_users() {
		$entities = openstation_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'posts', $ids );
		$this->assertContains( 'pages', $ids );
		$this->assertContains( 'users', $ids );
		$this->assertContains( 'media', $ids );

		$by_id = array();
		foreach ( $entities as $e ) {
			$by_id[ $e['id'] ] = $e;
		}
		$this->assertSame( 'user', $by_id['users']['kind'] );
		$this->assertSame( 'post', $by_id['posts']['kind'] );
		$this->assertSame( 'post', $by_id['pages']['kind'] );
		$this->assertSame( 'media', $by_id['media']['kind'] );
		$this->assertSame( 'wp/v2/users', $by_id['users']['restPath'] );

		$this->assertSame( 'post', $by_id['posts']['post_type'] );
		$this->assertSame( 'page', $by_id['pages']['post_type'] );
		$this->assertSame( 'attachment', $by_id['media']['post_type'] );
		$this->assertArrayNotHasKey( 'post_type', $by_id['users'] );
	}

	public function test_entities_filter_can_extend() {
		add_filter( 'openstation_my_wordpress_entities', static function ( $entities ) {
			$entities[] = array(
				'id'       => 'comments',
				'label'    => 'Comments',
				'icon'     => 'dashicons-admin-comments',
				'restPath' => 'wp/v2/comments',
			);
			return $entities;
		} );

		$entities = openstation_my_wordpress_entities();
		$ids      = wp_list_pluck( $entities, 'id' );
		$this->assertContains( 'comments', $ids );
	}

	public function test_entities_filter_passes_edit_action_through() {
		add_filter( 'openstation_my_wordpress_entities', static function ( $entities ) {
			$entities[] = array(
				'id'         => 'atf-forms',
				'label'      => 'Forms',
				'icon'       => 'dashicons-feedback',
				'restPath'   => 'wp/v2/atf-form',
				'post_type'  => 'atf-form',
				'editAction' => 'atf/open-builder',
			);
			$entities[] = array(
				'id'         => 'atf-entries',
				'label'      => 'Entries',
				'icon'       => 'dashicons-email',
				'restPath'   => 'desktop-mode/v1/post-type/atf-entry',
				'editAction' => false,
			);
			return $entities;
		} );

		$by_id = array();
		foreach ( openstation_my_wordpress_entities() as $entity ) {
			$by_id[ $entity['id'] ] = $entity;
		}
		$this->assertSame( 'atf/open-builder', $by_id['atf-forms']['editAction'] );
		$this->assertFalse( $by_id['atf-entries']['editAction'] );
	}

	public function test_subscriber_cannot_use_by_default() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertFalse( openstation_my_wordpress_user_can_use() );
	}

	public function test_can_use_filter_overrides_default() {
		wp_set_current_user( self::$subscriber_id );
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_true' );
		$this->assertTrue( openstation_my_wordpress_user_can_use() );
	}

}
