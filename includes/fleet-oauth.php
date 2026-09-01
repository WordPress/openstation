<?php
/**
 * OAuth 2.0 authorization server for Fleet for OpenStation.
 *
 * Fleet is a public client: it has a stable client id, but no shared secret
 * that could remain secret across WordPress installations. Authorization Code
 * + PKCE protects the browser round trip. Access tokens are short-lived;
 * refresh tokens rotate on every use and revoke their grant when an older
 * token from the same family is replayed.
 *
 * The single `site:manage` scope deliberately delegates the connected
 * WordPress user's full REST API authority. It does not bypass endpoint
 * permission callbacks: Core and plugin routes still call current_user_can()
 * exactly as they do for cookie or Application Password authentication.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

const OPENSTATION_FLEET_OAUTH_OPTION               = 'openstation_fleet_oauth_grants';
const OPENSTATION_FLEET_OAUTH_CODE_PREFIX          = 'openstation_fleet_oauth_code_';
const OPENSTATION_FLEET_OAUTH_SCOPE                = 'site:manage';
const OPENSTATION_FLEET_OAUTH_CODE_TTL             = 300;
const OPENSTATION_FLEET_OAUTH_ACCESS_TTL           = 15 * MINUTE_IN_SECONDS;
const OPENSTATION_FLEET_OAUTH_REFRESH_IDLE_TTL     = 30 * DAY_IN_SECONDS;
const OPENSTATION_FLEET_OAUTH_REFRESH_ABSOLUTE_TTL = 90 * DAY_IN_SECONDS;

/**
 * Return the issuer identifier for this WordPress installation.
 *
 * @return string
 */
function openstation_fleet_oauth_issuer() {
	return untrailingslashit( home_url( '/' ) );
}

/**
 * Whether this site can safely advertise its OAuth endpoints.
 *
 * @return bool
 */
function openstation_fleet_oauth_is_available() {
	return 'https' === wp_parse_url( openstation_fleet_oauth_issuer(), PHP_URL_SCHEME );
}

/**
 * Build the RFC 8414 well-known metadata URL for this issuer.
 *
 * @return string
 */
function openstation_fleet_oauth_metadata_url() {
	$issuer = wp_parse_url( openstation_fleet_oauth_issuer() );
	if ( ! is_array( $issuer ) || empty( $issuer['scheme'] ) || empty( $issuer['host'] ) ) {
		return '';
	}

	$port = isset( $issuer['port'] ) ? ':' . (int) $issuer['port'] : '';
	$path = isset( $issuer['path'] ) ? '/' . trim( $issuer['path'], '/' ) : '';
	return strtolower( $issuer['scheme'] ) . '://' . strtolower( $issuer['host'] ) . $port . '/.well-known/oauth-authorization-server' . $path;
}

/**
 * Return authorization server metadata.
 *
 * @return array
 */
function openstation_fleet_oauth_metadata() {
	return array(
		'issuer'                                        => openstation_fleet_oauth_issuer(),
		'authorization_endpoint'                         => add_query_arg(
			array(
				'page'                     => 'openstation-fleet-authorize',
				OPENSTATION_CLASSIC_FLAG  => '1',
			),
			admin_url( 'admin.php' )
		),
		'token_endpoint'                                 => rest_url( 'openstation/v1/oauth/token' ),
		'revocation_endpoint'                            => rest_url( 'openstation/v1/oauth/revoke' ),
		'response_types_supported'                       => array( 'code' ),
		'grant_types_supported'                          => array( 'authorization_code', 'refresh_token' ),
		'code_challenge_methods_supported'               => array( 'S256' ),
		'scopes_supported'                               => array( OPENSTATION_FLEET_OAUTH_SCOPE ),
		'token_endpoint_auth_methods_supported'          => array( 'none' ),
		'revocation_endpoint_auth_methods_supported'     => array( 'none' ),
		'authorization_response_iss_parameter_supported' => true,
	);
}

/**
 * Serve the well-known metadata document without requiring rewrite rules.
 *
 * @return void
 */
function openstation_fleet_oauth_maybe_serve_metadata() {
	if ( ! openstation_fleet_oauth_is_available() ) {
		return;
	}

	$request_path  = isset( $_SERVER['REQUEST_URI'] ) ? wp_parse_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ), PHP_URL_PATH ) : '';
	$metadata_path = wp_parse_url( openstation_fleet_oauth_metadata_url(), PHP_URL_PATH );
	if ( ! is_string( $request_path ) || ! is_string( $metadata_path ) || untrailingslashit( $request_path ) !== untrailingslashit( $metadata_path ) ) {
		return;
	}

	nocache_headers();
	header( 'Content-Type: application/json; charset=' . get_option( 'blog_charset' ) );
	header( 'X-Content-Type-Options: nosniff' );
	echo wp_json_encode( openstation_fleet_oauth_metadata() );
	exit;
}
add_action( 'parse_request', 'openstation_fleet_oauth_maybe_serve_metadata', 0 );

