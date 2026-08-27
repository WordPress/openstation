<?php
/**
 * OpenStation — Games registry.
 *
 * Server-side registration API + payload builder for desktop games.
 * A game's discovery metadata (title, icon, description, score
 * columns) is declared here in PHP so the Games window and the
 * scoreboard tabs paint at shell boot without downloading any game
 * code; the game's JS bundle — declared via the `script` handle —
 * is loaded lazily on first launch and publishes the full def
 * (including the `render` callback) on
 * `window.openStationGames[ <id> ]`.
 *
 * This deliberate laziness is the one way the games registry differs
 * from the wallpaper registry it is otherwise modeled on: wallpaper
 * scripts are enqueued eagerly because the active wallpaper must
 * paint at boot; game code is only needed when someone plays.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a server-side desktop game.
 *
 * Example:
 *
 * ```php
 * openstation_register_game( 'inkfall', array(
 *     'title'         => __( 'Inkfall', 'desktop-mode' ),
 *     'description'   => __( 'Type the falling words.', 'desktop-mode' ),
 *     'icon_svg'      => '<svg …>…</svg>',
 *     'script'        => 'os-game-inkfall',
 *     'score_columns' => array(
 *         array( 'key' => 'score', 'label' => __( 'Score', 'desktop-mode' ), 'type' => 'number' ),
 *         array( 'key' => 'time',  'label' => __( 'Time', 'desktop-mode' ),  'type' => 'time' ),
 *     ),
 *     'config'        => array( 'pace' => 'brisk' ),
 * ) );
 * ```
 *
 * ```js
 * // Inside os-game-inkfall.js
 * window.openStationGames = window.openStationGames || {};
 * window.openStationGames.inkfall = {
 *     id: 'inkfall',
 *     title: 'Inkfall',
 *     icon: 'data:image/svg+xml;base64,…',
 *     scoreColumns: [ … ],
 *     render: function ( ctx ) { return function () {}; },
 * };
 * ```
 *
 * @param string $id   Game id (slug). Must match the
 *                     `window.openStationGames[<id>]` key the game's
 *                     JS publishes.
 * @param array  $args {
 *     @type string   $title         Launcher label. Required.
 *     @type string   $description   Plain-text description shown on the
 *                                   launcher tile. Optional.
 *     @type string   $icon          Dashicon class, http(s) URL, or
 *                                   `data:image/svg+xml` URI.
 *     @type string   $icon_svg      Raw SVG markup shorthand — converted
 *                                   to a base64 data URI. Wins over
 *                                   `icon`.
 *     @type string   $script        Registered script handle whose file
 *                                   publishes the game def. Required.
 *     @type array[]  $score_columns Scoreboard column declarations:
 *                                   `{ key, label, type }` with type one
 *                                   of `number` | `time` | `text`.
 *     @type array    $config        Arbitrary blob shipped to the game's
 *                                   launch context (asset URLs, tuning).
 *                                   The framework merges its own keys in
 *                                   underneath (`wordsUrl` — see
 *                                   includes/games/config.php); the
 *                                   game's keys win on collision.
 *     @type string[] $capabilities  Gate: ALL caps must match.
 *     @type array    $window        The game window's size, as any
 *                                   subset of `{ width, height,
 *                                   minWidth, minHeight }` in pixels.
 *                                   Declare it here as well as in the
 *                                   JS def: a game's bundle is fetched
 *                                   on first play, so the shell opens
 *                                   the window — and paints its loading
 *                                   spinner — before it has seen the
 *                                   def. Without this the first window
 *                                   of a session opens at the framework
 *                                   default. The def still wins once it
 *                                   arrives, so declaring only in JS
 *                                   keeps working.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function openstation_register_game( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Game id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'         => '',
		'description'   => '',
		'icon'          => 'dashicons-admin-generic',
		'icon_svg'      => '',
		'script'        => '',
		'score_columns' => array(),
		'config'        => array(),
		'capabilities'  => array(),
		'window'        => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	$svg = trim( (string) $args['icon_svg'] );
	if ( '' !== $svg ) {
		// Same defence-in-depth as desktop icons: the data URI is
		// consumed via `<img src=…>` (which sandboxes SVG scripts),
		// but reject script tags outright anyway.
		if ( false !== stripos( $svg, '<script' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Game `icon_svg` must not contain a <script> tag.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		if ( 0 !== stripos( ltrim( $svg ), '<svg' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Game `icon_svg` must start with a <svg> root element.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		$args['icon'] = 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this game.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'id'         => $id,
				)
			);
		}
	}

	if ( '' === (string) $args['title'] ) {
		return openstation_registration_error(
			'openstation_missing_title',
			__( 'Game registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === (string) $args['script'] ) {
		return openstation_registration_error(
			'openstation_missing_script',
			__( 'Game registration requires a `script` handle that publishes the game def.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'            => $id,
		'title'         => (string) $args['title'],
		'description'   => sanitize_textarea_field( (string) $args['description'] ),
		'icon'          => openstation_sanitize_dock_icon( (string) $args['icon'] ),
		'script'        => (string) $args['script'],
		'score_columns' => openstation_games_sanitize_score_columns( $args['score_columns'] ),
		'config'        => is_array( $args['config'] ) ? $args['config'] : array(),
		'window'        => openstation_games_sanitize_window( $args['window'] ),
	);
	openstation_games_registry( $id, $entry );

	/**
	 * Fires after a desktop game is successfully registered.
	 *
	 * Does NOT fire when `openstation_register_game()` returns a
	 * `WP_Error`.
	 *
	 * @param string $id    The game id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_game_registered', $id, $entry );

	return true;
}

/**
 * Normalize the `window` declaration — the game window's size, known
 * before its bundle is.
 *
 * **Why this is registered server-side at all**, when the JS def
 * already carries a `window` block: a game's bundle is heavyweight
 * (the game, its engine, sometimes a dictionary asset), so it is
 * fetched on first play rather than at boot. The shell therefore has
 * to open the window — and paint its loading spinner — *before* it has
 * ever seen the def. Without a size here that first window opens at
 * the framework default and would have to jump to the real size once
 * the def landed. With it, the size is right from the first frame.
 *
 * The JS def still wins once it arrives, so a game that declares only
 * in JS keeps working exactly as before; it simply gets the default
 * size on the first open of a session.
 *
 * Values are clamped rather than rejected: a nonsensical size is a
 * plugin bug that should not stop the game opening, and an unopenable
 * window is a worse answer than an oddly-sized one.
 *
 * @internal
 *
 * @param mixed $window Raw caller input.
 * @return array Sanitized subset of `{ width, height, minWidth, minHeight }`.
 */
