<?php
/**
 * Tests for the related-entities server surface —
 * `openstation_window_related_entities_for_post()`, the
 * `openstation_window_related_entities` filter, and the `related`
 * key the content-identity builder attaches for the title bar's
 * "Related" menu.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_RelatedEntities extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function tear_down() {
		unset( $_GET['p'], $GLOBALS['pagenow'], $GLOBALS['post'] );
		remove_all_filters( 'openstation_window_content_identity' );
		remove_all_filters( 'openstation_window_related_entities' );
		parent::tear_down();
	}

	/**
	 * Point the builder's screen detection at a post.php edit request
	 * for the given post.
	 *
	 * @param WP_Post $post Post being "edited".
	 */
	private function fake_post_edit_screen( $post ) {
		$GLOBALS['pagenow'] = 'post.php';
		$GLOBALS['post']    = $post;
		set_current_screen( 'post' );
	}

	/**
	 * Pull the related items of a given group out of a builder result.
	 *
	 * @param array[] $related Related items.
	 * @param string  $group   Group key to keep.
	 * @return array[] Matching items, reindexed.
	 */
	private function items_in_group( $related, $group ) {
		return array_values(
			array_filter(
				$related,
				static function ( $item ) use ( $group ) {
					return $group === $item['group'];
				}
			)
		);
	}

	/**
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_comments_item_carries_count_and_filtered_url() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create_many( 3, array( 'comment_post_ID' => $post_id ) );

		$related  = openstation_window_related_entities_for_post( get_post( $post_id ) );
		$comments = $this->items_in_group( $related, 'comments' );

		$this->assertCount( 1, $comments );
		$this->assertSame( 'comments', $comments[0]['id'] );
		$this->assertSame( 3, $comments[0]['count'] );
		$this->assertStringContainsString( 'edit-comments.php?p=' . $post_id, $comments[0]['url'] );
	}

	/**
	 * The comments item must serve the moderation queue: pending
	 * comments count, and the badge matches the approved + pending
	 * total the opened screen lists — not the approved-only cache.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_comments_item_counts_pending_comments() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create_many(
			2,
			array(
				'comment_post_ID' => $post_id,
				'comment_approved' => '0',
			)
		);
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );

		$related  = openstation_window_related_entities_for_post( get_post( $post_id ) );
		$comments = $this->items_in_group( $related, 'comments' );

		$this->assertCount( 1, $comments, 'All-pending or mixed comments must still surface the item.' );
		$this->assertSame( 3, $comments[0]['count'] );
	}

	/**
	 * An empty filtered comments list is a dead end — no item at zero.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_no_comments_item_when_post_has_no_comments() {
		$post_id = self::factory()->post->create();

		$related = openstation_window_related_entities_for_post( get_post( $post_id ) );

		$this->assertSame( array(), $this->items_in_group( $related, 'comments' ) );
	}

	/**
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_no_comments_item_when_post_type_support_is_removed() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create_many( 2, array( 'comment_post_ID' => $post_id ) );

		remove_post_type_support( 'post', 'comments' );
		$related = openstation_window_related_entities_for_post( get_post( $post_id ) );
		add_post_type_support( 'post', 'comments' );

		$this->assertSame( array(), $this->items_in_group( $related, 'comments' ) );
	}

	/**
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_assigned_terms_yield_per_taxonomy_groups_with_term_edit_urls() {
		$cat_id  = self::factory()->category->create( array( 'name' => 'Consoles' ) );
		$tag_id  = self::factory()->tag->create( array( 'name' => 'retro' ) );
		$post_id = self::factory()->post->create();
		wp_set_post_categories( $post_id, array( $cat_id ) );
		wp_set_post_tags( $post_id, array( 'retro' ) );

		$related = openstation_window_related_entities_for_post( get_post( $post_id ) );

		$cats = $this->items_in_group( $related, 'terms/category' );
		$this->assertCount( 1, $cats );
		$this->assertSame( 'term-category-' . $cat_id, $cats[0]['id'] );
		$this->assertSame( 'Consoles', $cats[0]['label'] );
		$this->assertSame( 'Categories', $cats[0]['groupLabel'] );
		$this->assertStringContainsString( 'term.php?taxonomy=category&tag_ID=' . $cat_id, $cats[0]['url'] );
		$this->assertSame( 'dashicons-category', $cats[0]['icon'] );

		$tags = $this->items_in_group( $related, 'terms/post_tag' );
		$this->assertCount( 1, $tags );
		$this->assertSame( 'retro', $tags[0]['label'] );
		$this->assertStringContainsString( 'term.php?taxonomy=post_tag&tag_ID=' . $tag_id, $tags[0]['url'] );
		$this->assertSame( 'dashicons-tag', $tags[0]['icon'] );
	}

	/**
	 * Featured, attached, and embedded media all surface — deduped when
	 * the same attachment arrives through more than one source — each
	 * deep-linking the Media Library grid detail modal.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_media_items_cover_featured_attached_and_embedded_deduped() {
		$post_id     = self::factory()->post->create();
		$featured_id = self::factory()->attachment->create_object(
			'featured.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);
		$attached_id = self::factory()->attachment->create_object(
			'attached.jpg',
			$post_id,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Attached Photo',
			)
		);
		set_post_thumbnail( $post_id, $featured_id );
		// Embed the ATTACHED image too — it must not produce a second
		// entry for the same attachment.
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => '<img class="wp-image-' . $attached_id . '" src="x.jpg" />',
			)
		);

		$related = openstation_window_related_entities_for_post( get_post( $post_id ) );
		$media   = $this->items_in_group( $related, 'media' );

		$this->assertCount( 2, $media );
		$ids = wp_list_pluck( $media, 'id' );
		$this->assertContains( 'media-' . $featured_id, $ids );
		$this->assertContains( 'media-' . $attached_id, $ids );
		foreach ( $media as $item ) {
			$this->assertStringContainsString( 'upload.php?item=', $item['url'] );
		}
	}

	/**
	 * Internal hyperlinks that resolve to another post surface as the
	 * "Linked posts" group, opening the target's editor. Self-links
	 * and external hrefs are skipped.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_internal_links_yield_linked_posts_items() {
		$target_id = self::factory()->post->create( array( 'post_title' => 'Target Post' ) );
		$source_id = self::factory()->post->create();
		wp_update_post(
			array(
				'ID'           => $source_id,
				'post_content' => 'See <a href="' . get_permalink( $target_id ) . '">the target</a>, '
					. '<a href="' . get_permalink( $source_id ) . '">myself</a>, and '
					. '<a href="https://external.example/">elsewhere</a>.',
			)
		);

		$related = openstation_window_related_entities_for_post( get_post( $source_id ) );
		$links   = $this->items_in_group( $related, 'links' );

		$this->assertCount( 1, $links, 'Only the resolvable non-self internal link may surface.' );
		$this->assertSame( 'link-' . $target_id, $links[0]['id'] );
		$this->assertSame( 'Target Post', $links[0]['label'] );
		$this->assertSame( 'Linked posts', $links[0]['groupLabel'] );
		$this->assertStringContainsString( 'post.php?post=' . $target_id . '&action=edit', $links[0]['url'] );
	}

	/**
	 * Built-ins are posts/pages only — CPTs join via the filter.
	 *
	 * @covers ::openstation_window_related_entities_for_post
	 */
	public function test_custom_post_types_get_no_builtin_items() {
		register_post_type( 'acme_order', array( 'public' => true ) );
		$order_id = self::factory()->post->create( array( 'post_type' => 'acme_order' ) );
		self::factory()->comment->create( array( 'comment_post_ID' => $order_id ) );

		$related = openstation_window_related_entities_for_post( get_post( $order_id ) );
		unregister_post_type( 'acme_order' );

		$this->assertSame( array(), $related );
	}

	/**
	 * @covers ::openstation_build_content_identity
	 */
	public function test_identity_carries_related_for_a_post_edit_screen() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$identity = openstation_build_content_identity();

		$this->assertArrayHasKey( 'related', $identity );
		$this->assertNotEmpty( $this->items_in_group( $identity['related'], 'comments' ) );
	}

	/**
	 * A page with no comments, terms, or media yields no `related` key
	 * at all — the shell hides the button on an empty list.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_identity_omits_related_when_nothing_applies() {
		$page_id = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$this->fake_post_edit_screen( get_post( $page_id ) );

		$identity = openstation_build_content_identity();

		$this->assertSame( 'page', $identity['type'] );
		$this->assertArrayNotHasKey( 'related', $identity );
	}

	/**
	 * @covers ::openstation_build_content_identity
	 */
	public function test_related_filter_receives_related_identity_and_screen() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		$captured = array();
		add_filter(
			'openstation_window_related_entities',
			function ( $related, $identity, $screen ) use ( &$captured ) {
				$captured = array( $related, $identity, $screen );
				return $related;
			},
			10,
			3
		);

		openstation_build_content_identity();

		$this->assertNotEmpty( $captured[0], 'Built-in items must reach the filter.' );
		$this->assertSame( 'post', $captured[1]['type'] );
		$this->assertInstanceOf( 'WP_Screen', $captured[2] );
	}

	/**
	 * @covers ::openstation_build_content_identity
	 */
	public function test_related_filter_can_add_and_remove_items() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_related_entities',
			static function () {
				return array(
					array(
						'id'    => 'acme/report',
						'group' => 'acme/reports',
						'label' => 'Sales report',
						'url'   => admin_url( 'admin.php?page=acme-report' ),
					),
				);
			}
		);

		$identity = openstation_build_content_identity();

		$this->assertCount( 1, $identity['related'] );
		$this->assertSame( 'acme/report', $identity['related'][0]['id'] );
	}

	/**
	 * The related filter runs AFTER the identity filter, so an identity
	 * a plugin injects for its own screen still gets related items.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_related_filter_applies_to_plugin_injected_identities() {
		set_current_screen( 'dashboard' );

		add_filter(
			'openstation_window_content_identity',
			static function () {
				return array(
					'type' => 'acme/order',
					'id'   => 77,
				);
			}
		);
		add_filter(
			'openstation_window_related_entities',
			function ( $related, $identity ) {
				$this->assertSame( 'acme/order', $identity['type'] );
				return array(
					array(
						'id'    => 'acme/customer-12',
						'group' => 'acme/customers',
						'label' => 'Customer #12',
						'url'   => admin_url( 'admin.php?page=acme-customer&c=12' ),
					),
				);
			},
			10,
			2
		);

		$identity = openstation_build_content_identity();

		$this->assertSame( 'acme/customer-12', $identity['related'][0]['id'] );
	}

	/**
	 * Built-ins belong to the detected post: an identity filter that
	 * REWRITES the identity to a different object must not see the
	 * post's comments/terms/media tag along — that would leak labels
	 * and deep links the filter deliberately removed.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_rewritten_identity_suppresses_builtin_related_items() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_content_identity',
			static function () {
				return array(
					'type' => 'acme/gated',
					'id'   => 'hidden',
				);
			}
		);

		$identity = openstation_build_content_identity();

		$this->assertSame( 'acme/gated', $identity['type'] );
		$this->assertArrayNotHasKey( 'related', $identity );
	}

	/**
	 * A label-only rewrite keeps the same object — built-ins stay.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_same_object_identity_rewrite_keeps_builtin_related_items() {
		$post_id = self::factory()->post->create();
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		$this->fake_post_edit_screen( get_post( $post_id ) );

		add_filter(
			'openstation_window_content_identity',
			static function ( $identity ) {
				$identity['label'] = 'Renamed';
				return $identity;
			}
		);

		$identity = openstation_build_content_identity();

		$this->assertNotEmpty( $this->items_in_group( $identity['related'], 'comments' ) );
	}

	/**
	 * No identity, no related pass — the filter must not run at all.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_related_filter_is_not_applied_without_an_identity() {
		set_current_screen( 'dashboard' );

		$called = false;
		add_filter(
			'openstation_window_related_entities',
			static function ( $related ) use ( &$called ) {
				$called = true;
				return $related;
			}
		);

		$this->assertNull( openstation_build_content_identity() );
		$this->assertFalse( $called );
	}

	/**
	 * The filtered comments list — the Related menu's "Comments" target
	 * — announces a per-post identity rooted at the post, so the two
	 * windows tie together on the desktop.
	 *
	 * @covers ::openstation_build_content_identity
	 */
	public function test_filtered_comments_list_roots_at_the_post() {
		$post_id = self::factory()->post->create( array( 'post_title' => 'Discussed' ) );

		$GLOBALS['pagenow'] = 'edit-comments.php';
		$_GET['p']          = (string) $post_id;
		set_current_screen( 'edit-comments' );

		$identity = openstation_build_content_identity();
		unset( $_GET['p'] );

		$this->assertSame( 'comments', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'] );
		$this->assertSame(
			array(
				'type' => 'post',
				'id'   => $post_id,
			),
			$identity['root']
		);
		$this->assertStringContainsString( 'Discussed', $identity['label'] );
	}

	/**
	 * @covers ::openstation_build_content_identity
	 */
	public function test_unfiltered_comments_list_yields_null() {
		$GLOBALS['pagenow'] = 'edit-comments.php';
		set_current_screen( 'edit-comments' );

		$this->assertNull( openstation_build_content_identity() );
	}

	/**
	 * One malformed filter entry must not invalidate the whole identity
	 * client-side — the sanitizer drops it and whitelists fields.
	 *
	 * @covers ::openstation_window_related_entities_sanitize
	 */
	public function test_sanitizer_drops_malformed_items_and_whitelists_fields() {
		$sanitized = openstation_window_related_entities_sanitize(
			array(
				array(
					'id'    => 'good',
					'group' => 'acme/things',
					'label' => 'Good',
					'url'   => 'https://example.test/wp-admin/admin.php',
					'count' => '5',
					'extra' => 'dropped',
				),
				array(
					'id'    => '',
					'group' => 'acme/things',
					'label' => 'Missing id',
					'url'   => 'https://example.test/',
				),
				// Whitespace-only required field: passes `empty()` but the
				// JS engine rejects it — and with it the WHOLE identity.
				// The sanitizer must drop it server-side.
				array(
					'id'    => 'ws',
					'group' => 'acme/things',
					'label' => '   ',
					'url'   => 'https://example.test/',
				),
				// '0' is a legitimate label (`empty('0')` is true — the
				// sanitizer must not use empty()).
				array(
					'id'    => 'zero',
					'group' => 'acme/things',
					'label' => '0',
					'url'   => 'https://example.test/wp-admin/admin.php',
				),
				'not-an-array',
				array( 'id' => 'no-url', 'group' => 'g', 'label' => 'x' ),
			)
		);

		$this->assertSame(
			array(
				array(
					'id'    => 'good',
					'group' => 'acme/things',
					'label' => 'Good',
					'url'   => 'https://example.test/wp-admin/admin.php',
					'count' => 5,
				),
				array(
					'id'    => 'zero',
					'group' => 'acme/things',
					'label' => '0',
					'url'   => 'https://example.test/wp-admin/admin.php',
				),
			),
			$sanitized
		);
	}

	/**
	 * @covers ::openstation_window_related_entities_sanitize
	 */
	public function test_sanitizer_returns_empty_array_for_non_arrays() {
		$this->assertSame( array(), openstation_window_related_entities_sanitize( null ) );
		$this->assertSame( array(), openstation_window_related_entities_sanitize( 'nope' ) );
	}

	// ────────────────────────────────────────────────────────────────
	// REST recompute — `GET /desktop-mode/v1/content-identity` — the
	// endpoint the chromeless bridge's editor save-watcher hits so a
	// Gutenberg save refreshes the Related menu without a reload.
	// ────────────────────────────────────────────────────────────────

	/**
	 * @covers ::openstation_rest_content_identity
	 */
	public function test_rest_content_identity_returns_fresh_identity_with_related() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$post_id = self::factory()->post->create( array( 'post_title' => 'Fresh' ) );
		self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $post_id );
		$response = rest_get_server()->dispatch( $request );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertSame( 200, $response->get_status() );
		$identity = $response->get_data()['identity'];
		$this->assertSame( 'post', $identity['type'] );
		$this->assertSame( $post_id, $identity['id'] );
		$this->assertSame( 'Fresh', $identity['label'] );
		$this->assertNotEmpty( $this->items_in_group( $identity['related'], 'comments' ) );
	}

	/**
	 * Both public filters run on the REST recompute too — with a null
	 * screen, exactly as documented.
	 *
	 * @covers ::openstation_rest_content_identity
	 */
	public function test_rest_content_identity_applies_both_filters_with_null_screen() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$post_id = self::factory()->post->create();

		$screens = array();
		add_filter(
			'openstation_window_related_entities',
			static function ( $related, $identity, $screen ) use ( &$screens ) {
				$screens[] = $screen;
				$related[] = array(
					'id'    => 'acme/from-rest',
					'group' => 'acme/things',
					'label' => 'From REST',
					'url'   => admin_url( 'admin.php?page=acme' ),
				);
				return $related;
			},
			10,
			3
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $post_id );
		$response = rest_get_server()->dispatch( $request );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertSame( array( null ), $screens );
		$ids = wp_list_pluck( $response->get_data()['identity']['related'], 'id' );
		$this->assertContains( 'acme/from-rest', $ids );
	}

	/**
	 * @covers ::openstation_rest_content_identity_permission
	 */
	public function test_rest_content_identity_requires_auth_and_edit_cap() {
		$post_id = self::factory()->post->create();

		// Logged out → 401.
		wp_set_current_user( 0 );
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $post_id );
		$this->assertSame( 401, rest_get_server()->dispatch( $request )->get_status() );

		// Logged in, OpenStation on, but cannot edit the post → 403.
		$subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber_id );
		update_user_meta( $subscriber_id, 'desktop_mode_mode', '1' );
		$this->assertSame( 403, rest_get_server()->dispatch( $request )->get_status() );
	}

	/**
	 * @covers ::openstation_rest_content_identity
	 */
	public function test_rest_content_identity_rejects_attachments_and_missing_posts() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$attachment_id = self::factory()->attachment->create_object(
			'rest.jpg',
			0,
			array( 'post_mime_type' => 'image/jpeg' )
		);

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', $attachment_id );
		$this->assertSame( 404, rest_get_server()->dispatch( $request )->get_status() );

		// Missing post: the permission callback's `edit_post` check
		// fails first — 403, deliberately not leaking existence.
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/content-identity' );
		$request->set_param( 'post', 999999 );
		$this->assertSame( 403, rest_get_server()->dispatch( $request )->get_status() );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
	}

	/**
	 * The chromeless bridge ships the editor save-watcher that refetches
	 * the identity from the REST route after every real save.
	 *
	 * @covers ::openstation_chromeless_bridge_script
	 */
	public function test_bridge_script_contains_the_save_watcher() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$post_id = self::factory()->post->create();
		$this->fake_post_edit_screen( get_post( $post_id ) );

		ob_start();
		openstation_chromeless_bridge_script();
		$output = ob_get_clean();

		unset( $_GET['openstation_chromeless'] );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );

		$this->assertStringContainsString( 'desktop-mode/v1/content-identity', $output );
		$this->assertStringContainsString( 'isSavingPost', $output );
	}
}