/**
 * Advertise Fleet OAuth in the WordPress REST index.
 *
 * @param WP_REST_Response $response REST index response.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_add_to_rest_index( $response ) {
	if ( ! openstation_fleet_oauth_is_available() ) {
		return $response;
	}

	$data = $response->get_data();
	if ( ! isset( $data['authentication'] ) || ! is_array( $data['authentication'] ) ) {
		$data['authentication'] = array();
	}
	$data['authentication']['openstation-fleet-oauth'] = array(
		'metadata' => openstation_fleet_oauth_metadata_url(),
		'issuer'   => openstation_fleet_oauth_issuer(),
		'scope'    => OPENSTATION_FLEET_OAUTH_SCOPE,
	);
	$response->set_data( $data );
	return $response;
}
add_filter( 'rest_index', 'openstation_fleet_oauth_add_to_rest_index' );

/**
 * Register token and revocation routes.
 *
 * @return void
 */
function openstation_fleet_oauth_register_rest_routes() {
	register_rest_route(
		'openstation/v1',
		'/oauth/token',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_fleet_oauth_token_endpoint',
			'permission_callback' => '__return_true',
		)
	);
	register_rest_route(
		'openstation/v1',
		'/oauth/revoke',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_fleet_oauth_revoke_endpoint',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'openstation_fleet_oauth_register_rest_routes' );

/**
 * Register the authorization consent screen without adding a menu item.
 *
 * @return void
 */
function openstation_fleet_oauth_register_authorize_screen() {
	add_submenu_page(
		null,
		__( 'Connect Fleet', 'desktop-mode' ),
		__( 'Connect Fleet', 'desktop-mode' ),
		'manage_options',
		'openstation-fleet-authorize',
		'openstation_fleet_oauth_render_authorize_screen'
	);
}
add_action( 'admin_menu', 'openstation_fleet_oauth_register_authorize_screen' );

/**
 * Read one scalar request value.
 *
 * @param array  $source Request source.
 * @param string $key    Key to read.
 * @return string
 */
function openstation_fleet_oauth_request_string( $source, $key ) {
	return isset( $source[ $key ] ) && is_string( $source[ $key ] )
		? (string) wp_unslash( $source[ $key ] )
		: '';
}

/**
 * Validate one authorization request.
 *
 * The first approval also registers the client's exact redirect URI. Later
 * requests using the same client id must match that URI byte-for-byte.
 *
 * @param array $source Query or form values.
 * @return array|WP_Error
 */
function openstation_fleet_oauth_validate_authorization_request( $source ) {
	if ( ! openstation_fleet_oauth_is_available() ) {
		return new WP_Error( 'openstation_fleet_oauth_https_required', __( 'Fleet OAuth requires HTTPS.', 'desktop-mode' ) );
	}

	$response_type = openstation_fleet_oauth_request_string( $source, 'response_type' );
	$client_id     = openstation_fleet_oauth_request_string( $source, 'client_id' );
	$redirect_uri  = openstation_fleet_oauth_request_string( $source, 'redirect_uri' );
	$scope         = trim( openstation_fleet_oauth_request_string( $source, 'scope' ) );
	$state         = openstation_fleet_oauth_request_string( $source, 'state' );
	$challenge     = openstation_fleet_oauth_request_string( $source, 'code_challenge' );
	$method        = openstation_fleet_oauth_request_string( $source, 'code_challenge_method' );

	if ( 'code' !== $response_type ) {
		return new WP_Error( 'unsupported_response_type', __( 'Fleet requires the authorization code flow.', 'desktop-mode' ) );
	}
	if ( ! wp_is_uuid( $client_id ) ) {
		return new WP_Error( 'invalid_request', __( 'The Fleet client id is invalid.', 'desktop-mode' ) );
	}
	if ( ! openstation_fleet_oauth_valid_redirect_uri( $redirect_uri ) ) {
		return new WP_Error( 'invalid_request', __( 'The Fleet callback URL is invalid.', 'desktop-mode' ) );
	}
	if ( OPENSTATION_FLEET_OAUTH_SCOPE !== $scope ) {
		return new WP_Error( 'invalid_scope', __( 'Fleet requested an unsupported permission scope.', 'desktop-mode' ) );
	}
	if ( ! preg_match( '/^[A-Za-z0-9\-._~]{32,128}$/', $state ) ) {
		return new WP_Error( 'invalid_request', __( 'The Fleet state value is invalid.', 'desktop-mode' ) );
	}
	if ( 'S256' !== $method || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $challenge ) ) {
		return new WP_Error( 'invalid_request', __( 'Fleet must use PKCE with S256.', 'desktop-mode' ) );
	}

	$known_redirect = openstation_fleet_oauth_known_redirect_uri( $client_id );
	if ( '' !== $known_redirect && ! hash_equals( $known_redirect, $redirect_uri ) ) {
		return new WP_Error( 'invalid_request', __( 'This Fleet client is registered to a different callback URL.', 'desktop-mode' ) );
	}

	return array(
		'response_type'         => $response_type,
		'client_id'             => $client_id,
		'redirect_uri'          => $redirect_uri,
		'scope'                 => $scope,
		'state'                 => $state,
		'code_challenge'        => $challenge,
		'code_challenge_method' => $method,
	);
}

