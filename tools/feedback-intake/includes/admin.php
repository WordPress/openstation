<?php
/**
 * Tools → OpenStation feedback: the weekly read.
 *
 * A summary for the last 7 and 30 days (submissions per reason and
 * the ever-enabled split, which is the activation funnel), a list
 * table newest first with a reason filter, and a CSV download of the
 * filtered rows. `manage_options` only.
 *
 * @package OpenStationFeedbackIntake
 */

defined( 'ABSPATH' ) || exit;

const OSFI_PAGE_SLUG = 'openstation-feedback';

/** Human labels for the reason slugs. */
function osfi_reason_labels() {
	return array(
		'changed_too_much' => 'Changed WordPress too much',
		'missing_features' => 'Missing features',
		'too_buggy'        => 'Too buggy or unstable',
		'other'            => 'Other',
	);
}

function osfi_register_page() {
	add_management_page(
		'OpenStation feedback',
		'OpenStation feedback',
		'manage_options',
		OSFI_PAGE_SLUG,
		'osfi_render_page'
	);
}
add_action( 'admin_menu', 'osfi_register_page' );

/**
 * The CSV download. Handled on `admin_init` so headers go out before
 * any markup; nonce-protected and `manage_options` only.
 */
function osfi_maybe_export_csv() {
	if ( ! isset( $_GET['page'], $_GET['osfi_export'] ) || OSFI_PAGE_SLUG !== $_GET['page'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked just below.
		return;
	}
	if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'osfi_export' ) ) {
		wp_die( 'Not allowed.' );
	}
	$reason = isset( $_GET['reason'] ) ? sanitize_key( wp_unslash( $_GET['reason'] ) ) : '';
	$result = osfi_query_rows(
		array(
			'reason'   => $reason,
			'per_page' => 1000,
			'page'     => 1,
		)
	);
	$cols = array( 'id', 'received_at', 'reasons', 'details', 'plugin_version', 'wp_version', 'php_version', 'locale', 'multisite', 'ever_enabled', 'deactivator_enabled', 'install_age_days', 'first_enable_delay_days', 'enabled_user_bucket', 'active_plugins_bucket', 'context' );

	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="openstation-deactivations-' . gmdate( 'Y-m-d' ) . '.csv"' );
	$out = fopen( 'php://output', 'w' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- streaming a download.
	fputcsv( $out, $cols );
	foreach ( $result['rows'] as $r ) {
		$line = array();
		foreach ( $cols as $c ) {
			$v = $r[ $c ];
			if ( is_array( $v ) ) {
				$v = implode( '|', $v );
			} elseif ( is_bool( $v ) ) {
				$v = $v ? 1 : 0;
			}
			// Neutralise spreadsheet formula injection on free text.
			if ( is_string( $v ) && '' !== $v && strpbrk( $v[0], "=+-@\t\r" ) !== false ) {
				$v = "'" . $v;
			}
			$line[] = $v;
		}
		fputcsv( $out, $line );
	}
	fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
	exit;
}
add_action( 'admin_init', 'osfi_maybe_export_csv' );

/**
 * Per-reason counts and the ever-enabled split over the last N days.
 *
 * @param int $days
 * @return array{ total:int, reasons:array<string,int>, ever_enabled:int, never_enabled:int }
 */
function osfi_summary( $days ) {
	$rows  = osfi_query_rows(
		array(
			'after'    => ( time() - $days * DAY_IN_SECONDS ) * 1000,
			'per_page' => 1000,
			'page'     => 1,
		)
	)['rows'];
	$out   = array(
		'total'         => count( $rows ),
		'reasons'       => array_fill_keys( OSFI_REASONS, 0 ),
		'ever_enabled'  => 0,
		'never_enabled' => 0,
	);
	foreach ( $rows as $r ) {
		foreach ( $r['reasons'] as $slug ) {
			if ( isset( $out['reasons'][ $slug ] ) ) {
				++$out['reasons'][ $slug ];
			}
		}
		if ( $r['ever_enabled'] ) {
			++$out['ever_enabled'];
		} else {
			++$out['never_enabled'];
		}
	}
	return $out;
}

