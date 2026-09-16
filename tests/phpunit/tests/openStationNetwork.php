<?php
/**
 * An OpenStation network of separate installs: the identity every
 * install publishes, the hub's registry and list, and a member's join.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @covers ::openstation_network_keypair
 * @covers ::openstation_network_sign
 * @covers ::openstation_network_verify
 * @covers ::openstation_network_is_public_key
 * @covers ::openstation_network_identity
 * @covers ::openstation_network_fetch_identity
 * @covers ::openstation_network_add_member
 * @covers ::openstation_network_remove_member
 * @covers ::openstation_network_check_member
 * @covers ::openstation_network_member_by_key
 * @covers ::openstation_network_hub_list
 * @covers ::openstation_rest_network_list_permission
 * @covers ::openstation_network_request_signer
 * @covers ::openstation_network_join
 * @covers ::openstation_network_leave
 * @covers ::openstation_network_refresh_list
 * @covers ::openstation_network_member_payload
 * @covers ::openstation_network_hub_payload
 * @covers ::openstation_multisite_payload
 * @covers ::openstation_native_window_offered_here
 * @covers ::openstation_network_mint_hop
 * @covers ::openstation_network_verify_hop
 * @covers ::openstation_network_hop_issuer_key
 * @covers ::openstation_network_hop_user
 * @covers ::openstation_network_hop_landing
 * @covers ::openstation_rest_network_hop
 */
