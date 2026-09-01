<?php
/**
 * Tests for the Trash app — the App Framework port of the Recycle
 * Bin, running beside the legacy window over the SAME store: the
 * manifest, the gate, the data payload, and the restore / purge
 * dispatch cycle end to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group trash-app
 */

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
		// App desktop-icon registrations are process-scoped; left
		// behind they leak into later suites' auto-place counts.
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action name.
	 * @param array  $state  Client state.
	 * @param array  $args   Action args.
	 * @return array Runtime response.
	 */
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

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-recycle-bin' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Trash', $manifest['title'] );
		$this->assertSame( 880, $manifest['width'] );
		$this->assertSame( 560, $manifest['height'] );
		$this->assertSame( 520, $manifest['min_width'] );
		$this->assertSame( 360, $manifest['min_height'] );
		// The legacy bin's rail furniture, inherited whole: a dock
		// control, last on the rail after the shell's own cluster.
		$this->assertSame( 'dock', $manifest['placement'] );
		$this->assertSame( 'control', $manifest['nav_kind'] );
		$this->assertSame( 40, $manifest['dock_order'] );
		$this->assertTrue( $manifest['placeable'] );
		// Any content change repaints the bin.
		$this->assertSame( array( '*' ), $manifest['watch'] );
		// The whole server surface: two mutations. Filter, search and
		// the Refresh button ride the built-in `refresh`.
		$this->assertSame( array( 'restore', 'purge' ), $manifest['actions'] );
		// Both bin drawings ride the config extra so the client's
		// empty/full tile-art swap is local — and there is NO badge.
		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['config']['empty'] );
		$this->assertStringStartsWith( 'data:image/svg+xml', (string) $manifest['config']['full'] );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_follows_the_legacy_capability_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-recycle-bin' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_recycle_bin_user_can_use', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_recycle_bin_user_can_use', '__return_false' );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
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

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
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
		// `total` stays the GLOBAL bin count even under a narrow view —
		// what decides toolbar-vs-empty-state and the badge.
		$this->assertGreaterThanOrEqual( 2, $searched['data']['total'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
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
		// The same `os.post.changed` broadcast the legacy bin emits,
		// as the framework's announce effect.
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
		// The restored row left the recomputed data.
		$this->assertNotContains( $post_id, wp_list_pluck( $response['data']['items'], 'id' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_purge_deletes_forever_and_a_blocked_item_becomes_a_toast() {
		$post_id = self::factory()->post->create();
		wp_trash_post( $post_id );

		$response = $this->dispatch(
			'purge',
			array(),
			array(
				'items' => array(
					array( 'id' => $post_id, 'type' => 'post' ),
					// A ref that cannot be purged (nothing there).
					array( 'id' => 999999, 'type' => 'post' ),
				),
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertNull( get_post( $post_id ) );
		$types = wp_list_pluck( $response['effects'], 'type' );
		$this->assertContains( 'announce', $types );
		// The legacy bin logged failures to the console; the app says
		// so out loud.
		$this->assertContains( 'toast', $types );
	}
}
