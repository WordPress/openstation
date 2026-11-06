<?php
/**
 * Security regression tests for the `.os.php` apps: every read path a
 * Contributor reaches through the App Framework dispatch, the quick-edit
 * capability rules, and the REST fields and meta the apps add to Core's
 * own collections, which answer logged-out requests too.
 *
 * Each test drives the real entry point — a dispatch through the
 * runtime, or a request through the REST server — as the least
 * privileged account that can reach it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-security
 */
class Tests_OpenStation_SecurityApps extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $contributor_id;

	/**
	 * Another author's private post.
	 *
	 * @var int
	 */
	protected static $private_id;

	/**
	 * Another author's draft.
	 *
	 * @var int
	 */
	protected static $draft_id;

	/**
	 * A published post sealed by a password.
	 *
	 * @var int
	 */
	protected static $sealed_id;

	/**
	 * A published post anyone may read.
	 *
	 * @var int
	 */
	protected static $public_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );

		self::$private_id = $factory->post->create(
			array(
				'post_title'   => 'Board minutes',
				'post_content' => 'PRIVATE-BODY-MARKER',
				'post_status'  => 'private',
				'post_author'  => self::$admin_id,
			)
		);
		self::$draft_id   = $factory->post->create(
			array(
				'post_title'   => 'Unannounced launch',
				'post_content' => 'DRAFT-BODY-MARKER',
				'post_status'  => 'draft',
				'post_author'  => self::$admin_id,
			)
		);
		self::$sealed_id  = $factory->post->create(
			array(
				'post_title'    => 'Members only',
				'post_content'  => 'SEALED-BODY-MARKER',
				'post_status'   => 'publish',
				'post_password' => 'hunter2',
				'post_author'   => self::$admin_id,
			)
		);
		self::$public_id  = $factory->post->create(
			array(
				'post_title'   => 'Hello world',
				'post_content' => 'Public body',
				'post_status'  => 'publish',
				'post_author'  => self::$admin_id,
			)
		);
	}

	public function tear_down() {
		// App icons are process-scoped — see the codeBlue.php tear_down.
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	/**
	 * Run one My WordPress dispatch as the current user.
	 *
	 * @param string $action Action.
	 * @param array  $state  Client state.
	 * @param array  $args   Trigger args.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array() ) {
		return openstation_apps_runtime()->dispatch(
			'my-wordpress',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
			),
			openstation_apps_os()
		);
	}

	/**
	 * Every string anywhere in a payload, joined — for "this marker
	 * never reaches the client" assertions that do not depend on the
	 * payload's shape.
	 *
	 * @param mixed $payload Payload.
	 * @return string
	 */
	protected function flatten( $payload ) {
		return (string) wp_json_encode( $payload );
	}

	// ---------------------------------------------- My WordPress reads

	/**
	 * `item` rides up with the client's state, so a Contributor could
	 * open any post id in the Posts section's dossier and read its
	 * rendered body: another author's private post, another author's
	 * draft.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 */
	public function test_my_wordpress_detail_refuses_another_authors_private_post_and_draft() {
		wp_set_current_user( self::$contributor_id );

		foreach ( array( self::$private_id, self::$draft_id ) as $id ) {
			$response = $this->dispatch(
				'refresh',
				array(
					'section' => 'posts',
					'item'    => $id,
				)
			);
			$this->assertTrue( $response['ok'] );
			$this->assertNull( $response['data']['detail'], 'No dossier for a post the caller cannot read.' );
			$this->assertStringNotContainsString( 'PRIVATE-BODY-MARKER', $this->flatten( $response ) );
			$this->assertStringNotContainsString( 'DRAFT-BODY-MARKER', $this->flatten( $response ) );
		}

		// The caller's own draft still opens, body and all.
		$own      = self::factory()->post->create(
			array(
				'post_status'  => 'draft',
				'post_author'  => self::$contributor_id,
				'post_content' => 'OWN-DRAFT-MARKER',
			)
		);
		$response = $this->dispatch(
			'refresh',
			array(
				'section' => 'posts',
				'item'    => $own,
			)
		);
		$this->assertStringContainsString( 'OWN-DRAFT-MARKER', $response['data']['detail']['content'] );
	}

	/**
	 * `read_post` passes a password-protected post (its status is
	 * `publish`); the body still needs the password, or `edit_post`.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\detail
	 * @covers \OpenStation\Apps\MyWordPress\folder
	 */
	public function test_my_wordpress_withholds_a_password_protected_body() {
		wp_set_current_user( self::$contributor_id );

		$detail = $this->dispatch(
			'refresh',
			array(
				'section' => 'posts',
				'item'    => self::$sealed_id,
			)
		)['data']['detail'];
		$this->assertSame( 'Members only', $detail['title'] );
		$this->assertSame( '', $detail['content'] );

		$folder = $this->dispatch( 'into', array( 'section' => 'posts' ), array( 'item' => self::$sealed_id ) )['data']['folder'];
		$this->assertSame( '', $folder['content'] );

		// The author holds `edit_post` and reads it as before.
		wp_set_current_user( self::$admin_id );
		$detail = $this->dispatch(
			'refresh',
			array(
				'section' => 'posts',
				'item'    => self::$sealed_id,
			)
		)['data']['detail'];
		$this->assertStringContainsString( 'SEALED-BODY-MARKER', $detail['content'] );
	}

	/**
	 * The detail FOLDER (`into`) rendered the same body, and its
	 * relation sub-lists hung off the same unreadable post.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\folder
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_my_wordpress_folder_refuses_another_authors_private_post() {
		wp_set_current_user( self::$contributor_id );

		$response = $this->dispatch( 'into', array( 'section' => 'posts' ), array( 'item' => self::$private_id ) );
		$this->assertNull( $response['data']['folder'] );
		$this->assertStringNotContainsString( 'PRIVATE-BODY-MARKER', $this->flatten( $response ) );

		$sub = $this->dispatch(
			'relation',
			array(
				'section' => 'posts',
				'into'    => self::$private_id,
			),
			array( 'relation' => 'author' )
		);
		$this->assertNull( $sub['data']['sub'] );
	}

	/**
	 * `WP_Query` returns every private row it is asked for unless the
	 * query says `perm => readable`, and a draft's excerpt, word count
	 * and REST meta are its body. Core's `edit.php` lists another
	 * author's draft by title only, and their private post not at all.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\fetch
	 * @covers \OpenStation\Apps\MyWordPress\count_of
	 */
	public function test_my_wordpress_list_hides_private_rows_and_draft_bodies() {
		register_post_meta(
			'post',
			'unit_secret_meta',
			array(
				'show_in_rest' => true,
				'single'       => true,
				'type'         => 'string',
			)
		);
		update_post_meta( self::$draft_id, 'unit_secret_meta', 'META-MARKER' );

		wp_set_current_user( self::$contributor_id );
		$response = $this->dispatch( 'refresh', array( 'section' => 'posts' ) );
		unregister_post_meta( 'post', 'unit_secret_meta' );

		$rows = array_column( $response['data']['list']['items'], null, 'id' );
		$this->assertArrayNotHasKey( self::$private_id, $rows, 'Another author\'s private post is not listed.' );
		$this->assertArrayHasKey( self::$draft_id, $rows, 'A draft lists by title, as on edit.php.' );
		$this->assertSame( '', $rows[ self::$draft_id ]['excerpt'] );
		$this->assertSame( 0, $rows[ self::$draft_id ]['words'] );
		$this->assertStringNotContainsString( 'DRAFT-BODY-MARKER', $this->flatten( $response ) );
		$this->assertStringNotContainsString( 'META-MARKER', $this->flatten( $response ) );

		// The tile count agrees with the rows.
		$posts = null;
		foreach ( $response['data']['sections'] as $section ) {
			if ( 'posts' === $section['id'] ) {
				$posts = $section;
			}
		}
		$counts = wp_count_posts( 'post', 'readable' );
		$this->assertSame( (int) $counts->publish + (int) $counts->draft + (int) $counts->future + (int) $counts->pending + (int) $counts->private, $posts['count'] );
		$this->assertSame( 0, (int) $counts->private, 'The contributor counts no private post of anyone else.' );

		// The admin still lists, reads and counts everything.
		wp_set_current_user( self::$admin_id );
		$rows = array_column( $this->dispatch( 'refresh', array( 'section' => 'posts' ) )['data']['list']['items'], null, 'id' );
		$this->assertArrayHasKey( self::$private_id, $rows );
		$this->assertNotSame( 0, $rows[ self::$draft_id ]['words'] );
	}

	/**
	 * A sub-row id rides up with the state too: the author pane opened
	 * the account dossier — email, role, registration date — of ANY
	 * user id, and the author row's subtitle was the author's email.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\sub_detail
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_my_wordpress_author_pane_holds_to_the_post_and_hides_account_facts() {
		$admin_email = get_userdata( self::$admin_id )->user_email;
		$state       = array(
			'section'  => 'posts',
			'into'     => self::$public_id,
			'relation' => 'author',
		);
		wp_set_current_user( self::$contributor_id );

		$foreign = $this->dispatch( 'open', $state, array( 'item' => self::$editor_id ) );
		$this->assertNull( $foreign['data']['subDetail'], 'A user who is not the post\'s author has no pane here.' );

		$author = $this->dispatch( 'open', $state, array( 'item' => self::$admin_id ) );
		$this->assertSame( 'user', $author['data']['subDetail']['kind'] );
		$this->assertNotContains( __( 'Email', 'desktop-mode' ), array_column( $author['data']['subDetail']['detail']['facts'], 0 ) );
		$this->assertSame( '', $author['data']['sub']['rows'][0]['subtitle'] );
		$this->assertStringNotContainsString( $admin_email, $this->flatten( $author['data']['sub'] ) );
		$this->assertStringNotContainsString( $admin_email, $this->flatten( $author['data']['subDetail']['detail'] ) );

		// A caller who may list users sees the account facts as before.
		wp_set_current_user( self::$admin_id );
		$author = $this->dispatch( 'open', $state, array( 'item' => self::$admin_id ) );
		$this->assertContains( __( 'Email', 'desktop-mode' ), array_column( $author['data']['subDetail']['detail']['facts'], 0 ) );
	}

	/**
	 * The media pane opened any attachment id, not one of the post's.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\sub_detail
	 */
	public function test_my_wordpress_media_pane_refuses_an_attachment_of_another_post() {
		wp_set_current_user( self::$admin_id );
		$elsewhere = self::factory()->attachment->create_object(
			'elsewhere.jpg',
			self::$private_id,
			array( 'post_mime_type' => 'image/jpeg' )
		);

		wp_set_current_user( self::$contributor_id );
		$response = $this->dispatch(
			'open',
			array(
				'section'  => 'posts',
				'into'     => self::$public_id,
				'relation' => 'media',
			),
			array( 'item' => $elsewhere )
		);
		$this->assertNull( $response['data']['subDetail'] );
	}

	/**
	 * `get_comments()` answers pending rows, and revisions are read on
	 * `edit_post`: neither reaches a Contributor through another
	 * author's published post.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_my_wordpress_sub_lists_withhold_pending_comments_and_revisions() {
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => self::$public_id,
				'comment_approved' => '0',
				'comment_author'   => 'Held back',
				'comment_content'  => 'PENDING-COMMENT-MARKER',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => self::$public_id,
				'comment_approved' => '1',
				'comment_author'   => 'Out loud',
				'comment_content'  => 'Approved words',
			)
		);
		wp_set_current_user( self::$admin_id );
		wp_update_post(
			array(
				'ID'           => self::$public_id,
				'post_content' => 'Public body, revised',
			)
		);
		$state = array(
			'section' => 'posts',
			'into'    => self::$public_id,
		);

		wp_set_current_user( self::$contributor_id );
		$comments = $this->dispatch( 'relation', $state, array( 'relation' => 'comments' ) );
		$titles   = array_column( $comments['data']['sub']['rows'], 'title' );
		$this->assertContains( 'Out loud', $titles );
		$this->assertNotContains( 'Held back', $titles );
		$this->assertStringNotContainsString( 'PENDING-COMMENT-MARKER', $this->flatten( $comments ) );

		$revisions = $this->dispatch( 'relation', $state, array( 'relation' => 'revisions' ) );
		$this->assertSame( array(), $revisions['data']['sub']['rows'] );

		wp_set_current_user( self::$admin_id );
		$comments = $this->dispatch( 'relation', $state, array( 'relation' => 'comments' ) );
		$this->assertContains( 'Held back', array_column( $comments['data']['sub']['rows'], 'title' ) );
		$this->assertNotEmpty( $this->dispatch( 'relation', $state, array( 'relation' => 'revisions' ) )['data']['sub']['rows'] );
	}

	// ------------------------------------------- My WordPress quick edit

	/**
	 * A private post is a published one: Core turns a Contributor's
	 * `private` into `pending`. The quick edit only checked `publish`.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\quick_edit_action
	 */
	public function test_my_wordpress_quick_edit_refuses_private_without_publish_posts() {
		wp_set_current_user( self::$contributor_id );
		$own = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => self::$contributor_id,
			)
		);

		$this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'  => array( $own ),
				'status' => 'private',
			)
		);
		$this->assertSame( 'draft', get_post_status( $own ) );
	}

	/**
	 * Stickiness is a front-page placement Core offers only to a caller
	 * holding `edit_others_posts` AND `publish_posts`; an Author could
	 * pin their own post to the top of the home page.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\quick_edit_action
	 */
	public function test_my_wordpress_quick_edit_refuses_sticky_without_edit_others_posts() {
		wp_set_current_user( self::$author_id );
		$own = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => self::$author_id,
			)
		);

		$this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'    => array( $own ),
				'sticky'   => 'sticky',
				'comments' => 'closed',
			)
		);
		$this->assertFalse( is_sticky( $own ), 'The sticky pick is dropped.' );
		$this->assertSame( 'closed', get_post( $own )->comment_status, 'The other picks still apply.' );

		// An Editor may.
		wp_set_current_user( self::$editor_id );
		$this->dispatch(
			'quick-edit',
			array( 'section' => 'posts' ),
			array(
				'items'  => array( $own ),
				'sticky' => 'sticky',
			)
		);
		$this->assertTrue( is_sticky( $own ) );
	}

	// -------------------------------------------- REST fields and meta

	/**
	 * `/wp/v2/users/<id>` answers in `view` context to anyone for an
	 * author with a published post, so the personal options and contact
	 * methods registered with a `view` context were public.
	 *
	 * @covers ::openstation_user_edit_window_register_meta
	 */
	public function test_profile_meta_is_not_readable_logged_out() {
		$phone = static function ( $methods ) {
			$methods['unit_phone'] = 'Phone';
			return $methods;
		};
		add_filter( 'user_contactmethods', $phone );
		// A fresh server re-runs `rest_api_init`, so the meta registers
		// (priority 5) before the users controller builds its schema,
		// the order a real request has.
		$GLOBALS['wp_rest_server'] = null;
		update_user_meta( self::$admin_id, 'unit_phone', '+1-555-0100' );
		update_user_meta( self::$admin_id, 'admin_color', 'midnight' );

		wp_set_current_user( 0 );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/users/' . self::$admin_id ) );
		$this->assertSame( 200, $response->get_status(), 'The author of a published post is publicly listed.' );
		$data = $response->get_data();
		$meta = isset( $data['meta'] ) ? (array) $data['meta'] : array();
		$this->assertArrayNotHasKey( 'unit_phone', $meta );
		$this->assertArrayNotHasKey( 'admin_color', $meta );
		$this->assertStringNotContainsString( '555-0100', $this->flatten( $data ) );

		// The profile form's own read, in `edit` context, still has them.
		wp_set_current_user( self::$admin_id );
		$request = new WP_REST_Request( 'GET', '/wp/v2/users/' . self::$admin_id );
		$request->set_param( 'context', 'edit' );
		$meta = (array) rest_do_request( $request )->get_data()['meta'];
		remove_filter( 'user_contactmethods', $phone );
		$GLOBALS['wp_rest_server'] = null;
		$this->assertSame( '+1-555-0100', $meta['unit_phone'] );
		$this->assertSame( 'midnight', $meta['admin_color'] );
	}

	/**
	 * The moderation signals rode every `/wp/v2/comments` row,
	 * logged-out ones included.
	 *
	 * @covers ::openstation_comments_window_register_rest_fields
	 */
	public function test_comment_moderation_fields_are_not_readable_logged_out() {
		openstation_comments_window_register_rest_fields();
		$comment = self::factory()->comment->create(
			array(
				'comment_post_ID'  => self::$public_id,
				'comment_approved' => '1',
			)
		);
		update_comment_meta( $comment, 'akismet_result', 'false' );

		wp_set_current_user( 0 );
		$data = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/comments/' . $comment ) )->get_data();
		$this->assertSame( $comment, $data['id'] );
		foreach ( array( 'openstation_spam_score', 'openstation_akismet', 'openstation_ai_verdict' ) as $field ) {
			$this->assertArrayNotHasKey( $field, $data );
		}

		wp_set_current_user( self::$editor_id );
		$request = new WP_REST_Request( 'GET', '/wp/v2/comments/' . $comment );
		$request->set_param( 'context', 'edit' );
		$data = rest_do_request( $request )->get_data();
		$this->assertArrayHasKey( 'openstation_spam_score', $data );
		$this->assertSame( 'false', $data['openstation_akismet'] );
	}

	/**
	 * `openstation_count` counted drafts and private posts for every
	 * caller of `/wp/v2/categories`: an oracle for "an unpublished post
	 * sits in this term".
	 *
	 * @covers ::openstation_posts_window_term_count_any
	 */
	public function test_term_count_field_counts_unpublished_posts_only_for_editors() {
		openstation_posts_window_register_count_field();
		$term = self::factory()->category->create( array( 'name' => 'Layoffs' ) );
		wp_set_post_categories( self::$draft_id, array( $term ) );
		wp_set_post_categories( self::$private_id, array( $term ) );

		wp_set_current_user( 0 );
		$data = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/categories/' . $term ) )->get_data();
		$this->assertSame( 0, $data['openstation_count'] );

		wp_set_current_user( self::$editor_id );
		$data = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/categories/' . $term ) )->get_data();
		$this->assertSame( 2, $data['openstation_count'] );
	}

	/**
	 * `moderate_comments` (an Editor) could map any email address to its
	 * account — the oracle Core closed on `/wp/v2/users?search=`.
	 *
	 * @covers ::openstation_comments_window_author_insights
	 */
	public function test_comment_author_insights_name_the_account_only_for_list_users() {
		$email = get_userdata( self::$author_id )->user_email;

		wp_set_current_user( self::$editor_id );
		$insights = openstation_comments_window_author_insights( $email );
		$this->assertSame( 0, $insights['userId'] );
		$this->assertSame( '', $insights['userName'] );

		wp_set_current_user( self::$admin_id );
		$insights = openstation_comments_window_author_insights( $email );
		$this->assertSame( self::$author_id, $insights['userId'] );
	}

	/**
	 * A password seals the discussion as well as the body: Core's REST
	 * comments controller withholds every comment of a sealed post from
	 * a caller who cannot edit it, and the Comments relation, and the
	 * count on its folder, follow that rule.
	 *
	 * @covers \OpenStation\Apps\MyWordPress\folder
	 * @covers \OpenStation\Apps\MyWordPress\sub
	 */
	public function test_my_wordpress_withholds_a_sealed_posts_comments() {
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => self::$sealed_id,
				'comment_author'   => 'Insider',
				'comment_content'  => 'SEALED-COMMENT-MARKER',
				'comment_approved' => 1,
			)
		);
		$state = array(
			'section' => 'posts',
			'into'    => self::$sealed_id,
		);

		wp_set_current_user( self::$contributor_id );
		$folder = $this->dispatch( 'into', array( 'section' => 'posts' ), array( 'item' => self::$sealed_id ) )['data']['folder'];
		$counts = array_column( $folder['folders'], 'count', 'relation' );
		$this->assertSame( 0, $counts['comments'] );

		$comments = $this->dispatch( 'relation', $state, array( 'relation' => 'comments' ) );
		$this->assertSame( array(), $comments['data']['sub']['rows'] );
		$this->assertStringNotContainsString( 'SEALED-COMMENT-MARKER', $this->flatten( $comments ) );
		$this->assertStringNotContainsString( 'Insider', $this->flatten( $comments ) );

		wp_set_current_user( self::$admin_id );
		$comments = $this->dispatch( 'relation', $state, array( 'relation' => 'comments' ) );
		$this->assertContains( 'Insider', array_column( $comments['data']['sub']['rows'], 'title' ) );
	}
}
