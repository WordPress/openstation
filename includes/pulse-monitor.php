<?php
/**
 * OpenStation — Pulse Monitor server feed.
 *
 * The server half of the Pulse Monitor — the `wp-pulse` wallpaper and
 * the `desktop-mode/pulse` widget: an ECG trace that beats once per
 * HTTP request. The shell sees its own
 * traffic client-side; everything else that happens to the site — a
 * visitor reading a post, a crawler, a comment, a login, another
 * admin's Heartbeat, a cron run, a REST call from an app — only
 * exists on the server. This module records those requests into a
 * small rolling log and relays them to listening shells over
 * Heartbeat, together with a health snapshot the trace uses to pick
 * its rhythm (sinus, ectopic, fibrillation, tachycardia).
 *
 * Cost model. Nothing is recorded unless a shell is listening: a
 * mounted monitor (wallpaper or widget) contributes `openstation_pulse`
 * to every Heartbeat tick, and each tick refreshes a short lease in the
 * autoloaded `openstation_pulse_listeners` option. With no live lease
 * a request pays one in-memory option read at `shutdown` and returns.
 * Front-end page views — visitors and bots — are not counted unless an
 * administrator turns on the `pulse_visitors` extended option ("Count
 * site visitors"), so by default a listening monitor costs visitors
 * nothing either. When a request is recorded, the response is closed
 * first (`fastcgi_finish_request()` where the server has it) so nobody
 * waits for the write, and the write itself is kept rare and small:
 * at most one request per {@see OPENSTATION_PULSE_WRITE_INTERVAL_MS}
 * writes the log — the ones in between are sampled out, failures
 * included, so the failure rate the trace diagnoses from stays fair and
 * a burst (a login attack, a crawler) cannot turn into a write per
 * request. Only comments, publishing and orders always write: they are
 * rare and already wrote to the database. With a persistent object
 * cache the log lives there and never touches the database. A listener's own requests
 * are never recorded — the shell already sees them — and neither are
 * WP-CLI commands.
 *
 * Best effort. The log and the leases are read-modify-write options
 * with no lock, so concurrent requests can overwrite each other's
 * rows: under heavy traffic some beats are dropped, and a lease write
 * can be lost (the next tick past its half-life rewrites it). Both
 * are acceptable for a live trace; neither is an audit log.
 *
 * Privacy. Rows carry a kind, a timestamp, an HTTP status and the
 * user id (only to exclude a listener's own traffic). No URLs, IPs,
 * user agents or names are stored or relayed.
 *
 * Also owns the bundle's script handle and the widget registration;
 * the wallpaper registers with the other built-ins in
 * `includes/wallpapers.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Option holding the rolling event log (not autoloaded).
 */
const OPENSTATION_PULSE_LOG_OPTION = 'openstation_pulse_log';

/**
 * Option holding the listener leases — `user id => unix expiry`.
 * Autoloaded: it is read on every request's `shutdown`.
 */
const OPENSTATION_PULSE_LISTENERS_OPTION = 'openstation_pulse_listeners';

/**
 * Seconds a Heartbeat tick keeps a listener's lease alive. Four
 * 60-second ticks' worth would be generous; three is enough for the
 * slowest standard interval with one missed tick.
 */
const OPENSTATION_PULSE_LEASE_TTL = 180;

/**
 * Autoloaded option holding when the log was last written, in unix ms.
 * Without a persistent object cache it spaces the database writes out;
 * it is autoloaded so checking it costs nothing.
 */
const OPENSTATION_PULSE_GATE_OPTION = 'openstation_pulse_gate';

/**
 * Object cache group the log lives in when a persistent cache is in use.
 */
const OPENSTATION_PULSE_CACHE_GROUP = 'openstation_pulse';

/**
 * Minimum milliseconds between two writes of the log, for everything
 * but comments, publishing and orders.
 */
const OPENSTATION_PULSE_WRITE_INTERVAL_MS = 1000;

/**
 * Maximum retained log rows.
 */
const OPENSTATION_PULSE_LOG_MAX = 200;

/**
 * Milliseconds of history retained in the log.
 */
const OPENSTATION_PULSE_LOG_WINDOW_MS = 120000;

/**
 * Event kinds the server records. Mirrors the server-side source ids
 * in `src/plugins/pulse-monitor/sources.ts`.
 *
 * @return string[]
 */
function openstation_pulse_kinds() {
	return array( 'visitors', 'bots', 'comments', 'publish', 'orders', 'logins', 'api', 'cron', 'team' );
}

