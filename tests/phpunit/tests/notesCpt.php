<?php
/**
 * Tests for the pinned-notes CPT registration + sanitizers.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-notes
 */
class Tests_OpenStation_NotesCpt extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		remove_all_filters( 'open_station_notes_colors' );
	}

	public function tear_down() {
		remove_all_filters( 'open_station_notes_colors' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_notes_register_cpt
	 */
	public function test_cpt_is_registered_and_fully_non_public() {
		$this->assertTrue( post_type_exists( OPEN_STATION_NOTES_POST_TYPE ) );
		$type = get_post_type_object( OPEN_STATION_NOTES_POST_TYPE );
		$this->assertFalse( $type->public );
		$this->assertFalse( $type->publicly_queryable );
		$this->assertTrue( $type->exclude_from_search );
		$this->assertFalse( $type->show_ui );
		$this->assertFalse( $type->show_in_rest );
		$this->assertTrue( $type->delete_with_user );
	}

	/**
	 * @covers ::open_station_notes_colors
	 */
	public function test_default_palette_has_six_pastels() {
		$this->assertSame(
			array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' ),
			open_station_notes_colors()
		);
	}

	/**
	 * @covers ::open_station_notes_colors
	 */
	public function test_palette_is_filterable_and_sanitized() {
		add_filter(
			'open_station_notes_colors',
			static function ( $colors ) {
				$colors[] = 'Corporate Beige!'; // sanitize_key → corporatebeige.
				$colors[] = '';
				return $colors;
			}
		);
		$colors = open_station_notes_colors();
		$this->assertContains( 'corporatebeige', $colors );
		$this->assertNotContains( '', $colors );
	}

	/**
	 * @covers ::open_station_notes_sanitize_color
	 */
	public function test_color_sanitizer_whitelists() {
		$this->assertSame( 'mint', open_station_notes_sanitize_color( 'mint' ) );
		$this->assertSame( 'butter', open_station_notes_sanitize_color( 'chartreuse' ) );
		$this->assertSame( 'butter', open_station_notes_sanitize_color( '' ) );
		$this->assertSame( 'butter', open_station_notes_sanitize_color( array( 'mint' ) ) );
	}

	/**
	 * @covers ::open_station_notes_sanitize_fraction
	 */
	public function test_fraction_sanitizer_clamps_to_unit_range() {
		$this->assertSame( 0.5, open_station_notes_sanitize_fraction( 0.5 ) );
		$this->assertSame( 0.0, open_station_notes_sanitize_fraction( -3 ) );
		$this->assertSame( 1.0, open_station_notes_sanitize_fraction( 42 ) );
		$this->assertSame( 0.0, open_station_notes_sanitize_fraction( 'not-a-number' ) );
	}

	/**
	 * @covers ::open_station_notes_untrash_status
	 */
	public function test_untrash_restores_publish_status() {
		$note_id = wp_insert_post(
			array(
				'post_type'    => OPEN_STATION_NOTES_POST_TYPE,
				'post_status'  => 'publish',
				'post_author'  => self::$user_id,
				'post_title'   => 'Public note',
				'post_content' => 'Shared with everyone',
			)
		);
		wp_trash_post( $note_id );
		$this->assertSame( 'trash', get_post_status( $note_id ) );
		wp_untrash_post( $note_id );
		$this->assertSame( 'publish', get_post_status( $note_id ) );
	}

	/**
	 * @covers ::open_station_notes_untrash_status
	 */
	public function test_untrash_restores_private_status() {
		$note_id = wp_insert_post(
			array(
				'post_type'    => OPEN_STATION_NOTES_POST_TYPE,
				'post_status'  => 'private',
				'post_author'  => self::$user_id,
				'post_title'   => 'Private note',
				'post_content' => 'Mine',
			)
		);
		wp_trash_post( $note_id );
		wp_untrash_post( $note_id );
		$this->assertSame( 'private', get_post_status( $note_id ) );
	}

	/**
	 * @covers ::open_station_notes_untrash_status
	 */
	public function test_untrash_leaves_other_post_types_alone() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_trash_post( $post_id );
		wp_untrash_post( $post_id );
		// Core default: untrashed regular posts land on 'draft'.
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}
}