/**
 * Validate a redirect URI presented for interactive approval.
 *
 * @param string $url Candidate redirect URI.
 * @return bool
 */
function openstation_fleet_oauth_valid_redirect_uri( $url ) {
	$parts = wp_parse_url( $url );
	return is_array( $parts )
		&& isset( $parts['scheme'], $parts['host'], $parts['path'] )
		&& 'https' === strtolower( $parts['scheme'] )
		&& '' !== $parts['host']
		&& ! isset( $parts['user'] )
		&& ! isset( $parts['pass'] )
		&& ! isset( $parts['fragment'] );
}

/**
 * Return the exact redirect URI already registered for a client.
 *
 * @param string $client_id Client UUID.
 * @return string
 */
function openstation_fleet_oauth_known_redirect_uri( $client_id ) {
	foreach ( openstation_fleet_oauth_get_grants() as $grant ) {
		if ( isset( $grant['client_id'], $grant['redirect_uri'] ) && hash_equals( (string) $grant['client_id'], $client_id ) ) {
			return (string) $grant['redirect_uri'];
		}
	}
	return '';
}

/**
 * Render the managed-site consent screen.
 *
 * @return void
 */
function openstation_fleet_oauth_render_authorize_screen() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Only a site administrator can connect this site to Fleet.', 'desktop-mode' ), '', array( 'response' => 403 ) );
	}

	$request = openstation_fleet_oauth_validate_authorization_request( $_GET ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- validation-only OAuth authorization request.
	if ( is_wp_error( $request ) ) {
		wp_die( esc_html( $request->get_error_message() ), esc_html__( 'Invalid Fleet request', 'desktop-mode' ), array( 'response' => 400 ) );
	}

	$hub_host = wp_parse_url( $request['redirect_uri'], PHP_URL_HOST );
	$nonce    = wp_create_nonce( openstation_fleet_oauth_authorize_nonce_action( $request ) );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Connect this site to Fleet?', 'desktop-mode' ); ?></h1>
		<div class="card" style="max-width:680px;padding:24px;margin-top:24px">
			<h2 style="margin-top:0"><?php echo esc_html( $hub_host ); ?></h2>
			<p><?php esc_html_e( 'This Fleet hub is asking to manage this site through the WordPress REST API as your account.', 'desktop-mode' ); ?></p>
			<p><strong><?php esc_html_e( 'Full API access', 'desktop-mode' ); ?></strong></p>
			<p><?php esc_html_e( 'Fleet can use every REST API action your WordPress account is allowed to use, including content, users, plugins, themes, settings, and APIs added by other plugins. WordPress capability checks still apply to every request.', 'desktop-mode' ); ?></p>
			<p><?php esc_html_e( 'The connection uses short-lived access tokens and a rotating refresh token. You can revoke it from the Fleet hub or from your WordPress profile.', 'desktop-mode' ); ?></p>
			<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
				<input type="hidden" name="action" value="openstation_fleet_oauth_decide">
				<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( $nonce ); ?>">
				<?php foreach ( $request as $key => $value ) : ?>
					<input type="hidden" name="<?php echo esc_attr( $key ); ?>" value="<?php echo esc_attr( $value ); ?>">
				<?php endforeach; ?>
				<p class="submit" style="display:flex;gap:8px;margin-bottom:0;padding-bottom:0">
					<button class="button button-primary" type="submit" name="decision" value="approve"><?php esc_html_e( 'Connect Fleet', 'desktop-mode' ); ?></button>
					<button class="button" type="submit" name="decision" value="deny"><?php esc_html_e( 'Cancel', 'desktop-mode' ); ?></button>
				</p>
			</form>
		</div>
	</div>
	<?php
}

/**
 * Build the nonce action that binds consent to every security parameter.
 *
 * @param array $request Validated request.
 * @return string
 */
function openstation_fleet_oauth_authorize_nonce_action( $request ) {
	return 'openstation_fleet_oauth_authorize_' . hash(
		'sha256',
		implode(
			"\n",
			array(
				$request['client_id'],
				$request['redirect_uri'],
				$request['scope'],
				$request['state'],
				$request['code_challenge'],
			)
		)
	);
}

