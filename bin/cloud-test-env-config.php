<?php
/**
 * The PHP half of bin/cloud-test-env.sh; not intended to run on its own.
 *
 * Commands:
 *
 *   salts <file>
 *       Write a set of the eight auth keys and salts as `define()`s.
 *   configs <wp-env.json> <salts> <wp-config.php> <wp-tests-config.php> [proxy host:port]
 *       Write the test core's wp-config.php and the tests config the way
 *       wp-env does: wp-env's default constants overlaid with the
 *       `config` of its config file, the file's `port` added to the three
 *       URL constants, and the tests config being the same file minus
 *       the wp-settings.php line, with ABSPATH pinned to /var/www/html/.
 *   install-site <site dir>
 *       Install the `serve` site if it is not installed yet, and activate
 *       the plugin.
 */

if ( 'cli' !== PHP_SAPI ) {
	exit( 1 );
}

$command = $argv[1] ?? '';

if ( 'salts' === $command ) {
	$out = "<?php\n";
	foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT' ) as $name ) {
		$out .= "define( '{$name}', '" . bin2hex( random_bytes( 32 ) ) . "' );\n";
	}
	file_put_contents( $argv[2], $out );
	exit( 0 );
}

if ( 'configs' === $command ) {
	list( , , $wp_env_json, $salts_file, $wp_config, $tests_config ) = $argv;
	$proxy = $argv[6] ?? '';

	// wp-env's defaults, from @wordpress/env lib/config/parse-config.js.
	$config = array(
		'FS_METHOD'           => 'direct',
		'WP_DEBUG'            => true,
		'SCRIPT_DEBUG'        => true,
		'WP_ENVIRONMENT_TYPE' => 'local',
		'WP_PHP_BINARY'       => 'php',
		'WP_TESTS_EMAIL'      => 'admin@example.org',
		'WP_TESTS_TITLE'      => 'Test Blog',
		'WP_TESTS_DOMAIN'     => 'localhost',
		'WP_SITEURL'          => 'http://localhost',
		'WP_HOME'             => 'http://localhost',
	);
	$json = json_decode( (string) file_get_contents( $wp_env_json ), true );
	foreach ( (array) ( $json['config'] ?? array() ) as $key => $value ) {
		// wp-env skips a constant set to null.
		if ( null === $value ) {
			unset( $config[ $key ] );
		} else {
			$config[ $key ] = $value;
		}
	}
	// lib/config/post-process-config.js: the port goes on the three URL
	// constants unless one is already there.
	$port = $json['port'] ?? null;
	if ( $port ) {
		foreach ( array( 'WP_TESTS_DOMAIN', 'WP_SITEURL', 'WP_HOME' ) as $key ) {
			if ( isset( $config[ $key ] ) && ! preg_match( '#^(?:https?://)?[^/]+:\d+#', $config[ $key ] ) ) {
				$config[ $key ] = preg_replace( '#^((?:https?://)?[^/]+)#', '${1}:' . (int) $port, $config[ $key ] );
			}
		}
	}

	$lines = array(
		'<?php',
		'// Written by bin/cloud-test-env.sh — regenerated on every run.',
		"define( 'DB_NAME', 'wordpress_test' );",
		"define( 'DB_USER', 'root' );",
		"define( 'DB_PASSWORD', 'password' );",
		"define( 'DB_HOST', '127.0.0.1:3306' );",
		"define( 'DB_CHARSET', 'utf8' );",
		"define( 'DB_COLLATE', '' );",
		trim( substr( (string) file_get_contents( $salts_file ), strlen( '<?php' ) ) ),
		"\$table_prefix = 'wp_';",
	);
	foreach ( $config as $key => $value ) {
		$lines[] = "define( '{$key}', " . var_export( $value, true ) . ' );';
	}
	if ( preg_match( '/^([^:]+):(\d+)$/', $proxy, $m ) ) {
		$lines[] = '// The cloud container reaches the internet only through this proxy.';
		$lines[] = "define( 'WP_PROXY_HOST', " . var_export( $m[1], true ) . ' );';
		$lines[] = "define( 'WP_PROXY_PORT', " . var_export( $m[2], true ) . ' );';
	}

	$site   = $lines;
	$site[] = "if ( ! defined( 'ABSPATH' ) ) {";
	$site[] = "\tdefine( 'ABSPATH', __DIR__ . '/' );";
	$site[] = '}';
	$site[] = "require_once ABSPATH . 'wp-settings.php';";
	file_put_contents( $wp_config, implode( "\n", $site ) . "\n" );

	$tests   = $lines;
	$tests[] = "define( 'ABSPATH', '/var/www/html/' );";
	$tests[] = "define( 'WP_DEFAULT_THEME', 'default' );";
	file_put_contents( $tests_config, implode( "\n", $tests ) . "\n" );
	exit( 0 );
}

if ( 'install-site' === $command ) {
	define( 'WP_INSTALLING', true ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- Core's own constant: keeps wp-load.php from redirecting to the installer.
	$_SERVER['HTTP_HOST'] = 'localhost';
	require $argv[2] . '/wp-load.php';
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	if ( ! is_blog_installed() ) {
		wp_install( 'OpenStation', 'admin', 'admin@example.org', true, '', 'password' );
		echo "installed\n";
	}
	$result = activate_plugin( 'desktop-mode/desktop-mode.php' );
	if ( is_wp_error( $result ) ) {
		fwrite( STDERR, $result->get_error_message() . "\n" );
		exit( 1 );
	}
	exit( 0 );
}

fwrite( STDERR, "cloud-test-env-config.php: unknown command '{$command}'.\n" );
exit( 1 );
