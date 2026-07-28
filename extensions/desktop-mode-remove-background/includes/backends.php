<?php
/**
 * Remove Background — processing backends.
 *
 * A backend is a callable `( string $path, string $mime, int $attachment_id )`
 * returning the processed image as a binary PNG string, or a `WP_Error`.
 * The map is filterable (`desktop_mode_remove_background_backends`) so
 * plugins can add their own service without touching this file.
 *
 * @package DesktopModeRemoveBackground
 */

defined( 'ABSPATH' ) || exit;

/**
 * Backend registry.
 *
 * @return array<string, callable>
 */
function desktop_mode_remove_bg_backends() {
	$backends = array(
		'removebg' => 'desktop_mode_remove_bg_backend_removebg',
		'rembg'    => 'desktop_mode_remove_bg_backend_rembg',
		'ai'       => 'desktop_mode_remove_bg_backend_ai',
	);

	/**
	 * Filter the backend registry.
	 *
	 * @since 0.1.0
	 *
	 * @param array<string, callable> $backends Map of slug => callable.
	 */
	$filtered = apply_filters( 'desktop_mode_remove_background_backends', $backends );
	return is_array( $filtered ) ? $filtered : $backends;
}

/**
 * Build a multipart/form-data body.
 *
 * @param string $boundary  Boundary token.
 * @param array  $fields    Map of name => scalar value.
 * @param string $file_name Form field name for the file part.
 * @param string $filename  Client filename.
 * @param string $mime      File mime type.
 * @param string $bytes     File contents.
 * @return string
 */
function desktop_mode_remove_bg_multipart( $boundary, array $fields, $file_name, $filename, $mime, $bytes ) {
	$body = '';
	foreach ( $fields as $name => $value ) {
		$body .= "--{$boundary}\r\n";
		$body .= "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n";
		$body .= $value . "\r\n";
	}
	$body .= "--{$boundary}\r\n";
	$body .= "Content-Disposition: form-data; name=\"{$file_name}\"; filename=\"{$filename}\"\r\n";
	$body .= "Content-Type: {$mime}\r\n\r\n";
	$body .= $bytes . "\r\n";
	$body .= "--{$boundary}--\r\n";
	return $body;
}

/**
 * remove.bg backend — https://www.remove.bg/api.
 *
 * @param string $path Image file path.
 * @param string $mime Image mime type.
 * @return string|WP_Error Binary PNG.
 */