/**
 * Approve or reject an authorization request.
 *
 * @return void
 */
function openstation_fleet_oauth_handle_decision() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Only a site administrator can connect this site to Fleet.', 'desktop-mode' ), '', array( 'response' => 403 ) );
	}

	$request = openstation_fleet_oauth_validate_authorization_request( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce is verified against the validated request below.
	if ( is_wp_error( $request ) ) {
		wp_die( esc_html( $request->get_error_message() ), esc_html__( 'Invalid Fleet request', 'desktop-mode' ), array( 'response' => 400 ) );
	}
	check_admin_referer( openstation_fleet_oauth_authorize_nonce_action( $request ) );

	$decision = sanitize_key( openstation_fleet_oauth_request_string( $_POST, 'decision' ) );
	if ( 'approve' !== $decision ) {
		openstation_fleet_oauth_redirect_authorization_response(
			$request,
			array(
				'error'             => 'access_denied',
				'error_description' => __( 'The site administrator declined the Fleet connection.', 'desktop-mode' ),
			)
		);
	}

	$code = openstation_fleet_oauth_random_value( 32 );
	set_transient(
		OPENSTATION_FLEET_OAUTH_CODE_PREFIX . hash( 'sha256', $code ),
		array(
			'user_id'        => get_current_user_id(),
			'client_id'      => $request['client_id'],
			'redirect_uri'   => $request['redirect_uri'],
			'scope'          => $request['scope'],
			'code_challenge' => $request['code_challenge'],
			'issued_at'      => time(),
		),
		OPENSTATION_FLEET_OAUTH_CODE_TTL
	);
	openstation_fleet_oauth_redirect_authorization_response( $request, array( 'code' => $code ) );
}
add_action( 'admin_post_openstation_fleet_oauth_decide', 'openstation_fleet_oauth_handle_decision' );

/**
 * Redirect to the exact validated client callback.
 *
 * @param array $request Validated authorization request.
 * @param array $args    Response arguments.
 * @return void
 */
