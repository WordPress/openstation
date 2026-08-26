<?php
/**
 * The per-user summary payload every user-shaped list row carries, and
 * the grouped prefetch that keeps a page of them from costing two
 * queries a row.
 *
 * The prefetch is the whole point of the file: a 100-row Customers
 * page fired ~200 uncached queries before it existed. What has to
 * hold is that the fast path and the slow path answer the *same*
 * thing — a tile whose post count depends on how the page was loaded
 * is worse than no count at all.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressUserSummaryPayload extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $quiet_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id = $factory->user->create( array( 'role' => 'author' ) );
		self::$quiet_id  = $factory->user->create( array( 'role' => 'subscriber' ) );

		$factory->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_type'   => 'post',
				'post_date'   => '2024-03-01 10:00:00',
			)
		);
		$factory->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_type'   => 'page',
				'post_date'   => '2024-06-01 10:00:00',
			)
		);
		// Neither of these counts: a draft is not public, and a
		// revision is not a page anyone wrote.
		$factory->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_type'   => 'post',
			)
		);
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		$this->reset_prime_cache();
	}

	public function tear_down() {
		$this->reset_prime_cache();
		parent::tear_down();
	}

	/**
	 * The prefetch store is a per-request static keyed by user id, and
	 * PHPUnit runs many "requests" in one process. Overwriting the
	 * ids under test with an empty row is enough to force the
	 * un-primed path for the next assertion.
	 *
	 * @return void
	 */
	protected function reset_prime_cache() {
		$cache = &openstation_my_wordpress_user_summary_cache();
		$cache = array();
	}

	/**
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_the_payload_counts_public_posts_and_pages() {
		$summary = openstation_my_wordpress_user_summary_payload( self::$author_id );

		$this->assertSame( 2, $summary['postCount'] );
		// The most recent of the two published dates, not the draft's.
		$this->assertStringStartsWith( '2024-06-01', $summary['lastActive'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_a_user_who_never_published_reads_as_zero_not_unknown() {
		$summary = openstation_my_wordpress_user_summary_payload( self::$quiet_id );

		$this->assertSame( 0, $summary['postCount'] );
		$this->assertSame( '', $summary['lastActive'] );
	}

	/**
	 * The contract that makes the prefetch safe to add: primed and
	 * un-primed must be indistinguishable from the outside.
	 *
	 * @covers ::openstation_my_wordpress_user_summary_prime
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_the_prefetch_answers_exactly_what_the_per_user_path_does() {
		$ids = array( self::$admin_id, self::$author_id, self::$quiet_id );

		$slow = array();
		foreach ( $ids as $id ) {
			$slow[ $id ] = openstation_my_wordpress_user_summary_payload( $id );
		}

		$this->reset_prime_cache();
		openstation_my_wordpress_user_summary_prime( $ids );

		$fast = array();
		foreach ( $ids as $id ) {
			$fast[ $id ] = openstation_my_wordpress_user_summary_payload( $id );
		}

		$this->assertSame( $slow, $fast );
	}

	/**
	 * The reason the prefetch exists. Two grouped queries for the
	 * whole page, not two per row.
	 *
	 * @covers ::openstation_my_wordpress_user_summary_prime
	 */
	public function test_priming_a_page_costs_the_same_as_priming_one_row() {
		global $wpdb;

		// Measured as "does the cost scale with the row count" rather
		// than against a fixed number: the queries themselves are two,
		// but the first `mysql2date()` of the process can warm an
		// option, and pinning an absolute total would make this test
		// about that instead.
		$one = self::factory()->user->create();
		self::factory()->post->create(
			array(
				'post_author' => $one,
				'post_status' => 'publish',
			)
		);

		$before = $wpdb->num_queries;
		openstation_my_wordpress_user_summary_prime( array( $one ) );
		$single = $wpdb->num_queries - $before;

		$many = array();
		for ( $i = 0; $i < 20; $i++ ) {
			$id     = self::factory()->user->create();
			$many[] = $id;
			self::factory()->post->create(
				array(
					'post_author' => $id,
					'post_status' => 'publish',
				)
			);
		}

		$before = $wpdb->num_queries;
		openstation_my_wordpress_user_summary_prime( $many );
		$batch = $wpdb->num_queries - $before;

		$this->assertLessThanOrEqual(
			$single,
			$batch,
			'the prefetch must be grouped — 20 rows cost no more than one'
		);

		// And the rows themselves are then free of the two lookups.
		// `get_userdata()` may still hit the DB on a cold cache, so
		// the bound is generous and still far below the 2-per-row it
		// replaces.
		$before = $wpdb->num_queries;
		foreach ( $many as $id ) {
			openstation_my_wordpress_user_summary_payload( $id );
		}
		$this->assertLessThan(
			2 * count( $many ),
			$wpdb->num_queries - $before,
			'primed rows should not be re-querying post counts'
		);
	}

	/**
	 * A second prime for ids already held must not re-query them —
	 * otherwise paging back and forth silently pays again.
	 *
	 * @covers ::openstation_my_wordpress_user_summary_prime
	 */
	public function test_priming_the_same_ids_twice_queries_once() {
		global $wpdb;

		openstation_my_wordpress_user_summary_prime( array( self::$author_id ) );

		$before = $wpdb->num_queries;
		openstation_my_wordpress_user_summary_prime( array( self::$author_id ) );

		$this->assertSame( $before, $wpdb->num_queries );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_summary_prime
	 */
	public function test_priming_nothing_is_a_no_op() {
		global $wpdb;

		$before = $wpdb->num_queries;
		openstation_my_wordpress_user_summary_prime( array() );
		openstation_my_wordpress_user_summary_prime( array( 0, -3 ) );

		$this->assertSame( $before, $wpdb->num_queries );
	}

	/**
	 * The private half of the payload is capability-gated, and the
	 * prefetch must not have become a way around that: it carries
	 * counts and dates only.
	 *
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_a_subscriber_sees_counts_but_not_roles_or_registration() {
		openstation_my_wordpress_user_summary_prime( array( self::$author_id ) );
		wp_set_current_user( self::$quiet_id );

		$summary = openstation_my_wordpress_user_summary_payload( self::$author_id );

		$this->assertSame( 2, $summary['postCount'] );
		$this->assertSame( array(), $summary['roleLabels'] );
		$this->assertSame( '', $summary['registered'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_an_administrator_sees_the_private_half() {
		$summary = openstation_my_wordpress_user_summary_payload( self::$author_id );

		$this->assertNotEmpty( $summary['roleLabels'] );
		$this->assertNotSame( '', $summary['registered'] );
	}

	/**
	 * @covers ::openstation_my_wordpress_user_summary_payload
	 */
	public function test_a_user_who_does_not_exist_returns_the_empty_shape() {
		$summary = openstation_my_wordpress_user_summary_payload( 999999 );

		$this->assertSame(
			array(
				'postCount'  => 0,
				'roleLabels' => array(),
				'registered' => '',
				'lastActive' => '',
			),
			$summary
		);
	}
}
