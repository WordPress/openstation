<?php
/**
 * Desktop Mode — OAuth relay scaffolding.
 *
 * Every plugin that integrates with an external service (Tumblr,
 * Mastodon, Bluesky, Spotify, Discord, …) reinvents the same
 * fiddly OAuth dance: generate a `state` nonce, persist it in a
 * transient, open a popup for the user to authorize, the callback
 * URL `postMessage`s back to the opener, the opener resolves a
 * Promise on receiving the success message. ~120 LOC of lifecycle
 * plumbing per plugin.
 *
 * This module bundles the dance into one helper so each plugin
 * declares only what's plugin-specific (the authorize / token
 * URLs and the token-storage callback). The rest — state nonce
 * + transient + popup + postMessage + opener listener — lives
 * here and is identical across consumers.
 *
 * Public PHP surface:
 *
 *   desktop_mode_register_oauth_relay( $service, [
 *       'authorize_url' => 'https://www.example.com/oauth2/authorize',
 *       'token_url'     => 'https://api.example.com/oauth2/token',
 *       'client_id'     => 'CLIENT_ID',
 *       'client_secret' => 'CLIENT_SECRET',
 *       'scope'         => 'read write',
 *       'on_success'    => function ( $user_id, $tokens, $service ) {
 *           // Persist tokens however your plugin needs.
 *       },
 *   ] );
 *
 * Public JS surface (since 0.8.2):
 *
 *   const { ok, service } = await wp.desktop.startOAuth( 'example' );
 *   // Tokens stay server-side — persisted by your `on_success` callback.
 *
 * REST routes:
 *
 *   POST /desktop-mode/v1/oauth/start    body: { service: string }
 *     → { authorize_url: string, state: string }
 *   GET  /desktop-mode/v1/oauth/callback ?code&state&error
 *     → HTML page that postMessages the opener and closes
 *
 * @package Desktop_Mode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

const DESKTOP_MODE_OAUTH_TRANSIENT_PREFIX = 'desktop_mode_oauth_state_';
const DESKTOP_MODE_OAUTH_STATE_TTL        = 600; // 10 minutes.

/**
 * Register an OAuth relay for `$service`.
 *
 * @since 0.8.2
 *
 * @param string $service Slug identifying the service. Lowercased,
 *                        sanitized via `sanitize_key`.
 * @param array  $args {
 *     OAuth relay configuration.
 *
 *     @type string   $authorize_url Authorization URL the user is
 *                                   redirected to in the popup. The
 *                                   framework appends `client_id`,
 *                                   `redirect_uri`, `scope`, and
 *                                   `state` query-args automatically.
 *                                   Required.
 *     @type string   $token_url     Token-exchange URL. The framework
 *                                   POSTs `grant_type=authorization_code`
 *                                   + `code` + `client_id` + `client_secret`
 *                                   + `redirect_uri` and parses the JSON
 *                                   response. Required.
 *     @type string   $client_id     OAuth client id. Required.
 *     @type string   $client_secret OAuth client secret. Required.
 *     @type string   $scope         OAuth scope string. Optional.
 *     @type callable $on_success    `function ( int $user_id, array $tokens,
 *                                   string $service ): void`. Called after a
 *                                   successful token exchange so the plugin
 *                                   can persist tokens however it needs
 *                                   (user meta, options, custom table).
 *                                   Required.
 *     @type string[] $capabilities  Caps the user must hold to start the
 *                                   flow. Default: `[ 'read' ]` (any
 *                                   logged-in user).
 * }
 * @return true|WP_Error `true` on success, `WP_Error` on validation failure.
 */