function openstation_fleet_oauth_redirect_authorization_response( $request, $args ) {
	$args['state'] = $request['state'];
	$args['iss']   = openstation_fleet_oauth_issuer();
	$location      = add_query_arg( $args, $request['redirect_uri'] );
	wp_redirect( $location ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- exact HTTPS URI validated and explicitly approved above.
	exit;
}

/**
 * Token endpoint for authorization_code and refresh_token grants.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_token_endpoint( WP_REST_Request $request ) {
	if ( ! openstation_fleet_oauth_is_available() ) {
		return openstation_fleet_oauth_error_response( 'invalid_request', __( 'Fleet OAuth requires HTTPS.', 'desktop-mode' ) );
	}

	$grant_type = (string) $request->get_param( 'grant_type' );
	if ( 'authorization_code' === $grant_type ) {
		return openstation_fleet_oauth_exchange_code( $request );
	}
	if ( 'refresh_token' === $grant_type ) {
		return openstation_fleet_oauth_exchange_refresh_token( $request );
	}
	return openstation_fleet_oauth_error_response( 'unsupported_grant_type', __( 'That OAuth grant type is not supported.', 'desktop-mode' ) );
}

/**
 * Exchange a one-time authorization code.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_exchange_code( WP_REST_Request $request ) {
	$code         = (string) $request->get_param( 'code' );
	$client_id    = (string) $request->get_param( 'client_id' );
	$redirect_uri = (string) $request->get_param( 'redirect_uri' );
	$verifier     = (string) $request->get_param( 'code_verifier' );
	$key          = OPENSTATION_FLEET_OAUTH_CODE_PREFIX . hash( 'sha256', $code );
	$pending      = '' !== $code ? get_transient( $key ) : false;

	if ( ! is_array( $pending ) || ! wp_is_uuid( $client_id ) || ! preg_match( '/^[A-Za-z0-9\-._~]{43,128}$/', $verifier ) ) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The authorization code is invalid or expired.', 'desktop-mode' ) );
	}
	$challenge = openstation_fleet_oauth_base64url_encode( hash( 'sha256', $verifier, true ) );
	if (
		! hash_equals( (string) $pending['client_id'], $client_id )
		|| ! hash_equals( (string) $pending['redirect_uri'], $redirect_uri )
		|| ! hash_equals( (string) $pending['code_challenge'], $challenge )
	) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The authorization code could not be verified.', 'desktop-mode' ) );
	}
	delete_transient( $key );

	$user = get_user_by( 'id', (int) $pending['user_id'] );
	if ( ! $user ) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The approving WordPress user no longer exists.', 'desktop-mode' ) );
	}

	$grant_id     = wp_generate_uuid4();
	$family_value = openstation_fleet_oauth_random_value( 32 );
	$now          = time();
	$grant        = array(
		'id'                          => $grant_id,
		'user_id'                     => (int) $user->ID,
		'client_id'                   => $client_id,
		'client_host'                 => (string) wp_parse_url( $redirect_uri, PHP_URL_HOST ),
		'redirect_uri'                => $redirect_uri,
		'scope'                       => OPENSTATION_FLEET_OAUTH_SCOPE,
		'created_at'                  => $now,
		'last_used_at'                => $now,
		'access_hash'                 => '',
		'access_expires_at'           => 0,
		'refresh_family_hash'         => hash( 'sha256', $family_value ),
		'refresh_hash'                => '',
		'refresh_expires_at'          => min( $now + OPENSTATION_FLEET_OAUTH_REFRESH_IDLE_TTL, $now + OPENSTATION_FLEET_OAUTH_REFRESH_ABSOLUTE_TTL ),
		'refresh_absolute_expires_at' => $now + OPENSTATION_FLEET_OAUTH_REFRESH_ABSOLUTE_TTL,
		'revoked_at'                  => 0,
	);
	return openstation_fleet_oauth_issue_tokens( $grant, $family_value );
}

/**
 * Rotate a refresh token and issue a new access token.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_exchange_refresh_token( WP_REST_Request $request ) {
	$token     = (string) $request->get_param( 'refresh_token' );
	$client_id = (string) $request->get_param( 'client_id' );
	$parts     = openstation_fleet_oauth_parse_refresh_token( $token );
	if ( ! is_array( $parts ) || ! wp_is_uuid( $client_id ) ) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The refresh token is invalid.', 'desktop-mode' ) );
	}

	$grants = openstation_fleet_oauth_get_grants();
	if ( ! isset( $grants[ $parts['grant_id'] ] ) || ! is_array( $grants[ $parts['grant_id'] ] ) ) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The refresh token is invalid.', 'desktop-mode' ) );
	}
	$grant = $grants[ $parts['grant_id'] ];
	$now   = time();
	if (
		! hash_equals( (string) $grant['client_id'], $client_id )
		|| ! empty( $grant['revoked_at'] )
		|| $now > (int) $grant['refresh_expires_at']
		|| $now > (int) $grant['refresh_absolute_expires_at']
		|| ! get_user_by( 'id', (int) $grant['user_id'] )
	) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The refresh token is expired or revoked.', 'desktop-mode' ) );
	}

	if ( ! hash_equals( (string) $grant['refresh_family_hash'], hash( 'sha256', $parts['family'] ) ) ) {
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'The refresh token is invalid.', 'desktop-mode' ) );
	}
	if ( ! hash_equals( (string) $grant['refresh_hash'], hash( 'sha256', $token ) ) ) {
		$grant['revoked_at']            = $now;
		$grants[ $grant['id'] ]         = $grant;
		openstation_fleet_oauth_save_grants( $grants );
		return openstation_fleet_oauth_error_response( 'invalid_grant', __( 'Refresh token replay detected. Reconnect Fleet.', 'desktop-mode' ) );
	}

	return openstation_fleet_oauth_issue_tokens( $grant, $parts['family'] );
}

/**
 * Issue and persist one access/refresh token pair.
 *
 * @param array  $grant        Grant record.
 * @param string $family_value Plaintext refresh family value.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_issue_tokens( $grant, $family_value ) {
	$now           = time();
	$access_token  = 'osf_at_' . $grant['id'] . '.' . openstation_fleet_oauth_random_value( 32 );
	$refresh_token = 'osf_rt_' . $grant['id'] . '.' . $family_value . '.' . openstation_fleet_oauth_random_value( 32 );

	$grant['access_hash']        = hash( 'sha256', $access_token );
	$grant['access_expires_at']  = $now + OPENSTATION_FLEET_OAUTH_ACCESS_TTL;
	$grant['refresh_hash']       = hash( 'sha256', $refresh_token );
	$grant['refresh_expires_at'] = min( $now + OPENSTATION_FLEET_OAUTH_REFRESH_IDLE_TTL, (int) $grant['refresh_absolute_expires_at'] );
	$grant['last_used_at']       = $now;

	$grants                  = openstation_fleet_oauth_get_grants();
	$grants[ $grant['id'] ] = $grant;
	openstation_fleet_oauth_save_grants( $grants );

	$response = new WP_REST_Response(
		array(
			'access_token'       => $access_token,
			'token_type'         => 'Bearer',
			'expires_in'         => OPENSTATION_FLEET_OAUTH_ACCESS_TTL,
			'refresh_token'      => $refresh_token,
			'refresh_expires_in' => max( 0, (int) $grant['refresh_expires_at'] - $now ),
			'scope'              => (string) $grant['scope'],
		),
		200
	);
	$response->header( 'Cache-Control', 'no-store' );
	$response->header( 'Pragma', 'no-cache' );
	return $response;
}

/**
 * Revoke an access token or its refresh-token grant.
 *
 * Per RFC 7009, the endpoint returns 200 for unknown tokens so it cannot be
 * used as a token oracle.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_revoke_endpoint( WP_REST_Request $request ) {
	$token     = (string) $request->get_param( 'token' );
	$client_id = (string) $request->get_param( 'client_id' );
	$grants    = openstation_fleet_oauth_get_grants();
	$grant_id  = openstation_fleet_oauth_token_grant_id( $token );

	if ( '' !== $grant_id && isset( $grants[ $grant_id ] ) && is_array( $grants[ $grant_id ] ) ) {
		$grant = $grants[ $grant_id ];
		if ( isset( $grant['client_id'] ) && hash_equals( (string) $grant['client_id'], $client_id ) ) {
			if ( 0 === strpos( $token, 'osf_rt_' ) ) {
				$parts = openstation_fleet_oauth_parse_refresh_token( $token );
				if ( is_array( $parts ) && hash_equals( (string) $grant['refresh_family_hash'], hash( 'sha256', $parts['family'] ) ) ) {
					$grant['revoked_at'] = time();
				}
			} elseif ( 0 === strpos( $token, 'osf_at_' ) && hash_equals( (string) $grant['access_hash'], hash( 'sha256', $token ) ) ) {
				$grant['access_hash']       = '';
				$grant['access_expires_at'] = 0;
			}
			$grants[ $grant_id ] = $grant;
			openstation_fleet_oauth_save_grants( $grants );
		}
	}

	$response = new WP_REST_Response( null, 200 );
	$response->header( 'Cache-Control', 'no-store' );
	return $response;
}

/**
 * Authenticate a Fleet Bearer token for REST requests.
 *
 * @param int|false $input_user User already identified by another method.
 * @return int|false
 */
function openstation_fleet_oauth_determine_current_user( $input_user ) {
	global $openstation_fleet_oauth_auth_status;

	if ( ! openstation_fleet_oauth_is_rest_request() ) {
		return $input_user;
	}
	if ( isset( $openstation_fleet_oauth_auth_status ) ) {
		return true === $openstation_fleet_oauth_auth_status && isset( $GLOBALS['openstation_fleet_oauth_grant']['user_id'] )
			? (int) $GLOBALS['openstation_fleet_oauth_grant']['user_id']
			: $input_user;
	}

	$token = openstation_fleet_oauth_bearer_token();
	if ( '' === $token ) {
		return $input_user;
	}

	$grant_id = openstation_fleet_oauth_token_grant_id( $token );
	$grants   = openstation_fleet_oauth_get_grants();
	if ( '' === $grant_id || ! isset( $grants[ $grant_id ] ) || ! is_array( $grants[ $grant_id ] ) ) {
		$openstation_fleet_oauth_auth_status = new WP_Error( 'invalid_token', __( 'The Fleet access token is invalid.', 'desktop-mode' ), array( 'status' => 401 ) );
		return false;
	}

	$grant = $grants[ $grant_id ];
	$user  = get_user_by( 'id', (int) $grant['user_id'] );
	if (
		0 !== strpos( $token, 'osf_at_' )
		|| ! empty( $grant['revoked_at'] )
		|| time() > (int) $grant['access_expires_at']
		|| ! hash_equals( (string) $grant['access_hash'], hash( 'sha256', $token ) )
		|| ! $user
	) {
		$openstation_fleet_oauth_auth_status = new WP_Error( 'invalid_token', __( 'The Fleet access token is expired or revoked.', 'desktop-mode' ), array( 'status' => 401 ) );
		return false;
	}

	$now = time();
	if ( $now - (int) $grant['last_used_at'] >= 5 * MINUTE_IN_SECONDS ) {
		$grant['last_used_at'] = $now;
		$grants[ $grant_id ]   = $grant;
		openstation_fleet_oauth_save_grants( $grants );
	}
	$GLOBALS['openstation_fleet_oauth_grant'] = $grant;
	$openstation_fleet_oauth_auth_status      = true;
	return (int) $user->ID;
}
add_filter( 'determine_current_user', 'openstation_fleet_oauth_determine_current_user', 25 );

/**
 * Show active Fleet connections on a user's standard WordPress profile.
 *
 * @param WP_User $profile_user User whose profile is open.
 * @return void
 */
function openstation_fleet_oauth_render_profile_connections( $profile_user ) {
	if ( ! $profile_user instanceof WP_User || ! current_user_can( 'edit_user', $profile_user->ID ) ) {
		return;
	}

	$connections = array_filter(
		openstation_fleet_oauth_get_grants(),
		static function ( $grant ) use ( $profile_user ) {
			return is_array( $grant )
				&& isset( $grant['user_id'] )
				&& (int) $profile_user->ID === (int) $grant['user_id']
				&& empty( $grant['revoked_at'] );
		}
	);
	?>
	<h2><?php esc_html_e( 'Fleet connections', 'desktop-mode' ); ?></h2>
	<?php if ( empty( $connections ) ) : ?>
		<p><?php esc_html_e( 'No Fleet hubs are connected through this account.', 'desktop-mode' ); ?></p>
	<?php else : ?>
		<p><?php esc_html_e( 'These hubs can use the WordPress REST API with your permissions. Revoke any connection you no longer recognize or use.', 'desktop-mode' ); ?></p>
		<table class="widefat striped" style="max-width:900px">
			<thead>
				<tr>
					<th><?php esc_html_e( 'Fleet hub', 'desktop-mode' ); ?></th>
					<th><?php esc_html_e( 'Connected', 'desktop-mode' ); ?></th>
					<th><?php esc_html_e( 'Last used', 'desktop-mode' ); ?></th>
					<th><?php esc_html_e( 'Action', 'desktop-mode' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $connections as $grant ) : ?>
					<tr>
						<td><strong><?php echo esc_html( (string) $grant['client_host'] ); ?></strong><br><code><?php echo esc_html( (string) $grant['scope'] ); ?></code></td>
						<td><?php echo esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $grant['created_at'] ) ); ?></td>
						<td><?php echo esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $grant['last_used_at'] ) ); ?></td>
						<td>
							<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
								<input type="hidden" name="action" value="openstation_fleet_oauth_revoke_grant">
								<input type="hidden" name="grant_id" value="<?php echo esc_attr( (string) $grant['id'] ); ?>">
								<input type="hidden" name="user_id" value="<?php echo esc_attr( (string) $profile_user->ID ); ?>">
								<?php wp_nonce_field( 'openstation_fleet_oauth_revoke' ); ?>
								<button class="button" type="submit"><?php esc_html_e( 'Revoke', 'desktop-mode' ); ?></button>
							</form>
						</td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
	<?php
}
add_action( 'show_user_profile', 'openstation_fleet_oauth_render_profile_connections' );
add_action( 'edit_user_profile', 'openstation_fleet_oauth_render_profile_connections' );