/**
 * Per-request state: explicit events recorded by the content hooks
 * during this request, flushed on `shutdown`.
 *
 * @return array Per-request state, by reference.
 */
function &openstation_pulse_state() {
	static $state = array( 'events' => array() );
	return $state;
}

/**
 * Clears the per-request state. Used by tests.
 */
function openstation_pulse_reset() {
	$state           = &openstation_pulse_state();
	$state['events'] = array();
}

/**
 * Whether front-end page views — visitors and bots — beat.
 *
 * Off by default: counting them gives every uncached page view some
 * server work while a monitor is open. An administrator turns it on
 * with the `pulse_visitors` extended option ("Count site visitors").
 *
 * @return bool
 */
function openstation_pulse_counts_visitors() {
	$enabled = false;
	if ( function_exists( 'openstation_get_extended_options' ) ) {
		$options = openstation_get_extended_options();
		$enabled = ! empty( $options['pulse_visitors'] );
	}

	/**
	 * Filters whether the Pulse Monitor counts front-end page views
	 * (visitors and bots). Defaults to the `pulse_visitors` extended
	 * option, which is off.
	 *
	 * @param bool $enabled Whether front-end page views are recorded.
	 */
	return (bool) apply_filters( 'openstation_pulse_count_visitors', $enabled );
}

/**
 * Whether this request is a front-end page view: not cron, REST,
 * XML-RPC, admin-ajax or an admin screen.
 *
 * @return bool
 */
function openstation_pulse_is_front_end_request() {
	return ! (
		wp_doing_cron()
		|| wp_doing_ajax()
		|| is_admin()
		|| ( defined( 'REST_REQUEST' ) && REST_REQUEST )
		|| ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST )
	);
}

/**
 * Whether the log lives in a persistent object cache instead of
 * `wp_options`.
 *
 * @return bool
 */
function openstation_pulse_uses_object_cache() {
	return (bool) wp_using_ext_object_cache();
}

/**
 * Sends the response and closes the connection before the log is
 * written, so the visitor never waits for it. A no-op where the server
 * API cannot do it (mod_php, CLI).
 */
function openstation_pulse_finish_response() {
	/**
	 * Filters whether the Pulse Monitor closes the response before it
	 * writes the log. Return false if something later on `shutdown`
	 * still needs to send output.
	 *
	 * @param bool $finish Whether to finish the response early.
	 */
	if ( ! apply_filters( 'openstation_pulse_finish_request', true ) ) {
		return;
	}
	if ( function_exists( 'fastcgi_finish_request' ) ) {
		fastcgi_finish_request();
	} elseif ( function_exists( 'litespeed_finish_request' ) ) {
		litespeed_finish_request();
	}
}

/**
 * Returns the live listener leases, pruned of expired entries.
 *
 * @return array<int,int> User id => unix expiry.
 */
function openstation_pulse_listeners() {
	$raw = get_option( OPENSTATION_PULSE_LISTENERS_OPTION, array() );
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$now  = time();
	$live = array();
	foreach ( $raw as $user_id => $until ) {
		if ( (int) $until > $now ) {
			$live[ (int) $user_id ] = (int) $until;
		}
	}
	return $live;
}

/**
 * Whether at least one shell is listening right now.
 *
 * @return bool
 */
function openstation_pulse_is_listening() {
	return ! empty( openstation_pulse_listeners() );
}

/**
 * Extends a user's listener lease. Writes only when the lease is new
 * or past its half-life, so a 15-second Heartbeat costs one write
 * every ~90 seconds rather than one per tick.
 *
 * @param int $user_id User id.
 * @return bool Whether the option was written.
 */
function openstation_pulse_touch_listener( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	$leases = openstation_pulse_listeners();
	$now    = time();
	if ( isset( $leases[ $user_id ] ) && $leases[ $user_id ] - $now > OPENSTATION_PULSE_LEASE_TTL / 2 ) {
		return false;
	}
	$leases[ $user_id ] = $now + OPENSTATION_PULSE_LEASE_TTL;
	update_option( OPENSTATION_PULSE_LISTENERS_OPTION, $leases, true );
	return true;
}