function desktop_mode_register_oauth_relay( $service, $args = array() ) {
	$service = sanitize_key( (string) $service );
	if ( '' === $service ) {
		return new WP_Error(
			'desktop_mode_oauth_missing_service',
			__( 'OAuth relay registration requires a non-empty service slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'authorize_url' => '',
		'token_url'     => '',
		'client_id'     => '',
		'client_secret' => '',
		'scope'         => '',
		'on_success'    => null,
		'capabilities'  => array( 'read' ),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( array( 'authorize_url', 'token_url', 'client_id', 'client_secret' ) as $required ) {
		if ( '' === (string) $args[ $required ] ) {
			return new WP_Error(
				'desktop_mode_oauth_missing_' . $required,
				/* translators: %s: missing field name. */
				sprintf( __( 'OAuth relay registration requires a non-empty `%s`.', 'desktop-mode' ), $required ),
				array( 'service' => $service )
			);
		}
	}

	if ( ! is_callable( $args['on_success'] ) ) {
		return new WP_Error(
			'desktop_mode_oauth_missing_on_success',
			__( 'OAuth relay registration requires a callable `on_success` handler.', 'desktop-mode' ),
			array( 'service' => $service )
		);
	}

	$authorize_url = esc_url_raw( (string) $args['authorize_url'], array( 'http', 'https' ) );
	$token_url     = esc_url_raw( (string) $args['token_url'], array( 'http', 'https' ) );
	if ( '' === $authorize_url || '' === $token_url ) {
		return new WP_Error(
			'desktop_mode_oauth_invalid_url',
			__( 'OAuth relay `authorize_url` and `token_url` must be valid http(s) URLs.', 'desktop-mode' ),
			array( 'service' => $service )
		);
	}

	$entry = array(
		'service'       => $service,
		'authorize_url' => $authorize_url,
		'token_url'     => $token_url,
		'client_id'     => (string) $args['client_id'],
		'client_secret' => (string) $args['client_secret'],
		'scope'         => (string) $args['scope'],
		'on_success'    => $args['on_success'],
		'capabilities'  => array_values( array_filter( array_map( 'strval', (array) $args['capabilities'] ) ) ),
	);
	desktop_mode_oauth_relay_registry( $service, $entry );

	/**
	 * Fires after an OAuth relay is registered. Use this to layer
	 * observability or to extend behaviour.
	 *
	 * @since 0.8.2
	 *
	 * @param string $service The service slug.
	 * @param array  $entry   The stored registry entry minus the secrets
	 *                        (`client_secret` is masked).
	 */
	do_action(
		'desktop_mode_oauth_relay_registered',
		$service,
		array_merge( $entry, array( 'client_secret' => '[redacted]' ) )
	);

	return true;
}

/**
 * Static registry for OAuth relays. Mirror of the icon / native-
 * window / wallpaper registries.
 *
 * @since 0.8.2
 * @internal
 */
function desktop_mode_oauth_relay_registry( $service = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $service ) {
		return $store;
	}
	if ( '__unset__' === $entry ) {
		unset( $store[ $service ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $service ] = $entry;
	}
	return isset( $store[ $service ] ) ? $store[ $service ] : null;
}

/**
 * Remove a previously registered OAuth relay. Mirror of
 * `desktop_mode_register_oauth_relay()` — handy for plugins that
 * register conditionally and for PHPUnit teardowns.
 *
 * @since 0.8.2
 *
 * @param string $service Service slug passed to register.
 * @return void
 */
function desktop_mode_unregister_oauth_relay( $service ) {
	$service = sanitize_key( (string) $service );
	if ( '' === $service ) {
		return;
	}
	desktop_mode_oauth_relay_registry( $service, '__unset__' );
}

/**
 * The redirect URI the popup posts back to. Same for every service —
 * the framework recovers the service from the state transient, so no
 * service query arg is needed.
 *
 * @since 0.8.2
 *
 * @return string
 */
function desktop_mode_oauth_redirect_uri() {
	return rest_url( 'desktop-mode/v1/oauth/callback' );
}

/**
 * Generate a fresh state nonce, persist it in a transient keyed by
 * the state value (with `user_id` + `service` stored in the transient
 * payload), and return the value the popup will round-trip.
 *
 * @since 0.8.2
 *
 * @param int    $user_id The user starting the flow.
 * @param string $service The service slug being authorized.
 * @return string The state value to embed in the authorize URL.
 */
function desktop_mode_oauth_issue_state( $user_id, $service ) {
	// 32 chars of letters+digits — `wp_generate_password` with the
	// no-special-chars flag is the canonical WP shape.
	$state = wp_generate_password( 32, false );
	set_transient(
		DESKTOP_MODE_OAUTH_TRANSIENT_PREFIX . $state,
		array(
			'user_id' => (int) $user_id,
			'service' => (string) $service,
			'issued'  => time(),
		),
		DESKTOP_MODE_OAUTH_STATE_TTL
	);
	return $state;
}

/**
 * Validate + consume an issued state nonce. Returns the stored
 * `{ user_id, service }` payload on a hit, `null` on a miss / expired.
 *
 * Single-use: a successful read deletes the transient so a replay
 * with the same state fails.
 *
 * @since 0.8.2
 *
 * @param string $state State value from the callback query.
 * @return array{user_id:int,service:string,issued:int}|null
 */
function desktop_mode_oauth_consume_state( $state ) {
	$state = (string) $state;
	if ( '' === $state ) {
		return null;
	}
	$key   = DESKTOP_MODE_OAUTH_TRANSIENT_PREFIX . $state;
	$entry = get_transient( $key );
	if ( ! is_array( $entry ) || empty( $entry['user_id'] ) || empty( $entry['service'] ) ) {
		return null;
	}
	delete_transient( $key );
	return array(
		'user_id' => (int) $entry['user_id'],
		'service' => (string) $entry['service'],
		'issued'  => isset( $entry['issued'] ) ? (int) $entry['issued'] : 0,
	);
}

/**
 * REST: `POST /desktop-mode/v1/oauth/start` — issue a state and
 * return the assembled authorize URL.
 *
 * @since 0.8.2
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_oauth_start( WP_REST_Request $request ) {
	$service = sanitize_key( (string) $request->get_param( 'service' ) );
	$entry   = desktop_mode_oauth_relay_registry( $service );
	if ( ! is_array( $entry ) ) {
		return new WP_Error(
			'desktop_mode_oauth_unknown_service',
			__( 'No OAuth relay is registered for that service.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	foreach ( $entry['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return new WP_Error(
				'desktop_mode_oauth_capability_denied',
				__( 'Current user lacks the capability required to start this OAuth flow.', 'desktop-mode' ),
				array( 'status' => 403 )
			);
		}
	}

	$user_id = get_current_user_id();
	$state   = desktop_mode_oauth_issue_state( $user_id, $service );

	$query = array(
		'response_type' => 'code',
		'client_id'     => $entry['client_id'],
		'redirect_uri'  => desktop_mode_oauth_redirect_uri(),
		'state'         => $state,
	);
	if ( '' !== $entry['scope'] ) {
		$query['scope'] = $entry['scope'];
	}

	/**
	 * Filter the query parameters appended to the authorize URL.
	 * Lets plugins inject service-specific extras (`access_type=offline`
	 * for Google, `force_login=true` for Twitter, `prompt=consent`,
	 * etc.) without having to fork the relay.
	 *
	 * @since 0.8.2
	 *
	 * @param array  $query   Default query params.
	 * @param string $service Service slug.
	 * @param array  $entry   Registry entry (with secrets redacted).
	 */
	$query = apply_filters(
		'desktop_mode_oauth_authorize_query',
		$query,
		$service,
		array_merge( $entry, array( 'client_secret' => '[redacted]' ) )
	);

	$authorize_url = add_query_arg( array_map( 'rawurlencode', $query ), $entry['authorize_url'] );

	return rest_ensure_response(
		array(
			'authorize_url' => $authorize_url,
			'state'         => $state,
		)
	);
}

/**
 * REST: `GET /desktop-mode/v1/oauth/callback` — exchange the auth
 * code for tokens, fire the registered `on_success` handler, then
 * render an HTML page that `postMessage`s the opener and closes.
 *
 * @since 0.8.2
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_oauth_callback( WP_REST_Request $request ) {
	$state = (string) $request->get_param( 'state' );
	$code  = (string) $request->get_param( 'code' );
	$error = (string) $request->get_param( 'error' );

	$consumed = desktop_mode_oauth_consume_state( $state );
	if ( null === $consumed ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'reason'  => 'invalid_state',
			'message' => __( 'OAuth state nonce missing, expired, or already used.', 'desktop-mode' ),
		) );
	}
	$service = $consumed['service'];
	$user_id = $consumed['user_id'];

	if ( '' !== $error ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'service' => $service,
			'reason'  => 'authorize_denied',
			'message' => $error,
		) );
	}

	$entry = desktop_mode_oauth_relay_registry( $service );
	if ( ! is_array( $entry ) ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'reason'  => 'unknown_service',
			'message' => __( 'OAuth relay is no longer registered for that service.', 'desktop-mode' ),
		) );
	}

	if ( '' === $code ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'service' => $service,
			'reason'  => 'missing_code',
			'message' => __( 'OAuth callback did not return an authorization code.', 'desktop-mode' ),
		) );
	}

	$response = wp_remote_post(
		$entry['token_url'],
		array(
			'timeout' => 15,
			'body'    => array(
				'grant_type'    => 'authorization_code',
				'code'          => $code,
				'client_id'     => $entry['client_id'],
				'client_secret' => $entry['client_secret'],
				'redirect_uri'  => desktop_mode_oauth_redirect_uri(),
			),
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'service' => $service,
			'reason'  => 'token_request_failed',
			'message' => $response->get_error_message(),
		) );
	}
	$status = (int) wp_remote_retrieve_response_code( $response );
	$body   = wp_remote_retrieve_body( $response );
	$tokens = json_decode( $body, true );
	if ( $status < 200 || $status >= 300 || ! is_array( $tokens ) ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'service' => $service,
			'reason'  => 'token_exchange_failed',
			'message' => sprintf(
				/* translators: %d: HTTP status code. */
				__( 'Token exchange failed with HTTP %d.', 'desktop-mode' ),
				$status
			),
		) );
	}

	try {
		call_user_func( $entry['on_success'], $user_id, $tokens, $service );
	} catch ( \Throwable $e ) {
		return desktop_mode_oauth_render_callback_html( array(
			'ok'      => false,
			'service' => $service,
			'reason'  => 'on_success_threw',
			'message' => $e->getMessage(),
		) );
	}

	/**
	 * Fires after a successful OAuth round-trip — after `on_success`
	 * persists the tokens. Plugins use this to refresh badges,
	 * re-render dock items, or surface a "connected" toast in
	 * sibling windows via the activity bus.
	 *
	 * @since 0.8.2
	 *
	 * @param string $service Service slug.
	 * @param int    $user_id User who connected.
	 */
	do_action( 'desktop_mode_oauth_relay_connected', $service, $user_id );

	return desktop_mode_oauth_render_callback_html( array(
		'ok'      => true,
		'service' => $service,
	) );
}