function osfi_render_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$labels = osfi_reason_labels();
	$reason = isset( $_GET['reason'] ) ? sanitize_key( wp_unslash( $_GET['reason'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
	$paged  = isset( $_GET['paged'] ) ? max( 1, (int) $_GET['paged'] ) : 1; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$result = osfi_query_rows(
		array(
			'reason'   => $reason,
			'per_page' => 50,
			'page'     => $paged,
		)
	);
	$pages  = (int) ceil( $result['total'] / 50 );
	$base   = admin_url( 'tools.php?page=' . OSFI_PAGE_SLUG . ( $reason ? '&reason=' . rawurlencode( $reason ) : '' ) );
	$export = wp_nonce_url( $base . '&osfi_export=1', 'osfi_export' );
	?>
	<div class="wrap">
		<h1>OpenStation feedback</h1>
		<p>What sites said when they deactivated OpenStation. Nothing here identifies a site or a person.</p>

		<table class="widefat striped" style="max-width:720px;margin:12px 0 24px">
			<thead><tr><th></th><th>Last 7 days</th><th>Last 30 days</th></tr></thead>
			<tbody>
			<?php
			$s7  = osfi_summary( 7 );
			$s30 = osfi_summary( 30 );
			echo '<tr><th>Submissions</th><td>' . (int) $s7['total'] . '</td><td>' . (int) $s30['total'] . '</td></tr>';
			foreach ( $labels as $slug => $label ) {
				echo '<tr><td>' . esc_html( $label ) . '</td><td>' . (int) $s7['reasons'][ $slug ] . '</td><td>' . (int) $s30['reasons'][ $slug ] . '</td></tr>';
			}
			echo '<tr><th>Had turned it on somewhere</th><td>' . (int) $s7['ever_enabled'] . '</td><td>' . (int) $s30['ever_enabled'] . '</td></tr>';
			echo '<tr><th>Never turned it on</th><td>' . (int) $s7['never_enabled'] . '</td><td>' . (int) $s30['never_enabled'] . '</td></tr>';
			?>
			</tbody>
		</table>

		<form method="get" style="margin-bottom:12px">
			<input type="hidden" name="page" value="<?php echo esc_attr( OSFI_PAGE_SLUG ); ?>">
			<label for="osfi-reason">Reason</label>
			<select id="osfi-reason" name="reason">
				<option value="">All</option>
				<?php foreach ( $labels as $slug => $label ) : ?>
					<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( $reason, $slug ); ?>><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
			<button class="button">Filter</button>
			<a class="button" href="<?php echo esc_url( $export ); ?>">Download CSV</a>
			<span style="margin-left:8px"><?php echo (int) $result['total']; ?> rows</span>
		</form>

		<table class="widefat striped">
			<thead><tr>
				<th>Received (UTC)</th><th>Reasons</th><th>Details</th><th>Versions</th><th>Locale</th><th>Ever on</th><th>Users</th><th>Plugins</th><th>Installed</th><th>Context</th>
			</tr></thead>
			<tbody>
			<?php if ( empty( $result['rows'] ) ) : ?>
				<tr><td colspan="10">Nothing yet.</td></tr>
			<?php endif; ?>
			<?php foreach ( $result['rows'] as $r ) : ?>
				<tr>
					<td><?php echo esc_html( str_replace( 'T', ' ', substr( $r['received_at'], 0, 16 ) ) ); ?></td>
					<td><?php echo esc_html( implode( ', ', array_map( static fn( $s ) => $labels[ $s ] ?? $s, $r['reasons'] ) ) ); ?></td>
					<td><?php echo esc_html( $r['details'] ); ?></td>
					<td><?php echo esc_html( "OS {$r['plugin_version']} · WP {$r['wp_version']} · PHP {$r['php_version']}" . ( $r['multisite'] ? ' · network' : '' ) ); ?></td>
					<td><?php echo esc_html( $r['locale'] ); ?></td>
					<td><?php echo $r['ever_enabled'] ? 'yes' : 'no'; ?><?php echo $r['deactivator_enabled'] ? ' (deactivator too)' : ''; ?></td>
					<td><?php echo esc_html( $r['enabled_user_bucket'] ); ?></td>
					<td><?php echo esc_html( $r['active_plugins_bucket'] ); ?></td>
					<td><?php echo null === $r['install_age_days'] ? '?' : (int) $r['install_age_days'] . ' d'; ?></td>
					<td><?php echo esc_html( $r['context'] ); ?></td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>

		<?php if ( $pages > 1 ) : ?>
			<p>
			<?php
			for ( $i = 1; $i <= $pages; $i++ ) {
				if ( $i === $paged ) {
					echo '<strong>' . (int) $i . '</strong> ';
				} else {
					echo '<a href="' . esc_url( $base . '&paged=' . $i ) . '">' . (int) $i . '</a> ';
				}
			}
			?>
			</p>
		<?php endif; ?>
	</div>
	<?php
}
