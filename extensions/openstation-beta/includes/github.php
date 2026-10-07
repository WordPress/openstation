<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_BETA_CI_TAG = 'ci-artifacts';

const OPENSTATION_BETA_CURRENT_OPTION = 'openstation_beta_current';

function openstation_beta_repo() {

	return (string) apply_filters( 'openstation_beta_repo', 'WordPress/openstation' );
}

function openstation_beta_github_token() {
	$token = defined( 'OPENSTATION_BETA_GITHUB_TOKEN' ) ? (string) OPENSTATION_BETA_GITHUB_TOKEN : '';

	return (string) apply_filters( 'openstation_beta_github_token', $token );
}

function openstation_beta_ci_asset_url( $asset ) {
	return sprintf(
		'https://github.com/%s/releases/download/%s/%s',
		openstation_beta_repo(),
		OPENSTATION_BETA_CI_TAG,
		$asset
	);
}

function openstation_beta_current() {
	$current = get_option( OPENSTATION_BETA_CURRENT_OPTION, null );
	return is_array( $current ) ? $current : null;
}

function openstation_beta_api_get( $path, $cache_key, $ttl, $force = false ) {
	$transient = 'openstation_beta_' . $cache_key;
	if ( ! $force ) {
		$cached = get_transient( $transient );
		if ( false !== $cached && is_array( $cached ) ) {
			return $cached;
		}
	}

	$headers = array(
		'Accept'               => 'application/vnd.github+json',
		'X-GitHub-Api-Version' => '2022-11-28',
	);
	$token   = openstation_beta_github_token();
	if ( '' !== $token ) {
		$headers['Authorization'] = 'Bearer ' . $token;
	}

	$response = wp_remote_get(
		'https://api.github.com' . $path,
		array(
			'timeout'    => 15,
			'headers'    => $headers,
			'user-agent' => 'openstation-beta/' . OPENSTATION_BETA_VERSION,
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( 200 !== $code ) {
		return new WP_Error(
			'openstation_beta_github_http',
			sprintf(

				__( 'GitHub API returned HTTP %1$d for %2$s.', 'openstation-beta' ),
				$code,
				$path
			),
			array( 'status' => 502 )
		);
	}

	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $data ) ) {
		return new WP_Error(
			'openstation_beta_github_json',
			__( 'GitHub API returned an unparseable response.', 'openstation-beta' ),
			array( 'status' => 502 )
		);
	}

	set_transient( $transient, $data, $ttl );
	return $data;
}

function openstation_beta_fetch_open_prs( $force = false ) {
	$raw = openstation_beta_api_get(
		'/repos/' . openstation_beta_repo() . '/pulls?state=open&per_page=100',
		'prs',
		5 * MINUTE_IN_SECONDS,
		$force
	);
	if ( is_wp_error( $raw ) ) {
		return $raw;
	}

	$prs = array();
	foreach ( $raw as $pr ) {
		if ( ! is_array( $pr ) || empty( $pr['number'] ) || empty( $pr['head']['sha'] ) ) {
			continue;
		}
		$number = (int) $pr['number'];
		$sha    = strtolower( (string) $pr['head']['sha'] );
		if ( ! preg_match( '/^[0-9a-f]{40}$/', $sha ) ) {
			continue;
		}
		$prs[] = array(
			'number'     => $number,
			'title'      => sanitize_text_field( isset( $pr['title'] ) ? (string) $pr['title'] : '' ),
			'branch'     => sanitize_text_field( isset( $pr['head']['ref'] ) ? (string) $pr['head']['ref'] : '' ),
			'sha'        => $sha,
			'draft'      => ! empty( $pr['draft'] ),
			'author'     => sanitize_text_field( isset( $pr['user']['login'] ) ? (string) $pr['user']['login'] : '' ),

			'member'     => in_array(
				isset( $pr['author_association'] ) ? (string) $pr['author_association'] : '',
				array( 'OWNER', 'MEMBER', 'COLLABORATOR' ),
				true
			),
			'updated_at' => sanitize_text_field( isset( $pr['updated_at'] ) ? (string) $pr['updated_at'] : '' ),
			'url'        => esc_url_raw( isset( $pr['html_url'] ) ? (string) $pr['html_url'] : '' ),
			'asset'      => sprintf( 'pr-%d-%s.zip', $number, $sha ),
		);
	}
	return $prs;
}