/**
 * Build the HTML string the OAuth callback popup renders.
 *
 * Pure function — no side effects. Split out from
 * {@see desktop_mode_oauth_render_callback_html()} so unit tests
 * can exercise the markup directly without going through a REST
 * dispatch + output-buffer dance.
 *
 * **Why `wp_json_encode` and not `esc_js` for the inlined values.**
 * `esc_js` HTML-encodes `"` to `&quot;` — fine for JS embedded
 * inside an HTML *attribute* (where the parser decodes entities
 * before the JS engine sees the value), wrong for JS embedded
 * inside a `<script>` element (where HTML entities are NOT
 * decoded — the JS engine reads `{&quot;ok&quot;:true}` literally
 * and throws a syntax error). The canonical safe shape for
 * embedding JSON in a script block is to drop the value as a
 * direct JS literal (JSON is a subset of JS) with `JSON_HEX_TAG`
 * neutralising any `</script>` substrings in string values
 * (defence-in-depth — our payload values are server-built, but
 * filters could mutate them).
 *
 * @since 0.8.2
 * @internal
 *
 * @param array $payload `{ ok: bool, service?: string, reason?: string, message?: string }`.
 * @return string
 */
function desktop_mode_oauth_build_callback_html( array $payload ) {
	// `JSON_HEX_TAG` escapes `<` and `>` as `\u003C` / `\u003E` so a
	// `</script>` smuggled into any string value can't terminate the
	// script block early. `JSON_UNESCAPED_SLASHES` keeps URLs
	// readable in DevTools.
	$payload_literal = wp_json_encode( $payload, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES );
	$origin_literal  = wp_json_encode( site_url(), JSON_HEX_TAG | JSON_UNESCAPED_SLASHES );

	return "<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<title>OAuth Callback</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #1d2327; }
</style>
</head>
<body>
<p>Authorization complete. You can close this window.</p>
<script>
( function () {
    try {
        if ( window.opener ) {
            window.opener.postMessage(
                { type: 'desktop-mode-oauth-callback', payload: {$payload_literal} },
                {$origin_literal}
            );
        }
    } catch ( e ) {}
    setTimeout( function () { window.close(); }, 250 );
} )();
</script>
</body>
</html>";
}