function openstation_games_sanitize_window( $window ) {
	if ( ! is_array( $window ) ) {
		return array();
	}
	$out = array();
	foreach ( array( 'width', 'height', 'minWidth', 'minHeight' ) as $key ) {
		if ( ! isset( $window[ $key ] ) || ! is_numeric( $window[ $key ] ) ) {
			continue;
		}
		$value = (int) $window[ $key ];
		if ( $value <= 0 ) {
			continue;
		}
		// The ceiling is generous on purpose — it exists to catch a
		// typo'd pixel value, not to have an opinion about how big a
		// game may be. The window manager clamps to the viewport anyway.
		$out[ $key ] = min( $value, 10000 );
	}

	return $out;
}

/**
 * Normalize the `score_columns` declaration: drop rows without a
 * valid key, default labels to the key, and clamp `type` to the
 * supported set.
 *
 * @internal
 *
 * @param mixed $columns Raw caller input.
 * @return array[] Sanitized `{ key, label, type }` rows.
 */
function openstation_games_sanitize_score_columns( $columns ) {
	if ( ! is_array( $columns ) ) {
		return array();
	}
	$out = array();
	foreach ( $columns as $column ) {
		if ( ! is_array( $column ) ) {
			continue;
		}
		$key = sanitize_key( (string) ( $column['key'] ?? '' ) );
		if ( '' === $key ) {
			continue;
		}
		$label = sanitize_text_field( (string) ( $column['label'] ?? '' ) );
		$type  = (string) ( $column['type'] ?? 'number' );
		if ( ! in_array( $type, array( 'number', 'time', 'text' ), true ) ) {
			$type = 'number';
		}
		$out[] = array(
			'key'   => $key,
			'label' => '' !== $label ? $label : $key,
			'type'  => $type,
		);
	}
	return $out;
}