function openstation_beta_fetch_trunk( $force = false ) {
	$transient = 'openstation_beta_trunk';
	if ( ! $force ) {
		$cached = get_transient( $transient );
		if ( is_array( $cached ) ) {
			return isset( $cached['sha'] ) ? $cached : null;
		}
	}

	$response = wp_remote_get(
		openstation_beta_ci_asset_url( 'trunk.json' ),
		array(
			'timeout'    => 15,
			'user-agent' => 'openstation-beta/' . OPENSTATION_BETA_VERSION,
		)
	);

	$trunk = null;
	if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		$sha  = is_array( $data ) && isset( $data['sha'] ) ? strtolower( (string) $data['sha'] ) : '';
		if ( preg_match( '/^[0-9a-f]{40}$/', $sha ) ) {
			$trunk = array(
				'sha'      => $sha,
				'version'  => sanitize_text_field( isset( $data['version'] ) ? (string) $data['version'] : '' ),
				'built_at' => sanitize_text_field( isset( $data['built_at'] ) ? (string) $data['built_at'] : '' ),
				'url'      => openstation_beta_ci_asset_url( 'trunk.zip' ),
			);
		}
	}

	set_transient( $transient, null === $trunk ? array() : $trunk, 5 * MINUTE_IN_SECONDS );
	return $trunk;
}

function openstation_beta_fetch_stable( $force = false ) {
	$raw = openstation_beta_api_get(
		'/repos/' . openstation_beta_repo() . '/releases/latest',
		'stable',
		15 * MINUTE_IN_SECONDS,
		$force
	);
	if ( is_wp_error( $raw ) ) {
		return $raw;
	}

	$by_name = array();
	if ( isset( $raw['assets'] ) && is_array( $raw['assets'] ) ) {
		foreach ( $raw['assets'] as $asset ) {
			if ( is_array( $asset ) && isset( $asset['name'] ) ) {
				$by_name[ (string) $asset['name'] ] = esc_url_raw( isset( $asset['browser_download_url'] ) ? (string) $asset['browser_download_url'] : '' );
			}
		}
	}

	$url = '';
	foreach ( array( 'openstation.zip', 'desktop-mode.zip' ) as $name ) {
		if ( ! empty( $by_name[ $name ] ) ) {
			$url = $by_name[ $name ];
			break;
		}
	}
	if ( '' === $url ) {
		return new WP_Error(
			'openstation_beta_no_stable_asset',
			__( 'The latest release has no plugin zip asset.', 'openstation-beta' ),
			array( 'status' => 502 )
		);
	}

	$tag = sanitize_text_field( isset( $raw['tag_name'] ) ? (string) $raw['tag_name'] : '' );
	return array(
		'tag'          => $tag,
		'version'      => ltrim( $tag, 'v' ),
		'url'          => $url,
		'published_at' => sanitize_text_field( isset( $raw['published_at'] ) ? (string) $raw['published_at'] : '' ),
	);
}