/**
 * Confirm a profile-side Fleet revocation.
 *
 * @return void
 */
function openstation_fleet_oauth_profile_revocation_notice() {
	if ( '1' !== openstation_fleet_oauth_request_string( $_GET, 'openstation_fleet_revoked' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- fixed display-only notice.
		return;
	}
	?>
	<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'The Fleet connection was revoked.', 'desktop-mode' ); ?></p></div>
	<?php
}
add_action( 'admin_notices', 'openstation_fleet_oauth_profile_revocation_notice' );

/**
 * Revoke a Fleet grant from the approving user's WordPress profile.
 *
 * @return void
 */
function openstation_fleet_oauth_handle_profile_revocation() {
	check_admin_referer( 'openstation_fleet_oauth_revoke' );
	$grant_id = openstation_fleet_oauth_request_string( $_POST, 'grant_id' );
	$user_id  = absint( openstation_fleet_oauth_request_string( $_POST, 'user_id' ) );
	if ( ! wp_is_uuid( $grant_id ) || ! current_user_can( 'edit_user', $user_id ) ) {
		wp_die( esc_html__( 'You cannot revoke this Fleet connection.', 'desktop-mode' ), '', array( 'response' => 403 ) );
	}

	$grants = openstation_fleet_oauth_get_grants();
	if ( isset( $grants[ $grant_id ]['user_id'] ) && $user_id === (int) $grants[ $grant_id ]['user_id'] ) {
		$grants[ $grant_id ]['revoked_at'] = time();
		openstation_fleet_oauth_save_grants( $grants );
	}

	$profile_url = get_edit_user_link( $user_id );
	wp_safe_redirect( add_query_arg( 'openstation_fleet_revoked', '1', $profile_url ? $profile_url : admin_url( 'profile.php' ) ) );
	exit;
}
add_action( 'admin_post_openstation_fleet_oauth_revoke_grant', 'openstation_fleet_oauth_handle_profile_revocation' );