/**
 * Render the popup's HTML response.
 *
 * **Why this is more than `new WP_REST_Response( $html )`.**
 * `WP_REST_Server::serve_request()` runs every response's data
 * through `wp_json_encode()` regardless of the Content-Type
 * header. The naive form ships the HTML as a JSON-encoded string
 * with `Content-Type: text/html`, the browser renders it as
 * literal text (with the `<script>` block as inert page content),
 * and the popup's `postMessage` to its opener never fires.
 *
 * The fix: register a `rest_pre_serve_request` filter scoped to
 * this exact route that echoes the HTML directly and short-
 * circuits the JSON serializer. The filter self-removes after
 * firing so a subsequent REST request can't replay the cached
 * HTML closure.
 *
 * The returned `WP_REST_Response` carries the HTML as `data` so
 * unit tests reading `$response->get_data()` still see the body
 * (the filter only fires when the response is actually served).
 *
 * @since 0.8.2
 *
 * @param array $payload `{ ok: bool, service?: string, reason?: string, message?: string }`.
 * @return WP_REST_Response
 */
function desktop_mode_oauth_render_callback_html( array $payload ) {
	$html = desktop_mode_oauth_build_callback_html( $payload );

	$filter_cb = null;
	$filter_cb = static function ( $served, $result, $request ) use ( $html, &$filter_cb ) {
		// Scope tightly to the OAuth callback route — never affect
		// other REST endpoints' serialization. A misconfigured filter
		// here could break every REST response on the site.
		if (
			! $request instanceof WP_REST_Request
			|| '/desktop-mode/v1/oauth/callback' !== $request->get_route()
		) {
			return $served;
		}
		// Self-remove so the closure (which captures the HTML for THIS
		// request) doesn't echo it again on a subsequent REST call.
		if ( $filter_cb ) {
			remove_filter( 'rest_pre_serve_request', $filter_cb, 10 );
		}
		if ( ! headers_sent() ) {
			header( 'Content-Type: text/html; charset=utf-8' );
		}
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- statically-built HTML; embedded payload is wp_json_encode( …, JSON_HEX_TAG )-escaped during build in `desktop_mode_oauth_build_callback_html`.
		echo $html;
		// `true` tells WP_REST_Server we already served the response,
		// short-circuiting the json-encode + `echo` path that follows.
		return true;
	};
	add_filter( 'rest_pre_serve_request', $filter_cb, 10, 3 );

	$response = new WP_REST_Response( $html );
	$response->header( 'Content-Type', 'text/html; charset=utf-8' );
	return $response;
}

/**
 * Permission check for the start endpoint — any logged-in user.
 * The per-relay `capabilities` gate runs in the callback itself
 * so capability denial returns the canonical service-not-allowed
 * error rather than the REST-level "forbidden".
 *
 * @since 0.8.2
 *
 * @return true|WP_Error
 */
function desktop_mode_rest_oauth_start_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You must be logged in to start an OAuth flow.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	return true;
}

/**
 * Register the OAuth REST routes on `rest_api_init`.
 *
 * @since 0.8.2
 *
 * @return void
 */
function desktop_mode_register_oauth_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/oauth/start',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_rest_oauth_start',
			'permission_callback' => 'desktop_mode_rest_oauth_start_permission',
			'args'                => array(
				'service' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/oauth/callback',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_rest_oauth_callback',
			// Public — the route is reached via a redirect from the
			// remote service. Auth is the state nonce + (later) the
			// per-service capabilities check on the start side.
			'permission_callback' => '__return_true',
			'args'                => array(
				'state' => array( 'required' => true, 'type' => 'string' ),
				'code'  => array( 'required' => false, 'type' => 'string' ),
				'error' => array( 'required' => false, 'type' => 'string' ),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_oauth_rest_routes' );
