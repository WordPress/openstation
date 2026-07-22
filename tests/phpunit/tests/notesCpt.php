<?php
/**
 * Tests for the pinned-notes CPT registration + sanitizers.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-notes
 */
class Tests_DesktopMode_NotesCpt extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		remove_all_filters( 'desktop_mode_notes_colors' );
	}

	public function tear_down() {
		remove_all_filters( 'desktop_mode_notes_colors' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_notes_register_cpt
	 */
	public function test_cpt_is_registered_and_fully_non_public() {
		$this->assertTrue( post_type_exists( DESKTOP_MODE_NOTES_POST_TYPE ) );
		$type = get_post_type_object( DESKTOP_MODE_NOTES_POST_TYPE );
		$this->assertFalse( $type->public );
		$this->assertFalse( $type->publicly_queryable );
		$this->assertTrue( $type->exclude_from_search );
		$this->assertFalse( $type->show_ui );
		$this->assertFalse( $type->show_in_rest );
		$this->assertTrue( $type->delete_with_user );
	}

	/**
	 * @covers ::desktop_mode_notes_colors
	 */
	public function test_default_palette_has_six_pastels() {
		$this->assertSame(
			array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' ),
			desktop_mode_notes_colors()
		);
	}

	/**
	 * @covers ::desktop_mode_notes_colors
	 */
	public function test_palette_is_filterable_and_sanitized() {
		add_filter(
			'desktop_mode_notes_colors',
			static function ( $colors ) {
				$colors[] = 'Corporate Beige!'; // sanitize_key → corporatebeige.
				$colors[] = '';
				return $colors;
			}
		);
		$colors = desktop_mode_notes_colors();
		$this->assertContains( 'corporatebeige', $colors );
		$this->assertNotContains( '', $colors );
	}

	/**
	 * @covers ::desktop_mode_notes_sanitize_color
	 */
	public function test_color_sanitizer_whitelists() {
		$this->assertSame( 'mint', desktop_mode_notes_sanitize_color( 'mint' ) );
		$this->assertSame( 'butter', desktop_mode_notes_sanitize_color( 'chartreuse' ) );
		$this->assertSame( 'butter', desktop_mode_notes_sanitize_color( '' ) );
		$this->assertSame( 'butter', desktop_mode_notes_sanitize_color( array( 'mint' ) ) );
	}

	/**
	 * @covers ::desktop_mode_notes_sanitize_fraction
	 */
	public function test_fraction_sanitizer_clamps_to_unit_range() {
		$this->assertSame( 0.5, desktop_mode_notes_sanitize_fraction( 0.5 ) );
		$this->assertSame( 0.0, desktop_mode_notes_sanitize_fraction( -3 ) );
		$this->assertSame( 1.0, desktop_mode_notes_sanitize_fraction( 42 ) );
		$this->assertSame( 0.0, desktop_mode_notes_sanitize_fraction( 'not-a-number' ) );
	}

	/**
	 * @covers ::desktop_mode_notes_untrash_status
	 */
	public function test_untrash_restores_publish_status() {
		$note_id = wp_insert_post(
			array(
				'post_type'    => DESKTOP_MODE_NOTES_POST_TYPE,
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
	 * @covers ::desktop_mode_notes_untrash_status
	 */
	public function test_untrash_restores_private_status() {
		$note_id = wp_insert_post(
			array(
				'post_type'    => DESKTOP_MODE_NOTES_POST_TYPE,
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
	 * @covers ::desktop_mode_notes_untrash_status
	 */
	public function test_untrash_leaves_other_post_types_alone() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_trash_post( $post_id );
		wp_untrash_post( $post_id );
		// Core default: untrashed regular posts land on 'draft'.
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}
}