function desktop_mode_remove_bg_backend_removebg( $path, $mime ) {
	$settings = desktop_mode_remove_bg_get_settings();
	if ( '' === $settings['removebg_api_key'] ) {
		return new WP_Error(
			'desktop_mode_remove_bg_no_key',
			__( 'No remove.bg API key configured. An administrator can set one via the desktop_mode_remove_background option or the DESKTOP_MODE_REMOVE_BG_API_KEY constant (see the extension README).', 'desktop-mode-remove-background' )
		);
	}

	$bytes = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $bytes ) {
		return new WP_Error( 'desktop_mode_remove_bg_unreadable', __( 'Could not read the image file.', 'desktop-mode-remove-background' ) );
	}

	$boundary = 'dmrb' . wp_generate_password( 24, false );
	$response = wp_remote_post(
		'https://api.remove.bg/v1.0/removebg',
		array(
			'timeout' => 90,
			'headers' => array(
				'X-Api-Key'    => $settings['removebg_api_key'],
				'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
			),
			'body'    => desktop_mode_remove_bg_multipart(
				$boundary,
				array(
					'size'   => 'auto',
					'format' => 'png',
				),
				'image_file',
				basename( $path ),
				$mime,
				$bytes
			),
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = (string) wp_remote_retrieve_body( $response );
	if ( 200 !== $code ) {
		$decoded = json_decode( $body, true );
		$detail  = isset( $decoded['errors'][0]['title'] ) ? (string) $decoded['errors'][0]['title'] : "HTTP {$code}";
		return new WP_Error(
			'desktop_mode_remove_bg_api_error',
			sprintf(
				/* translators: %s is the error detail from remove.bg. */
				__( 'remove.bg rejected the request: %s', 'desktop-mode-remove-background' ),
				$detail
			)
		);
	}
	return $body;
}

/**
 * Self-hosted rembg backend (`rembg s` HTTP server, or compatible).
 * POSTs the image as multipart field `file` to the configured
 * endpoint and expects a PNG back.
 *
 * @param string $path Image file path.
 * @param string $mime Image mime type.
 * @return string|WP_Error Binary PNG.
 */
function desktop_mode_remove_bg_backend_rembg( $path, $mime ) {
	$settings = desktop_mode_remove_bg_get_settings();
	if ( '' === $settings['rembg_endpoint'] ) {
		return new WP_Error(
			'desktop_mode_remove_bg_no_endpoint',
			__( 'No rembg endpoint configured. An administrator can set one via the desktop_mode_remove_background option or the DESKTOP_MODE_REMOVE_BG_ENDPOINT constant (see the extension README).', 'desktop-mode-remove-background' )
		);
	}

	$bytes = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $bytes ) {
		return new WP_Error( 'desktop_mode_remove_bg_unreadable', __( 'Could not read the image file.', 'desktop-mode-remove-background' ) );
	}

	$boundary = 'dmrb' . wp_generate_password( 24, false );
	$response = wp_remote_post(
		$settings['rembg_endpoint'],
		array(
			'timeout' => 90,
			'headers' => array(
				'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
			),
			'body'    => desktop_mode_remove_bg_multipart( $boundary, array(), 'file', basename( $path ), $mime, $bytes ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	if ( 200 !== $code ) {
		return new WP_Error(
			'desktop_mode_remove_bg_api_error',
			sprintf(
				/* translators: %d is the HTTP status code. */
				__( 'The rembg endpoint returned HTTP %d.', 'desktop-mode-remove-background' ),
				$code
			)
		);
	}
	return (string) wp_remote_retrieve_body( $response );
}

/**
 * WordPress AI Client backend — generative editing via the configured
 * image-capable connector (e.g. Gemini image models). Experimental:
 * the model REGENERATES the picture rather than masking it, so the
 * subject may not be pixel-identical to the original.
 *
 * @param string $path Image file path.
 * @param string $mime Image mime type.
 * @return string|WP_Error Binary PNG.
 */
function desktop_mode_remove_bg_backend_ai( $path, $mime ) {
	if ( ! function_exists( 'wp_ai_client_prompt' ) ) {
		return new WP_Error(
			'desktop_mode_remove_bg_no_ai_client',
			__( 'The WordPress AI Client is not available on this site.', 'desktop-mode-remove-background' )
		);
	}

	$bytes = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $bytes ) {
		return new WP_Error( 'desktop_mode_remove_bg_unreadable', __( 'Could not read the image file.', 'desktop-mode-remove-background' ) );
	}

	try {
		$data_uri = 'data:' . $mime . ';base64,' . base64_encode( $bytes ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		$message  = new \WordPress\AiClient\Messages\DTO\UserMessage(
			array(
				new \WordPress\AiClient\Messages\DTO\MessagePart(
					'Remove the background from this image completely. Keep the foreground subject pixel-identical. Output a PNG with a fully transparent background. Return only the image.'
				),
				new \WordPress\AiClient\Messages\DTO\MessagePart(
					new \WordPress\AiClient\Files\DTO\File( $data_uri, $mime )
				),
			)
		);

		$file = wp_ai_client_prompt( array( $message ) )->generateImageResult()->toFile();

		$base64 = $file->getBase64Data();
		if ( is_string( $base64 ) && '' !== $base64 ) {
			$decoded = base64_decode( $base64, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
			if ( false !== $decoded ) {
				return $decoded;
			}
		}
		$url = $file->getUrl();
		if ( is_string( $url ) && '' !== $url ) {
			$download = wp_remote_get( $url, array( 'timeout' => 90 ) );
			if ( ! is_wp_error( $download ) && 200 === (int) wp_remote_retrieve_response_code( $download ) ) {
				return (string) wp_remote_retrieve_body( $download );
			}
		}
		return new WP_Error(
			'desktop_mode_remove_bg_ai_empty',
			__( 'The AI Client returned no readable image data.', 'desktop-mode-remove-background' )
		);
	} catch ( \Throwable $e ) {
		return new WP_Error(
			'desktop_mode_remove_bg_ai_error',
			sprintf(
				/* translators: %s is the underlying error message. */
				__( 'AI image editing failed: %s', 'desktop-mode-remove-background' ),
				$e->getMessage()
			)
		);
	}
}
