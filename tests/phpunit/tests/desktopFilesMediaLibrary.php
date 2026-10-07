<?php

class Tests_OpenStation_MediaLibrary extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $subscriber_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		openstation_files_install_schema();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		global $wpdb;

		$attachments = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		foreach ( $attachments as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
		$tables = openstation_files_table_names();
		foreach ( $tables as $t ) {
			$wpdb->query( "TRUNCATE TABLE $t" );
		}
		$this->rrmdir( openstation_stored_files_dir() );
		remove_all_filters( 'openstation_stored_file_is_media' );
		remove_all_filters( 'openstation_stored_file_start_post_args' );
		parent::tear_down();
	}

	private function rrmdir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			if ( is_dir( $entry ) ) {
				$this->rrmdir( $entry );
			} else {
				unlink( $entry );
			}
		}
		foreach ( (array) glob( $dir . '/.htaccess' ) as $entry ) {
			unlink( $entry );
		}
		rmdir( $dir );
	}

	private function make_stored_file( $owner_id, $name, $contents, $mime ) {
		$dir = openstation_stored_files_ensure_dir( $owner_id );
		$this->assertIsString( $dir );
		$disk_name = wp_generate_uuid4();
		file_put_contents( $dir . '/' . $disk_name, $contents );
		$id = openstation_stored_files_create(
			$owner_id,
			array(
				'display_name' => $name,
				'disk_name'    => $disk_name,
				'size_bytes'   => strlen( $contents ),
				'mime'         => $mime,
			)
		);
		$this->assertIsInt( $id );
		return $id;
	}

	private function make_stored_image( $owner_id, $name = 'photo.jpg' ) {
		return $this->make_stored_file(
			$owner_id,
			$name,
			file_get_contents( DIR_TESTDATA . '/images/test-image.jpg' ),
			'image/jpeg'
		);
	}

	public function test_is_media_follows_the_upload_allow_list() {
		$this->assertTrue( openstation_stored_file_is_media( array( 'mime' => 'image/jpeg' ) ) );
		$this->assertTrue( openstation_stored_file_is_media( array( 'mime' => 'application/pdf' ) ) );
		$this->assertTrue( openstation_stored_file_is_media( array( 'mime' => 'text/plain' ) ) );
		$this->assertFalse( openstation_stored_file_is_media( array( 'mime' => 'application/x-msdownload' ) ) );
		$this->assertFalse( openstation_stored_file_is_media( array( 'mime' => '' ) ) );
		$this->assertFalse( openstation_stored_file_is_media( null ) );
	}

	public function test_is_media_is_filterable() {
		add_filter( 'openstation_stored_file_is_media', '__return_false' );
		$this->assertFalse( openstation_stored_file_is_media( array( 'mime' => 'image/jpeg' ) ) );
	}

	public function test_upload_shape_carries_is_media() {
		$image = $this->make_stored_image( self::$admin_id );
		$shape = openstation_resolve_file( 'upload', (string) $image )->serialize();
		$this->assertTrue( $shape['isMedia'] );

		$exe   = $this->make_stored_file( self::$admin_id, 'setup.exe', 'MZ', 'application/x-msdownload' );
		$shape = openstation_resolve_file( 'upload', (string) $exe )->serialize();
		$this->assertFalse( $shape['isMedia'] );
	}

	public function test_media_filename_derives_a_missing_extension() {
		$this->assertSame( 'photo.jpg', openstation_stored_file_media_filename( array( 'display_name' => 'photo.jpg', 'mime' => 'image/jpeg' ) ) );
		$this->assertSame( 'photo.jpg', openstation_stored_file_media_filename( array( 'display_name' => 'photo', 'mime' => 'image/jpeg' ) ) );
		$this->assertSame( 'file.pdf', openstation_stored_file_media_filename( array( 'display_name' => '', 'mime' => 'application/pdf' ) ) );
	}

	public function test_add_to_media_copies_the_bytes_and_leaves_the_source_alone() {
		$file_id = $this->make_stored_image( self::$admin_id );
		$row     = openstation_stored_files_get( $file_id );
		$source  = openstation_stored_file_path( $row );

		$fired = array();
		add_action(
			'openstation_stored_file_added_to_media',
			function ( $attachment_id, $stored_id, $user_id ) use ( &$fired ) {
				$fired[] = array( $attachment_id, $stored_id, $user_id );
			},
			10,
			3
		);

		$result = openstation_stored_file_to_attachment( $file_id, self::$admin_id );
		$this->assertNotWPError( $result );
		$this->assertTrue( $result['created'] );
		$attachment_id = $result['attachment_id'];

		$attachment = get_post( $attachment_id );
		$this->assertSame( 'attachment', $attachment->post_type );
		$this->assertSame( 'image/jpeg', $attachment->post_mime_type );
		$this->assertSame( self::$admin_id, (int) $attachment->post_author );
		$this->assertSame( (string) $file_id, get_post_meta( $attachment_id, '_openstation_stored_file_id', true ) );

		$copy = get_attached_file( $attachment_id );
		$this->assertFileExists( $copy );
		$this->assertFileExists( $source );
		$this->assertSame( md5_file( $source ), md5_file( $copy ) );
		$this->assertNotSame( $source, $copy );

		$this->assertNotEmpty( wp_get_attachment_metadata( $attachment_id ) );

		$this->assertSame( array( array( $attachment_id, $file_id, self::$admin_id ) ), $fired );
	}

	public function test_add_to_media_is_idempotent_per_stored_file() {
		$file_id = $this->make_stored_file( self::$admin_id, 'notes.txt', 'hello world', 'text/plain' );

		$first = openstation_stored_file_to_attachment( $file_id, self::$admin_id );
		$this->assertNotWPError( $first );
		$second = openstation_stored_file_to_attachment( $file_id, self::$admin_id );
		$this->assertNotWPError( $second );

		$this->assertSame( $first['attachment_id'], $second['attachment_id'] );
		$this->assertTrue( $first['created'] );
		$this->assertFalse( $second['created'] );
		$this->assertSame( 1, count( get_posts( array( 'post_type' => 'attachment', 'post_status' => 'inherit', 'fields' => 'ids' ) ) ) );

		update_post_meta( $first['attachment_id'], '_openstation_stored_file_key', wp_generate_uuid4() );
		$this->assertSame( 0, openstation_stored_file_find_attachment( openstation_stored_files_get( $file_id ) ) );
		update_post_meta( $first['attachment_id'], '_openstation_stored_file_key', openstation_stored_files_get( $file_id )['disk_name'] );

		wp_delete_attachment( $first['attachment_id'], true );
		$this->assertSame( 0, openstation_stored_file_find_attachment( openstation_stored_files_get( $file_id ) ) );
		$third = openstation_stored_file_to_attachment( $file_id, self::$admin_id );
		$this->assertNotWPError( $third );
		$this->assertTrue( $third['created'] );
		$this->assertNotSame( $first['attachment_id'], $third['attachment_id'] );
	}

	public function test_add_to_media_masks_files_the_user_cannot_read() {
		$file_id = $this->make_stored_image( self::$admin_id );
		$result  = openstation_stored_file_to_attachment( $file_id, self::$author_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_not_found', $result->get_error_code() );

		$result = openstation_stored_file_to_attachment( 999999, self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_files_not_found', $result->get_error_code() );
	}

	public function test_add_to_media_rejects_non_media() {
		$file_id = $this->make_stored_file( self::$admin_id, 'setup.exe', 'MZ', 'application/x-msdownload' );
		$result  = openstation_stored_file_to_attachment( $file_id, self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_not_media', $result->get_error_code() );
		$this->assertSame( 415, $result->get_error_data()['status'] );
	}

	public function test_start_post_creates_an_auto_draft_with_the_image_in_place() {
		$file_id = $this->make_stored_image( self::$admin_id );

		$fired = array();
		add_action(
			'openstation_stored_file_post_started',
			function ( $post_id, $attachment_id, $stored_id, $user_id ) use ( &$fired ) {
				$fired[] = array( $post_id, $attachment_id, $stored_id, $user_id );
			},
			10,
			4
		);

		$result = openstation_stored_file_start_post( $file_id, 'post', self::$admin_id );
		$this->assertNotWPError( $result );

		$post = get_post( $result['post_id'] );
		$this->assertSame( 'post', $post->post_type );
		$this->assertSame( 'auto-draft', $post->post_status );
		$this->assertSame( '', $post->post_title );
		$this->assertSame( self::$admin_id, (int) $post->post_author );

		$attachment_id = $result['attachment_id'];
		$this->assertStringContainsString( '<!-- wp:image {"id":' . $attachment_id . ',', $post->post_content );
		$this->assertStringContainsString( 'wp-image-' . $attachment_id, $post->post_content );
		$this->assertStringContainsString( wp_get_attachment_image_url( $attachment_id, 'large' ), $post->post_content );
		$this->assertSame( $attachment_id, get_post_thumbnail_id( $post ) );

		$this->assertSame( 'post', $result['post_type'] );
		$this->assertTrue( $result['created'] );
		$this->assertStringContainsString( 'post.php?post=' . $post->ID . '&action=edit', $result['edit_url'] );
		$this->assertSame( array( array( $post->ID, $attachment_id, $file_id, self::$admin_id ) ), $fired );
	}

	public function test_start_post_reuses_the_attachment_and_can_make_pages() {
		$file_id = $this->make_stored_image( self::$admin_id );

		$post = openstation_stored_file_start_post( $file_id, 'post', self::$admin_id );
		$page = openstation_stored_file_start_post( $file_id, 'page', self::$admin_id );
		$this->assertNotWPError( $post );
		$this->assertNotWPError( $page );

		$this->assertSame( $post['attachment_id'], $page['attachment_id'] );
		$this->assertFalse( $page['created'] );
		$this->assertSame( 'page', get_post( $page['post_id'] )->post_type );
		$this->assertSame( 'auto-draft', get_post( $page['post_id'] )->post_status );
		$this->assertNotSame( $post['post_id'], $page['post_id'] );
	}

	public function test_start_post_uses_the_file_block_for_non_images() {
		$file_id = $this->make_stored_file( self::$admin_id, 'notes.txt', 'hello world', 'text/plain' );
		$result  = openstation_stored_file_start_post( $file_id, 'post', self::$admin_id );
		$this->assertNotWPError( $result );

		$post = get_post( $result['post_id'] );
		$this->assertStringContainsString( '<!-- wp:file {"id":' . $result['attachment_id'] . ',', $post->post_content );
		$this->assertStringContainsString( 'notes.txt', $post->post_content );
		$this->assertSame( 0, get_post_thumbnail_id( $post ) );
	}

	public function test_start_post_content_and_args_are_filterable() {
		$file_id = $this->make_stored_image( self::$admin_id );
		add_filter(
			'openstation_stored_file_start_post_content',
			function ( $content, $attachment_id, $post_type ) {
				return '<!-- wp:paragraph --><p>' . $post_type . ' ' . $attachment_id . '</p><!-- /wp:paragraph -->' . $content;
			},
			10,
			3
		);
		add_filter(
			'openstation_stored_file_start_post_args',
			function ( $args ) {
				$args['post_title'] = 'From the desktop';
				return $args;
			}
		);
		$result = openstation_stored_file_start_post( $file_id, 'post', self::$admin_id );
		$this->assertNotWPError( $result );
		$post = get_post( $result['post_id'] );
		$this->assertSame( 'From the desktop', $post->post_title );
		$this->assertStringStartsWith( '<!-- wp:paragraph --><p>post ' . $result['attachment_id'] . '</p>', $post->post_content );
		$this->assertStringContainsString( '<!-- wp:image', $post->post_content );
		remove_all_filters( 'openstation_stored_file_start_post_content' );
	}

	public function test_start_post_rejects_unknown_types_and_unauthorised_users() {
		$file_id = $this->make_stored_image( self::$admin_id );

		$result = openstation_stored_file_start_post( $file_id, 'no-such-type', self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_bad_post_type', $result->get_error_code() );

		$result = openstation_stored_file_start_post( $file_id, 'revision', self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_bad_post_type', $result->get_error_code() );

		$own = $this->make_stored_image( self::$author_id );
		$this->assertNotWPError( openstation_stored_file_start_post( $own, 'post', self::$author_id ) );
		$result = openstation_stored_file_start_post( $own, 'page', self::$author_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_cannot_create_posts', $result->get_error_code() );

		$exe    = $this->make_stored_file( self::$admin_id, 'setup.exe', 'MZ', 'application/x-msdownload' );
		$before = count( get_posts( array( 'post_type' => 'post', 'post_status' => 'auto-draft', 'fields' => 'ids' ) ) );
		$result = openstation_stored_file_start_post( $exe, 'post', self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_not_media', $result->get_error_code() );
		$this->assertSame( $before, count( get_posts( array( 'post_type' => 'post', 'post_status' => 'auto-draft', 'fields' => 'ids' ) ) ) );
	}

	public function test_attach_to_post_appends_blocks_attaches_and_sets_the_featured_image() {
		$post_id = self::factory()->post->create(
			array(
				'post_author'  => self::$admin_id,
				'post_content' => '<!-- wp:paragraph --><p>Intro</p><!-- /wp:paragraph -->',
			)
		);
		$image   = $this->make_stored_image( self::$admin_id );
		$text    = $this->make_stored_file( self::$admin_id, 'notes.txt', 'hello world', 'text/plain' );

		$fired = array();
		add_action(
			'openstation_stored_file_attached_to_post',
			function ( $pid, $attachment_ids, $file_ids, $user_id ) use ( &$fired ) {
				$fired[] = array( $pid, $attachment_ids, $file_ids, $user_id );
			},
			10,
			4
		);

		$result = openstation_stored_files_attach_to_post( $post_id, array( $text, $image ), self::$admin_id );
		$this->assertNotWPError( $result );
		$this->assertTrue( $result['appended'] );
		$this->assertTrue( $result['featured_image_set'] );
		$this->assertCount( 2, $result['attachment_ids'] );
		list( $text_att, $image_att ) = $result['attachment_ids'];

		$post = get_post( $post_id );

		$this->assertStringStartsWith( '<!-- wp:paragraph --><p>Intro</p><!-- /wp:paragraph -->', $post->post_content );
		$this->assertStringContainsString( '<!-- wp:file {"id":' . $text_att . ',', $post->post_content );
		$this->assertStringContainsString( '<!-- wp:image {"id":' . $image_att . ',', $post->post_content );
		$this->assertLessThan( strpos( $post->post_content, 'wp:image' ), strpos( $post->post_content, 'wp:file' ) );

		$this->assertSame( $post_id, (int) get_post_field( 'post_parent', $text_att ) );
		$this->assertSame( $post_id, (int) get_post_field( 'post_parent', $image_att ) );
		$this->assertSame( $image_att, get_post_thumbnail_id( $post_id ) );

		$this->assertStringContainsString( 'post.php?post=' . $post_id . '&action=edit', $result['edit_url'] );
		$this->assertSame( array( array( $post_id, array( $text_att, $image_att ), array( $text, $image ), self::$admin_id ) ), $fired );
	}

	public function test_attach_to_post_keeps_an_existing_featured_image_and_parent() {
		$post_id = self::factory()->post->create( array( 'post_author' => self::$admin_id ) );
		$other   = self::factory()->post->create( array( 'post_author' => self::$admin_id ) );
		$image   = $this->make_stored_image( self::$admin_id );

		$first = openstation_stored_file_to_attachment( $image, self::$admin_id );
		wp_update_post( array( 'ID' => $first['attachment_id'], 'post_parent' => $other ) );
		$existing_thumb = self::factory()->attachment->create_upload_object( DIR_TESTDATA . '/images/test-image.jpg', $post_id );
		set_post_thumbnail( $post_id, $existing_thumb );

		$result = openstation_stored_files_attach_to_post( $post_id, array( $image ), self::$admin_id );
		$this->assertNotWPError( $result );
		$this->assertSame( array( $first['attachment_id'] ), $result['attachment_ids'] );
		$this->assertFalse( $result['featured_image_set'] );
		$this->assertSame( $existing_thumb, get_post_thumbnail_id( $post_id ) );
		$this->assertSame( $other, (int) get_post_field( 'post_parent', $first['attachment_id'] ) );
		$this->assertStringContainsString( 'wp-image-' . $first['attachment_id'], get_post( $post_id )->post_content );
	}

	public function test_attach_to_post_content_is_filterable_and_empty_content_gets_no_leading_gap() {
		$post_id = self::factory()->post->create( array( 'post_author' => self::$admin_id, 'post_content' => '' ) );
		$image   = $this->make_stored_image( self::$admin_id );
		add_filter(
			'openstation_stored_file_attach_content',
			function ( $markup, $attachment_ids, $post ) {
				return '<!-- wp:heading --><h2 class="wp-block-heading">' . count( $attachment_ids ) . ' for ' . $post->ID . '</h2><!-- /wp:heading -->' . $markup;
			},
			10,
			3
		);
		$result = openstation_stored_files_attach_to_post( $post_id, array( $image ), self::$admin_id );
		remove_all_filters( 'openstation_stored_file_attach_content' );
		$this->assertNotWPError( $result );
		$content = get_post( $post_id )->post_content;
		$this->assertStringStartsWith( '<!-- wp:heading --><h2 class="wp-block-heading">1 for ' . $post_id . '</h2>', $content );
		$this->assertStringContainsString( '<!-- wp:image', $content );
	}

	public function test_attach_to_post_refuses_bad_targets_and_touches_nothing_on_failure() {
		$image = $this->make_stored_image( self::$admin_id );

		$result = openstation_stored_files_attach_to_post( 999999, array( $image ), self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_post_not_found', $result->get_error_code() );

		$trashed = self::factory()->post->create( array( 'post_author' => self::$admin_id, 'post_status' => 'trash' ) );
		$result  = openstation_stored_files_attach_to_post( $trashed, array( $image ), self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_post_trashed', $result->get_error_code() );

		$admins = self::factory()->post->create( array( 'post_author' => self::$admin_id ) );
		$own    = $this->make_stored_image( self::$author_id );
		$result = openstation_stored_files_attach_to_post( $admins, array( $own ), self::$author_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_cannot_edit_post', $result->get_error_code() );

		$result = openstation_stored_files_attach_to_post( $admins, array(), self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_no_files', $result->get_error_code() );

		$before = get_post( $admins )->post_content;
		$exe    = $this->make_stored_file( self::$admin_id, 'setup.exe', 'MZ', 'application/x-msdownload' );
		$result = openstation_stored_files_attach_to_post( $admins, array( $image, $exe ), self::$admin_id );
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_not_media', $result->get_error_code() );
		$this->assertSame( $before, get_post( $admins )->post_content );
		$this->assertFalse( has_post_thumbnail( $admins ) );
	}

	public function test_rest_attach_to_post_returns_the_summary() {
		$post_id = self::factory()->post->create( array( 'post_author' => self::$admin_id, 'post_title' => 'Drop zone' ) );
		$image   = $this->make_stored_image( self::$admin_id );
		$req     = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/posts/' . $post_id . '/uploads' );
		$req->set_param( 'id', $post_id );
		$req->set_param( 'fileIds', array( $image ) );

		$res = openstation_files_rest_attach_to_post( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertSame( $post_id, $data['postId'] );
		$this->assertSame( 'Drop zone', $data['title'] );
		$this->assertTrue( $data['appended'] );
		$this->assertTrue( $data['featuredImageSet'] );
		$this->assertCount( 1, $data['attachments'] );
		$this->assertSame( get_post_thumbnail_id( $post_id ), $data['attachments'][0]['attachmentId'] );
		$this->assertStringContainsString( 'post.php?post=' . $post_id . '&action=edit', $data['editUrl'] );
	}

	public function test_rest_routes_are_registered() {
		$routes = rest_get_server()->get_routes( 'desktop-mode/v1' );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/uploads/(?P<id>\d+)/media', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/uploads/(?P<id>\d+)/post', $routes );
		$this->assertArrayHasKey( '/desktop-mode/v1/files/posts/(?P<id>\d+)/uploads', $routes );
	}

	public function test_rest_add_to_media_returns_the_attachment_summary() {
		$file_id = $this->make_stored_image( self::$admin_id );
		$req     = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads/' . $file_id . '/media' );
		$req->set_param( 'id', $file_id );

		$res = openstation_files_rest_add_to_media( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertTrue( $data['created'] );
		$this->assertSame( 'attachment', get_post_type( $data['attachmentId'] ) );
		$this->assertSame( wp_get_attachment_url( $data['attachmentId'] ), $data['url'] );
		$this->assertStringContainsString( 'post.php?post=' . $data['attachmentId'] . '&action=edit', $data['editUrl'] );
		$this->assertNotSame( '', $data['title'] );

		$again = openstation_files_rest_add_to_media( $req )->get_data();
		$this->assertFalse( $again['created'] );
		$this->assertSame( $data['attachmentId'], $again['attachmentId'] );
	}

	public function test_rest_start_post_takes_the_post_type() {
		$file_id = $this->make_stored_image( self::$admin_id );
		$req     = new WP_REST_Request( 'POST', '/desktop-mode/v1/files/uploads/' . $file_id . '/post' );
		$req->set_param( 'id', $file_id );
		$req->set_param( 'postType', 'page' );

		$res = openstation_files_rest_start_post( $req );
		$this->assertNotWPError( $res );
		$data = $res->get_data();
		$this->assertSame( 'page', $data['postType'] );
		$this->assertSame( 'page', get_post_type( $data['postId'] ) );
		$this->assertStringContainsString( 'post.php?post=' . $data['postId'] . '&action=edit', $data['editUrl'] );
		$this->assertSame( $data['attachment']['attachmentId'], get_post_thumbnail_id( $data['postId'] ) );

		$req->set_param( 'postType', 'no-such-type' );
		$res = openstation_files_rest_start_post( $req );
		$this->assertWPError( $res );
		$this->assertSame( 'openstation_stored_file_bad_post_type', $res->get_error_code() );
	}

	public function test_permission_gate_requires_upload_files() {

		update_user_meta( self::$subscriber_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$subscriber_id );
		$result = openstation_files_rest_media_permission();
		$this->assertWPError( $result );
		$this->assertSame( 'openstation_stored_file_cannot_add_to_media', $result->get_error_code() );

		update_user_meta( self::$author_id, 'desktop_mode_mode', '1' );
		wp_set_current_user( self::$author_id );
		$this->assertTrue( openstation_files_rest_media_permission() );
	}

	public function test_shell_config_carries_the_capability_flags() {
		$config = apply_filters( 'openstation_shell_config', array() );
		$this->assertTrue( $config['desktopStorage']['canAddToMedia'] );
		$this->assertTrue( $config['desktopStorage']['canStartPost'] );
		$this->assertTrue( $config['desktopStorage']['canStartPage'] );

		$this->assertArrayHasKey( 'canUpload', $config['desktopStorage'] );

		wp_set_current_user( self::$author_id );
		$config = apply_filters( 'openstation_shell_config', array() );
		$this->assertTrue( $config['desktopStorage']['canAddToMedia'] );
		$this->assertTrue( $config['desktopStorage']['canStartPost'] );
		$this->assertFalse( $config['desktopStorage']['canStartPage'] );

		wp_set_current_user( self::$subscriber_id );
		$config = apply_filters( 'openstation_shell_config', array() );
		$this->assertFalse( $config['desktopStorage']['canAddToMedia'] );
		$this->assertFalse( $config['desktopStorage']['canStartPost'] );
		$this->assertFalse( $config['desktopStorage']['canStartPage'] );
	}
}