/**
 * Records an explicit event for this request — a comment, a publish,
 * a login. Explicit events replace the generic request classification
 * on `shutdown`, so a comment POST beats once as a comment rather
 * than twice.
 *
 * Public so plugins can add their own beats: a form plugin can call
 * `openstation_pulse_record( 'comments' )` on submission, a shop on a
 * refund. Unknown kinds are accepted when they are slug-shaped; the
 * client renders them as a generic beat.
 *
 * @param string $kind Event kind (see {@see openstation_pulse_kinds()}).
 * @param array  $args {
 *     Optional. Event flags.
 *
 *     @type bool $error Render the beat as an ectopic (failed) beat.
 * }
 * @return bool True when the event was queued.
 */
function openstation_pulse_record( $kind, $args = array() ) {
	$kind = is_string( $kind ) ? sanitize_key( $kind ) : '';
	if ( '' === $kind ) {
		return false;
	}
	$state             = &openstation_pulse_state();
	$state['events'][] = array(
		'kind'  => $kind,
		'error' => ! empty( $args['error'] ),
	);
	return true;
}

/**
 * Whether a user agent looks like a crawler, monitor or script.
 *
 * @param string $user_agent Raw user agent.
 * @return bool
 */
function openstation_pulse_is_bot( $user_agent ) {
	$user_agent = (string) $user_agent;
	$is_bot     = '' === $user_agent
		|| (bool) preg_match( '/bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|curl|wget|python|httpclient|okhttp|go-http|headless|lighthouse|feedfetcher|scrap/i', $user_agent );

	/**
	 * Filters whether the current request counts as a bot for the
	 * Pulse Monitor — bot beats render smaller than visitor beats.
	 *
	 * @param bool   $is_bot     Whether the user agent matched the bot pattern.
	 * @param string $user_agent The raw user agent.
	 */
	return (bool) apply_filters( 'openstation_pulse_is_bot', $is_bot, $user_agent );
}

/**
 * Classifies the current request into one Pulse kind.
 *
 * @return string Event kind, or '' when the request is not worth a beat.
 */
function openstation_pulse_classify_request() {
	$logged_in = get_current_user_id() > 0;

	if ( wp_doing_cron() ) {
		$kind = 'cron';
	} elseif ( ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) ) {
		$kind = $logged_in ? 'team' : 'api';
	} elseif ( wp_doing_ajax() || is_admin() ) {
		$kind = $logged_in ? 'team' : 'api';
	} else {
		$user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$kind       = openstation_pulse_is_bot( $user_agent ) ? 'bots' : 'visitors';
	}

	/**
	 * Filters the Pulse kind a request is classified as. Return an
	 * empty string to keep the request off the monitor.
	 *
	 * @param string $kind The classified kind.
	 */
	return (string) apply_filters( 'openstation_pulse_request_kind', $kind );
}

/**
 * Reads the log: its sequence counter and the rows still inside the
 * retention window.
 *
 * @param int $now Current time in milliseconds.
 * @return array {
 *     @type int   $seq     Highest sequence number handed out.
 *     @type array $entries Rows with `ts` at or after `$now` minus the window, oldest first.
 * }
 */
function openstation_pulse_read_log( $now ) {
	$log     = openstation_pulse_uses_object_cache()
		? wp_cache_get( 'log', OPENSTATION_PULSE_CACHE_GROUP )
		: get_option( OPENSTATION_PULSE_LOG_OPTION, array() );
	$seq     = ( is_array( $log ) && isset( $log['seq'] ) ) ? (int) $log['seq'] : 0;
	$entries = ( is_array( $log ) && isset( $log['entries'] ) && is_array( $log['entries'] ) ) ? $log['entries'] : array();
	$cutoff  = $now - OPENSTATION_PULSE_LOG_WINDOW_MS;

	return array(
		'seq'     => $seq,
		'entries' => array_values(
			array_filter(
				$entries,
				function ( $entry ) use ( $cutoff ) {
					return is_array( $entry ) && isset( $entry['ts'] ) && (int) $entry['ts'] >= $cutoff;
				}
			)
		),
	);
}

/**
 * Appends rows to the log, pruning by age and count.
 *
 * @param array $rows Rows with `kind`, `status`, `error`, `user`.
 * @param int   $now  Current time in milliseconds.
 */