/**
 * Surface Fleet bearer authentication success or failure to REST Core.
 *
 * @param WP_Error|null|true $result Existing authentication result.
 * @return WP_Error|null|true
 */
function openstation_fleet_oauth_rest_authentication_errors( $result ) {
	global $openstation_fleet_oauth_auth_status;
	if ( null !== $result ) {
		return $result;
	}
	return isset( $openstation_fleet_oauth_auth_status ) ? $openstation_fleet_oauth_auth_status : null;
}
add_filter( 'rest_authentication_errors', 'openstation_fleet_oauth_rest_authentication_errors', 95 );

/**
 * Detect whether the current request targets WordPress REST.
 *
 * `determine_current_user` runs before REST_REQUEST is always defined, so the
 * same early request-shape check used by OpenStation's bootstrap is required.
 *
 * @return bool
 */
function openstation_fleet_oauth_is_rest_request() {
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return true;
	}
	$prefix = function_exists( 'rest_get_url_prefix' ) ? rest_get_url_prefix() : 'wp-json';
	$uri    = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	return ( '' !== $prefix && false !== strpos( $uri, '/' . $prefix . '/' ) ) || false !== strpos( $uri, 'rest_route=' );
}

/**
 * Read an RFC 6750 Bearer token from server headers.
 *
 * @return string
 */
