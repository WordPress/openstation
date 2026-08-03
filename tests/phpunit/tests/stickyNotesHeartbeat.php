<?php
/**
 * Tests for Gutenberg sticky notes over the OpenStation Heartbeat bus.
 *
 * @group openstation
 * @group os-sticky-notes
 */
class Tests_OpenStation_StickyNotesHeartbeat extends WP_UnitTestCase {

	protected static $user_id;
	protected $sticky_term_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		$this->register_guidelines_surface();
		$this->sticky_term_id = $this->ensure_term( 'sticky', 'Sticky' );
	}

	public function tear_down() {
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_sticky_notes_compute_heartbeat_delta
	 * @covers ::open_station_sticky_notes_shape_guideline
	 */
	public function test_delta_returns_changed_private_sticky_guidelines() {
		$sticky_id = $this->create_guideline(
			array(
				'post_title'   => 'Remember',
				'post_content' => 'Do the thing',
				'terms'        => array( $this->sticky_term_id ),
			)
		);
		$this->create_guideline(
			array(
				'post_title' => 'Not sticky',
				'terms'      => array(),
			)
		);

		$delta = open_station_sticky_notes_compute_heartbeat_delta(
			$this->sticky_term_id,
			array(),
			0,
			100
		);

		$this->assertCount( 1, $delta['notes'] );
		$this->assertSame( $sticky_id, $delta['notes'][0]['id'] );
		$this->assertSame( 'Remember', $delta['notes'][0]['title']['raw'] );
		$this->assertSame( 'Do the thing', $delta['notes'][0]['content']['raw'] );
		$this->assertContains( $this->sticky_term_id, $delta['notes'][0]['wp_guideline_type'] );
		$this->assertGreaterThan( 0, $delta['notes'][0]['open_station_modified_ms'] );
		$this->assertSame( array(), $delta['removed'] );
	}

	/**
	 * @covers ::open_station_sticky_notes_compute_heartbeat_delta
	 * @covers ::open_station_sticky_notes_alive_known_ids
	 */
	public function test_delta_reports_known_ids_that_are_no_longer_stickies_as_removed() {
		$sticky_id = $this->create_guideline(
			array(
				'post_title' => 'Alive sticky',
				'terms'      => array( $this->sticky_term_id ),
			)
		);
		$plain_id  = $this->create_guideline(
			array(
				'post_title' => 'Plain guideline',
				'terms'      => array(),
			)
		);

		$delta = open_station_sticky_notes_compute_heartbeat_delta(
			$this->sticky_term_id,
			array( $sticky_id, $plain_id, 999999 ),
			0,
			100
		);

		$this->assertContains( $plain_id, $delta['removed'] );
		$this->assertContains( 999999, $delta['removed'] );
		$this->assertNotContains( $sticky_id, $delta['removed'] );
	}

	/**
	 * @covers ::open_station_sticky_notes_heartbeat_received
	 */
	public function test_heartbeat_handler_uses_subscription_payload() {
		$sticky_id = $this->create_guideline(
			array(
				'post_title' => 'Heartbeat sticky',
				'terms'      => array( $this->sticky_term_id ),
			)
		);

		$response = open_station_sticky_notes_heartbeat_received(
			array( 'other' => 'untouched' ),
			array(
				'open_station_sticky_notes_subscribe' => array(
					'stickyTermId' => $this->sticky_term_id,
					'knownIds'     => array(),
					'version'      => 0,
				),
			)
		);

		$this->assertSame( 'untouched', $response['other'] );
		$this->assertArrayHasKey( 'open_station_sticky_notes', $response );
		$this->assertSame( $sticky_id, $response['open_station_sticky_notes']['notes'][0]['id'] );
	}

	/**
	 * @covers ::open_station_sticky_notes_heartbeat_received
	 */
	public function test_filter_is_registered_on_heartbeat_received() {
		$this->assertNotFalse(
			has_filter(
				'heartbeat_received',
				'open_station_sticky_notes_heartbeat_received'
			),
			'Sticky notes should hook the shared Heartbeat response.'
		);
	}

	/**
	 * @covers ::open_station_sticky_notes_is_available
	 */
	public function test_is_available_when_guidelines_surface_is_registered() {
		$this->assertTrue( open_station_sticky_notes_is_available() );
	}

	/**
	 * @covers ::open_station_sticky_notes_is_available
	 */
	public function test_is_not_available_without_the_guidelines_taxonomy() {
		unregister_taxonomy( OPEN_STATION_STICKY_NOTES_TAXONOMY );

		$this->assertFalse( open_station_sticky_notes_is_available() );
	}

	/**
	 * @covers ::open_station_sticky_notes_is_available
	 */
	public function test_availability_can_be_forced_off_by_filter() {
		add_filter( 'open_station_sticky_notes_available', '__return_false' );

		$this->assertFalse(
			open_station_sticky_notes_is_available(),
			'The open_station_sticky_notes_available filter should be able to force the surface off.'
		);
	}

	/**
	 * @covers ::open_station_sticky_notes_heartbeat_received
	 * @covers ::open_station_sticky_notes_is_available
	 */
	public function test_heartbeat_skips_delta_when_surface_is_unavailable() {
		unregister_taxonomy( OPEN_STATION_STICKY_NOTES_TAXONOMY );

		$response = open_station_sticky_notes_heartbeat_received(
			array( 'other' => 'untouched' ),
			array(
				'open_station_sticky_notes_subscribe' => array(
					'stickyTermId' => 123,
					'knownIds'     => array(),
					'version'      => 0,
				),
			)
		);

		$this->assertSame( 'untouched', $response['other'] );
		$this->assertArrayNotHasKey(
			'open_station_sticky_notes',
			$response,
			'No sticky delta should be computed when the Guidelines surface is absent.'
		);
	}

	protected function register_guidelines_surface() {
		if ( ! post_type_exists( OPEN_STATION_STICKY_NOTES_POST_TYPE ) ) {
			register_post_type(
				OPEN_STATION_STICKY_NOTES_POST_TYPE,
				array(
					'public'       => false,
					'show_in_rest' => true,
					'supports'     => array( 'title', 'editor', 'excerpt' ),
				)
			);
		}
		if ( ! taxonomy_exists( OPEN_STATION_STICKY_NOTES_TAXONOMY ) ) {
			register_taxonomy(
				OPEN_STATION_STICKY_NOTES_TAXONOMY,
				OPEN_STATION_STICKY_NOTES_POST_TYPE,
				array(
					'hierarchical' => true,
					'show_in_rest' => true,
				)
			);
		}
	}

	protected function ensure_term( $slug, $name ) {
		$existing = get_term_by( 'slug', $slug, OPEN_STATION_STICKY_NOTES_TAXONOMY );
		if ( $existing ) {
			return (int) $existing->term_id;
		}
		$term = wp_insert_term(
			$name,
			OPEN_STATION_STICKY_NOTES_TAXONOMY,
			array( 'slug' => $slug )
		);
		return (int) $term['term_id'];
	}

	protected function create_guideline( $args = array() ) {
		$post_id = self::factory()->post->create(
			array(
				'post_type'    => OPEN_STATION_STICKY_NOTES_POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => isset( $args['post_title'] ) ? $args['post_title'] : 'Guideline',
				'post_content' => isset( $args['post_content'] ) ? $args['post_content'] : '',
			)
		);
		if ( ! empty( $args['terms'] ) ) {
			wp_set_object_terms(
				$post_id,
				array_map( 'intval', (array) $args['terms'] ),
				OPEN_STATION_STICKY_NOTES_TAXONOMY
			);
		}
		return (int) $post_id;
	}
}