function openstation_pulse_append( $rows, $now ) {
	$log     = openstation_pulse_read_log( $now );
	$seq     = $log['seq'];
	$entries = $log['entries'];

	foreach ( $rows as $row ) {
		$entries[] = array(
			'seq'    => ++$seq,
			'ts'     => $now,
			'kind'   => $row['kind'],
			'status' => (int) $row['status'],
			'error'  => (bool) $row['error'],
			'user'   => (int) $row['user'],
		);
	}

	if ( count( $entries ) > OPENSTATION_PULSE_LOG_MAX ) {
		$entries = array_slice( $entries, -OPENSTATION_PULSE_LOG_MAX );
	}

	$log = array(
		'seq'     => $seq,
		'entries' => $entries,
	);
	if ( openstation_pulse_uses_object_cache() ) {
		wp_cache_set( 'log', $log, OPENSTATION_PULSE_CACHE_GROUP );
		return;
	}
	update_option( OPENSTATION_PULSE_LOG_OPTION, $log, false );
}

/**
 * Whether this request may write the log now — at most one request per
 * {@see OPENSTATION_PULSE_WRITE_INTERVAL_MS}. Claims the slot when it does.
 *
 * @param int $now Current time in milliseconds.
 * @return bool
 */
function openstation_pulse_claim_write( $now ) {
	if ( openstation_pulse_uses_object_cache() ) {
		// `add` is atomic in Redis and Memcached: one request per second
		// wins, and the rest never fetch the log.
		return (bool) wp_cache_add( 'gate', $now, OPENSTATION_PULSE_CACHE_GROUP, (int) ceil( OPENSTATION_PULSE_WRITE_INTERVAL_MS / 1000 ) );
	}
	$last = (int) get_option( OPENSTATION_PULSE_GATE_OPTION, 0 );
	if ( $now - $last < OPENSTATION_PULSE_WRITE_INTERVAL_MS && $now >= $last ) {
		return false;
	}
	update_option( OPENSTATION_PULSE_GATE_OPTION, $now, true );
	return true;
}

/**
 * `shutdown` handler — records this request when a shell is listening.
 */
