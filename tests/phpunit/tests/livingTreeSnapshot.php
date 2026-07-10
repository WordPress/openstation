<?php
/**
 * Tests for the Living Tree wallpaper's server module — the compact
 * site-DNA snapshot, its permission gate, its REST route, and the
 * aggregate metric helpers behind it.
 *
 * The snapshot is the contract the JS client trusts blind: shape, bounds,
 * compactness (aggregates only, never per-post identities), and seed
 * stability (installEpoch must not drift between calls).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group living-tree
 */
class Tests_DesktopMode_LivingTreeSnapshot extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_transient( 'desktop_mode_living_tree_snapshot' );
	}

	/**
	 * @covers ::desktop_mode_living_tree_build_snapshot
	 */
	public function test_snapshot_has_the_full_expected_shape() {
		$snapshot = desktop_mode_living_tree_build_snapshot();

		$this->assertIsArray( $snapshot );
		$expected_keys = array(
			'siteUrl',
			'installEpoch',
			'siteAgeDays',
			'totalPosts',
			'totalPages',
			'totalCategories',
			'totalTags',
			'totalComments',
			'activeUsers',
			'traffic',
			'seoHealth',
			'performance',
			'branches',
			'tagCooccurrence',
		);
		foreach ( $expected_keys as $key ) {
			$this->assertArrayHasKey( $key, $snapshot, "missing snapshot key: {$key}" );
		}
	}

	/**
	 * @covers ::desktop_mode_living_tree_build_snapshot
	 */
	public function test_snapshot_field_types_and_bounds() {
		$snapshot = desktop_mode_living_tree_build_snapshot();

		$this->assertNotEmpty( $snapshot['siteUrl'] );
		$this->assertIsString( $snapshot['siteUrl'] );

		// Age is a non-negative whole number — the master clock never runs
		// backwards.
		$this->assertGreaterThanOrEqual( 0, $snapshot['siteAgeDays'] );

		// Aggregate counts are non-negative.
		foreach ( array( 'totalPosts', 'totalPages', 'totalCategories', 'totalTags', 'totalComments', 'activeUsers', 'traffic' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
		}

		// Normalised scores stay within [0, 1].
		foreach ( array( 'seoHealth', 'performance' ) as $key ) {
			$this->assertGreaterThanOrEqual( 0, $snapshot[ $key ], "{$key} must be >= 0" );
			$this->assertLessThanOrEqual( 1, $snapshot[ $key ], "{$key} must be <= 1" );
		}

		// Compact DNA collections are arrays (never a full post list).
		$this->assertIsArray( $snapshot['branches'] );
		$this->assertIsArray( $snapshot['tagCooccurrence'] );
	}

	/**
	 * The golden rule at the server boundary: the snapshot is aggregates
	 * only — it must never carry per-post identities or coordinates.
	 *
	 * @covers ::desktop_mode_living_tree_build_snapshot
	 */
	public function test_snapshot_tag_cooccurrence_edges_are_compact() {
		$edges = desktop_mode_living_tree_build_snapshot()['tagCooccurrence'];
		$this->assertIsArray( $edges );
		// Empty is valid for the stub; when populated, each edge is a
		// compact { a, b, weight } triple — no post rows.
		foreach ( $edges as $edge ) {
			$this->assertArrayHasKey( 'a', $edge );
			$this->assertArrayHasKey( 'b', $edge );
			$this->assertArrayHasKey( 'weight', $edge );
		}
	}

	/**
	 * @covers ::desktop_mode_living_tree_user_can_use
	 */
	public function test_permission_gate_default_and_filter() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->assertTrue( desktop_mode_living_tree_user_can_use() );

		add_filter( 'desktop_mode_living_tree_user_can_use', '__return_false' );
		$this->assertFalse( desktop_mode_living_tree_user_can_use() );
		remove_filter( 'desktop_mode_living_tree_user_can_use', '__return_false' );
	}

	/**
	 * The route registers on `rest_api_init` (fired lazily when the REST
	 * server is first built) — we don't call the registrar directly, which
	 * would trip core's "register on rest_api_init" notice.
	 *
	 * @covers ::desktop_mode_living_tree_register_routes
	 */
	public function test_snapshot_route_is_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/desktop-mode/v1/living-tree/snapshot', $routes );
	}

	/**
	 * @covers ::desktop_mode_living_tree_flush_cache
	 */
	public function test_flush_cache_clears_the_transient() {
		set_transient( 'desktop_mode_living_tree_snapshot', array( 'stale' => true ), HOUR_IN_SECONDS );
		desktop_mode_living_tree_flush_cache();
		$this->assertFalse( get_transient( 'desktop_mode_living_tree_snapshot' ) );
	}

	/**
	 * @covers ::desktop_mode_living_tree_build_snapshot
	 */
	public function test_snapshot_totals_reflect_published_content() {
		self::factory()->post->create_many( 3, array( 'post_status' => 'publish' ) );
		self::factory()->post->create( array( 'post_status' => 'draft' ) );
		self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);

		$snapshot = desktop_mode_living_tree_build_snapshot();
		$this->assertGreaterThanOrEqual( 3, $snapshot['totalPosts'] );
		$this->assertGreaterThanOrEqual( 1, $snapshot['totalPages'] );
		// Drafts are invisible to the tree: only published content grows
		// leaves, so publish count stays below the raw row count.
		$this->assertLessThan( 5, $snapshot['totalPosts'] );
	}

	/**
	 * The determinism seed is `siteUrl|installEpoch` — the epoch must be
	 * stable across calls or the skeleton would reshuffle on every load.
	 *
	 * @covers ::desktop_mode_living_tree_install_epoch
	 */
	public function test_install_epoch_is_stable_and_site_age_non_negative() {
		$first  = desktop_mode_living_tree_install_epoch();
		$second = desktop_mode_living_tree_install_epoch();
		$this->assertSame( $first, $second );
		// The tests factory always seeds an admin user, so an epoch exists.
		$this->assertGreaterThan( 0, $first );
		$this->assertGreaterThanOrEqual( 0, desktop_mode_living_tree_site_age_days() );
	}

	/**
	 * @covers ::desktop_mode_living_tree_tag_cooccurrence
	 */
	public function test_tag_cooccurrence_finds_shared_tags_and_stays_compact() {
		$post_a = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$post_b = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_set_post_tags( $post_a, array( 'alpha', 'beta' ) );
		wp_set_post_tags( $post_b, array( 'alpha', 'beta', 'gamma' ) );

		$edges = desktop_mode_living_tree_tag_cooccurrence( 10 );
		$this->assertNotEmpty( $edges );
		$this->assertLessThanOrEqual( 10, count( $edges ) );

		// alpha+beta co-occur on two posts — that pair leads the list.
		$this->assertSame( 2, $edges[0]['weight'] );
		$this->assertLessThan( $edges[0]['b'], $edges[0]['a'], 'edges are normalised a < b' );

		// Compactness: each edge is exactly { a, b, weight }.
		$this->assertSame( array( 'a', 'b', 'weight' ), array_keys( $edges[0] ) );
	}

	/**
	 * @covers ::desktop_mode_living_tree_branch_dna
	 */
	public function test_branch_dna_is_capped_and_normalised() {
		self::factory()->post->create_many( 2, array( 'post_status' => 'publish' ) );
		$dna = desktop_mode_living_tree_branch_dna();
		$this->assertLessThanOrEqual( 12, count( $dna ) );
		foreach ( $dna as $hint ) {
			$this->assertSame( array( 'depth', 'girth', 'length' ), array_keys( $hint ) );
			$this->assertGreaterThanOrEqual( 0, $hint['girth'] );
			$this->assertLessThanOrEqual( 1, $hint['girth'] );
		}
	}

	/**
	 * @covers ::desktop_mode_living_tree_build_snapshot
	 */
	public function test_snapshot_filter_can_adjust_the_payload() {
		$filter = static function ( $snapshot ) {
			$snapshot['seoHealth'] = 0.25;
			return $snapshot;
		};
		add_filter( 'desktop_mode_living_tree_snapshot', $filter );
		$snapshot = desktop_mode_living_tree_build_snapshot();
		remove_filter( 'desktop_mode_living_tree_snapshot', $filter );
		$this->assertSame( 0.25, $snapshot['seoHealth'] );
	}
}
