<?php

defined( 'ABSPATH' ) || exit;

function openstation_enqueue_assets() {
	if ( ! is_admin() ) {
		return;
	}

	if ( openstation_is_enabled() ) {
		wp_enqueue_script( 'os-iframe-bridge' );

		global $hook_suffix;
		if ( 'post.php' === $hook_suffix || 'post-new.php' === $hook_suffix ) {
			wp_enqueue_script( 'os-gutenberg-drop-receiver' );
		}
	}

	if ( openstation_is_chromeless_request() ) {
		wp_enqueue_style( 'openstation' );
		wp_enqueue_style( 'os-chromeless' );

		do_action( 'openstation_chromeless_styles' );
		return;
	}

	if ( ! openstation_is_shell_request() ) {
		return;
	}

	wp_enqueue_style( 'openstation' );
	wp_enqueue_style( 'os-windows' );
	wp_enqueue_style( 'os-window-overview' );
	wp_enqueue_style( 'os-dock' );
	wp_enqueue_style( 'os-dock-peek' );
	wp_enqueue_style( 'os-workspaces' );
	wp_enqueue_style( 'os-shortcuts' );
	wp_enqueue_style( 'os-openstation-layout' );
	wp_enqueue_style( 'os-files' );
	wp_enqueue_style( 'os-notes' );

	wp_enqueue_style( 'os-mobile' );

	$solo_window = openstation_solo_window_id();
	if ( '' !== $solo_window ) {
		wp_enqueue_style( 'os-solo' );

		wp_add_inline_style(
			'os-solo',
			sprintf(
				'body.os-solo .os-window:not(#wp-window-%1$s){visibility:hidden !important;pointer-events:none !important;}',
				esc_attr( $solo_window )
			)
		);
	}

	$show_rebrand_notice = openstation_should_show_rebrand_notice();
	if ( $show_rebrand_notice ) {
		wp_enqueue_style( 'os-announce' );
	}

	wp_enqueue_script( 'openstation' );

	$command_palette = openstation_build_command_palette_assets_payload();

	if ( function_exists( 'wp_enqueue_command_palette_assets' ) ) {

		$menu_map = openstation_build_command_menu_map();
		wp_add_inline_script(
			'openstation',
			'window.__openStationMenuCommands = ' . wp_json_encode( $menu_map ) . ';',
			'before'
		);
	}

	global $title, $parent_file, $menu;

	$menu_icon = 'dashicons-admin-generic';
	if ( ! empty( $parent_file ) && ! empty( $menu ) ) {
		foreach ( $menu as $item ) {
			if ( ! empty( $item[2] ) && $item[2] === $parent_file && ! empty( $item[6] ) ) {
				$menu_icon = $item[6];
				break;
			}
		}
	}

	$menu_payload   = openstation_build_menu_payload();
	$dock_items     = $menu_payload['dockItems'];
	$native_windows = isset( $menu_payload['nativeWindows'] )
		? $menu_payload['nativeWindows']
		: array();

	foreach ( $native_windows as &$native_window_row ) {
		if ( is_array( $native_window_row ) ) {
			$native_window_row['templateHtml'] = '';
		}
	}
	unset( $native_window_row );
	$native_window_script_data         = isset( $menu_payload['nativeWindowScriptData'] )
		? $menu_payload['nativeWindowScriptData']
		: array();
	$server_widgets                    = isset( $menu_payload['serverWidgets'] )
		? $menu_payload['serverWidgets']
		: array();
	$server_wallpapers                 = isset( $menu_payload['serverWallpapers'] )
		? $menu_payload['serverWallpapers']
		: array();
	$server_command_scripts            = isset( $menu_payload['serverCommandScripts'] )
		? $menu_payload['serverCommandScripts']
		: array();
	$server_commands                   = isset( $menu_payload['serverCommands'] )
		? $menu_payload['serverCommands']
		: array();
	$server_settings_tab_scripts       = isset( $menu_payload['serverSettingsTabScripts'] )
		? $menu_payload['serverSettingsTabScripts']
		: array();
	$server_settings_tabs              = isset( $menu_payload['serverSettingsTabs'] )
		? $menu_payload['serverSettingsTabs']
		: array();
	$server_dock_rail_renderer_scripts = isset( $menu_payload['serverDockRailRendererScripts'] )
		? $menu_payload['serverDockRailRendererScripts']
		: array();
	$server_titlebar_button_scripts    = isset( $menu_payload['serverTitleBarButtonScripts'] )
		? $menu_payload['serverTitleBarButtonScripts']
		: array();
	$server_window_action_scripts      = isset( $menu_payload['serverWindowActionScripts'] )
		? $menu_payload['serverWindowActionScripts']
		: array();
	$server_window_theme_scripts       = isset( $menu_payload['serverWindowThemeScripts'] )
		? $menu_payload['serverWindowThemeScripts']
		: array();
	$server_window_themes              = isset( $menu_payload['serverWindowThemes'] )
		? $menu_payload['serverWindowThemes']
		: array();
	$server_window_control_scripts     = isset( $menu_payload['serverWindowControlScripts'] )
		? $menu_payload['serverWindowControlScripts']
		: array();
	$server_window_controls            = isset( $menu_payload['serverWindowControls'] )
		? $menu_payload['serverWindowControls']
		: array();
	$server_window_slot_scripts        = isset( $menu_payload['serverWindowSlotScripts'] )
		? $menu_payload['serverWindowSlotScripts']
		: array();
	$server_window_slots               = isset( $menu_payload['serverWindowSlots'] )
		? $menu_payload['serverWindowSlots']
		: array();
	$server_window_chrome_scripts      = isset( $menu_payload['serverWindowChromeScripts'] )
		? $menu_payload['serverWindowChromeScripts']
		: array();
	$server_window_chromes             = isset( $menu_payload['serverWindowChromes'] )
		? $menu_payload['serverWindowChromes']
		: array();
	$server_window_notices             = isset( $menu_payload['serverWindowNotices'] )
		? $menu_payload['serverWindowNotices']
		: array();
	$server_games                      = isset( $menu_payload['serverGames'] )
		? $menu_payload['serverGames']
		: array();

	$server_desktop_themes = isset( $menu_payload['serverDesktopThemes'] )
		? $menu_payload['serverDesktopThemes']
		: array();

	foreach ( $server_desktop_themes as &$desktop_theme_row ) {
		if ( is_array( $desktop_theme_row ) ) {
			$desktop_theme_row['cssText']     = '';
			$desktop_theme_row['tokens']      = new stdClass();
			$desktop_theme_row['cssDeferred'] = true;
		}
	}
	unset( $desktop_theme_row );
	$desktop_icons = isset( $menu_payload['desktopIcons'] )
		? $menu_payload['desktopIcons']
		: array();

	$server_file_types           = function_exists( 'openstation_build_file_types_payload' )
		? openstation_build_file_types_payload()
		: array();
	$server_file_openers         = function_exists( 'openstation_build_file_openers_payload' )
		? openstation_build_file_openers_payload()
		: array();

	$script_dep_payloads         = isset( $menu_payload['scriptDepPayloads'] )
		? (array) $menu_payload['scriptDepPayloads']
		: array();
	$user_file_associations      = function_exists( 'openstation_get_user_file_associations' )
		? openstation_get_user_file_associations( get_current_user_id() )
		: array();
	$server_wallpaper_menu_items = function_exists( 'openstation_build_wallpaper_menu_items' )
		? openstation_build_wallpaper_menu_items()
		: array();

	$drop_allowed_mimes_map = current_user_can( 'upload_files' )
		? get_allowed_mime_types( get_current_user_id() )
		: array();

	$drop_allowed_mimes_map = apply_filters( 'openstation_drop_allowed_mimes', $drop_allowed_mimes_map, get_current_user_id() );
	$drop_allowed_mimes_map = is_array( $drop_allowed_mimes_map ) ? $drop_allowed_mimes_map : array();
	$drop_allowed_mimes     = array_values( array_unique( array_values( $drop_allowed_mimes_map ) ) );

	$drop_max_size = (int) wp_max_upload_size();

	$drop_max_size = (int) apply_filters( 'openstation_drop_max_size', $drop_max_size, get_current_user_id() );

	$drop_enabled = (bool) apply_filters(
		'openstation_drop_enabled',
		current_user_can( 'upload_files' ),
		get_current_user_id()
	);

	$drop_config = array(
		'enabled'      => $drop_enabled,
		'allowedMimes' => $drop_allowed_mimes,
		'extToMime'    => $drop_allowed_mimes_map,
		'maxSize'      => $drop_max_size,
	);

	$suffix          = openstation_asset_suffix();
	$lazy_bundle_url = static function ( $base ) use ( $suffix ) {
		$path = OPENSTATION_DIR . 'assets/js/' . $base . $suffix . '.js';
		$ver  = file_exists( $path )
			? (string) filemtime( $path )
			: OPENSTATION_VERSION;
		return esc_url_raw(
			OPENSTATION_URL . 'assets/js/' . $base . $suffix . '.js?ver=' . $ver
		);
	};

	$boot_target        = openstation_shell_boot_target();
	$current_page       = $boot_target['url'];
	$from_portal        = $boot_target['fromPortal'];
	$from_portal_intent = $boot_target['fromPortalIntent'];

	$current_title = wp_strip_all_tags( (string) $title );
	if ( openstation_is_shell_screen_request() ) {
		$boot_meta     = openstation_shell_boot_target_meta( $current_page, $dock_items );
		$current_title = wp_strip_all_tags( $boot_meta['title'] );
		if ( '' !== $boot_meta['icon'] ) {
			$menu_icon = $boot_meta['icon'];
		}
	}

	$config = apply_filters(
		'openstation_shell_config',
		array(
			'currentPage'                   => esc_url( $current_page ),
			'currentTitle'                  => $current_title,
			'currentIcon'                   => sanitize_html_class( $menu_icon ),

			'adminUrl'                      => esc_url( self_admin_url() ),
			'homeUrl'                       => esc_url( home_url( '/' ) ),

			'logoutUrl'                     => esc_url_raw(
				html_entity_decode( wp_logout_url(), ENT_QUOTES, 'UTF-8' )
			),
			'colorScheme'                   => sanitize_html_class( get_user_option( 'admin_color' ), 'fresh' ),
			'dockItems'                     => $dock_items,

			'menuSig'                       => isset( $menu_payload['menuSig'] ) ? (string) $menu_payload['menuSig'] : '',
			'nativeWindows'                 => $native_windows,

			'nativeWindowScriptData'        => $native_window_script_data,
			'serverWidgets'                 => $server_widgets,
			'serverWallpapers'              => $server_wallpapers,
			'serverCommandScripts'          => $server_command_scripts,
			'serverCommands'                => $server_commands,
			'serverSettingsTabScripts'      => $server_settings_tab_scripts,
			'serverSettingsTabs'            => $server_settings_tabs,
			'serverDockRailRendererScripts' => $server_dock_rail_renderer_scripts,
			'serverTitleBarButtonScripts'   => $server_titlebar_button_scripts,
			'serverWindowActionScripts'     => $server_window_action_scripts,
			'serverWindowThemeScripts'      => $server_window_theme_scripts,
			'serverWindowThemes'            => $server_window_themes,
			'serverWindowControlScripts'    => $server_window_control_scripts,
			'serverWindowControls'          => $server_window_controls,
			'serverWindowSlotScripts'       => $server_window_slot_scripts,
			'serverWindowSlots'             => $server_window_slots,
			'serverWindowChromeScripts'     => $server_window_chrome_scripts,
			'serverWindowChromes'           => $server_window_chromes,
			'serverWindowNotices'           => $server_window_notices,

			'serverGames'                   => $server_games,
			'serverDesktopThemes'           => $server_desktop_themes,
			'desktopIcons'                  => $desktop_icons,
			'serverFileTypes'               => $server_file_types,
			'serverFileOpeners'             => $server_file_openers,

			'scriptDepPayloads'             => (object) $script_dep_payloads,
			'userFileAssociations'          => $user_file_associations,
			'filesUrl'                      => esc_url_raw( rest_url( 'desktop-mode/v1/files' ) ),

			'notesUrl'                      => esc_url_raw( rest_url( 'desktop-mode/v1/notes' ) ),

			'canCreatePosts'                => current_user_can( 'edit_posts' ),
			'serverWallpaperMenuItems'      => $server_wallpaper_menu_items,
			'accentColors'                  => openstation_get_accent_colors(),
			'toastTypes'                    => openstation_get_toast_types(),
			'coreUpdate'                    => openstation_get_core_update(),
			'coreNotices'                   => openstation_get_core_notices(),
			'pluginNotices'                 => openstation_get_plugin_notices(),
			'defaultWallpaper'              => openstation_get_default_wallpaper(),
			'session'                       => openstation_get_session( get_current_user_id() ),

			'sessionUrl'                    => esc_url_raw(
				is_network_admin()
					? add_query_arg( 'network', '1', rest_url( 'desktop-mode/v1/session' ) )
					: rest_url( 'desktop-mode/v1/session' )
			),
			'restUrl'                       => esc_url_raw( rest_url() ),
			'mediaUrl'                      => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'dropConfig'                    => $drop_config,
			'defaultWindowUrl'              => esc_url_raw( rest_url( 'desktop-mode/v1/default-window' ) ),
			'defaultWindow'                 => openstation_get_default_window( get_current_user_id() ),
			'canUpload'                     => current_user_can( 'upload_files' ),
			'pluginUrl'                     => esc_url_raw( untrailingslashit( OPENSTATION_URL ) ),
			'pluginVersion'                 => OPENSTATION_VERSION,
			'aboutFeedUrl'                  => esc_url_raw(
				add_query_arg(
					array(
						'action' => 'openstation_about_feed',
						'nonce'  => wp_create_nonce( 'openstation_about_feed' ),
					),
					admin_url( 'admin-ajax.php' )
				)
			),
			'iframeBridgeUrl'               => $lazy_bundle_url( 'iframe-bridge' ),

			'aiAssistantBundleUrl'          => $lazy_bundle_url( 'ai-assistant' ),

			'shellOverlaysBundleUrl'        => $lazy_bundle_url( 'shell-overlays' ),

			'fileDropBundleUrl'             => $lazy_bundle_url( 'file-drop' ),
			'filesOverlaysBundleUrl'        => $lazy_bundle_url( 'files-overlays' ),
			'notesBundleUrl'                => $lazy_bundle_url( 'notes' ),
			'dockConstellationBundleUrl'    => $lazy_bundle_url( 'dock-constellation' ),
			'windowLinkVisualsBundleUrl'    => $lazy_bundle_url( 'window-link-visuals' ),

			'hasNotes'                      => function_exists( 'openstation_notes_user_has_any' )
				? openstation_notes_user_has_any()
				: false,

			'componentsBundleUrl'           => $lazy_bundle_url( 'os-components' ),

			'mio'                           => openstation_mio_config(),
			'mioBundleUrl'                  => $lazy_bundle_url( 'mio' ),

			'windowSystemBundleUrl'         => $lazy_bundle_url( 'window-system' ),

			'mobileBundleUrl'               => $lazy_bundle_url( 'mobile' ),
			'mode'                          => openstation_mode_config( get_current_user_id() ),

			'itemVisibilityMenuBundleUrl'   => $lazy_bundle_url( 'item-visibility-menu' ),

			'workspaceWizardBundleUrl'      => $lazy_bundle_url( 'workspace-wizard' ),

			'workspacePresets'              => openstation_workspace_presets(),

			'releaseCardBundleUrl'          => $lazy_bundle_url( 'release-card' ),
			'restNonce'                     => wp_create_nonce( 'wp_rest' ),

			'soloWindow'                    => openstation_solo_window_id(),
			'osSettings'                    => openstation_get_os_settings( get_current_user_id() ),
			'osSettingsUrl'                 => esc_url_raw( rest_url( 'desktop-mode/v1/os-settings' ) ),
			'seenIntros'                    => openstation_get_seen_intros( get_current_user_id() ),
			'seenIntrosUrl'                 => esc_url_raw( rest_url( 'desktop-mode/v1/intros' ) ),

			'rebrandNotice'                 => $show_rebrand_notice,

			'shellTour'                     => openstation_should_offer_shell_tour( get_current_user_id() ),
			'shellTourBundleUrl'            => $lazy_bundle_url( 'shell-tour' ),

			'firstRun'                      => openstation_first_run_config( get_current_user_id() ),

			'usageFeedback'                 => function_exists( 'openstation_usage_feedback_config' ) ? openstation_usage_feedback_config() : null,
			'usageFeedbackBundleUrl'        => $lazy_bundle_url( 'usage-feedback' ),
			'aiSearchUrl'                   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/search' ) ),

			'aiAssistant'                   => function_exists( 'openstation_ai_assistant_config' )
				? openstation_ai_assistant_config()
				: null,

			'aiStatusUrl'                   => esc_url_raw( rest_url( 'desktop-mode/v1/ai/status' ) ),
			'extendedOptions'               => current_user_can( 'manage_options' ) ? openstation_get_extended_options() : null,
			'extendedOptionsUrl'            => esc_url_raw( rest_url( 'desktop-mode/v1/extended-options' ) ),

			'gamesEnabled'                  => openstation_games_enabled(),
			'currentUserIsAdmin'            => current_user_can( 'manage_options' ),

			'multisite'                     => openstation_multisite_payload(),
			'portalUrl'                     => esc_url( openstation_portal_url() ),
			'fromPortal'                    => $from_portal,
			'fromPortalIntent'              => $from_portal_intent,

			'landInOverview'                => openstation_shell_lands_in_overview(),
			'arrivalDirection'              => openstation_shell_arrival_direction(),
			'hopLinkOffer'                  => function_exists( 'openstation_network_link_offer' ) ? openstation_network_link_offer() : null,
			'pwa'                           => array(
				'manifestUrl'    => esc_url_raw( openstation_pwa_manifest_url() ),
				'swUrl'          => esc_url_raw( openstation_pwa_sw_url() ),

				'swFallbackUrl'  => esc_url_raw( openstation_pwa_sw_fallback_url() ),

				'swScope'        => openstation_pwa_sw_scope(),

				'swConfig'       => array(
					'adminAssetCache' => (bool) openstation_pwa_admin_asset_cache_enabled(),
					'windowPrewarm'   => ! empty( openstation_get_os_settings( get_current_user_id() )['windowPrewarmEnabled'] ),
				),

				'shellBuild'     => openstation_shell_build_stamp(),
				'stateUrl'       => esc_url_raw( rest_url( 'desktop-mode/v1/pwa-state' ) ),
				'state'          => openstation_pwa_get_user_state( get_current_user_id() ),

				'appName'        => get_bloginfo( 'name' ),

				'forceReplaceSw' => openstation_pwa_force_replace_sw(),
			),

			'commandPalette'                => $command_palette,

			'gameStyleHandles'              => function_exists( 'openstation_games_style_handles' )
				? openstation_games_style_handles()
				: array(),
			'deferredStyles'                => openstation_build_deferred_styles(
				array_merge(
					array(
						'desktop-mode-ai-assistant',
						'desktop-mode-bug-report',

						'desktop-mode-my-wordpress',
					),

					function_exists( 'openstation_games_style_handles' )
						? openstation_games_style_handles()
						: array()
				)
			),
		)
	);

	wp_localize_script( 'openstation', 'openStationConfig', $config );

	do_action( 'openstation_mode_init' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_assets' );

function openstation_defer_core_command_palette() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_defer_core_command_palette', 0 );

function openstation_print_preload_hints() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}

	$suffix = openstation_asset_suffix();

	$build_url = static function ( $relative ) {
		$path = OPENSTATION_DIR . $relative;
		$ver  = file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_VERSION;
		return OPENSTATION_URL . $relative . '?ver=' . $ver;
	};

	$hints = array(

		array(
			'href' => $build_url( 'assets/js/desktop' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'preload',
		),
		array(
			'href' => $build_url( 'assets/css/desktop.css' ),
			'as'   => 'style',
			'rel'  => 'preload',
		),

		array(
			'href' => $build_url( 'assets/js/window-system' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'prefetch',
		),
		array(
			'href' => $build_url( 'assets/js/shell-overlays' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'prefetch',
		),
	);

	if ( openstation_mode_hint_is_mobile( get_current_user_id() ) ) {
		$hints[] = array(
			'href' => $build_url( 'assets/js/mobile' . $suffix . '.js' ),
			'as'   => 'script',
			'rel'  => 'prefetch',
		);
	}

	$hints = apply_filters( 'openstation_preload_hints', $hints );

	if ( ! is_array( $hints ) ) {
		return;
	}

	foreach ( $hints as $hint ) {
		if ( ! is_array( $hint ) ) {
			continue;
		}
		$href = isset( $hint['href'] ) ? (string) $hint['href'] : '';
		$as   = isset( $hint['as'] ) ? (string) $hint['as'] : '';
		if ( '' === $href || '' === $as ) {
			continue;
		}

		$rel = isset( $hint['rel'] ) ? (string) $hint['rel'] : 'preload';
		if ( 'prefetch' !== $rel ) {
			$rel = 'preload';
		}
		printf(
			'<link rel="%s" as="%s" href="%s" />' . "\n",
			esc_attr( $rel ),
			esc_attr( $as ),
			esc_url( $href )
		);
	}
}
add_action( 'admin_print_styles', 'openstation_print_preload_hints', 1 );

function openstation_defer_non_critical_styles( $html, $handle, $href, $media ) {

	if ( ! openstation_is_enabled() ) {
		return $html;
	}
	if ( openstation_is_chromeless_request() ) {
		return $html;
	}

	$deferred = apply_filters(
		'openstation_deferred_styles',
		array(
			'os-dock-peek',
			'os-openstation-layout',
			'desktop-mode-ai-assistant',
			'desktop-mode-bug-report',
			'os-window-overview',
		)
	);

	if ( ! in_array( $handle, (array) $deferred, true ) ) {
		return $html;
	}

	$resolved_media = $media ? $media : 'all';
	$id             = $handle . '-css';

	$markup = sprintf(
		'<link rel=\'stylesheet\' id=\'%1$s\' href=\'%2$s\' media=\'print\' onload="this.media=\'%3$s\'; this.onload=null;" />' . "\n" .
			'<noscript><link rel=\'stylesheet\' id=\'%1$s-noscript\' href=\'%2$s\' media=\'%4$s\' /></noscript>' . "\n",
		esc_attr( $id ),
		esc_url( $href ),
		esc_js( $resolved_media ),
		esc_attr( $resolved_media )
	);

	return $markup;
}
add_filter( 'style_loader_tag', 'openstation_defer_non_critical_styles', 10, 4 );

function openstation_build_command_menu_map() {
	global $menu, $submenu, $_parent_pages;
	if ( ! is_array( $menu ) ) {
		return array();
	}
	$out = array();

	$extract_root_text = static function ( $label ) {
		if ( '' === $label || ! is_string( $label ) ) {
			return '';
		}
		if ( class_exists( 'WP_HTML_Tag_Processor' ) ) {
			$processor = new WP_HTML_Tag_Processor( $label );
			$text      = '';
			$depth     = 0;
			while ( $processor->next_token() ) {
				$token_type = $processor->get_token_type();
				if ( '#text' === $token_type && 0 === $depth ) {
					$text .= $processor->get_modifiable_text();
				}
				if ( '#tag' === $token_type ) {
					if ( $processor->is_tag_closer() ) {
						if ( $depth > 0 ) {
							--$depth;
						}
						continue;
					}
					$name = $processor->get_tag();
					if ( $name && ! ( class_exists( 'WP_HTML_Processor' ) && WP_HTML_Processor::is_void( $name ) ) ) {
						++$depth;
					}
				}
			}
			return trim( $text );
		}
		return trim( wp_strip_all_tags( $label ) );
	};

	foreach ( $menu as $menu_item ) {
		if ( empty( $menu_item[0] ) || ! is_string( $menu_item[0] ) ) {
			continue;
		}
		if ( ! empty( $menu_item[1] ) && ! current_user_can( $menu_item[1] ) ) {
			continue;
		}
		$menu_label = $extract_root_text( $menu_item[0] );
		$menu_slug  = $menu_item[2];
		$menu_url   = '';

		if ( ( ! isset( $_parent_pages[ $menu_slug ] ) || openstation_is_admin_file_slug( $menu_slug ) ) && ( preg_match( '/\.php($|\?)/', $menu_slug ) || wp_http_validate_url( $menu_slug ) ) ) {
			$menu_url = $menu_slug;
		} elseif ( ! empty( menu_page_url( $menu_slug, false ) ) ) {
			$menu_url = menu_page_url( $menu_slug, false );
		}
		if ( '' !== $menu_url ) {
			$out[] = array(
				'label' => $menu_label,
				'url'   => $menu_url,
				'name'  => $menu_slug,
			);
		}
		if ( ! empty( $submenu ) && is_array( $submenu ) && array_key_exists( $menu_slug, $submenu ) ) {
			foreach ( $submenu[ $menu_slug ] as $submenu_item ) {
				if ( empty( $submenu_item[0] ) ) {
					continue;
				}
				if ( ! empty( $submenu_item[1] ) && ! current_user_can( $submenu_item[1] ) ) {
					continue;
				}
				$submenu_label = $extract_root_text( $submenu_item[0] );
				$submenu_slug  = $submenu_item[2];
				$submenu_url   = '';

				if ( ( ! isset( $_parent_pages[ $submenu_slug ] ) || openstation_is_admin_file_slug( $submenu_slug ) ) && ( preg_match( '/\.php($|\?)/', $submenu_slug ) || wp_http_validate_url( $submenu_slug ) ) ) {
					$submenu_url = $submenu_slug;
				} elseif ( ! empty( menu_page_url( $submenu_slug, false ) ) ) {
					$submenu_url = menu_page_url( $submenu_slug, false );
				}
				if ( '' === $submenu_url ) {
					continue;
				}
				$out[] = array(
					'label' => sprintf(

						__( '%1$s > %2$s', 'desktop-mode' ),
						$menu_label,
						$submenu_label
					),
					'url'   => $submenu_url,
					'name'  => $menu_slug . '-' . $submenu_item[2],
				);
			}
		}
	}
	return $out;
}