function openstation_fleet_oauth_bearer_token() {
	$header = '';
	if ( isset( $_SERVER['HTTP_AUTHORIZATION'] ) && is_string( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
		$header = sanitize_text_field( wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ) );
	} elseif ( isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) && is_string( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
		$header = sanitize_text_field( wp_unslash( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) );
	}
	return preg_match( '/^Bearer[ ]+([^ ]+)$/i', trim( $header ), $matches ) ? (string) $matches[1] : '';
}

/**
 * Revoke every grant owned by a user after a password change or deletion.
 *
 * @param string|int $unused  New password for wp_set_password; user id for delete_user.
 * @param int|null   $user_id User id for wp_set_password.
 * @return void
 */
function openstation_fleet_oauth_revoke_user_grants( $unused, $user_id = null ) {
	$target_id = null === $user_id ? (int) $unused : (int) $user_id;
	$grants    = openstation_fleet_oauth_get_grants();
	$changed   = false;
	foreach ( $grants as $id => $grant ) {
		if ( isset( $grant['user_id'] ) && $target_id === (int) $grant['user_id'] && empty( $grant['revoked_at'] ) ) {
			$grant['revoked_at'] = time();
			$grants[ $id ]       = $grant;
			$changed             = true;
		}
	}
	if ( $changed ) {
		openstation_fleet_oauth_save_grants( $grants );
	}
}
add_action( 'wp_set_password', 'openstation_fleet_oauth_revoke_user_grants', 10, 2 );
add_action( 'delete_user', 'openstation_fleet_oauth_revoke_user_grants', 10, 1 );

/**
 * Get stored OAuth grants.
 *
 * @return array
 */
function openstation_fleet_oauth_get_grants() {
	$grants = get_option( OPENSTATION_FLEET_OAUTH_OPTION, array() );
	return is_array( $grants ) ? $grants : array();
}

/**
 * Persist OAuth grants without autoloading the security state.
 *
 * @param array $grants Grant records keyed by grant UUID.
 * @return void
 */
function openstation_fleet_oauth_save_grants( $grants ) {
	if ( false === get_option( OPENSTATION_FLEET_OAUTH_OPTION, false ) ) {
		add_option( OPENSTATION_FLEET_OAUTH_OPTION, $grants, '', false );
		return;
	}
	update_option( OPENSTATION_FLEET_OAUTH_OPTION, $grants, false );
}

/**
 * Extract a grant UUID from either opaque token format.
 *
 * @param string $token Token value.
 * @return string
 */
function openstation_fleet_oauth_token_grant_id( $token ) {
	return preg_match( '/^osf_(?:at|rt)_([0-9a-f-]{36})\./i', $token, $matches ) && wp_is_uuid( $matches[1] )
		? strtolower( $matches[1] )
		: '';
}

/**
 * Parse a refresh token.
 *
 * @param string $token Refresh token.
 * @return array|null
 */
function openstation_fleet_oauth_parse_refresh_token( $token ) {
	if ( ! preg_match( '/^osf_rt_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/i', $token, $matches ) || ! wp_is_uuid( $matches[1] ) ) {
		return null;
	}
	return array(
		'grant_id' => strtolower( $matches[1] ),
		'family'   => $matches[2],
	);
}

/**
 * Generate a high-entropy base64url value.
 *
 * @param int $bytes Random byte count.
 * @return string
 */
function openstation_fleet_oauth_random_value( $bytes ) {
	return openstation_fleet_oauth_base64url_encode( random_bytes( $bytes ) );
}

/**
 * Encode bytes without base64 padding.
 *
 * @param string $value Raw bytes.
 * @return string
 */
function openstation_fleet_oauth_base64url_encode( $value ) {
	return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' );
}

/**
 * Return an OAuth-shaped error response.
 *
 * @param string $code        OAuth error code.
 * @param string $description Human-readable description.
 * @return WP_REST_Response
 */
function openstation_fleet_oauth_error_response( $code, $description ) {
	$response = new WP_REST_Response(
		array(
			'error'             => $code,
			'error_description' => $description,
		),
		400
	);
	$response->header( 'Cache-Control', 'no-store' );
	$response->header( 'Pragma', 'no-cache' );
	return $response;
}