function openstation_beta_assets_exist( $assets, $force = false ) {
	$transient = 'openstation_beta_asset_map';
	$map       = get_transient( $transient );
	if ( ! is_array( $map ) ) {
		$map = array();
	}

	$now     = time();
	$pending = array();
	$out     = array();
	foreach ( array_unique( array_map( 'strval', $assets ) ) as $asset ) {
		if ( isset( $map[ $asset ] ) && is_array( $map[ $asset ] ) ) {
			$entry = $map[ $asset ];
			if ( ! empty( $entry['exists'] ) ) {
				$out[ $asset ] = true;
				continue;
			}
			if ( ! $force && isset( $entry['checked_at'] ) && $now - (int) $entry['checked_at'] < 2 * MINUTE_IN_SECONDS ) {
				$out[ $asset ] = false;
				continue;
			}
		}
		$pending[] = $asset;
	}

	foreach ( openstation_beta_probe_assets( $pending ) as $asset => $exists ) {
		$out[ $asset ] = $exists;
		$map[ $asset ] = array(
			'exists'     => $exists,
			'checked_at' => $now,
		);
	}

	if ( array() !== $pending ) {

		$map = array_intersect_key( $map, $out );
		set_transient( $transient, $map, 12 * HOUR_IN_SECONDS );
	}

	return $out;
}

function openstation_beta_probe_assets( $assets ) {
	if ( array() === $assets ) {
		return array();
	}

	$pre = apply_filters( 'openstation_beta_pre_probe_assets', null, $assets );
	if ( is_array( $pre ) ) {
		$out = array();
		foreach ( $assets as $asset ) {
			$out[ $asset ] = ! empty( $pre[ $asset ] );
		}
		return $out;
	}

	$out = array();

	if ( class_exists( '\WpOrg\Requests\Requests' ) ) {
		$requests = array();
		foreach ( $assets as $asset ) {
			$requests[ $asset ] = array(
				'url'     => openstation_beta_ci_asset_url( $asset ),
				'type'    => \WpOrg\Requests\Requests::HEAD,
				'options' => array(
					'timeout'          => 10,
					'follow_redirects' => false,
				),
			);
		}
		$responses = \WpOrg\Requests\Requests::request_multiple( $requests );
		foreach ( $assets as $asset ) {
			$response      = isset( $responses[ $asset ] ) ? $responses[ $asset ] : null;
			$out[ $asset ] = $response instanceof \WpOrg\Requests\Response
				&& ( 200 === (int) $response->status_code || ( $response->status_code >= 300 && $response->status_code < 400 ) );
		}
		return $out;
	}

	foreach ( $assets as $asset ) {
		$response      = wp_remote_head(
			openstation_beta_ci_asset_url( $asset ),
			array(
				'timeout'     => 10,
				'redirection' => 0,
				'user-agent'  => 'openstation-beta/' . OPENSTATION_BETA_VERSION,
			)
		);
		$code          = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
		$out[ $asset ] = 200 === $code || ( $code >= 300 && $code < 400 );
	}
	return $out;
}

function openstation_beta_dev_checkout_marker( $dir = null ) {
	if ( null === $dir ) {
		$dir = dirname( WP_PLUGIN_DIR . '/' . OPENSTATION_BETA_TARGET_PLUGIN );
	}
	if ( ! is_dir( $dir ) ) {
		return '';
	}
	foreach ( array( '.git', 'package.json', 'vite.config.js', 'src', '.wp-env.json' ) as $marker ) {
		if ( file_exists( $dir . '/' . $marker ) ) {
			return $marker;
		}
	}
	return '';
}

function openstation_beta_install_blocked() {
	$marker = openstation_beta_dev_checkout_marker();

	if ( '' !== $marker && ! apply_filters( 'openstation_beta_allow_dev_overwrite', false, $marker ) ) {
		return array(
			'code'   => 'dev-checkout',
			'reason' => sprintf(

				__( 'The installed OpenStation plugin is a development checkout ("%s" found in its folder) — installing a build here would overwrite that working tree. Switch builds on a site running a packaged install instead.', 'openstation-beta' ),
				$marker
			),
		);
	}
	return null;
}