function openstation_pulse_on_shutdown() {
	$listeners = openstation_pulse_listeners();
	$state     = &openstation_pulse_state();
	$explicit  = $state['events'];
	$announced = ! empty( $explicit );
	openstation_pulse_reset();

	// A WP-CLI command is not site traffic — and with no user agent it
	// would otherwise beat as a bot.
	if ( empty( $listeners ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
		return;
	}
	$user_id = get_current_user_id();
	if ( $user_id > 0 && isset( $listeners[ $user_id ] ) ) {
		// The listener's own shell already beats for its requests —
		// including the block editor's, which the chromeless bridge
		// reports from inside the editor window.
		return;
	}

	$status = http_response_code();
	$status = is_int( $status ) ? $status : 200;

	if ( empty( $explicit ) ) {
		// Page views are off by default; a front-end server error still
		// counts, it is what the monitor is for.
		if ( $status < 500 && openstation_pulse_is_front_end_request() && ! openstation_pulse_counts_visitors() ) {
			return;
		}
		$kind = openstation_pulse_classify_request();
		if ( '' === $kind ) {
			return;
		}
		$explicit = array(
			array(
				'kind'  => $kind,
				'error' => false,
			),
		);
	}

	$rows = array();
	foreach ( $explicit as $event ) {
		$row = array(
			'kind'   => $event['kind'],
			'status' => $status,
			'error'  => $event['error'] || $status >= 500,
			'user'   => $user_id,
		);

		/**
		 * Filters one Pulse Monitor event before it is logged. Return
		 * a falsy value to drop it.
		 *
		 * @param array|false $row {
		 *     The event.
		 *
		 *     @type string $kind   Event kind.
		 *     @type int    $status HTTP status of the request.
		 *     @type bool   $error  Whether it renders as a failed beat.
		 *     @type int    $user   Current user id (0 for visitors).
		 * }
		 */
		$row = apply_filters( 'openstation_pulse_event', $row );
		if ( is_array( $row ) && isset( $row['kind'] ) && '' !== sanitize_key( (string) $row['kind'] ) ) {
			$rows[] = array(
				'kind'   => sanitize_key( (string) $row['kind'] ),
				'status' => isset( $row['status'] ) ? (int) $row['status'] : $status,
				'error'  => ! empty( $row['error'] ),
				'user'   => $user_id,
			);
		}
	}

	if ( empty( $rows ) ) {
		return;
	}

	// Everything is sampled alike, failures included, so the failure
	// rate stays fair and a burst cannot become a write per request.
	// Comments, publishing and orders are rare and already wrote to the
	// database: they always make it into the log.
	$now    = (int) round( microtime( true ) * 1000 );
	$always = $announced && ! in_array( true, wp_list_pluck( $rows, 'error' ), true );
	if ( ! $always && ! openstation_pulse_claim_write( $now ) ) {
		return;
	}
	openstation_pulse_finish_response();
	openstation_pulse_append( $rows, $now );
}

/**
 * Builds the server-side health snapshot the trace diagnoses from.
 *
 * @param array $entries Log rows inside the retention window.
 * @return array {
 *     @type array|null $siteHealth `{ good, recommended, critical }` from the
 *                                  last Site Health run, or null.
 *     @type int        $requests   Logged requests in the window.
 *     @type int        $failures   Logged requests that failed (5xx / flagged).
 *     @type int        $cronLate   Seconds the oldest due cron event is overdue.
 * }
 */
function openstation_pulse_health_snapshot( $entries ) {
	$site_health = null;
	$cached      = get_transient( 'health-check-site-status-result' );
	if ( is_string( $cached ) && '' !== $cached ) {
		$decoded = json_decode( $cached, true );
		if ( is_array( $decoded ) ) {
			$site_health = array(
				'good'        => isset( $decoded['good'] ) ? (int) $decoded['good'] : 0,
				'recommended' => isset( $decoded['recommended'] ) ? (int) $decoded['recommended'] : 0,
				'critical'    => isset( $decoded['critical'] ) ? (int) $decoded['critical'] : 0,
			);
		}
	}

	$failures = 0;
	foreach ( $entries as $entry ) {
		if ( ! empty( $entry['error'] ) ) {
			++$failures;
		}
	}

	$cron_late = 0;
	$crons     = function_exists( '_get_cron_array' ) ? _get_cron_array() : array();
	if ( is_array( $crons ) && ! empty( $crons ) ) {
		$first = (int) min( array_keys( $crons ) );
		// A minute of slack: WP-Cron only runs on the next request.
		$cron_late = max( 0, time() - $first - 60 );
	}

	$snapshot = array(
		'siteHealth' => $site_health,
		'requests'   => count( $entries ),
		'failures'   => $failures,
		'cronLate'   => $cron_late,
	);

	/**
	 * Filters the health snapshot the Pulse Monitor diagnoses from.
	 * Plugins that know more (an uptime monitor, a queue depth) can
	 * add failures or override the cron delay.
	 *
	 * @param array $snapshot The snapshot.
	 */
	return (array) apply_filters( 'openstation_pulse_health', $snapshot );
}

/**
 * Heartbeat handler — relays logged events newer than the client's
 * cursor, plus the health snapshot.
 *
 * Opt-in via the client-sent `openstation_pulse` key; ticks without
 * it return untouched. The first tick (cursor 0) returns only the
 * cursor, so mounting the wallpaper does not replay two minutes of
 * history as one burst. A cursor ahead of the log means the log was
 * reset (deleted, restored, migrated): every row it holds is new to
 * that client, so they are all relayed and the response brings the
 * cursor back down.
 *
 * @param array $response Heartbeat response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function openstation_pulse_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! isset( $data['openstation_pulse'] ) ) {
		return $response;
	}

	/**
	 * Filters the capability required to receive the site-wide Pulse
	 * Monitor feed. Users without it still get a live trace from their
	 * own shell's traffic; they just do not see visitors, logins or
	 * other people's activity.
	 *
	 * @param string $capability Capability. Default 'manage_options'.
	 */
	$capability = (string) apply_filters( 'openstation_pulse_capability', 'manage_options' );
	if ( ! current_user_can( $capability ) ) {
		return $response;
	}

	$user_id = get_current_user_id();
	openstation_pulse_touch_listener( $user_id );

	$payload = is_array( $data['openstation_pulse'] ) ? $data['openstation_pulse'] : array();
	$since   = isset( $payload['since'] ) ? (int) $payload['since'] : 0;

	$now      = (int) round( microtime( true ) * 1000 );
	$log      = openstation_pulse_read_log( $now );
	$seq      = $log['seq'];
	$windowed = $log['entries'];
	$replay   = $since > 0;
	if ( $since > $seq ) {
		$since = 0;
	}

	$fresh = array();
	if ( $replay ) {
		foreach ( $windowed as $entry ) {
			if ( (int) $entry['seq'] <= $since || (int) $entry['user'] === $user_id ) {
				continue;
			}
			$fresh[] = array(
				'ts'     => (int) $entry['ts'],
				'kind'   => (string) $entry['kind'],
				'status' => (int) $entry['status'],
				'error'  => ! empty( $entry['error'] ),
			);
		}
	}

	$response['openstation_pulse'] = array(
		'seq'    => $seq,
		'now'    => $now,
		'events' => $fresh,
		'health' => openstation_pulse_health_snapshot( $windowed ),
	);

	return $response;
}

