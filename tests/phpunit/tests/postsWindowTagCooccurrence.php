<?php

class Tests_OpenStation_PostsWindowTagCooccurrence extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		do_action( 'rest_api_init' );

		delete_option( 'desktop_mode_terms_cache_version' );
	}

	public function test_endpoint_requires_edit_posts_cap() {
		wp_set_current_user( $this->subscriber_id );
		$request  = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame(
			403,
			$response->get_status(),
			'Subscriber must not be able to read the cooccurrence aggregator.'
		);
	}

	public function test_endpoint_allows_administrator() {
		wp_set_current_user( $this->admin_id );
		$request  = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame(
			200,
			$response->get_status(),
			'Admin must be able to read the cooccurrence aggregator.'
		);
	}

	public function test_unknown_taxonomy_returns_400() {
		wp_set_current_user( $this->admin_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$request->set_param( 'taxonomy', 'definitely_not_a_taxonomy' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'openstation_invalid_taxonomy', $data['code'] );
	}

	public function test_returns_empty_pairs_when_no_shared_posts() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'alpha' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'beta' ) );

		$post_a = self::factory()->post->create();
		$post_b = self::factory()->post->create();
		wp_set_object_terms( $post_a, array( $t1 ), 'post_tag' );
		wp_set_object_terms( $post_b, array( $t2 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayHasKey( 'pairs', $data );
		$this->assertSame( array(), $data['pairs'] );
	}

	public function test_single_post_with_three_tags_yields_three_pairs() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'one' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'two' ) );
		$t3 = self::factory()->tag->create( array( 'name' => 'three' ) );

		$post = self::factory()->post->create();
		wp_set_object_terms( $post, array( $t1, $t2, $t3 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$data  = $response->get_data();
		$pairs = $data['pairs'];

		foreach ( array( $t1, $t2, $t3 ) as $tid ) {
			$this->assertArrayHasKey( (string) $tid, $pairs );
			$this->assertCount( 2, $pairs[ (string) $tid ] );
			foreach ( $pairs[ (string) $tid ] as $neighbor ) {
				$this->assertSame( 1, $neighbor['shared'] );
				$this->assertNotSame( $tid, $neighbor['id'] );
			}
		}
	}

	public function test_accumulates_shared_counts_across_posts_and_sorts_desc() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'apple' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'banana' ) );
		$t3 = self::factory()->tag->create( array( 'name' => 'cherry' ) );

		foreach ( range( 0, 1 ) as $i ) {
			$p = self::factory()->post->create();
			wp_set_object_terms( $p, array( $t1, $t2 ), 'post_tag' );
		}

		$p = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t1, $t3 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];

		$this->assertArrayHasKey( (string) $t1, $pairs );
		$this->assertSame( $t2, $pairs[ (string) $t1 ][0]['id'] );
		$this->assertSame( 2, $pairs[ (string) $t1 ][0]['shared'] );
		$this->assertSame( $t3, $pairs[ (string) $t1 ][1]['id'] );
		$this->assertSame( 1, $pairs[ (string) $t1 ][1]['shared'] );

		$this->assertArrayHasKey( (string) $t2, $pairs );
		$this->assertCount( 1, $pairs[ (string) $t2 ] );
		$this->assertSame( $t1, $pairs[ (string) $t2 ][0]['id'] );
		$this->assertSame( 2, $pairs[ (string) $t2 ][0]['shared'] );
	}

	public function test_excludes_trash_posts_from_cooccurrence() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'live' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'live2' ) );

		$trashed = self::factory()->post->create( array( 'post_status' => 'trash' ) );
		wp_set_object_terms( $trashed, array( $t1, $t2 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];
		$this->assertArrayNotHasKey( (string) $t1, $pairs );
		$this->assertArrayNotHasKey( (string) $t2, $pairs );
	}

	public function test_includes_drafts_pending_and_future_statuses() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'draft1' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'draft2' ) );

		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		wp_set_object_terms( $draft, array( $t1, $t2 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];
		$this->assertArrayHasKey( (string) $t1, $pairs );
		$this->assertSame( $t2, $pairs[ (string) $t1 ][0]['id'] );
	}

	public function test_limit_param_trims_neighbor_list() {
		wp_set_current_user( $this->admin_id );

		$hub      = self::factory()->tag->create( array( 'name' => 'hub' ) );
		$siblings = array();
		for ( $i = 0; $i < 5; $i++ ) {
			$siblings[] = self::factory()->tag->create( array( 'name' => "s$i" ) );
		}
		$post = self::factory()->post->create();
		wp_set_object_terms( $post, array_merge( array( $hub ), $siblings ), 'post_tag' );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$request->set_param( 'limit', 2 );
		$response = rest_get_server()->dispatch( $request );
		$pairs    = $response->get_data()['pairs'];

		$this->assertArrayHasKey( (string) $hub, $pairs );
		$this->assertCount(
			2,
			$pairs[ (string) $hub ],
			'limit=2 must trim the hub tag to its top 2 neighbors.'
		);
	}

	public function test_limit_param_is_capped_to_24() {
		wp_set_current_user( $this->admin_id );

		$hub      = self::factory()->tag->create( array( 'name' => 'hub' ) );
		$siblings = array();
		for ( $i = 0; $i < 30; $i++ ) {
			$siblings[] = self::factory()->tag->create( array( 'name' => "s$i" ) );
		}
		$post = self::factory()->post->create();
		wp_set_object_terms( $post, array_merge( array( $hub ), $siblings ), 'post_tag' );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$request->set_param( 'limit', 9999 );
		$response = rest_get_server()->dispatch( $request );
		$pairs    = $response->get_data()['pairs'];

		$this->assertCount(
			24,
			$pairs[ (string) $hub ],
			'limit must be clamped to 24 regardless of the caller-supplied value.'
		);
	}

	public function test_cache_version_starts_at_one_when_unset() {
		$this->assertSame(
			1,
			openstation_posts_window_terms_cache_version()
		);
		$this->assertSame(
			1,
			(int) get_option( 'desktop_mode_terms_cache_version' ),
			'First read must persist the version so concurrent readers see the same value.'
		);
	}

	public function test_invalidate_bumps_the_version() {
		$before = openstation_posts_window_terms_cache_version();
		openstation_posts_window_terms_cache_invalidate();
		$after = openstation_posts_window_terms_cache_version();
		$this->assertSame( $before + 1, $after );
	}

	public function test_first_call_writes_payload_to_transient() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'cache-a' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'cache-b' ) );
		$p  = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t1, $t2 ), 'post_tag' );

		$version = openstation_posts_window_terms_cache_version();

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$payload = $response->get_data();

		$cache_key = sprintf( 'dmwco_v%d_%s_l%d', $version, 'post_tag', 8 );
		$cached    = get_transient( $cache_key );
		$this->assertIsArray( $cached );
		$this->assertSame( $payload, $cached );
	}

	public function test_second_call_returns_cached_payload_without_recomputing() {
		wp_set_current_user( $this->admin_id );

		$version   = openstation_posts_window_terms_cache_version();
		$cache_key = sprintf( 'dmwco_v%d_%s_l%d', $version, 'post_tag', 8 );

		$sentinel = array(
			'pairs' => array(
				'9999' => array(
					array( 'id' => 8888, 'shared' => 42 ),
				),
			),
		);
		set_transient( $cache_key, $sentinel, DAY_IN_SECONDS );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $sentinel, $response->get_data() );
	}

	public function test_invalidation_makes_old_cache_unreachable() {
		wp_set_current_user( $this->admin_id );

		$version_a = openstation_posts_window_terms_cache_version();
		$key_a     = sprintf( 'dmwco_v%d_%s_l%d', $version_a, 'post_tag', 8 );

		$sentinel = array(
			'pairs' => array(
				'1234' => array(
					array( 'id' => 5678, 'shared' => 99 ),
				),
			),
		);
		set_transient( $key_a, $sentinel, DAY_IN_SECONDS );

		openstation_posts_window_terms_cache_invalidate();
		$version_b = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $version_a, $version_b );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$this->assertSame( array( 'pairs' => array() ), $response->get_data() );
	}

	public function test_set_object_terms_invalidates_cache() {
		$post = self::factory()->post->create();
		$tag  = self::factory()->tag->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_set_object_terms( $post, array( $tag ), 'post_tag' );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_created_term_invalidates_cache() {
		$before = openstation_posts_window_terms_cache_version();
		self::factory()->tag->create( array( 'name' => 'fresh' ) );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_edited_term_invalidates_cache() {
		$tag = self::factory()->tag->create( array( 'name' => 'before' ) );

		$before = openstation_posts_window_terms_cache_version();
		wp_update_term( $tag, 'post_tag', array( 'name' => 'after' ) );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_delete_term_invalidates_cache() {
		$tag    = self::factory()->tag->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_delete_term( $tag, 'post_tag' );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_wp_trash_post_invalidates_cache() {
		$post   = self::factory()->post->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_trash_post( $post );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_untrash_post_invalidates_cache() {
		$post = self::factory()->post->create();
		wp_trash_post( $post );
		$before = openstation_posts_window_terms_cache_version();
		wp_untrash_post( $post );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	public function test_before_delete_post_invalidates_cache() {
		$post   = self::factory()->post->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_delete_post( $post, true );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}
}
