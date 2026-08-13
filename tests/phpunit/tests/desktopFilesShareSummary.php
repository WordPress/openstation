<?php
/**
 * Tests for what a folder tile on the desktop can actually see about
 * its own sharing.
 *
 * Two gaps this pins shut, both of which made a working server-side
 * feature invisible in the UI:
 *
 *   1. `shareSummary` existed only on the folder response shape. A
 *      desktop tile is rendered from a PLACEMENT, whose `file` comes
 *      from `OpenStation_Folder_File::serialize()` — so the shared
 *      badge read a key that was never on the wire, and an accepted
 *      share showed up for nobody.
 *   2. Nothing filled the client's folders map on a normal boot, so
 *      folder ownership was unknown after a plain reload and the
 *      owner-only "Share folder" title-bar button never matched. The
 *      rows now ride the shell config as `filesBootFolders`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-files
 */
class Tests_OpenStation_FilesShareSummary extends WP_UnitTestCase {

	protected static $owner_id;
	protected static $editor_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$owner_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
	}

	public function tear_down() {
		global $wpdb;
		foreach ( openstation_files_table_names() as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		parent::tear_down();
	}

	/** Serialize a folder the way a desktop placement's `file` is built. */
	private function file_shape( $folder_id ) {
		$file = openstation_resolve_file( 'folder', (string) $folder_id );
		$this->assertNotNull( $file, 'The folder file type must resolve.' );
		return $file->serialize();
	}

	/** Invite the editor to a folder and accept, returning the folder id. */
	private function shared_folder() {
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Shared' ) );
		$share  = openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );
		openstation_folder_share_accept( $share, self::$editor_id );
		return $folder;
	}

	// ---------------------------------------------------------------
	// shareSummary on the placement's file shape
	// ---------------------------------------------------------------

	/**
	 * The reported bug: the tile renderer reads
	 * `placement.file.shareSummary`, and a folder placement carried
	 * no such key, so an accepted share was invisible on the desktop.
	 *
	 * @covers OpenStation_Folder_File::serialize
	 */
	public function test_folder_file_shape_carries_the_share_summary() {
		wp_set_current_user( self::$owner_id );
		$folder = $this->shared_folder();

		$shape = $this->file_shape( $folder );
		$this->assertArrayHasKey( 'shareSummary', $shape );
		$this->assertTrue( $shape['shareSummary']['shared'] );
	}

	/**
	 * Both sides of an accepted share must be able to tell the folder
	 * is shared — the recipient sees the same tile on their own
	 * desktop, rendered from their own placement.
	 *
	 * @covers OpenStation_Folder_File::serialize
	 */
	public function test_recipient_also_sees_the_shared_flag() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$editor_id );
		$shape = $this->file_shape( $folder );
		$this->assertTrue( $shape['shareSummary']['shared'] );
	}

	/**
	 * The recipient roster is owner-internal. `shared` is not.
	 *
	 * @covers ::openstation_files_folder_share_summary
	 */
	public function test_recipient_count_is_owner_only() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$owner_id );
		$this->assertSame( 1, $this->file_shape( $folder )['shareSummary']['recipientCount'] );

		wp_set_current_user( self::$editor_id );
		$this->assertSame( 0, $this->file_shape( $folder )['shareSummary']['recipientCount'] );
	}

	/**
	 * A pending invitation is not a share yet — no badge until the
	 * recipient accepts.
	 *
	 * @covers ::openstation_files_folder_share_summary
	 */
	public function test_pending_invitation_is_not_shared_yet() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Pending' ) );
		openstation_folder_share_invite( $folder, self::$owner_id, 'user', (string) self::$editor_id, 'read' );

		$this->assertFalse( $this->file_shape( $folder )['shareSummary']['shared'] );
	}

	/**
	 * @covers ::openstation_files_folder_share_summary
	 */
	public function test_private_folder_is_not_shared() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$summary = $this->file_shape( $folder )['shareSummary'];
		$this->assertFalse( $summary['shared'] );
		$this->assertSame( 0, $summary['recipientCount'] );
	}

	/**
	 * `share_mode = 'all'` shares with everyone without producing a
	 * single share row, so it must count on its own.
	 *
	 * @covers ::openstation_files_folder_share_summary
	 */
	public function test_share_mode_all_counts_as_shared() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder(
			self::$owner_id,
			array(
				'name'       => 'Everyone',
				'share_mode' => 'all',
			)
		);

		$this->assertTrue( $this->file_shape( $folder )['shareSummary']['shared'] );
	}

	/**
	 * The folder response and the placement's file shape must agree —
	 * a tile should paint the same badge whichever one it was
	 * rendered from. That agreement is the whole reason the summary
	 * moved into one shared helper.
	 *
	 * @covers ::openstation_files_shape_folder
	 * @covers OpenStation_Folder_File::serialize
	 */
	public function test_folder_response_and_placement_shape_agree() {
		wp_set_current_user( self::$owner_id );
		$folder = $this->shared_folder();

		$from_folder_route = openstation_files_shape_folder(
			openstation_files_get_folder( $folder )
		);
		$from_placement = $this->file_shape( $folder );

		$this->assertSame(
			$from_folder_route['shareSummary'],
			$from_placement['shareSummary']
		);
	}

	// ---------------------------------------------------------------
	// Boot-inlined folders
	// ---------------------------------------------------------------

	/**
	 * The owner's folders must reach the shell config, because the
	 * client's folders map is where the "Share folder" title-bar
	 * button looks up ownership — and after a plain reload nothing
	 * else filled it.
	 *
	 * @covers ::openstation_files_inject_boot_folders
	 */
	public function test_boot_config_carries_the_viewers_folders() {
		wp_set_current_user( self::$owner_id );
		$folder = openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$config = openstation_files_inject_boot_folders( array() );
		$this->assertArrayHasKey( 'filesBootFolders', $config );

		$ids = wp_list_pluck( $config['filesBootFolders'], 'id' );
		$this->assertContains( $folder, $ids );
	}

	/**
	 * Ownership is the field the button gate reads, so it has to be
	 * on the boot shape — not just the id.
	 *
	 * @covers ::openstation_files_inject_boot_folders
	 */
	public function test_boot_folders_carry_owner_id() {
		wp_set_current_user( self::$owner_id );
		openstation_files_create_folder( self::$owner_id, array( 'name' => 'Mine' ) );

		$folders = openstation_files_inject_boot_folders( array() )['filesBootFolders'];
		$this->assertNotEmpty( $folders );
		foreach ( $folders as $f ) {
			$this->assertSame( self::$owner_id, $f['ownerId'] );
		}
	}

	/**
	 * A recipient's boot config must include the folder shared with
	 * them — they open the same window, and the button gate has to
	 * be able to tell that they are NOT the owner rather than simply
	 * not knowing.
	 *
	 * @covers ::openstation_files_inject_boot_folders
	 */
	public function test_boot_folders_include_accepted_shares_for_the_recipient() {
		$folder = $this->shared_folder();

		wp_set_current_user( self::$editor_id );
		$folders = openstation_files_inject_boot_folders( array() )['filesBootFolders'];

		$ids = wp_list_pluck( $folders, 'id' );
		$this->assertContains( $folder, $ids );

		$matched = array_values(
			array_filter( $folders, static fn( $f ) => (int) $f['id'] === (int) $folder )
		);
		$this->assertSame(
			self::$owner_id,
			$matched[0]['ownerId'],
			'The recipient must see the real owner, not themselves.'
		);
	}

	/**
	 * Logged out, there is nothing to inline and nothing to leak.
	 *
	 * @covers ::openstation_files_inject_boot_folders
	 */
	public function test_boot_folders_absent_for_anonymous_requests() {
		wp_set_current_user( 0 );
		$this->assertArrayNotHasKey(
			'filesBootFolders',
			openstation_files_inject_boot_folders( array() )
		);
	}
}
