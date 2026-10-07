<?php

namespace OpenStation\App;

use OpenStation\App;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Registry {

	const FILE_SUFFIX = '.os.php';

	private $apps = array();

	private $loaded = array();

	public function add( App $app ) {
		$this->apps[ $app->id() ] = $app;
		return $app;
	}

	public function remove( $id ) {
		unset( $this->apps[ (string) $id ] );
	}

	public function get( $id ) {
		return isset( $this->apps[ (string) $id ] ) ? $this->apps[ (string) $id ] : null;
	}

	public function has( $id ) {
		return isset( $this->apps[ (string) $id ] );
	}

	public function all() {
		return $this->apps;
	}

	public function load_file( $path ) {
		$real = realpath( (string) $path );
		if ( false === $real || ! is_file( $real ) ) {
			return null;
		}
		if ( isset( $this->loaded[ $real ] ) ) {
			return $this->find_by_file( $real );
		}
		$this->loaded[ $real ] = true;

		$result = include $real;
		if ( ! $result instanceof App ) {
			return null;
		}
		$result->located_at( dirname( $real ), $real );
		return $this->add( $result );
	}

	public function load_dir( $dir ) {
		$dir = rtrim( (string) $dir, '/\\' );
		if ( '' === $dir || ! is_dir( $dir ) ) {
			return array();
		}
		$files = array_merge(
			(array) glob( $dir . '/*' . self::FILE_SUFFIX ),
			(array) glob( $dir . '/*/*' . self::FILE_SUFFIX )
		);
		sort( $files );

		$apps = array();
		foreach ( $files as $file ) {
			$app = $this->load_file( $file );
			if ( $app ) {
				$apps[] = $app;
			}
		}
		return $apps;
	}

	private function find_by_file( $real ) {
		foreach ( $this->apps as $app ) {
			if ( $app->file() === $real ) {
				return $app;
			}
		}
		return null;
	}
}