class Tests_OpenStation_Network extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/** The remote handler `pre_http_request` routes to, when set. */
	protected $remote = null;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
		// The mint route is for users who can open the shell at all.
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
	}

	public function set_up() {
		parent::set_up();
		openstation_network_option_delete( OPENSTATION_NETWORK_KEYPAIR_OPTION );
		openstation_network_option_delete( OPENSTATION_NETWORK_MEMBERS_OPTION );
		openstation_network_option_delete( OPENSTATION_NETWORK_HUB_OPTION );
		add_filter( 'pre_http_request', array( $this, 'route_remote' ), 10, 3 );
	}

	public function tear_down() {
		remove_filter( 'pre_http_request', array( $this, 'route_remote' ), 10 );
		$this->remote = null;
		openstation_network_option_delete( OPENSTATION_NETWORK_KEYPAIR_OPTION );
		openstation_network_option_delete( OPENSTATION_NETWORK_MEMBERS_OPTION );
		openstation_network_option_delete( OPENSTATION_NETWORK_HUB_OPTION );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * Hand every HTTP request to the test's handler; a test without one
	 * refuses the network.
	 */
	public function route_remote( $pre, $args, $url ) {
		if ( is_callable( $this->remote ) ) {
			return call_user_func( $this->remote, $url, $args );
		}
		return new WP_Error( 'http_request_failed', 'No network in tests.' );
	}

	/** A JSON response as `wp_remote_get()` returns one. */
	protected static function json_response( $body, $code = 200 ) {
		return array(
			'response' => array( 'code' => $code ),
			'body'     => wp_json_encode( $body ),
		);
	}

	/** A fresh keypair for a pretend remote install. */
	protected static function remote_keypair() {
		$pair = sodium_crypto_sign_keypair();
		return array(
			'public' => sodium_bin2base64( sodium_crypto_sign_publickey( $pair ), SODIUM_BASE64_VARIANT_ORIGINAL ),
			'secret' => sodium_crypto_sign_secretkey( $pair ),
		);
	}

	/** The identity a pretend member publishes. */
	protected static function member_identity( $public, array $over = array() ) {
		return array_merge(
			array(
				'url'       => 'https://member.test/',
				'name'      => 'Member',
				'shellUrl'  => 'https://member.test/wp-admin/admin.php?page=openstation',
				'publicKey' => $public,
				'multisite' => false,
			),
			$over
		);
	}

	/** Signed headers for a request from a pretend install. */
	protected static function signed_headers( array $pair, $route, $timestamp = null ) {
		$timestamp = null === $timestamp ? time() : $timestamp;
		$message   = openstation_network_request_message( 'GET', $route, $timestamp );
		return array(
			'X-OpenStation-Key'       => $pair['public'],
			'X-OpenStation-Timestamp' => (string) $timestamp,
			'X-OpenStation-Signature' => sodium_bin2base64( sodium_crypto_sign_detached( $message, $pair['secret'] ), SODIUM_BASE64_VARIANT_ORIGINAL ),
		);
	}

	/** A REST GET with headers. */
	protected static function rest_get( $route, array $headers = array() ) {
		$request = new WP_REST_Request( 'GET', $route );
		foreach ( $headers as $name => $value ) {
			$request->set_header( $name, $value );
		}
		return rest_do_request( $request );
	}

	// ---------------------------------------------------------- identity

	public function test_the_network_is_off_by_default_and_its_option_turns_it_on() {
		remove_filter( 'openstation_network_enabled', '__return_true' );
		try {
			$this->assertFalse( openstation_network_enabled(), 'Off by default: opt-in.' );
			wp_set_current_user( self::$admin_id );
			if ( is_multisite() ) {
				$block = openstation_multisite_payload();
				$this->assertIsArray( $block, 'A multisite keeps the switcher it has on its own.' );
				$this->assertArrayNotHasKey( 'hopUrl', $block, 'No token route while the module is off.' );
				$this->assertNotContains( 'member', wp_list_pluck( $block['sites'], 'kind' ) );
			} else {
				$this->assertNull( openstation_multisite_payload(), 'A single site has a switcher only as part of a network.' );
			}
			openstation_save_extended_options( array( 'network' => true ) );
			$this->assertTrue( openstation_network_enabled(), 'The extended option turns it on.' );
			$this->assertTrue( openstation_get_extended_options()['network'] );
		} finally {
			add_filter( 'openstation_network_enabled', '__return_true' );
			delete_option( OPENSTATION_EXTENDED_OPTIONS_KEY );
		}
	}

	public function test_keypair_is_generated_once_and_signs_verifiably() {
		$first  = openstation_network_public_key();
		$second = openstation_network_public_key();
		$this->assertSame( $first, $second, 'One keypair per install, kept.' );
		$this->assertTrue( openstation_network_is_public_key( $first ) );

		$signature = openstation_network_sign( 'hello' );
		$this->assertTrue( openstation_network_verify( 'hello', $signature, $first ) );
		$this->assertFalse( openstation_network_verify( 'hellp', $signature, $first ), 'A changed message fails.' );
		$this->assertFalse( openstation_network_verify( 'hello', $signature, self::remote_keypair()['public'] ), 'Another key fails.' );
		$this->assertFalse( openstation_network_verify( 'hello', 'not base64!', $first ) );
		$this->assertFalse( openstation_network_is_public_key( 'short' ) );
		$this->assertFalse( openstation_network_is_public_key( array() ) );
	}

	public function test_identity_route_is_public_and_carries_the_key() {
		$response = self::rest_get( '/desktop-mode/v1/network/identity' );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( openstation_network_public_key(), $data['publicKey'] );
		$this->assertSame( is_multisite(), $data['multisite'] );
		$this->assertStringContainsString( 'page=openstation', $data['shellUrl'] );
	}

	// ---------------------------------------------------------- registry

	public function test_add_member_pins_the_identity_it_fetched() {
		$pair         = self::remote_keypair();
		$this->remote = static function ( $url ) use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};

		$member = openstation_network_add_member( 'https://member.test' );
		$this->assertIsArray( $member );
		$this->assertSame( 'https://member.test/', $member['url'] );
		$this->assertSame( $pair['public'], $member['publicKey'] );
		$this->assertSame( 'paired', $member['status'] );
		$this->assertSame( $member, openstation_network_member_by_key( $pair['public'] ) );

		$again = openstation_network_add_member( 'https://MEMBER.test/' );
		$this->assertWPError( $again );
		$this->assertSame( 'openstation_network_exists', $again->get_error_code() );

		$self = openstation_network_add_member( is_multisite() ? network_home_url( '/' ) : home_url( '/' ) );
		$this->assertSame( 'openstation_network_self', $self->get_error_code() );

		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'], array( 'url' => 'https://other.test/', 'multisite' => true ) ) );
		};
		$this->assertSame( 'openstation_network_is_network', openstation_network_add_member( 'https://other.test' )->get_error_code() );

		$this->remote = static function () {
			return new WP_Error( 'http_request_failed', 'timed out' );
		};
		$this->assertWPError( openstation_network_add_member( 'https://gone.test' ) );

		$this->assertTrue( openstation_network_remove_member( $member['id'] ) );
		$this->assertFalse( openstation_network_remove_member( $member['id'] ) );
		$this->assertNull( openstation_network_member_by_key( $pair['public'] ) );
	}

	public function test_check_member_flags_a_changed_key_and_keeps_the_pinned_one() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );

		$other        = self::remote_keypair();
		$this->remote = static function () use ( $other ) {
			return self::json_response( self::member_identity( $other['public'], array( 'name' => 'Reinstalled' ) ) );
		};
		$checked = openstation_network_check_member( $member['id'] );
		$this->assertSame( 'key-changed', $checked['status'] );
		$this->assertSame( $pair['public'], $checked['publicKey'], 'The pinned key stays.' );
		$this->assertSame( 'Member', $checked['name'], 'Nothing from the unverified identity is taken.' );

		$this->remote = static function () {
			return new WP_Error( 'http_request_failed', 'timed out' );
		};
		$this->assertSame( 'unreachable', openstation_network_check_member( $member['id'] )['status'] );

		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'], array( 'name' => 'Renamed' ) ) );
		};
		$checked = openstation_network_check_member( $member['id'] );
		$this->assertSame( 'paired', $checked['status'] );
		$this->assertSame( 'Renamed', $checked['name'] );
		$this->assertNull( openstation_network_check_member( 'nope' ) );
	}

	// --------------------------------------------------------------- hub

	public function test_hub_list_requires_a_pinned_signer_or_an_administrator() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );
		$route  = '/desktop-mode/v1/network';

		$this->assertSame( 403, self::rest_get( $route )->get_status(), 'Unsigned and anonymous.' );
		$this->assertSame( 403, self::rest_get( $route, self::signed_headers( self::remote_keypair(), $route ) )->get_status(), 'A key the hub never pinned.' );
		$this->assertSame( 403, self::rest_get( $route, self::signed_headers( $pair, $route, time() - 3600 ) )->get_status(), 'A stale signature.' );
		$this->assertSame( 403, self::rest_get( $route, self::signed_headers( $pair, '/somewhere/else' ) )->get_status(), 'A signature over another route.' );

		$response = self::rest_get( $route, self::signed_headers( $pair, $route ) );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( openstation_network_public_key(), $data['publicKey'] );
		$ids = wp_list_pluck( $data['sites'], 'id' );
		$this->assertContains( 'member:' . $member['id'], $ids );
		$this->assertSame( 'member', end( $data['sites'] )['kind'], 'Members come after the local sites.' );
		if ( is_multisite() ) {
			$this->assertContains( (string) get_current_blog_id(), $ids );
			$this->assertNotEmpty( $data['networkAdmin']['rows'] );
		} else {
			$this->assertContains( 'hub', $ids );
			$this->assertNull( $data['networkAdmin'] );
		}

		wp_set_current_user( self::$editor_id );
		$this->assertSame( 403, self::rest_get( $route )->get_status(), 'An editor is not an administrator.' );
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 200, self::rest_get( $route )->get_status(), 'An administrator reads it without signing.' );
	}

	// ------------------------------------------------------------ member

	public function test_join_pins_the_hub_and_fetches_the_list() {
		if ( is_multisite() ) {
			$this->assertSame( 'openstation_network_is_network', openstation_network_join( 'https://hub.test' )->get_error_code() );
			return;
		}
		$hub  = self::remote_keypair();
		$me   = openstation_network_public_key();
		$seen = array();

		$this->remote = static function ( $url, $args ) use ( $hub, $me, &$seen ) {
			$seen[] = $url;
			if ( false !== strpos( $url, '/network/identity' ) ) {
				return self::json_response(
					array(
						'url'       => 'https://hub.test/',
						'name'      => 'The Network',
						'shellUrl'  => 'https://hub.test/wp-admin/network/admin.php?page=openstation',
						'publicKey' => $hub['public'],
						'multisite' => true,
					)
				);
			}
			// The list: only a request this install signed is answered.
			if ( empty( $args['headers']['X-OpenStation-Key'] ) || $args['headers']['X-OpenStation-Key'] !== $me ) {
				return self::json_response( array( 'message' => 'not a member' ), 403 );
			}
			return self::json_response(
				array(
					'name'         => 'The Network',
					'networkAdmin' => array(
						'url'      => 'https://hub.test/wp-admin/network/',
						'shellUrl' => 'https://hub.test/wp-admin/network/admin.php?page=openstation',
						'rows'     => array( array( 'title' => 'Sites', 'url' => 'https://hub.test/wp-admin/network/sites.php' ) ),
					),
					'sites'        => array(
						array( 'id' => '1', 'name' => 'Main', 'shellUrl' => 'https://hub.test/wp-admin/admin.php?page=openstation', 'kind' => 'local' ),
						array( 'id' => 'member:abc', 'name' => 'Me', 'shellUrl' => 'https://me.test/wp-admin/admin.php?page=openstation', 'kind' => 'member', 'publicKey' => $me ),
					),
				)
			);
		};

		$joined = openstation_network_join( 'https://hub.test' );
		$this->assertIsArray( $joined );
		$this->assertSame( $hub['public'], $joined['publicKey'] );
		$this->assertSame( '', $joined['error'] );
		$this->assertCount( 2, $joined['list']['sites'] );
		$this->assertTrue( openstation_network_is_member() );

		wp_set_current_user( self::$admin_id );
		$payload = openstation_network_member_payload();
		$this->assertSame( 'member:abc', $payload['current'], 'This site is the entry carrying its key.' );
		$this->assertSame( array( '1', 'member:abc' ), wp_list_pluck( $payload['sites'], 'id' ) );
		$this->assertSame( 'https://hub.test/wp-admin/network/admin.php?page=openstation', $payload['networkAdmin']['shellUrl'] );
		$config = openstation_multisite_payload();
		$this->assertStringContainsString( '/network/hop', $config['hopUrl'], 'And the route to mint a hop token.' );
		unset( $config['hopUrl'] );
		$this->assertSame( $payload, $config, 'The shell config carries it as its multisite block.' );

		wp_set_current_user( self::$editor_id );
		$this->assertNull( openstation_network_member_payload()['networkAdmin'], 'The Network Admin tile is for administrators.' );

		$this->assertTrue( openstation_network_leave() );
		$this->assertFalse( openstation_network_is_member() );
		$this->assertNull( openstation_network_member_payload() );
	}

	public function test_join_before_the_hub_added_this_site_records_it_and_waits() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'A member is a single site.' );
		}
		$hub          = self::remote_keypair();
		$this->remote = static function ( $url ) use ( $hub ) {
			if ( false !== strpos( $url, '/network/identity' ) ) {
				return self::json_response( self::member_identity( $hub['public'], array( 'url' => 'https://hub.test/', 'name' => 'The Network' ) ) );
			}
			return self::json_response( array( 'message' => 'This site is not a member of the network. Add it on the network first.' ), 403 );
		};

		$joined = openstation_network_join( 'https://hub.test' );
		$this->assertIsArray( $joined );
		$this->assertNull( $joined['list'] );
		$this->assertStringContainsString( 'not a member', $joined['error'] );
		$this->assertNull( openstation_network_member_payload(), 'No list, no switcher yet.' );
		$this->assertFalse( wp_next_scheduled( OPENSTATION_NETWORK_REFRESH_HOOK ), 'Just tried; no point asking again this minute.' );

		// Minutes later, painting the shell asks the hub again in the
		// background, so the hub adding this site is enough on its own.
		$stored          = openstation_network_option_get( OPENSTATION_NETWORK_HUB_OPTION );
		$stored['tried'] = time() - OPENSTATION_NETWORK_RETRY - 1;
		openstation_network_option_set( OPENSTATION_NETWORK_HUB_OPTION, $stored );
		$this->assertNull( openstation_network_member_payload(), 'Still no list on this request.' );
		$this->assertNotFalse( wp_next_scheduled( OPENSTATION_NETWORK_REFRESH_HOOK ), 'But the retry is scheduled.' );

		// The hub has added this site by the time the retry runs.
		$me           = openstation_network_public_key();
		$this->remote = static function ( $url, $args ) use ( $hub, $me ) {
			if ( false !== strpos( $url, '/network/identity' ) ) {
				return self::json_response( self::member_identity( $hub['public'], array( 'url' => 'https://hub.test/', 'name' => 'The Network' ) ) );
			}
			return self::json_response(
				array(
					'name'  => 'The Network',
					'sites' => array(
						array( 'id' => '1', 'name' => 'Main', 'shellUrl' => 'https://hub.test/wp-admin/admin.php?page=openstation', 'kind' => 'local' ),
						array( 'id' => 'member:abc', 'name' => 'Me', 'shellUrl' => 'https://me.test/wp-admin/admin.php?page=openstation', 'kind' => 'member', 'publicKey' => $me ),
					),
				)
			);
		};
		do_action( OPENSTATION_NETWORK_REFRESH_HOOK );
		wp_clear_scheduled_hook( OPENSTATION_NETWORK_REFRESH_HOOK );
		$payload = openstation_network_member_payload();
		$this->assertSame( array( '1', 'member:abc' ), wp_list_pluck( $payload['sites'], 'id' ), 'The switcher appears; nobody pressed Sync.' );
		$this->assertSame( '', openstation_network_hub()['error'] );

		// A site that is nobody's member shows nothing either.
		openstation_network_leave();
		wp_set_current_user( self::$admin_id );
		$this->assertNull( openstation_multisite_payload() );
	}

	public function test_a_hub_lists_itself_then_its_members() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );
		wp_set_current_user( self::$admin_id );

		$payload = openstation_multisite_payload();
		$ids     = wp_list_pluck( $payload['sites'], 'id' );
		$this->assertSame( 'member:' . $member['id'], end( $ids ), 'Members come last.' );
		if ( is_multisite() ) {
			$this->assertSame( (string) get_current_blog_id(), $payload['current'] );
			$this->assertContains( (string) get_current_blog_id(), $ids );
		} else {
			$this->assertSame( 'hub', $payload['current'] );
			$this->assertSame( 'hub', $ids[0] );
			$this->assertNull( $payload['networkAdmin'] );
		}
	}

	// --------------------------------------------------------------- hop

	/** A token as a pretend install would mint it, signed with its key. */
	protected static function foreign_token( array $pair, array $over = array() ) {
		$now     = time();
		$payload = array_merge(
			array(
				'v'     => 2,
				'iss'   => 'https://member.test/',
				'aud'   => openstation_network_identity()['url'],
				'sub'   => '77',
				'email' => 'visitor@example.org',
				'name'  => 'Visitor',
				'dir'   => 'next',
				'iat'  => $now,
				'exp'  => $now + 60,
				'jti'  => bin2hex( random_bytes( 8 ) ),
			),
			$over
		);
		$json = wp_json_encode( $payload );
		return openstation_network_hop_encode( $json ) . '.' . openstation_network_hop_encode( sodium_crypto_sign_detached( $json, $pair['secret'] ) );
	}

	public function test_mint_signs_a_token_for_a_switcher_target_only() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/network/hop' );
		$request->set_param( 'target', $member['shellUrl'] );
		$request->set_param( 'direction', 'next' );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		$minted = $response->get_data();

		$this->assertStringContainsString( 'openstation_overview=1', $minted['url'] );
		$this->assertStringContainsString( 'openstation_hop=' . $minted['token'], $minted['url'] );
		list( $body, $sig ) = explode( '.', $minted['token'] );
		$json    = openstation_network_hop_decode( $body );
		$payload = json_decode( $json, true );
		$this->assertSame( 2, $payload['v'] );
		$this->assertSame( 'https://member.test/', $payload['aud'], 'The audience is the install, by its identity URL.' );
		$this->assertSame( (string) self::$admin_id, $payload['sub'], 'The subject is the user id, which the user cannot edit.' );
		$this->assertSame( get_userdata( self::$admin_id )->user_email, $payload['email'] );
		$this->assertSame( 'next', $payload['dir'] );
		$this->assertLessThanOrEqual( 60, $payload['exp'] - $payload['iat'] );
		$this->assertTrue( openstation_network_verify( $json, sodium_bin2base64( openstation_network_hop_decode( $sig ), SODIUM_BASE64_VARIANT_ORIGINAL ), openstation_network_public_key() ), 'Signed with this install\'s key.' );

		$this->assertSame( 'openstation_hop_target', openstation_network_mint_hop( 'https://stranger.test/wp-admin/admin.php?page=openstation' )->get_error_code() );
		$this->assertSame( 'openstation_hop_target', openstation_network_mint_hop( admin_url( 'admin.php?page=openstation' ) )->get_error_code(), 'A site of this install is no target: it shares the login already.' );

		// Origin is not the line. A separate install on this very
		// hostname shares nothing but the hostname, so it is a target
		// like any other member; only the transport rule still applies.
		$members            = openstation_network_members();
		$twin               = array_values( $members )[0];
		$twin['id']         = 'twin';
		$twin['url']        = home_url( '/site-b/' );
		$twin['shellUrl']   = home_url( '/site-b/wp-admin/admin.php?page=openstation' );
		$members['twin']    = $twin;
		openstation_network_save_members( $members );
		$this->assertSame( home_url( '/site-b/' ), openstation_network_hop_targets()[ $twin['shellUrl'] ], 'Same origin, another install: a target, with that install as audience.' );
		$twin_mint = openstation_network_mint_hop( $twin['shellUrl'] );
		if ( is_wp_error( $twin_mint ) ) {
			$this->assertSame( 'openstation_hop_insecure', $twin_mint->get_error_code(), 'Over plain HTTP outside a local environment, only the transport rule stands in the way.' );
		} else {
			$twin_payload = json_decode( openstation_network_hop_decode( explode( '.', $twin_mint['token'] )[0] ), true );
			$this->assertSame( home_url( '/site-b/' ), $twin_payload['aud'], 'Minted, for that install.' );
		}

		wp_set_current_user( 0 );
		$this->assertSame( 401, rest_do_request( $request )->get_status(), 'Only a logged-in user mints.' );
	}

	public function test_verify_accepts_a_pinned_issuer_once_and_refuses_everything_else() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		openstation_network_add_member( 'https://member.test' );
		$visitor = self::factory()->user->create( array( 'user_email' => 'visitor@example.org' ) );

		$token   = self::foreign_token( $pair );
		$payload = openstation_network_verify_hop( $token );
		$this->assertIsArray( $payload );
		$this->assertSame( '77', $payload['sub'] );
		$this->assertNull( openstation_network_hop_user( $payload ), 'A matching email logs nobody in: nothing links source user 77 to anyone here yet.' );
		openstation_network_link( $visitor, array( 'iss' => 'https://member.test/', 'sub' => '77', 'name' => 'Visitor', 'email' => 'visitor@example.org', 'site' => 'Member' ) );
		$this->assertSame( $visitor, openstation_network_hop_user( $payload )->ID, 'Linked, the token logs that user in.' );
		$this->assertSame( 'openstation_hop_replay', openstation_network_verify_hop( $token )->get_error_code(), 'Once.' );

		// The takeover the linking exists to refuse: a token whose email
		// is an administrator's, minted for some other source account.
		$admin_email = get_userdata( self::$admin_id )->user_email;
		$forged      = openstation_network_verify_hop( self::foreign_token( $pair, array( 'sub' => '78', 'email' => $admin_email ) ) );
		$this->assertIsArray( $forged, 'Validly signed, so it verifies…' );
		$this->assertNull( openstation_network_hop_user( $forged ), '…and logs nobody in: the email is the source user\'s to edit, not proof of an account here.' );
		if ( is_multisite() ) {
			// Spent on one site of the origin, spent on every site: the
			// claim lives in the main site's table, not a per-site transient.
			$fresh = self::foreign_token( $pair );
			$this->assertIsArray( openstation_network_verify_hop( $fresh ) );
			switch_to_blog( self::factory()->blog->create() );
			$this->assertSame( 'openstation_hop_replay', openstation_network_verify_hop( $fresh )->get_error_code(), 'Install-wide.' );
			restore_current_blog();
		}

		$this->assertNull( openstation_network_hop_user( array( 'iss' => 'https://member.test/', 'sub' => '9999' ) ), 'A URL never creates a user.' );
		$this->assertSame( 'openstation_hop_expired', openstation_network_verify_hop( self::foreign_token( $pair, array( 'exp' => time() - 3600, 'iat' => time() - 3700 ) ) )->get_error_code() );
		$this->assertSame( 'openstation_hop_audience', openstation_network_verify_hop( self::foreign_token( $pair, array( 'aud' => 'https://elsewhere.test/' ) ) )->get_error_code() );
		$this->assertSame( 'openstation_hop_malformed', openstation_network_verify_hop( self::foreign_token( $pair, array( 'v' => 1 ) ) )->get_error_code(), 'The email-subject token is not a token any more.' );
		$this->assertSame( 'openstation_hop_issuer', openstation_network_verify_hop( self::foreign_token( $pair, array( 'iss' => 'https://stranger.test/' ) ) )->get_error_code() );
		$this->assertSame( 'openstation_hop_signature', openstation_network_verify_hop( self::foreign_token( self::remote_keypair() ) )->get_error_code(), 'A pinned issuer, another key.' );
		$this->assertSame( 'openstation_hop_malformed', openstation_network_verify_hop( 'not.a.token' )->get_error_code() );

		// A token this install minted for itself (a mapped domain of the
		// same install) verifies against its own key.
		$own = self::foreign_token(
			array( 'secret' => sodium_base642bin( openstation_network_keypair()['secret'], SODIUM_BASE64_VARIANT_ORIGINAL ) ),
			array( 'iss' => openstation_network_identity()['url'] )
		);
		$this->assertIsArray( openstation_network_verify_hop( $own ) );
	}

	public function test_a_link_is_offered_to_the_user_logged_in_here_and_answered_from_that_session() {
		$pair         = self::remote_keypair();
		$this->remote = static function () use ( $pair ) {
			return self::json_response( self::member_identity( $pair['public'] ) );
		};
		openstation_network_add_member( 'https://member.test' );
		$payload = openstation_network_verify_hop( self::foreign_token( $pair, array( 'sub' => '78', 'name' => 'Visitor', 'email' => 'visitor@example.org' ) ) );

		// Nobody logged in: no offer to anyone, and nothing in the config.
		$this->assertNull( openstation_network_link_offer() );

		wp_set_current_user( self::$admin_id );
		openstation_network_offer_link( self::$admin_id, $payload );
		$offer = openstation_network_link_offer();
		$this->assertSame( array( 'site' => 'Member', 'name' => 'Visitor', 'email' => 'visitor@example.org' ), array_intersect_key( $offer, array_flip( array( 'site', 'name', 'email' ) ) ) );
		$this->assertStringContainsString( '/desktop-mode/v1/network/link', $offer['url'] );

		// No, and not asked again for that account.
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/network/link' );
		$request->set_param( 'accept', false );
		$this->assertSame( array( 'linked' => false ), rest_do_request( $request )->get_data() );
		$this->assertNull( openstation_network_link_offer(), 'Answered.' );
		openstation_network_offer_link( self::$admin_id, $payload );
		$this->assertNull( openstation_network_link_offer(), 'Declined once, not offered again.' );
		$this->assertNull( openstation_network_hop_user( $payload ) );

		// Yes, for another source account: from then on its token logs this user in.
		$other = openstation_network_verify_hop( self::foreign_token( $pair, array( 'sub' => '79', 'name' => 'Visitor', 'email' => 'visitor@example.org' ) ) );
		openstation_network_offer_link( self::$admin_id, $other );
		$request->set_param( 'accept', true );
		$this->assertSame( array( 'linked' => true ), rest_do_request( $request )->get_data() );
		$this->assertSame( self::$admin_id, openstation_network_hop_user( $other )->ID );
		$this->assertSame( 404, rest_do_request( $request )->get_status(), 'Nothing left to answer.' );
		$links = openstation_network_linked_accounts( self::$admin_id );
		$this->assertCount( 1, $links );
		$this->assertSame( array( 'site' => 'Member', 'name' => 'Visitor', 'email' => 'visitor@example.org' ), array_values( $links )[0] );

		// The Network window lists it and undoes it.
		$html = openstation_apps_runtime()->dispatch( 'openstation-network', array( 'action' => 'mount', 'state' => array(), 'args' => array() ), openstation_apps_os() )['html'];
		$this->assertStringContainsString( 'Linked accounts', $html );
		$this->assertStringContainsString( 'visitor@example.org', $html );
		$response = openstation_apps_runtime()->dispatch( 'openstation-network', array( 'action' => 'unlink', 'state' => array(), 'args' => array( 'key' => array_keys( $links )[0] ) ), openstation_apps_os() );
		$this->assertStringContainsString( 'Unlinked', $response['state']['notice'] );
		$this->assertNull( openstation_network_hop_user( $other ), 'And the token logs nobody in again.' );

		wp_set_current_user( 0 );
		$this->assertSame( 401, rest_do_request( $request )->get_status(), 'Only a logged-in session answers.' );
	}

	public function test_landing_drops_the_token_and_keeps_the_direction() {
		$_GET[ OPENSTATION_NETWORK_HOP_ARG ]     = 'abc.def';
		$_GET[ OPENSTATION_SHELL_OVERVIEW_ARG ] = '1';
		$_SERVER['REQUEST_URI']                 = '/wp-admin/admin.php?page=openstation&openstation_overview=1&openstation_hop=abc.def';

		$landing = openstation_network_hop_landing( 'prev' );
		$this->assertStringNotContainsString( 'openstation_hop=', $landing );
		$this->assertStringContainsString( 'openstation_overview=1', $landing );
		$this->assertStringContainsString( 'openstation_hop_from=prev', $landing );
		$this->assertStringNotContainsString( 'openstation_hop_from', openstation_network_hop_landing( '' ) );

		// A direction the request carried goes with the token: only the
		// token's own direction reaches the landing URL.
		$_SERVER['REQUEST_URI'] = '/wp-admin/admin.php?page=openstation&openstation_hop_from=next&openstation_hop=abc.def';
		$this->assertStringNotContainsString( 'openstation_hop_from', openstation_network_hop_landing( '' ) );
		$this->assertStringContainsString( 'openstation_hop_from=prev', openstation_network_hop_landing( 'prev' ) );
		$this->assertStringNotContainsString( 'openstation_hop_from=next', openstation_network_hop_landing( 'prev' ) );

		unset( $_GET[ OPENSTATION_NETWORK_HOP_ARG ], $_GET[ OPENSTATION_SHELL_OVERVIEW_ARG ] );
	}

	// ---------------------------------------------------- windows + app

	public function test_network_windows_are_offered_only_in_the_network_admin() {
		$offered = static function ( $admin ) {
			return openstation_native_window_offered_here( array( 'admin' => $admin ) );
		};
		set_current_screen( 'dashboard' );
		$this->assertTrue( $offered( 'site' ) );
		$this->assertFalse( $offered( 'network' ) );
		$this->assertTrue( $offered( 'any' ) );
		$this->assertTrue( openstation_native_window_offered_here( array() ), 'Unset means site, the default every existing window has.' );

		set_current_screen( 'sites-network' );
		$this->assertFalse( $offered( 'site' ) );
		$this->assertTrue( $offered( 'network' ) );
		$this->assertTrue( $offered( 'any' ) );
		$this->assertFalse( openstation_native_window_offered_here( array() ), 'And a site window stays off the network admin.' );
	}

	public function test_network_app_is_gated_and_offered_on_every_shell() {
		$registry = openstation_apps_registry();
		$app      = $registry->get( 'openstation-network' );
		$this->assertNotNull( $app );
		$this->assertSame( 'any', $app->manifest()['admin'] );
		// A desktop icon, not a dock tile, so Preferences > Navigation lists it.
		$this->assertSame( 'none', $app->manifest()['placement'] );
		$this->assertIsArray( $app->manifest()['desktop_icon'] );

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		wp_set_current_user( self::$admin_id );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		// Registered as a window, the scope rides along into the store,
		// and the payload offers the window on the admin it names.
		openstation_apps_register_windows();
		$entry = openstation_native_window_registry()['openstation-network'];
		$this->assertSame( $app->manifest()['admin'], $entry['admin'] );
		$this->assertContains( 'openstation-network', wp_list_pluck( openstation_build_desktop_icons_payload(), 'id' ) );
		openstation_unregister_icon( 'openstation-network' );
		$ids_on = static function ( $screen ) {
			set_current_screen( $screen );
			return wp_list_pluck( openstation_collect_native_windows_payload()['windows'], 'id' );
		};
		if ( is_multisite() ) {
			$this->assertContains( 'openstation-network', $ids_on( 'sites-network' ), 'Offered in the network admin.' );
			$this->assertContains( 'openstation-network', $ids_on( 'dashboard' ), 'And on every site shell: the network is managed from wherever the super admin stands.' );
			$this->assertNotContains( 'openstation-code-blue', $ids_on( 'sites-network' ), 'A site-scoped app stays off the network admin.' );
		} else {
			$this->assertContains( 'openstation-network', $ids_on( 'dashboard' ) );
		}

		$response = openstation_apps_runtime()->dispatch(
			'openstation-network',
			array(
				'action' => 'mount',
				'state'  => array(),
				'args'   => array(),
			),
			openstation_apps_os()
		);
		$html = is_array( $response ) && isset( $response['html'] ) ? $response['html'] : wp_json_encode( $response );
		$this->assertStringContainsString( is_multisite() ? 'Sites in this network' : 'Join a network', $html );
		$this->assertStringContainsString( 'Add external site', $html, 'The door is named for what goes through it.' );

		// Open on a row hands the shell the switcher entry to hop to, as
		// a `hop` effect; the shell takes the same switch a pick does.
		$response = openstation_apps_runtime()->dispatch(
			'openstation-network',
			array(
				'action' => 'open',
				'state'  => array(),
				'args'   => array( 'id' => 'member:abc' ),
			),
			openstation_apps_os()
		);
		$this->assertSame( array( array( 'type' => 'hop', 'site' => 'member:abc' ) ), $response['effects'] );
	}

	public function test_the_menu_payload_carries_the_switcher_rows_and_the_app_spends_a_refresh() {
		$remote = self::remote_keypair();
		$this->remote = static function () use ( $remote ) {
			return self::json_response( self::member_identity( $remote['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );
		$this->assertIsArray( $member );
		wp_set_current_user( self::$admin_id );

		// A single-site hub whose last member left has no network, and
		// the block is null: that is how the switcher goes away.
		$rows = static function () {
			$block = openstation_build_menu_payload()['multisite'];
			return is_array( $block ) ? wp_list_pluck( $block['sites'], 'id' ) : array();
		};
		$this->assertContains( 'member:' . $member['id'], $rows(), 'The payload a refresh applies carries the switcher rows.' );
		$this->assertSame( openstation_multisite_payload(), openstation_build_menu_payload()['multisite'], 'The same block the shell boots with.' );

		$response = openstation_apps_runtime()->dispatch(
			'openstation-network',
			array(
				'action' => 'remove',
				'state'  => array(),
				'args'   => array( 'id' => $member['id'] ),
			),
			openstation_apps_os()
		);
		$this->assertContains( array( 'type' => 'refresh_menu' ), $response['effects'], 'Removing a site spends the refresh that repaints the row.' );
		$this->assertNotContains( 'member:' . $member['id'], $rows(), 'And the next payload no longer lists it.' );

		$response = openstation_apps_runtime()->dispatch(
			'openstation-network',
			array(
				'action' => 'remove',
				'state'  => array(),
				'args'   => array( 'id' => 'nobody' ),
			),
			openstation_apps_os()
		);
		$this->assertNotContains( array( 'type' => 'refresh_menu' ), $response['effects'], 'Nothing changed, nothing to refresh.' );
	}

	public function test_every_switcher_row_says_which_kind_of_site_it_is() {
		$remote = self::remote_keypair();
		$this->remote = static function () use ( $remote ) {
			return self::json_response( self::member_identity( $remote['public'] ) );
		};
		$member = openstation_network_add_member( 'https://member.test' );
		$this->assertIsArray( $member );

		wp_set_current_user( self::$admin_id );
		$block = openstation_multisite_payload();
		$kinds = array();
		foreach ( $block['sites'] as $site ) {
			$kinds[ $site['id'] ] = $site['kind'];
		}
		$this->assertSame( 'member', $kinds[ 'member:' . $member['id'] ], 'An install that joined from elsewhere.' );
		$this->assertSame( 'local', $kinds[ is_multisite() ? '1' : 'hub' ], "This network's own site." );
		$this->assertCount( 0, array_diff( $kinds, array( 'local', 'member' ) ), 'Nothing else.' );
		$foreign = wp_list_pluck( $block['sites'], 'foreign', 'id' );
		$this->assertTrue( $foreign[ 'member:' . $member['id'] ], 'Another install: a switch there mints a token.' );
		$this->assertFalse( $foreign[ is_multisite() ? '1' : 'hub' ], 'This install: it shares the login already.' );
	}
}
