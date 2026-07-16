<?php
/**
 * Tests for trashed notes (and custom post types generally) surfacing
 * in the Recycle Bin.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-notes
 */
class Tests_DesktopMode_NotesRecycleBin extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $admin_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		foreach ( array( self::$owner_id, self::$admin_id, self::$subscriber_id ) as $user_id ) {
			update_user_meta( $user_id, 'desktop_mode_mode', '1' );
		}
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$owner_id );
	}

	public function tear_down() {
		_unregister_post_type( 'wpd_test_book' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	private function create_trashed_note( $author_id, $text = 'trash me' ) {
		$note_id = wp_insert_post(
			array(
				'post_type'    => DESKTOP_MODE_NOTES_POST_TYPE,
				'post_status'  => 'private',
				'post_author'  => $author_id,
				'post_title'   => $text,
				'post_content' => $text,
			)
		);
		wp_trash_post( $note_id );
		return $note_id;
	}

	/**
	 * @covers ::desktop_mode_recycle_bin_capture_post_types
	 */
	public function test_show_ui_custom_post_types_are_captured_by_default() {
		register_post_type(
			'wpd_test_book',
			array(
				'public'    => true,
				'show_ui'   => true,
				'label'     => 'Books',
				'menu_icon' => 'dashicons-book',
			)
		);
		$types = desktop_mode_recycle_bin_capture_post_types();
		$this->assertContains( 'wpd_test_book', $types );
		// The notes CPT is headless but opted in by its own feature.
		$this->assertContains( DESKTOP_MODE_NOTES_POST_TYPE, $types );
		// Builtin utility types never leak in.
		$this->assertNotContains( 'revision', $types );
		$this->assertNotContains( 'wp_block', $types );
	}

	/**
	 * @covers ::desktop_mode_recycle_bin_shape_item
	 */
	public function test_custom_post_type_rows_use_their_menu_dashicon() {
		register_post_type(
			'wpd_test_book',
			array(
				'public'    => true,
				'show_ui'   => true,
				'labels'    => array( 'singular_name' => 'Book' ),
				'menu_icon' => 'dashicons-book',
			)
		);
		$book_id = wp_insert_post(
			array(
				'post_type'    => 'wpd_test_book',
				'post_status'  => 'publish',
				'post_author'  => self::$owner_id,
				'post_title'   => 'Moby Dick',
				'post_content' => 'Call me Ishmael.',
			)
		);
		wp_trash_post( $book_id );

		$item = desktop_mode_recycle_bin_shape_item( get_post( $book_id ) );
		$this->assertSame( 'dashicons-book', $item['icon'] );
		$this->assertSame( 'Book', $item['type_label'] );
		$this->assertSame( 'Call me Ishmael.', $item['subtitle'] );
	}

	/**
	 * @covers ::desktop_mode_notes_recycle_bin_gate
	 */
	public function test_owner_sees_their_trashed_note_in_the_bin() {
		$note_id = $this->create_trashed_note( self::$owner_id, 'my trashed note' );

		$result = desktop_mode_recycle_bin_get_items();
		$ids    = wp_list_pluck( $result['items'], 'id' );
		$this->assertContains( $note_id, $ids );

		foreach ( $result['items'] as $item ) {
			if ( $item['id'] === $note_id ) {
				$this->assertSame( 'Note', $item['type_label'] );
				$this->assertSame( 'dashicons-sticky', $item['icon'] );
				$this->assertSame( 'my trashed note', $item['subtitle'] );
				$this->assertTrue( $item['can_restore'] );
				$this->assertTrue( $item['can_purge'] );
			}
		}
	}

	/**
	 * @covers ::desktop_mode_notes_recycle_bin_gate
	 */
	public function test_admins_do_not_see_other_users_trashed_notes() {
		$note_id = $this->create_trashed_note( self::$owner_id, 'private business' );

		wp_set_current_user( self::$admin_id );
		$ids = wp_list_pluck( desktop_mode_recycle_bin_get_items()['items'], 'id' );
		$this->assertNotContains( $note_id, $ids );

		// Nor can they restore or purge it through the bin.
		$restore = desktop_mode_recycle_bin_restore( $note_id );
		$this->assertWPError( $restore );
		$purge = desktop_mode_recycle_bin_purge( $note_id );
		$this->assertWPError( $purge );
		$this->assertSame( 'trash', get_post_status( $note_id ) );
	}

	/**
	 * @covers ::desktop_mode_notes_recycle_bin_gate
	 */
	public function test_subscribers_manage_their_own_trashed_notes() {
		$note_id = $this->create_trashed_note( self::$subscriber_id, 'subscriber note' );

		wp_set_current_user( self::$subscriber_id );
		$ids = wp_list_pluck( desktop_mode_recycle_bin_get_items()['items'], 'id' );
		$this->assertContains( $note_id, $ids, 'Owners see their notes even without edit_posts caps.' );

		$this->assertTrue( desktop_mode_recycle_bin_restore( $note_id ) );
		$this->assertSame( 'private', get_post_status( $note_id ) );
	}

	/**
	 * @covers ::desktop_mode_recycle_bin_restore
	 */
	public function test_bin_restore_returns_a_public_note_to_publish() {
		$note_id = wp_insert_post(
			array(
				'post_type'    => DESKTOP_MODE_NOTES_POST_TYPE,
				'post_status'  => 'publish',
				'post_author'  => self::$owner_id,
				'post_title'   => 'shared',
				'post_content' => 'shared',
			)
		);
		wp_trash_post( $note_id );

		$this->assertTrue( desktop_mode_recycle_bin_restore( $note_id ) );
		$this->assertSame( 'publish', get_post_status( $note_id ) );
	}

	/**
	 * @covers ::desktop_mode_notes_recycle_bin_count
	 */
	public function test_badge_count_scopes_notes_to_the_owner() {
		$this->create_trashed_note( self::$owner_id );
		$this->create_trashed_note( self::$subscriber_id );

		// The admin holds edit_others_posts: the generic bucket counts
		// BOTH notes; the adjustment keeps only their own (zero here).
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 0, desktop_mode_recycle_bin_count() );

		// The subscriber holds no edit caps: the generic bucket counts
		// nothing; the adjustment adds their own note back.
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 1, desktop_mode_recycle_bin_count() );

		// The owner (editor, edit_others_posts) sees exactly their own.
		wp_set_current_user( self::$owner_id );
		$this->assertSame( 1, desktop_mode_recycle_bin_count() );
	}
}
