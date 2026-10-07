<?php

class Tests_OpenStation_WindowLinks extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		openstation_flush_script_handle_registries();
	}

	public function tear_down() {
		unset( $_GET['c'], $_GET['item'], $_GET['tag_ID'], $_GET['user_id'], $_GET['revision'], $_GET['to'], $GLOBALS['pagenow'], $GLOBALS['post'] );
		remove_all_filters( 'openstation_window_content_identity' );
		remove_all_filters( 'openstation_window_preview_url' );
		remove_all_filters( 'openstation_window_revisions' );
		parent::tear_down();
	}

	private function fake_post_edit_screen( $post ) {
		$GLOBALS['pagenow'] = 'post.php';
		$GLOBALS['post']    = $post;
		set_current_screen( 'post' );
	}

	public function test_post_edit_screen_yields_root_identity() {
		$post_id = self::factory()->post->create(
			array(
				'post_title' => 'Hello Desktop',
			)
		);
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'post', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'] );
		$this->assertSame( 'Hello Desktop', $identity['label'] );
		$this->assertArrayNotHasKey( 'root', $identity, 'A post edit screen IS a root — no root key expected.' );
	}

	public function test_page_edit_screen_uses_the_post_type_as_type() {
		$page_id = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$this->fake_post_edit_screen( get_post( $page_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'page', $identity['type'] );
		$this->assertSame( $page_id, $identity['id'] );
	}

	public function test_comment_edit_screen_roots_at_the_parent_post() {
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID' => $post_id,
				'comment_content' => 'Nice post! I especially liked the part about splines.',
			)
		);

		$GLOBALS['pagenow'] = 'comment.php';
		$_GET['c']          = (string) $comment_id;
		set_current_screen( 'comment' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'comment', $identity['type'] );
		$this->assertSame( $comment_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root'],
			'The comment must resolve its parent post server-side — the URL alone cannot.'
		);
		$this->assertNotSame( '', $identity['label'] );
	}

	public function test_comment_screen_with_missing_comment_yields_null() {
		$GLOBALS['pagenow'] = 'comment.php';
		$_GET['c']          = '999999';
		set_current_screen( 'comment' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_attached_media_roots_at_its_parent() {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			'image.jpg',
			$post_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'A Photo',
			)
		);
		$this->fake_post_edit_screen( get_post( $attachment_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'media', $identity['type'] );
		$this->assertSame( $attachment_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root']
		);
	}

	public function test_unattached_media_is_its_own_root() {
		$attachment_id = self::factory()->attachment->create_object(
			'lonely.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$this->fake_post_edit_screen( get_post( $attachment_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'media', $identity['type'] );
		$this->assertArrayNotHasKey( 'root', $identity );
	}

	public function test_add_new_screen_yields_null() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );
		get_current_screen()->action = 'add';

		$this->assertNull(
			openstation_build_content_identity(),
			'post-new.php has no committed identity yet — deferred until the first save.'
		);
	}

	public function test_unrelated_screen_yields_null() {
		set_current_screen( 'dashboard' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_filter_can_add_an_identity_for_a_custom_screen() {
		set_current_screen( 'dashboard' );

		add_filter(
			'openstation_window_content_identity',
			function ( $identity, $screen ) {
				$this->assertInstanceOf( 'WP_Screen', $screen );
				return array(
					'type' => 'acme/order',
					'id'   => 77,
					'root' => array(
						'type' => 'acme/customer',
						'id'   => 12,
					),
				);
			},
			10,
			2
		);

		$identity = openstation_build_content_identity();

		$this->assertSame( 'acme/order', $identity['type'] );
		$this->assertSame( 77, $identity['id'] );
	}

	public function test_filter_can_suppress_the_builtin_identity() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter( 'openstation_window_content_identity', '__return_null' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_bridge_script_substitutes_the_identity_placeholder() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$post_id = self::factory()->post->create( array( 'post_title' => 'Bridged' ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		ob_start();
		openstation_chromeless_bridge_script();

		$inline = wp_scripts()->get_data( 'os-chromeless-bridge', 'before' );
		$output = (string) ob_get_clean()
			. ( is_array( $inline ) ? implode( "\n", $inline ) : (string) $inline )
			. (string) file_get_contents( OPENSTATION_DIR . 'src/chromeless-bridge.js' );

		unset( $_GET['openstation_chromeless'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertStringNotContainsString( '/*__OPENSTATION_CONTENT_IDENTITY__*/', $output );
		$this->assertStringContainsString( 'os-content-identity', $output );
		$this->assertStringContainsString( '"type":"post"', $output );
		$this->assertStringContainsString( '"id":' . $post_id, $output );
	}

	public function test_post_identity_includes_internal_link_references() {
		$target_id = self::factory()->post->create( array( 'post_title' => 'Target' ) );
		$source_id = self::factory()->post->create(
			array(
				'post_content' => 'See <a href="' . get_permalink( $target_id ) . '">the other post</a> and <a href="https://external.example/">elsewhere</a>.',
			)
		);
		$this->fake_post_edit_screen( get_post( $source_id ) );

		$identity = openstation_build_content_identity();

		$this->assertContains(
			array(
				'type' => 'post',
				'id'   => $target_id,
			),
			$identity['links']
		);
	}

	public function test_reference_extraction_skips_self_links() {
		$post_id = self::factory()->post->create();
		$post    = get_post( $post_id );

		$post->post_content = '<a href="' . get_permalink( $post_id ) . '">me</a>';

		$post_refs = array_filter(
			openstation_window_links_extract_references( $post ),
			static function ( $ref ) {
				return 'post' === $ref['type'];
			}
		);
		$this->assertSame( array(), $post_refs );
	}

	public function test_reference_extraction_includes_embedded_media() {
		$attachment_id = self::factory()->attachment->create_object(
			'embedded.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$post_id = self::factory()->post->create(
			array(
				'post_content' => '<img class="alignnone wp-image-' . $attachment_id . '" src="x.jpg" /> and a bogus <span class="wp-image-999999"></span>',
			)
		);

		$links = openstation_window_links_extract_references( get_post( $post_id ) );

		$this->assertContains(
			array(
				'type' => 'media',
				'id'   => $attachment_id,
				'rel'  => 'child',
			),
			$links
		);

		foreach ( $links as $ref ) {
			$this->assertNotSame( 999999, $ref['id'] );
		}
	}

	public function test_reference_extraction_includes_featured_image() {
		$attachment_id = self::factory()->attachment->create_object(
			'featured.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$post_id = self::factory()->post->create();
		set_post_thumbnail( $post_id, $attachment_id );

		$links = openstation_window_links_extract_references( get_post( $post_id ) );

		$this->assertContains(
			array(
				'type' => 'media',
				'id'   => $attachment_id,
				'rel'  => 'child',
			),
			$links
		);
	}

	public function test_reference_extraction_includes_assigned_terms() {
		$term_id = self::factory()->category->create( array( 'name' => 'Consoles' ) );
		$post_id = self::factory()->post->create();
		wp_set_post_categories( $post_id, array( $term_id ) );

		$links = openstation_window_links_extract_references( get_post( $post_id ) );

		$this->assertContains(
			array(
				'type' => 'term/category',
				'id'   => $term_id,
			),
			$links
		);
	}

	public function test_upload_grid_item_identity() {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			'grid.jpg',
			$post_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Grid Photo',
			)
		);

		$GLOBALS['pagenow'] = 'upload.php';
		$_GET['item']       = (string) $attachment_id;
		set_current_screen( 'upload' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'media', $identity['type'] );
		$this->assertSame( $attachment_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root']
		);

		unset( $_GET['item'] );
	}

	public function test_upload_grid_without_item_yields_null() {
		$GLOBALS['pagenow'] = 'upload.php';
		set_current_screen( 'upload' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_term_edit_screen_identity() {
		$term_id = self::factory()->category->create( array( 'name' => 'Consoles' ) );

		$GLOBALS['pagenow'] = 'term.php';
		$_GET['tag_ID']     = (string) $term_id;
		set_current_screen( 'edit-category' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'term/category', $identity['type'] );
		$this->assertSame( $term_id, $identity['id'] );
		$this->assertSame( 'Consoles', $identity['label'] );
		$this->assertArrayNotHasKey( 'root', $identity );

		unset( $_GET['tag_ID'] );
	}

	public function test_user_edit_screen_yields_a_user_identity() {
		$user_id = self::factory()->user->create(
			array(
				'role'         => 'subscriber',
				'display_name' => 'Ada Lovelace',
			)
		);

		$GLOBALS['pagenow'] = 'user-edit.php';
		$_GET['user_id']    = (string) $user_id;
		set_current_screen( 'user-edit' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'user', $identity['type'] );
		$this->assertSame( $user_id, $identity['id'] );
		$this->assertSame( 'Ada Lovelace', $identity['label'] );
		$this->assertArrayNotHasKey( 'root', $identity );
	}

	public function test_profile_screen_identifies_the_current_user() {
		$GLOBALS['pagenow'] = 'profile.php';
		set_current_screen( 'profile' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'user', $identity['type'] );
		$this->assertSame( self::$admin_id, $identity['id'] );
	}

	public function test_user_edit_screen_respects_the_capability() {
		$editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		$other_id  = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $editor_id );

		$GLOBALS['pagenow'] = 'user-edit.php';
		$_GET['user_id']    = (string) $other_id;
		set_current_screen( 'user-edit' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_renderer_script_stores_handle() {
		$handle = 'wl-a-' . substr( md5( uniqid() ), 0, 8 );
		$ok     = openstation_register_window_link_renderer_script( $handle );
		$this->assertTrue( $ok );
		$this->assertTrue( openstation_window_link_renderer_script_registry( $handle ) );
	}

	public function test_renderer_script_rejects_empty_handle() {
		$r = openstation_register_window_link_renderer_script( '' );
		$this->assertInstanceOf( 'WP_Error', $r );
		$this->assertSame( 'openstation_missing_handle', $r->get_error_code() );
	}

	public function test_renderer_script_payload_resolves_registered_handle() {
		$handle = 'wl-b-' . substr( md5( uniqid() ), 0, 8 );
		wp_register_script( $handle, 'https://example.test/links.js', array(), '1.0', true );
		openstation_register_window_link_renderer_script( $handle );

		$payload = openstation_build_window_link_renderer_scripts_payload();
		$entry   = null;
		foreach ( $payload as $p ) {
			if ( $p['handle'] === $handle ) {
				$entry = $p;
				break;
			}
		}
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'links.js', $entry['scriptUrl'] );
	}

	public function test_renderer_script_payload_omits_unresolvable_handles() {
		$this->setExpectedIncorrectUsage( 'openstation_register_window_link_renderer_script' );

		$handle = 'wl-c-' . substr( md5( uniqid() ), 0, 8 );
		openstation_register_window_link_renderer_script( $handle );
		$payload = openstation_build_window_link_renderer_scripts_payload();
		foreach ( $payload as $entry ) {
			$this->assertNotSame( $handle, $entry['handle'] );
		}
	}

	public function test_renderer_script_registered_action_fires() {
		$captured = array();
		add_action( 'openstation_window_link_renderer_script_registered', function ( $h ) use ( &$captured ) {
			$captured[] = $h;
		} );
		$h = 'wl-d-' . substr( md5( uniqid() ), 0, 8 );
		openstation_register_window_link_renderer_script( $h );
		$this->assertContains( $h, $captured );
	}

	public function test_menu_payload_includes_window_link_renderer_scripts_key() {
		$payload = openstation_build_menu_payload();
		$this->assertArrayHasKey( 'serverWindowLinkRendererScripts', $payload );
		$this->assertIsArray( $payload['serverWindowLinkRendererScripts'] );
	}

	public function test_draft_post_identity_carries_preview_url() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayHasKey( 'previewUrl', $identity );
		$this->assertStringContainsString( 'preview=true', $identity['previewUrl'] );
		$this->assertStringContainsString( 'preview_id=' . $post_id, $identity['previewUrl'] );
		$this->assertStringContainsString( 'preview_nonce=', $identity['previewUrl'] );
	}

	public function test_published_post_identity_carries_nonced_preview_url() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayHasKey( 'previewUrl', $identity );
		$this->assertStringContainsString( 'preview_id=' . $post_id, $identity['previewUrl'] );
		$this->assertStringContainsString( 'preview_nonce=', $identity['previewUrl'] );
		parse_str( (string) wp_parse_url( $identity['previewUrl'], PHP_URL_QUERY ), $args );
		$this->assertArrayHasKey( 'preview_nonce', $args );
		$this->assertNotFalse(
			wp_verify_nonce( $args['preview_nonce'], 'post_preview_' . $post_id ),
			'The preview_nonce must verify against the post_preview_{ID} action core checks.'
		);
	}

	public function test_non_viewable_post_type_gets_no_preview_url() {
		register_post_type(
			'dm_hidden',
			array(
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
			)
		);
		$post_id = self::factory()->post->create( array( 'post_type' => 'dm_hidden' ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayNotHasKey( 'previewUrl', $identity );

		unregister_post_type( 'dm_hidden' );
	}

	public function test_preview_url_filter_can_rewrite_the_url() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_preview_url',
			static function ( $url, $post ) {
				return 'https://headless.example.test/preview/' . $post->ID;
			},
			10,
			2
		);

		$identity = openstation_build_content_identity();
		remove_all_filters( 'openstation_window_preview_url' );

		$this->assertSame( 'https://headless.example.test/preview/' . $post_id, $identity['previewUrl'] );
	}

	public function test_preview_url_filter_can_suppress_the_url() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter( 'openstation_window_preview_url', '__return_empty_string' );

		$identity = openstation_build_content_identity();
		remove_all_filters( 'openstation_window_preview_url' );

		$this->assertArrayNotHasKey( 'previewUrl', $identity );
	}

	public function test_rest_content_identity_includes_preview_url() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$post_id = self::factory()->post->create();

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $post_id );
		$response = rest_get_server()->dispatch( $request );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertSame( 200, $response->get_status() );
		$identity = $response->get_data()['identity'];
		$this->assertArrayHasKey( 'previewUrl', $identity );
		$this->assertStringContainsString( 'preview_nonce=', $identity['previewUrl'] );
	}

	public function test_post_identity_carries_revisions_url_and_count() {
		$post_id = self::factory()->post->create( array( 'post_content' => 'v1' ) );
		wp_save_post_revision( $post_id );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayHasKey( 'revisionsUrl', $identity );
		$this->assertStringContainsString( 'revision.php?revision=', $identity['revisionsUrl'] );
		$this->assertSame( 1, $identity['revisionCount'] );
	}

	public function test_revisions_url_points_at_the_latest_revision() {
		$post_id = self::factory()->post->create( array( 'post_content' => 'v1' ) );
		wp_save_post_revision( $post_id );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => 'v2',
			)
		);
		wp_save_post_revision( $post_id );

		$revisions = wp_get_post_revisions( $post_id, array( 'fields' => 'ids' ) );
		$latest    = (int) reset( $revisions );

		$this->assertGreaterThan( 1, count( $revisions ) );

		$this->fake_post_edit_screen( get_post( $post_id ) );
		$identity = openstation_build_content_identity();

		$this->assertStringContainsString( 'revision=' . $latest, $identity['revisionsUrl'] );
		$this->assertSame( count( $revisions ), $identity['revisionCount'] );
	}

	public function test_post_without_revisions_carries_no_revisions_url() {
		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayNotHasKey( 'revisionsUrl', $identity );
		$this->assertArrayNotHasKey( 'revisionCount', $identity );
	}

	public function test_post_type_without_revisions_support_carries_none() {
		register_post_type(
			'dm_norev',
			array(
				'public'   => true,
				'show_ui'  => true,
				'supports' => array( 'title', 'editor' ),
			)
		);
		$post_id = self::factory()->post->create( array( 'post_type' => 'dm_norev' ) );
		wp_save_post_revision( $post_id );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayNotHasKey( 'revisionsUrl', $identity );

		unregister_post_type( 'dm_norev' );
	}

	public function test_custom_post_type_with_revisions_support_carries_them() {
		register_post_type(
			'dm_rev',
			array(
				'public'   => true,
				'show_ui'  => true,
				'supports' => array( 'title', 'editor', 'revisions' ),
			)
		);
		$post_id = self::factory()->post->create( array( 'post_type' => 'dm_rev' ) );
		wp_save_post_revision( $post_id );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'dm_rev', $identity['type'] );
		$this->assertArrayHasKey( 'revisionsUrl', $identity );
		$this->assertSame( 1, $identity['revisionCount'] );

		unregister_post_type( 'dm_rev' );
	}

	public function test_revisions_filter_can_rewrite_the_descriptor() {
		$post_id = self::factory()->post->create();
		wp_save_post_revision( $post_id );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_revisions',
			static function ( $revisions, $post ) {
				return array(
					'url'   => 'https://example.test/history/' . $post->ID,
					'count' => 42,
				);
			},
			10,
			2
		);

		$identity = openstation_build_content_identity();

		$this->assertSame( 'https://example.test/history/' . $post_id, $identity['revisionsUrl'] );
		$this->assertSame( 42, $identity['revisionCount'] );
	}

	public function test_revisions_filter_can_suppress_the_row() {
		$post_id = self::factory()->post->create();
		wp_save_post_revision( $post_id );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_revisions',
			static function () {
				return array(
					'url'   => '',
					'count' => 0,
				);
			}
		);

		$identity = openstation_build_content_identity();

		$this->assertArrayNotHasKey( 'revisionsUrl', $identity );
	}

	public function test_revisions_filter_output_is_sanitized() {
		$post_id = self::factory()->post->create();
		wp_save_post_revision( $post_id );

		add_filter( 'openstation_window_revisions', '__return_false' );
		$this->assertSame(
			array(
				'url'   => '',
				'count' => 0,
			),
			openstation_window_revisions( get_post( $post_id ) )
		);
		remove_all_filters( 'openstation_window_revisions' );

		add_filter(
			'openstation_window_revisions',
			static function () {
				return array(
					'url'   => array( 'not', 'a', 'string' ),
					'count' => -8,
				);
			}
		);
		$this->assertSame(
			array(
				'url'   => '',
				'count' => 0,
			),
			openstation_window_revisions( get_post( $post_id ) )
		);
	}

	public function test_revision_browser_roots_at_the_parent_post() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Hello Desktop' ) );
		$revision_id = wp_save_post_revision( $post_id );

		$GLOBALS['pagenow'] = 'revision.php';
		$_GET['revision']   = $revision_id;
		set_current_screen( 'revision' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'revisions', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'], 'Keyed by the POST, not the revision on screen.' );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root']
		);
		$this->assertStringContainsString( 'Hello Desktop', $identity['label'] );
	}

	public function test_revision_browser_falls_back_to_the_to_param() {
		$post_id     = self::factory()->post->create();
		$revision_id = wp_save_post_revision( $post_id );

		$GLOBALS['pagenow'] = 'revision.php';
		$_GET['to']         = $revision_id;
		set_current_screen( 'revision' );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'revisions', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'] );
	}

	public function test_revision_browser_without_a_revision_yields_null() {
		$GLOBALS['pagenow'] = 'revision.php';
		set_current_screen( 'revision' );

		$this->assertNull( openstation_build_content_identity() );
	}

	public function test_rest_content_identity_includes_revisions_url() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$post_id = self::factory()->post->create();
		wp_save_post_revision( $post_id );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $post_id );
		$response = rest_get_server()->dispatch( $request );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertSame( 200, $response->get_status() );
		$identity = $response->get_data()['identity'];
		$this->assertArrayHasKey( 'revisionsUrl', $identity );
		$this->assertSame( 1, $identity['revisionCount'] );
	}
}