/**
 * Comment hook — a new comment, review, pingback or trackback beats as
 * a comment (spam included). Other comment types are bookkeeping that
 * plugins keep in the comments table — WooCommerce order notes, for
 * one — and stay off the trace.
 *
 * `wp_insert_comment` also fires for imports and programmatic
 * inserts: an importer bringing in a thousand comments beats a
 * thousand times.
 *
 * @param int             $comment_id Comment id.
 * @param WP_Comment|null $comment    Comment.
 */
function openstation_pulse_on_comment( $comment_id, $comment = null ) {
	$type = ( $comment instanceof WP_Comment ) ? $comment->comment_type : get_comment_type( $comment_id );
	if ( ! in_array( (string) $type, array( '', 'comment', 'review', 'pingback', 'trackback' ), true ) ) {
		return;
	}
	openstation_pulse_record( 'comments' );
}

/**
 * Post status hook — a post going live beats as a publish.
 *
 * @param string  $new_status New status.
 * @param string  $old_status Old status.
 * @param WP_Post $post       Post.
 */
function openstation_pulse_on_transition_post_status( $new_status, $old_status, $post ) {
	if ( 'publish' !== $new_status || 'publish' === $old_status ) {
		return;
	}
	if ( ! $post instanceof WP_Post || ! is_post_type_viewable( $post->post_type ) ) {
		return;
	}
	openstation_pulse_record( 'publish' );
}

/**
 * Registers the bundle both faces share. One script for the wallpaper
 * (`wp-pulse`, registered in `includes/wallpapers.php`) and the widget
 * (`desktop-mode/pulse`, below): the shell's loaders de-duplicate by
 * URL, so the engine, the signal taps and the Heartbeat feed load once
 * whichever face is on the desk. `heartbeat` is a dependency because
 * the monitor rides Heartbeat for site-wide events and for the
 * Heartbeat beat itself.
 */
function openstation_pulse_register_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';
	$js_path = OPENSTATION_DIR . 'assets/js/pulse-monitor' . $suffix . '.js';

	wp_register_script(
		'os-pulse-monitor',
		OPENSTATION_URL . 'assets/js/pulse-monitor' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n', 'heartbeat' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations( 'os-pulse-monitor', 'desktop-mode', OPENSTATION_DIR . 'languages' );
}

/**
 * Registers the Pulse Monitor widget: the wallpaper's trace, numbers
 * and labels in a resizable card, sharing its settings.
 */
function openstation_pulse_register_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
		'desktop-mode/pulse',
		array(
			'label'          => __( 'Pulse Monitor', 'desktop-mode' ),
			'description'    => __( 'A heart monitor for your site: every request, visitor, comment and Heartbeat tick is a labelled beat, failed ones say why, and the rhythm shows how healthy the site is.', 'desktop-mode' ),
			'icon'           => 'dashicons-heart',
			'script'         => 'os-pulse-monitor',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 260,
			'min_height'     => 150,
			'default_width'  => 380,
			'default_height' => 200,
		)
	);
}

/**
 * Wires the recorder.
 */
function openstation_pulse_register_hooks() {
	add_action( 'wp_insert_comment', 'openstation_pulse_on_comment', 10, 2 );
	add_action( 'transition_post_status', 'openstation_pulse_on_transition_post_status', 10, 3 );
	add_action(
		'wp_login',
		function () {
			openstation_pulse_record( 'logins' );
		}
	);
	add_action(
		'wp_login_failed',
		function () {
			openstation_pulse_record( 'logins', array( 'error' => true ) );
		}
	);
	add_action(
		'woocommerce_new_order',
		function () {
			openstation_pulse_record( 'orders' );
		}
	);
	// Last on `shutdown`: the recorder may close the response before it
	// writes, and nothing after it should still be sending output.
	add_action( 'shutdown', 'openstation_pulse_on_shutdown', PHP_INT_MAX );
	add_filter( 'heartbeat_received', 'openstation_pulse_heartbeat_received', 10, 2 );
}
add_action( 'init', 'openstation_pulse_register_hooks', 5 );
add_action( 'init', 'openstation_pulse_register_assets', 5 );
add_action( 'init', 'openstation_pulse_register_widget', 6 );
