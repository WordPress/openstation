<?php

class Tests_OpenStation_PostsWindowTermCounts extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		do_action( 'rest_api_init' );

		delete_option( 'desktop_mode_terms_cache_version' );
	}

	private function dispatch_with_ids( array $ids, $taxonomy = 'post_tag' ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/term-counts' );
		$request->set_param( 'taxonomy', $taxonomy );
		$request->set_param( 'ids', implode( ',', $ids ) );
		return rest_get_server()->dispatch( $request );
	}

	public function test_endpoint_requires_edit_posts_cap() {
		wp_set_current_user( $this->subscriber_id );
		$tag      = self::factory()->tag->create();
		$response = $this->dispatch_with_ids( array( $tag ) );
		$this->assertSame( 403, $response->get_status() );
	}

	public function test_endpoint_allows_administrator() {
		wp_set_current_user( $this->admin_id );
		$tag      = self::factory()->tag->create();
		$response = $this->dispatch_with_ids( array( $tag ) );
		$this->assertSame( 200, $response->get_status() );
	}

	public function test_unknown_taxonomy_returns_400() {
		wp_set_current_user( $this->admin_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/term-counts' );
		$request->set_param( 'taxonomy', 'definitely_not_a_taxonomy' );
		$request->set_param( 'ids', '1,2,3' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'openstation_invalid_taxonomy',
			$response->get_data()['code']
		);
	}

	public function test_returns_zero_for_unknown_or_unused_ids() {
		wp_set_current_user( $this->admin_id );
		$response = $this->dispatch_with_ids( array( 9999, 8888 ) );
		$data     = $response->get_data();
		$this->assertSame( 0, $data['9999'] );
		$this->assertSame( 0, $data['8888'] );
	}

	public function test_returns_correct_counts_for_tagged_posts() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create();
		$t2 = self::factory()->tag->create();

		foreach ( range( 0, 2 ) as $i ) {
			$p = self::factory()->post->create();
			wp_set_object_terms( $p, array( $t1 ), 'post_tag' );
		}
		$p = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t2 ), 'post_tag' );

		$data = $this->dispatch_with_ids( array( $t1, $t2 ) )->get_data();
		$this->assertSame( 3, $data[ (string) $t1 ] );
		$this->assertSame( 1, $data[ (string) $t2 ] );
	}

	public function test_different_id_subsets_project_from_shared_cache() {
		wp_set_current_user( $this->admin_id );

		$tags = array();
		for ( $i = 0; $i < 5; $i++ ) {
			$tag = self::factory()->tag->create();

			for ( $j = 0; $j < $i; $j++ ) {
				$p = self::factory()->post->create();
				wp_set_object_terms( $p, array( $tag ), 'post_tag' );
			}
			$tags[] = $tag;
		}

		$first  = $this->dispatch_with_ids( array_slice( $tags, 0, 3 ) )->get_data();
		$this->assertSame( 0, $first[ (string) $tags[0] ] );
		$this->assertSame( 1, $first[ (string) $tags[1] ] );
		$this->assertSame( 2, $first[ (string) $tags[2] ] );

		$second = $this->dispatch_with_ids( array_slice( $tags, 2, 3 ) )->get_data();
		$this->assertSame( 2, $second[ (string) $tags[2] ] );
		$this->assertSame( 3, $second[ (string) $tags[3] ] );
		$this->assertSame( 4, $second[ (string) $tags[4] ] );
	}

	public function test_trash_posts_excluded_from_count() {
		wp_set_current_user( $this->admin_id );

		$tag      = self::factory()->tag->create();
		$published = self::factory()->post->create();
		wp_set_object_terms( $published, array( $tag ), 'post_tag' );

		$trashed = self::factory()->post->create( array( 'post_status' => 'trash' ) );
		wp_set_object_terms( $trashed, array( $tag ), 'post_tag' );

		$data = $this->dispatch_with_ids( array( $tag ) )->get_data();
		$this->assertSame(
			1,
			$data[ (string) $tag ],
			'Trashed posts must not contribute to bulk count.'
		);
	}

	public function test_drafts_included_in_count() {
		wp_set_current_user( $this->admin_id );

		$tag   = self::factory()->tag->create();
		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		wp_set_object_terms( $draft, array( $tag ), 'post_tag' );

		$data = $this->dispatch_with_ids( array( $tag ) )->get_data();
		$this->assertSame(
			1,
			$data[ (string) $tag ],
			'Drafts must contribute to bulk count.'
		);
	}

	public function test_first_call_writes_full_taxonomy_map_to_transient() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create();
		$t2 = self::factory()->tag->create();
		$p  = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t1, $t2 ), 'post_tag' );

		$version   = openstation_posts_window_terms_cache_version();
		$cache_key = sprintf( 'dmtcnt_v%d_%s', $version, 'post_tag' );

		$this->dispatch_with_ids( array( $t1 ) );

		$cached = get_transient( $cache_key );
		$this->assertIsArray( $cached );
		$this->assertArrayHasKey( (string) $t1, $cached );
		$this->assertArrayHasKey(
			(string) $t2,
			$cached,
			'Cache must contain every term in the taxonomy, not just the ones the first caller requested.'
		);
		$this->assertSame( 1, $cached[ (string) $t1 ] );
		$this->assertSame( 1, $cached[ (string) $t2 ] );
	}

	public function test_second_call_short_circuits_on_cache_hit() {
		wp_set_current_user( $this->admin_id );

		$version   = openstation_posts_window_terms_cache_version();
		$cache_key = sprintf( 'dmtcnt_v%d_%s', $version, 'post_tag' );

		$sentinel = array(
			'42'   => 999,
			'1337' => 7,
		);
		set_transient( $cache_key, $sentinel, DAY_IN_SECONDS );

		$data = $this->dispatch_with_ids( array( 42, 1337 ) )->get_data();
		$this->assertSame( 999, $data['42'] );
		$this->assertSame( 7, $data['1337'] );
	}

	public function test_set_object_terms_invalidates_term_counts_cache() {
		wp_set_current_user( $this->admin_id );

		$version_a = openstation_posts_window_terms_cache_version();
		$key_a     = sprintf( 'dmtcnt_v%d_%s', $version_a, 'post_tag' );

		$sentinel = array( '4242' => 1234 );
		set_transient( $key_a, $sentinel, DAY_IN_SECONDS );

		$tag  = self::factory()->tag->create();
		$post = self::factory()->post->create();
		wp_set_object_terms( $post, array( $tag ), 'post_tag' );

		$version_b = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $version_a, $version_b );

		$data = $this->dispatch_with_ids( array( $tag, 4242 ) )->get_data();
		$this->assertSame(
			1,
			$data[ (string) $tag ],
			'Live SQL must replace the stale sentinel after invalidation.'
		);
		$this->assertSame(
			0,
			$data['4242'],
			'Stale sentinel entry must not leak through after invalidation.'
		);
	}

	public function test_empty_ids_param_returns_empty() {
		wp_set_current_user( $this->admin_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/term-counts' );
		$request->set_param( 'taxonomy', 'post_tag' );
		$request->set_param( 'ids', '' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data() );
	}

	public function test_ids_param_capped_at_500_caller_ids() {
		wp_set_current_user( $this->admin_id );

		$big = range( 1, 750 );
		$response = $this->dispatch_with_ids( $big );
		$this->assertSame( 200, $response->get_status() );
		$this->assertLessThanOrEqual( 500, count( $response->get_data() ) );
	}
}
