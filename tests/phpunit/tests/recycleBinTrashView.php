<?php
/**
 * Tests for Trash bin view polish:
 *
 *   - URL placements (file_type='link') carry a dedicated 'URL' badge
 *     label (issue 1).
 *   - Media attachments follow vanilla WP behavior — they permanent-
 *     delete on first call and do NOT route through Trash by default
 *     (issue 2). Sites that want media-in-trash opt in via
 *     `define( 'MEDIA_TRASH', true )` in `wp-config.php`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-recycle-bin
 */
class Tests_DesktopMode_RecycleBinTrashView extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		desktop_mode_files_install_schema();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $wpdb;
		$tables = desktop_mode_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	/**
	 * Issue 1: a trashed link placement reports `type_label = 'URL'` so
	 * the JS badge reads "URL" instead of the generic "Placement".
	 *
	 * @covers ::desktop_mode_files_list_trashed_for_recycle_bin
	 */
	public function test_link_placement_carries_url_type_label() {
		$placement_id = $this->create_placement( 'link', 'https://example.com/' );
		desktop_mode_files_trash_placement( self::$admin_id, $placement_id );

		$items = desktop_mode_files_list_trashed_for_recycle_bin( self::$admin_id );

		$item = $this->find_by_id( $items, $placement_id );
		$this->assertNotNull( $item, 'Trashed link placement should appear in the list.' );
		$this->assertSame( 'placement', $item['type'], 'Bucket stays "placement" so filters keep working.' );
		$this->assertArrayHasKey( 'type_label', $item );
		$this->assertSame( 'URL', $item['type_label'] );
	}

	/**
	 * Issue 1 — counter-test: non-link placements don't get the URL
	 * label so they fall back to the JS-side humanized bucket.
	 *
	 * @covers ::desktop_mode_files_list_trashed_for_recycle_bin
	 */
	public function test_non_link_placement_has_no_url_type_label() {
		$post_id      = self::factory()->post->create();
		$placement_id = $this->create_placement( 'post', (string) $post_id );
		desktop_mode_files_trash_placement( self::$admin_id, $placement_id );

		$items = desktop_mode_files_list_trashed_for_recycle_bin( self::$admin_id );

		$item = $this->find_by_id( $items, $placement_id );
		$this->assertNotNull( $item );
		$this->assertSame( 'placement', $item['type'] );
		$this->assertArrayNotHasKey( 'type_label', $item, 'Only link placements opt into the bespoke label.' );
	}

	/**
	 * Issue 2: with the `pre_delete_attachment` interception removed,
	 * deleting an attachment via `wp_delete_attachment()` follows
	 * vanilla WP — the post is permanently deleted on first call,
	 * not routed to Trash. The Recycle Bin only surfaces attachments
	 * that were trashed through some other path (REST, programmatic
	 * `wp_trash_post`, MEDIA_TRASH enabled).
	 */
	public function test_attachment_delete_does_not_route_through_trash_by_default() {
		$zip_id = self::factory()->attachment->create_object(
			'/tmp/akismet.zip',
			0,
			array(
				'post_mime_type' => 'application/zip',
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
			)
		);
		$image_id = self::factory()->attachment->create_object(
			'/tmp/photo.jpg',
			0,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
			)
		);

		wp_delete_attachment( $zip_id );
		wp_delete_attachment( $image_id );

		$this->assertNull( get_post( $zip_id ), '.zip should permanent-delete on first call.' );
		$this->assertNull( get_post( $image_id ), 'Image should permanent-delete on first call.' );
	}

	/**
	 * Posts still go through Trash via core's default behavior — the
	 * removal of the attachment-specific interception must not affect
	 * the non-attachment trash flow.
	 */
	public function test_posts_still_route_through_trash() {
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'publish' )
		);

		wp_delete_post( $post_id );

		$post = get_post( $post_id );
		$this->assertNotNull( $post );
		$this->assertSame( 'trash', $post->post_status );
	}

	private function create_placement( string $file_type, string $file_ref ): int {
		global $wpdb;
		$tables = desktop_mode_files_table_names();
		$now_ms = (int) round( microtime( true ) * 1000 );
		$wpdb->insert(
			$tables['placements'],
			array(
				'user_id'       => self::$admin_id,
				'parent_id'     => 0,
				'file_type'     => $file_type,
				'file_ref'      => $file_ref,
				'x'             => 0,
				'y'             => 0,
				'sort_order'    => 0,
				'updated_at_ms' => $now_ms,
			)
		);
		return (int) $wpdb->insert_id;
	}

	private function find_by_id( array $items, int $id ): ?array {
		foreach ( $items as $item ) {
			if ( (int) $item['id'] === $id ) {
				return $item;
			}
		}
		return null;
	}
}
