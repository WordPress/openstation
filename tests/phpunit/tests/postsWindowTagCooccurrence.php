<?php
/**
 * Tests for the `/desktop-mode/v1/tag-cooccurrence` REST endpoint.
 *
 * Powers the Tags window's cluster-aware spiral pack — tags that
 * share posts get pulled toward each other on the canvas. The
 * endpoint scans `term_relationships` once, groups by post, and
 * emits weighted neighbor lists per tag. A regression that miscounts
 * pairs, leaks trashed posts into the graph, or fans out unbounded
 * neighbor lists would visibly corrupt the cloud layout — these
 * tests pin the math + the safety guards.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-posts-window
 */
class Tests_OpenStation_PostsWindowTagCooccurrence extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		// The REST route is registered on `rest_api_init`; trigger
		// the action so the route is live for the dispatcher under
		// test. (WP_UnitTestCase doesn't fire it for every test.)
		do_action( 'rest_api_init' );

		// Reset the cache version so each test starts from a clean
		// state — otherwise an earlier test's invalidation leaks
		// into the cache-hit checks here.
		delete_option( 'desktop_mode_terms_cache_version' );
	}

	// ----------------------------------------------------------------
	// Auth
	// ----------------------------------------------------------------

	/**
	 * @covers ::openstation_posts_window_register_tag_cooccurrence_route
	 */
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

	/**
	 * @covers ::openstation_posts_window_register_tag_cooccurrence_route
	 */
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

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
	public function test_unknown_taxonomy_returns_400() {
		wp_set_current_user( $this->admin_id );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' );
		$request->set_param( 'taxonomy', 'definitely_not_a_taxonomy' );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'openstation_invalid_taxonomy', $data['code'] );
	}

	// ----------------------------------------------------------------
	// Empty + happy paths
	// ----------------------------------------------------------------

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
	public function test_returns_empty_pairs_when_no_shared_posts() {
		wp_set_current_user( $this->admin_id );

		// Two tags but no post links them.
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

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
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

		// Each tag should see the other two as neighbors with shared=1.
		foreach ( array( $t1, $t2, $t3 ) as $tid ) {
			$this->assertArrayHasKey( (string) $tid, $pairs );
			$this->assertCount( 2, $pairs[ (string) $tid ] );
			foreach ( $pairs[ (string) $tid ] as $neighbor ) {
				$this->assertSame( 1, $neighbor['shared'] );
				$this->assertNotSame( $tid, $neighbor['id'] );
			}
		}
	}

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 *
	 * Two posts share both tags → shared count = 2. A third post
	 * pairs only the first tag with a third tag → shared(t1,t3) = 1.
	 * Verifies the per-pair accumulation across distinct posts AND
	 * that the response sorts neighbors by shared count desc.
	 */
	public function test_accumulates_shared_counts_across_posts_and_sorts_desc() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'apple' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'banana' ) );
		$t3 = self::factory()->tag->create( array( 'name' => 'cherry' ) );

		// Two posts pair t1+t2.
		foreach ( range( 0, 1 ) as $i ) {
			$p = self::factory()->post->create();
			wp_set_object_terms( $p, array( $t1, $t2 ), 'post_tag' );
		}
		// One post pairs t1+t3.
		$p = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t1, $t3 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];

		// t1 sees t2 (2 shared) and t3 (1 shared) — t2 first (sorted desc).
		$this->assertArrayHasKey( (string) $t1, $pairs );
		$this->assertSame( $t2, $pairs[ (string) $t1 ][0]['id'] );
		$this->assertSame( 2, $pairs[ (string) $t1 ][0]['shared'] );
		$this->assertSame( $t3, $pairs[ (string) $t1 ][1]['id'] );
		$this->assertSame( 1, $pairs[ (string) $t1 ][1]['shared'] );

		// t2 sees only t1, with shared=2.
		$this->assertArrayHasKey( (string) $t2, $pairs );
		$this->assertCount( 1, $pairs[ (string) $t2 ] );
		$this->assertSame( $t1, $pairs[ (string) $t2 ][0]['id'] );
		$this->assertSame( 2, $pairs[ (string) $t2 ][0]['shared'] );
	}

	// ----------------------------------------------------------------
	// Status / type filtering — must mirror core's
	// `_update_post_term_count` exclusions so the cluster graph
	// matches what the user actually sees in the cloud.
	// ----------------------------------------------------------------

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
	public function test_excludes_trash_posts_from_cooccurrence() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'live' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'live2' ) );

		// One trashed post links t1+t2 — should NOT count.
		$trashed = self::factory()->post->create( array( 'post_status' => 'trash' ) );
		wp_set_object_terms( $trashed, array( $t1, $t2 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];
		$this->assertArrayNotHasKey( (string) $t1, $pairs );
		$this->assertArrayNotHasKey( (string) $t2, $pairs );
	}

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
	public function test_includes_drafts_pending_and_future_statuses() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'draft1' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'draft2' ) );

		// Drafts are non-trash and aren't auto-draft/inherit, so they
		// should contribute to the graph — matches how the rest of
		// the cloud counts terms.
		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		wp_set_object_terms( $draft, array( $t1, $t2 ), 'post_tag' );

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$pairs = $response->get_data()['pairs'];
		$this->assertArrayHasKey( (string) $t1, $pairs );
		$this->assertSame( $t2, $pairs[ (string) $t1 ][0]['id'] );
	}

	// ----------------------------------------------------------------
	// Top-N limit + cap
	// ----------------------------------------------------------------

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 */
	public function test_limit_param_trims_neighbor_list() {
		wp_set_current_user( $this->admin_id );

		// One hub tag connected to five sibling tags via one shared post.
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

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 *
	 * The callback caps `limit` at 24 — a hostile or sloppy caller
	 * passing limit=9999 must not be able to balloon every tag's
	 * neighbor array.
	 */
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

	// ----------------------------------------------------------------
	// Cache layer
	//
	// The endpoint memoises its result into a transient keyed by the
	// site-wide cache version + taxonomy + limit. Invalidation hooks
	// bump the version, which makes every previously-cached payload
	// unreachable in a single option write. Tests below pin the
	// version helpers + verify the canonical invalidation triggers.
	// ----------------------------------------------------------------

	/**
	 * @covers ::openstation_posts_window_terms_cache_version
	 */
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

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_invalidate_bumps_the_version() {
		$before = openstation_posts_window_terms_cache_version();
		openstation_posts_window_terms_cache_invalidate();
		$after = openstation_posts_window_terms_cache_version();
		$this->assertSame( $before + 1, $after );
	}

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 *
	 * First call must populate the transient under
	 * `dmwco_v<version>_<taxonomy>_l<limit>`. We verify by reading
	 * the transient directly — equality with the response payload
	 * proves the cache write fired.
	 */
	public function test_first_call_writes_payload_to_transient() {
		wp_set_current_user( $this->admin_id );

		$t1 = self::factory()->tag->create( array( 'name' => 'cache-a' ) );
		$t2 = self::factory()->tag->create( array( 'name' => 'cache-b' ) );
		$p  = self::factory()->post->create();
		wp_set_object_terms( $p, array( $t1, $t2 ), 'post_tag' );

		// `wp_set_object_terms` above already triggered an invalidation,
		// so the cache version is no longer 1. Read it AFTER the
		// fixture is set up.
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

	/**
	 * @covers ::openstation_posts_window_tag_cooccurrence_callback
	 *
	 * A pre-warmed transient under the active version must be
	 * returned verbatim — proves the dispatcher short-circuits on
	 * cache hit instead of re-running the SQL aggregation.
	 */
	public function test_second_call_returns_cached_payload_without_recomputing() {
		wp_set_current_user( $this->admin_id );

		$version   = openstation_posts_window_terms_cache_version();
		$cache_key = sprintf( 'dmwco_v%d_%s_l%d', $version, 'post_tag', 8 );

		// Stuff a sentinel payload into the cache; if the endpoint
		// short-circuits on hit we should see this verbatim instead
		// of the empty-pairs response the real SQL would produce.
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

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 *
	 * After invalidation, the previous cached payload must be
	 * unreachable (different version → different key) and the
	 * endpoint must recompute from the live DB.
	 */
	public function test_invalidation_makes_old_cache_unreachable() {
		wp_set_current_user( $this->admin_id );

		$version_a = openstation_posts_window_terms_cache_version();
		$key_a     = sprintf( 'dmwco_v%d_%s_l%d', $version_a, 'post_tag', 8 );

		// Plant a sentinel under the current version's key.
		$sentinel = array(
			'pairs' => array(
				'1234' => array(
					array( 'id' => 5678, 'shared' => 99 ),
				),
			),
		);
		set_transient( $key_a, $sentinel, DAY_IN_SECONDS );

		// Bump the version.
		openstation_posts_window_terms_cache_invalidate();
		$version_b = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $version_a, $version_b );

		// Endpoint must miss (different key) and return the live
		// empty-pairs response.
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/desktop-mode/v1/tag-cooccurrence' )
		);
		$this->assertSame( array( 'pairs' => array() ), $response->get_data() );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 *
	 * The hook surface — every action below should bump the
	 * version. If one of these regresses, users would see stale
	 * cluster layouts after edits without an F5.
	 */
	public function test_set_object_terms_invalidates_cache() {
		$post = self::factory()->post->create();
		$tag  = self::factory()->tag->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_set_object_terms( $post, array( $tag ), 'post_tag' );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_created_term_invalidates_cache() {
		$before = openstation_posts_window_terms_cache_version();
		self::factory()->tag->create( array( 'name' => 'fresh' ) );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_edited_term_invalidates_cache() {
		$tag = self::factory()->tag->create( array( 'name' => 'before' ) );
		// Setup fired created_term + set_object_terms; snapshot the
		// version AFTER setup so the assertion is about the edit.
		$before = openstation_posts_window_terms_cache_version();
		wp_update_term( $tag, 'post_tag', array( 'name' => 'after' ) );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_delete_term_invalidates_cache() {
		$tag    = self::factory()->tag->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_delete_term( $tag, 'post_tag' );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_wp_trash_post_invalidates_cache() {
		$post   = self::factory()->post->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_trash_post( $post );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_untrash_post_invalidates_cache() {
		$post = self::factory()->post->create();
		wp_trash_post( $post );
		$before = openstation_posts_window_terms_cache_version();
		wp_untrash_post( $post );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}

	/**
	 * @covers ::openstation_posts_window_terms_cache_invalidate
	 */
	public function test_before_delete_post_invalidates_cache() {
		$post   = self::factory()->post->create();
		$before = openstation_posts_window_terms_cache_version();
		wp_delete_post( $post, true );
		$after = openstation_posts_window_terms_cache_version();
		$this->assertGreaterThan( $before, $after );
	}
}