function openstation_beta_installed_version() {
	$file = WP_PLUGIN_DIR . '/' . OPENSTATION_BETA_TARGET_PLUGIN;
	if ( ! file_exists( $file ) ) {
		return '';
	}
	if ( ! function_exists( 'get_plugin_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$data = get_plugin_data( $file, false, false );
	return isset( $data['Version'] ) ? (string) $data['Version'] : '';
}

function openstation_beta_state( $force = false ) {
	$prs = openstation_beta_fetch_open_prs( $force );
	if ( is_wp_error( $prs ) ) {
		return $prs;
	}

	$errors = array();

	$stable = openstation_beta_fetch_stable( $force );
	if ( is_wp_error( $stable ) ) {
		$errors[] = $stable->get_error_message();
		$stable   = null;
	}

	$trunk = openstation_beta_fetch_trunk( $force );

	$ready = openstation_beta_assets_exist( wp_list_pluck( $prs, 'asset' ), $force );
	foreach ( $prs as &$pr ) {
		$pr['build_ready'] = ! empty( $ready[ $pr['asset'] ] );
	}
	unset( $pr );

	$current = openstation_beta_current();
	$state   = array(
		'current'         => array(
			'managed'      => null !== $current,
			'source'       => $current ? (string) $current['source'] : 'release',
			'id'           => $current && isset( $current['id'] ) ? (string) $current['id'] : '',
			'sha'          => $current && isset( $current['sha'] ) ? (string) $current['sha'] : '',
			'branch'       => $current && isset( $current['branch'] ) ? (string) $current['branch'] : '',
			'title'        => $current && isset( $current['title'] ) ? (string) $current['title'] : '',
			'installed_at' => $current && isset( $current['installed_at'] ) ? (int) $current['installed_at'] : 0,
			'installed_by' => $current && isset( $current['installed_by'] ) ? (string) $current['installed_by'] : '',
			'version'      => openstation_beta_installed_version(),
			'update'       => null,
		),
		'stable'          => $stable,
		'trunk'           => $trunk,
		'prs'             => $prs,
		'errors'          => $errors,
		'install_blocked' => openstation_beta_install_blocked(),
	);

	$state['current']['update'] = openstation_beta_pending_update( $state );

	return $state;
}

function openstation_beta_pending_update( $state ) {
	$current = $state['current'];

	if ( ! $current['managed'] ) {
		return null;
	}

	if ( 'pr' === $current['source'] ) {
		foreach ( $state['prs'] as $pr ) {
			if ( (string) $pr['number'] === $current['id'] ) {
				if ( $pr['sha'] !== $current['sha'] ) {
					return array(
						'kind' => 'new-build',
						'sha'  => $pr['sha'],
					);
				}
				return null;
			}
		}
		return array( 'kind' => 'pr-closed' );
	}

	if ( 'trunk' === $current['source'] && is_array( $state['trunk'] ) ) {
		if ( $state['trunk']['sha'] !== $current['sha'] ) {
			return array(
				'kind' => 'new-build',
				'sha'  => $state['trunk']['sha'],
			);
		}
	}

	return null;
}

function openstation_beta_block_auto_update( $update, $item ) {
	if ( isset( $item->plugin ) && OPENSTATION_BETA_TARGET_PLUGIN === $item->plugin && null !== openstation_beta_current() ) {
		return false;
	}
	return $update;
}
add_filter( 'auto_update_plugin', 'openstation_beta_block_auto_update', 10, 2 );

function openstation_beta_admin_notice() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'plugins' !== $screen->id || ! current_user_can( 'update_plugins' ) ) {
		return;
	}
	$current = openstation_beta_current();
	if ( null === $current ) {
		return;
	}

	$label = 'pr' === $current['source']

		? sprintf( __( 'pull request #%s', 'openstation-beta' ), $current['id'] )
		: __( 'trunk', 'openstation-beta' );
	printf(
		'<div class="notice notice-warning"><p>%s</p></div>',
		esc_html(
			sprintf(

				__( 'OpenStation is running a beta build from %s. Updating it from this screen replaces the build under test — use the OpenStation Beta page under Tools to manage it.', 'openstation-beta' ),
				$label
			)
		)
	);
}
add_action( 'admin_notices', 'openstation_beta_admin_notice' );
