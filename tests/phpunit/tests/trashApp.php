<?php

use OpenStation\App\State;

class Tests_OpenStation_TrashApp extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {

		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-recycle-bin',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-recycle-bin' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Trash', $manifest['title'] );
		$this->assertSame( 880, $manifest['width'] );
		$this->assertSame( 560, $manifest['height'] );
		$this->assertSame( 520, $manifest['min_width'] );
		$this->assertSame( 360, $manifest['min_height'] );

		$this->assertSame( 'dock', $manifest['placement'] );
		$this->assertSame( 'control', $manifest['nav_kind'] );
		$this->assertSame( 40, $manifest['dock_order'] );
		$this->assertTrue( $manifest['placeable'] );

		$this->assertSame( array( '*' ), $manifest['watch'] );

		$this->assertSame( array( 'show', 'reopen', 'restore', 'purge' ), $manifest['actions'] );

		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['config']['empty'] );
		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['config']['full'] );
	}

	public function test_gate_follows_the_legacy_capability_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-recycle-bin' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_recycle_bin_user_can_use', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_recycle_bin_user_can_use', '__return_false' );
	}

	public function test_mount_serves_the_same_rows_the_legacy_store_lists() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Doomed post' ) );
		wp_trash_post( $post_id );

		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$ids = wp_list_pluck( $response['data']['items'], 'id' );
		$this->assertContains( $post_id, $ids );
		$this->assertGreaterThanOrEqual( 1, $response['data']['total'] );
		$this->assertIsBool( $response['data']['mediaTrash'] );
	}

	public function test_returning_to_an_empty_bin_reads_newly_trashed_items() {
		$initial = $this->dispatch( 'mount' );
		$post_id = self::factory()->post->create();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page' ) );
		wp_trash_post( $post_id );
		wp_trash_post( $page_id );

		foreach ( array( 'show', 'reopen' ) as $action ) {
			$response = $this->dispatch( $action, $initial['state'] );
			$this->assertTrue( $response['ok'] );
			$ids = wp_list_pluck( $response['data']['items'], 'id' );
			$this->assertContains( $post_id, $ids );
			$this->assertContains( $page_id, $ids );
			$this->assertGreaterThanOrEqual( 2, $response['data']['total'] );
		}
	}

	public function test_filter_and_search_ride_the_built_in_refresh() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Alpha strategy memo' ) );
		$page_id = self::factory()->post->create(
			array(
				'post_title' => 'Quarterly page',
				'post_type'  => 'page',
			)
		);
		wp_trash_post( $post_id );
		wp_trash_post( $page_id );

		$pages = $this->dispatch( 'refresh', array( 'filter' => 'page' ) );
		$ids   = wp_list_pluck( $pages['data']['items'], 'id' );
		$this->assertContains( $page_id, $ids );
		$this->assertNotContains( $post_id, $ids );

		$searched = $this->dispatch( 'refresh', array( 'search' => 'Alpha strategy' ) );
		$ids      = wp_list_pluck( $searched['data']['items'], 'id' );
		$this->assertContains( $post_id, $ids );
		$this->assertNotContains( $page_id, $ids );

		$this->assertGreaterThanOrEqual( 2, $searched['data']['total'] );
	}

	public function test_restore_untrashes_and_announces_per_type() {
		$post_id = self::factory()->post->create();
		wp_trash_post( $post_id );

		$response = $this->dispatch(
			'restore',
			array(),
			array( 'items' => array( array( 'id' => $post_id, 'type' => 'post' ) ) )
		);
		$this->assertTrue( $response['ok'] );
		$this->assertNotSame( 'desktop-mode-recycle-bin', get_post_status( $post_id ) );

		$announce = null;
		foreach ( $response['effects'] as $effect ) {
			if ( 'announce' === $effect['type'] ) {
				$announce = $effect;
			}
		}
		$this->assertNotNull( $announce );
		$this->assertSame( 'post', $announce['contentType'] );
		$this->assertSame( 'untrashed', $announce['action'] );
		$this->assertSame( array( $post_id ), $announce['ids'] );

		$this->assertNotContains( $post_id, wp_list_pluck( $response['data']['items'], 'id' ) );
	}

	public function test_purge_deletes_forever_and_a_blocked_item_becomes_a_toast() {
		$post_id = self::factory()->post->create();
		wp_trash_post( $post_id );

		$response = $this->dispatch(
			'purge',
			array(),
			array(
				'items' => array(
					array( 'id' => $post_id, 'type' => 'post' ),

					array( 'id' => 999999, 'type' => 'post' ),
				),
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertNull( get_post( $post_id ) );
		$types = wp_list_pluck( $response['effects'], 'type' );
		$this->assertContains( 'announce', $types );

		$this->assertContains( 'toast', $types );
	}
}
