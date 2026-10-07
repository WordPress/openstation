<?php

$prefix      = getenv( 'HANDLE_MAP_PREFIX' );
$out_file    = getenv( 'HANDLE_OUT_FILE' );
$sources_dir = getenv( 'HANDLE_SOURCES_DIR' );
$locale      = getenv( 'HANDLE_LOCALE' );
$domain      = getenv( 'HANDLE_DOMAIN' );

if ( ! $prefix || ! $out_file || ! $sources_dir || ! $locale || ! $domain ) {
	fwrite( STDERR, "build-i18n-merge.php: missing required env vars.\n" );
	exit( 1 );
}

$exclude = array_filter( preg_split( '/\R/', (string) getenv( 'HANDLE_EXCLUDE_PREFIXES' ) ) );

$plurals       = '';
$revision_date = '';
$messages      = array();

$files = glob( rtrim( $sources_dir, '/' ) . '/*.json' );
if ( ! $files ) {
	$files = array();
}

foreach ( $files as $file ) {
	$raw = file_get_contents( $file );
	if ( false === $raw ) {
		continue;
	}
	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) ) {
		continue;
	}
	$source = isset( $data['source'] ) ? (string) $data['source'] : '';
	if ( '' === $source || 0 !== strpos( $source, $prefix ) ) {
		continue;
	}
	foreach ( $exclude as $skip ) {
		if ( '' !== $skip && 0 === strpos( $source, $skip ) ) {
			continue 2;
		}
	}

	if ( '' === $revision_date && ! empty( $data['translation-revision-date'] ) ) {
		$revision_date = (string) $data['translation-revision-date'];
	}

	if (
		! empty( $data['locale_data']['messages'][''] ) &&
		is_array( $data['locale_data']['messages'][''] )
	) {
		$header = $data['locale_data']['messages'][''];
		if ( ! empty( $header['plural-forms'] ) && '' === $plurals ) {
			$plurals = (string) $header['plural-forms'];
		}
	}

	if ( ! empty( $data['locale_data']['messages'] ) && is_array( $data['locale_data']['messages'] ) ) {
		foreach ( $data['locale_data']['messages'] as $key => $value ) {
			if ( '' === $key ) {
				continue;
			}
			$messages[ $key ] = $value;
		}
	}
}

if ( empty( $messages ) ) {
	if ( file_exists( $out_file ) ) {
		unlink( $out_file );
	}
	exit( 0 );
}

ksort( $messages );

$header = array(
	'domain'       => 'messages',
	'lang'         => $locale,
	'plural-forms' => '' !== $plurals ? $plurals : 'nplurals=2; plural=(n != 1);',
);

$json = array(
	'translation-revision-date' => '' !== $revision_date ? $revision_date : gmdate( 'Y-m-d H:iO' ),
	'generator'                 => 'desktop-mode/build-i18n.sh',
	'domain'                    => 'messages',
	'locale_data'               => array(
		'messages' => array_merge( array( '' => $header ), $messages ),
	),
);

$encoded = json_encode( $json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
if ( false === $encoded ) {
	fwrite( STDERR, "build-i18n-merge.php: failed to encode JSON for {$out_file}.\n" );
	exit( 1 );
}

if ( false === file_put_contents( $out_file, $encoded . "\n" ) ) {
	fwrite( STDERR, "build-i18n-merge.php: failed to write {$out_file}.\n" );
	exit( 1 );
}