/**
 * Internal module-level registry for games registered via
 * {@see openstation_register_game()}. Same static-store pattern as
 * the widget + wallpaper + native-window registries.
 *
 * @internal
 */
function openstation_games_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	// Sentinel write: the literal string `__unset__` removes the entry.
	if ( '__unset__' === $entry ) {
		unset( $store[ $id ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Unregister a game. Safe to call for unknown ids.
 *
 * @param string $id Game id.
 * @return bool Whether an entry was removed.
 */
function openstation_unregister_game( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id || null === openstation_games_registry( $id ) ) {
		return false;
	}
	openstation_games_registry( $id, '__unset__' );
	return true;
}

/**
 * The registered game entries with the `openstation_games` filter
 * applied. This is the read path everything else (payload, REST
 * validation) goes through, so filter-registered games validate.
 *
 * @return array[] Entries keyed by game id.
 */
function openstation_games_get_registered() {
	$registry = openstation_games_registry();

	/**
	 * Filters the server-declared game list. Mirrors the JS-side
	 * `os.games` filter so plugins can add, hide, or
	 * override entries at boot without round-tripping through the
	 * JS registry.
	 *
	 * @param array[] $registry The registered game entries, keyed by id.
	 */
	$registry = apply_filters( 'openstation_games', $registry );

	return is_array( $registry ) ? $registry : array();
}

/**
 * Whether a game id is known to the server registry (post-filter).
 * REST routes 404 unknown games through this.
 *
 * @param string $id Game id.
 * @return bool
 */
function openstation_games_is_registered( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return false;
	}
	$registry = openstation_games_get_registered();
	if ( isset( $registry[ $id ] ) ) {
		return true;
	}
	// Filter authors may return a plain list instead of an id-keyed
	// map — accept entries carrying the id in their payload too.
	foreach ( $registry as $entry ) {
		if ( is_array( $entry ) && isset( $entry['id'] ) && (string) $entry['id'] === $id ) {
			return true;
		}
	}
	return false;
}

/**
 * Build the game list for the shell payload. Only metadata + the
 * resolved script URL cross the wire; the game's render callback is
 * announced via the JS global its (lazily loaded) script sets up.
 *
 * @return array[]
 */
function openstation_build_desktop_games_payload() {
	// The module doesn't load when the framework is disabled, so this
	// only guards a mid-request flip (the admin just saved the toggle).
	if ( ! openstation_games_enabled() ) {
		return array();
	}
	$registry = openstation_games_get_registered();
	if ( empty( $registry ) ) {
		return array();
	}
	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$payload = openstation_resolve_script_payload( $handle );
		$out[]   = array(
			'id'                 => (string) $entry['id'],
			'title'              => isset( $entry['title'] ) ? (string) $entry['title'] : '',
			'description'        => isset( $entry['description'] ) ? (string) $entry['description'] : '',
			'icon'               => isset( $entry['icon'] ) ? (string) $entry['icon'] : '',
			'scoreColumns'       => isset( $entry['score_columns'] ) && is_array( $entry['score_columns'] )
				? array_map(
					static function ( $column ) {
						return array(
							'key'   => (string) $column['key'],
							'label' => (string) $column['label'],
							'type'  => (string) $column['type'],
						);
					},
					$entry['score_columns']
				)
				: array(),
			'config'             => array_merge(
				openstation_games_framework_config(),
				isset( $entry['config'] ) && is_array( $entry['config'] ) ? $entry['config'] : array()
			),
			// The window's size, known before its bundle is — so the
			// shell can open the window (and start its loading spinner)
			// on the click rather than after the download. Omitted
			// entirely when the game declared none, which reads as
			// "use the framework defaults" on the JS side.
			'window'             => isset( $entry['window'] ) && is_array( $entry['window'] )
				? $entry['window']
				: array(),
			'scriptUrl'          => $payload['url'],
			'scriptHandle'       => $handle,
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}
