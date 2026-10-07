<?php

defined( 'ABSPATH' ) || exit;

function openstation_css_subtree_version( $relative, $fallback ) {
	$root = OPENSTATION_DIR . $relative;
	if ( ! file_exists( $root ) ) {
		return (string) $fallback;
	}
	$max   = (int) filemtime( $root );
	$queue = array( $root );
	$seen  = array( $root => true );
	while ( ! empty( $queue ) ) {
		$file = array_pop( $queue );
		$css  = (string) file_get_contents( $file );
		if ( ! preg_match_all( '/@import\s+url\(\s*["\']?([^"\')\s]+)["\']?\s*\)/i', $css, $matches ) ) {
			continue;
		}
		foreach ( $matches[1] as $import ) {
			$path = dirname( $file ) . '/' . $import;
			if ( ! file_exists( $path ) || isset( $seen[ $path ] ) ) {
				continue;
			}
			$seen[ $path ] = true;
			$max           = max( $max, (int) filemtime( $path ) );
			$queue[]       = $path;
		}
	}
	return (string) $max;
}

function openstation_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$built_version = static function ( $relative ) use ( $version ) {
		$path = OPENSTATION_DIR . $relative;
		return file_exists( $path ) ? (string) filemtime( $path ) : $version;
	};

	wp_register_style(
		'os-variables',
		OPENSTATION_URL . 'assets/css/variables.css',
		array(),
		$built_version( 'assets/css/variables.css' )
	);

	wp_register_style(
		'openstation',
		OPENSTATION_URL . 'assets/css/desktop.css',
		array( 'os-variables' ),
		$built_version( 'assets/css/desktop.css' )
	);

	$window_sheets = array(
		'os-window-chrome' => 'assets/css/window-chrome.css',
		'os-window-states' => 'assets/css/window-states.css',
		'os-effects'       => 'assets/css/effects.css',
		'os-window-links'  => 'assets/css/window-links.css',
	);
	$previous      = array( 'os-variables', 'dashicons' );
	foreach ( $window_sheets as $handle => $relative ) {
		wp_register_style(
			$handle,
			OPENSTATION_URL . $relative,
			$previous,
			$built_version( $relative )
		);
		$previous = array( $handle );
	}

	wp_register_style(
		'os-windows',
		OPENSTATION_URL . 'assets/css/windows.css',
		$previous,
		$built_version( 'assets/css/windows.css' )
	);

	wp_register_style(
		'os-window-overview',
		OPENSTATION_URL . 'assets/css/window-overview.css',
		array( 'os-windows' ),
		$built_version( 'assets/css/window-overview.css' )
	);

	wp_register_style(
		'os-solo',
		OPENSTATION_URL . 'assets/css/solo.css',
		array( 'os-windows' ),
		$built_version( 'assets/css/solo.css' )
	);
	wp_register_style(
		'os-dock',
		OPENSTATION_URL . 'assets/css/dock.css',
		array( 'os-variables', 'dashicons' ),
		$built_version( 'assets/css/dock.css' )
	);
	wp_register_style(
		'os-dock-peek',
		OPENSTATION_URL . 'assets/css/dock-peek.css',
		array( 'os-dock' ),
		$built_version( 'assets/css/dock-peek.css' )
	);

	wp_register_style(
		'os-mobile',
		OPENSTATION_URL . 'assets/css/mobile.css',
		array( 'os-variables', 'dashicons', 'os-dock', 'os-windows' ),
		$built_version( 'assets/css/mobile.css' )
	);

	wp_register_style(
		'os-workspaces',
		OPENSTATION_URL . 'assets/css/workspaces.css',
		array( 'os-variables', 'dashicons' ),
		$built_version( 'assets/css/workspaces.css' )
	);

	wp_register_style(
		'os-shortcuts',
		OPENSTATION_URL . 'assets/css/shortcuts.css',
		array( 'os-variables' ),
		$built_version( 'assets/css/shortcuts.css' )
	);

	wp_register_style(
		'os-openstation-layout',
		OPENSTATION_URL . 'assets/css/openstation-layout.css',
		array( 'os-dock' ),
		$built_version( 'assets/css/openstation-layout.css' )
	);

	wp_register_style(
		'os-chromeless',
		OPENSTATION_URL . 'assets/css/chromeless.css',
		array( 'openstation' ),
		$built_version( 'assets/css/chromeless.css' )
	);

	wp_register_style(
		'desktop-mode-ai-assistant',
		OPENSTATION_URL . 'assets/css/ai-assistant.css',
		array( 'os-variables' ),
		$built_version( 'assets/css/ai-assistant.css' )
	);

	wp_register_style(
		'desktop-mode-bug-report',
		OPENSTATION_URL . 'assets/css/bug-report.css',
		array( 'os-variables' ),
		$built_version( 'assets/css/bug-report.css' )
	);

	$recycle_bin_css = OPENSTATION_DIR . 'assets/css/recycle-bin.css';
	wp_register_style(
		'desktop-mode-recycle-bin',
		OPENSTATION_URL . 'assets/css/recycle-bin.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $recycle_bin_css ) ? (string) filemtime( $recycle_bin_css ) : $version
	);

	$desktop_files_css = OPENSTATION_DIR . 'assets/css/desktop-files.css';
	wp_register_style(
		'os-files',
		OPENSTATION_URL . 'assets/css/desktop-files.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $desktop_files_css ) ? (string) filemtime( $desktop_files_css ) : $version
	);

	$games_css = OPENSTATION_DIR . 'assets/css/games.css';
	wp_register_style(
		'desktop-mode-games',
		OPENSTATION_URL . 'assets/css/games.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $games_css ) ? (string) filemtime( $games_css ) : $version
	);
	$game_inkfall_css = OPENSTATION_DIR . 'assets/css/game-inkfall.css';
	wp_register_style(
		'os-game-inkfall',
		OPENSTATION_URL . 'assets/css/game-inkfall.css',
		array( 'os-variables' ),
		file_exists( $game_inkfall_css ) ? (string) filemtime( $game_inkfall_css ) : $version
	);
	$game_alphabet_soup_css = OPENSTATION_DIR . 'assets/css/game-alphabet-soup.css';
	wp_register_style(
		'os-game-alphabet-soup',
		OPENSTATION_URL . 'assets/css/game-alphabet-soup.css',
		array( 'os-variables' ),
		file_exists( $game_alphabet_soup_css ) ? (string) filemtime( $game_alphabet_soup_css ) : $version
	);

	$notes_css = OPENSTATION_DIR . 'assets/css/notes.css';
	wp_register_style(
		'os-notes',
		OPENSTATION_URL . 'assets/css/notes.css',
		array( 'os-variables', 'dashicons', 'os-files' ),
		file_exists( $notes_css ) ? (string) filemtime( $notes_css ) : $version
	);

	$announce_css = OPENSTATION_DIR . 'assets/css/announce.css';
	wp_register_style(
		'os-announce',
		OPENSTATION_URL . 'assets/css/announce.css',
		array( 'os-variables' ),
		file_exists( $announce_css ) ? (string) filemtime( $announce_css ) : $version
	);

	wp_register_script(
		'openstation',
		OPENSTATION_URL . 'assets/js/desktop' . $suffix . '.js',

		array( 'wp-hooks', 'wp-i18n', 'heartbeat', 'jquery' ),
		$built_version( 'assets/js/desktop' . $suffix . '.js' ),

		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);

	wp_register_script(
		'os-iframe-bridge',
		OPENSTATION_URL . 'assets/js/iframe-bridge' . $suffix . '.js',
		array(),
		$built_version( 'assets/js/iframe-bridge' . $suffix . '.js' ),
		true
	);

	wp_register_script(
		'os-deactivation-feedback',
		OPENSTATION_URL . 'assets/js/deactivation-feedback' . $suffix . '.js',
		array( 'wp-i18n' ),
		$built_version( 'assets/js/deactivation-feedback' . $suffix . '.js' ),
		true
	);
	wp_set_script_translations(
		'os-deactivation-feedback',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
	$feedback_css = OPENSTATION_DIR . 'assets/css/deactivation-feedback.css';
	wp_register_style(
		'os-deactivation-feedback',
		OPENSTATION_URL . 'assets/css/deactivation-feedback.css',
		array(),
		file_exists( $feedback_css ) ? (string) filemtime( $feedback_css ) : $version
	);

	wp_register_script(
		'os-chromeless-bridge',
		OPENSTATION_URL . 'assets/js/chromeless-bridge' . $suffix . '.js',
		array(),
		$built_version( 'assets/js/chromeless-bridge' . $suffix . '.js' ),
		true
	);

	wp_register_script(
		'os-gutenberg-drop-receiver',
		OPENSTATION_URL . 'assets/js/gutenberg-drop-receiver' . $suffix . '.js',
		array( 'wp-blocks', 'wp-data' ),
		$built_version( 'assets/js/gutenberg-drop-receiver' . $suffix . '.js' ),
		true
	);

	$games_js = OPENSTATION_DIR . 'assets/js/games' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-games',
		OPENSTATION_URL . 'assets/js/games' . $suffix . '.js',
		array( 'wp-i18n', 'heartbeat', 'jquery' ),
		file_exists( $games_js ) ? (string) filemtime( $games_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-games',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);

	$game_inkfall_js = OPENSTATION_DIR . 'assets/js/game-inkfall' . $suffix . '.js';
	wp_register_script(
		'os-game-inkfall',
		OPENSTATION_URL . 'assets/js/game-inkfall' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $game_inkfall_js ) ? (string) filemtime( $game_inkfall_js ) : $version,
		true
	);
	wp_set_script_translations(
		'os-game-inkfall',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);

	$game_alphabet_soup_js = OPENSTATION_DIR . 'assets/js/game-alphabet-soup' . $suffix . '.js';
	wp_register_script(
		'os-game-alphabet-soup',
		OPENSTATION_URL . 'assets/js/game-alphabet-soup' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $game_alphabet_soup_js ) ? (string) filemtime( $game_alphabet_soup_js ) : $version,
		true
	);
	wp_set_script_translations(
		'os-game-alphabet-soup',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);

	$animated_logo_js = OPENSTATION_DIR . 'assets/js/animated-logo-wallpaper' . $suffix . '.js';
	wp_register_script(
		'os-animated-logo-wallpaper',
		OPENSTATION_URL . 'assets/js/animated-logo-wallpaper' . $suffix . '.js',
		array( 'wp-hooks' ),
		file_exists( $animated_logo_js ) ? (string) filemtime( $animated_logo_js ) : $version,
		true
	);

	$snow_js = OPENSTATION_DIR . 'assets/js/snow-wallpaper' . $suffix . '.js';
	wp_register_script(
		'os-snow-wallpaper',
		OPENSTATION_URL . 'assets/js/snow-wallpaper' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $snow_js ) ? (string) filemtime( $snow_js ) : $version,
		true
	);
	wp_set_script_translations(
		'os-snow-wallpaper',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);

	$ai_assistant_js = OPENSTATION_DIR . 'assets/js/ai-assistant' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-ai-assistant',
		OPENSTATION_URL . 'assets/js/ai-assistant' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $ai_assistant_js ) ? (string) filemtime( $ai_assistant_js ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-ai-assistant',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);

	wp_set_script_translations(
		'openstation',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_register_assets' );
