<?php
/**
 * Network — an OpenStation network as one place.
 *
 * On a network of separate installs, each with OpenStation, this is
 * the window that says who belongs. On the hub (a multisite's network
 * admin, or a single site that admitted others) it lists every site
 * the switcher offers, local and member, admits an install by its
 * address, and re-checks the ones already in. On a member it names the
 * network the site belongs to, shows the list as last fetched, and
 * leaves. A site in neither role is offered both doors. The switcher
 * above the overview's desktop tiles is the everyday face of all this;
 * the window is the one-time admin task behind it. See
 * docs/network.md.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\Network;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;
use function OpenStation\App\Html\esc;
use function OpenStation\App\Html\tag;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const APP_ID = 'openstation-network';

/** Three nodes joined by lines: a hub and two members. */
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="16" r="7" fill="currentColor"/><circle cx="16" cy="46" r="7" fill="currentColor"/><circle cx="48" cy="46" r="7" fill="currentColor"/><path d="M32 23 L16 39 M32 23 L48 39 M23 46 H41" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';

/**
 * Which face this install shows: `hub`, `member` or `unpaired`. A
 * multisite is always the hub side; a single site is whichever role it
 * took, or neither.
 *
 * @param Os $os Host.
 * @return string
 */
function mode( Os $os ) {
	if ( $os->env->is_network() ) {
		return 'hub';
	}
	if ( \openstation_network_is_member() ) {
		return 'member';
	}
	if ( \openstation_network_is_hub() ) {
		return 'hub';
	}
	return 'unpaired';
}

/**
 * The gate: whoever manages this install's network or, on a single
 * site, the site.
 *
 * @param Os $os Host.
 * @return bool
 */
function can_use( Os $os ) {
	return $os->env->is_network() ? $os->auth->can( 'manage_network' ) : $os->auth->can( 'manage_options' );
}

/**
 * Record an outcome on the state: an error, or a notice.
 *
 * @param State  $state  State.
 * @param mixed  $result A WP_Error, or anything else for success.
 * @param string $notice Notice on success.
 */
function outcome( State $state, $result, $notice ) {
	if ( is_wp_error( $result ) ) {
		$state->set( 'error', $result->get_error_message() )->set( 'notice', '' );
		return;
	}
	$state->set( 'error', '' )->set( 'notice', $notice );
}

/**
 * A status badge for a member.
 *
 * @param string $status `paired`, `unreachable` or `key-changed`.
 * @return string Markup.
 */
function status_badge( $status ) {
	switch ( $status ) {
		case 'unreachable':
			return tag( 'os-badge', array( 'tone' => 'warning' ), esc( __( 'Unreachable', 'desktop-mode' ) ) );
		case 'key-changed':
			return tag( 'os-badge', array( 'tone' => 'danger' ), esc( __( 'Key changed', 'desktop-mode' ) ) );
		default:
			return tag( 'os-badge', array( 'tone' => 'success' ), esc( __( 'Paired', 'desktop-mode' ) ) );
	}
}

/**
 * One site row.
 *
 * @param array<string,mixed> $site    `id`, `name`, `url`, `shellUrl`, `kind`, `status`, `error`.
 * @param bool                $can_remove Whether a Remove button is offered.
 */
function site_row( array $site, $can_remove ) {
	$is_member = 'member' === $site['kind'];
	?>
	<li class="os-network__site" os-key="<?php echo esc( $site['id'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?>">
		<div class="os-network__site-main">
			<strong class="os-network__site-name"><?php echo esc( $site['name'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></strong>
			<span class="os-network__site-url"><?php echo esc( $site['url'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></span>
			<?php if ( ! empty( $site['error'] ) ) : ?>
				<span class="os-network__site-error"><?php echo esc( $site['error'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></span>
			<?php endif; ?>
		</div>
		<div class="os-network__site-side">
			<?php
			if ( $is_member ) {
				echo status_badge( $site['status'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built by tag(), which escapes every attribute; the label is esc()'d.
			} else {
				echo tag( 'os-badge', array( 'tone' => 'neutral' ), esc( __( 'This network', 'desktop-mode' ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built by tag(); see above.
			}
			if ( $is_member && $can_remove ) {
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built by tag(); see above.
				echo tag(
					'os-button',
					array(
						'variant'          => 'ghost',
						'os-action'        => 'remove',
						'os-arg-id'        => substr( (string) $site['id'], strlen( 'member:' ) ),
						/* translators: %s: site name. */
						'os-confirm'       => sprintf( __( 'Remove %s from the network? Its switcher will stop listing this network the next time it syncs.', 'desktop-mode' ), $site['name'] ),
						'os-confirm-label' => __( 'Remove', 'desktop-mode' ),
					),
					esc( __( 'Remove', 'desktop-mode' ) )
				);
			}
			?>
		</div>
	</li>
	<?php
}

/**
 * The address field and its button, shared by every face.
 *
 * @param State  $state       State.
 * @param string $label       Field label.
 * @param string $action      Action the button dispatches.
 * @param string $button      Button label.
 * @param string $placeholder Placeholder.
 */
function address_form( State $state, $label, $action, $button, $placeholder = 'https://' ) {
	?>
	<div class="os-network__form">
		<os-text-field
			class="os-network__address"
			label="<?php echo esc( $label ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?>"
			placeholder="<?php echo esc( $placeholder ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?>"
			value="<?php echo esc( (string) $state->get( 'url' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?>"
			os-bind="url"
		></os-text-field>
		<os-button variant="primary" os-action="<?php echo esc( $action ); ?>"><?php echo esc( $button ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></os-button>
	</div>
	<?php
}

/**
 * The notices, when there are any.
 *
 * @param State $state State.
 */
function notices( State $state ) {
	if ( '' !== (string) $state->get( 'error' ) ) {
		echo '<os-notice tone="danger" os-action="dismiss">' . esc( (string) $state->get( 'error' ) ) . '</os-notice>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
	}
	if ( '' !== (string) $state->get( 'notice' ) ) {
		echo '<os-notice tone="success" os-action="dismiss">' . esc( (string) $state->get( 'notice' ) ) . '</os-notice>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
	}
}

/**
 * The hub's face: every site, and the door.
 *
 * @param State $state State.
 * @param Os    $os    Host.
 */
function hub_view( State $state, Os $os ) {
	$identity = \openstation_network_identity();
	$sites    = array_merge( \openstation_network_local_entries(), \openstation_network_member_entries() );
	$members  = \openstation_network_members();
	?>
	<section class="os-network__section">
		<header class="os-network__header">
			<h2 class="os-network__title"><?php esc_html_e( 'Sites in this network', 'desktop-mode' ); ?></h2>
			<p class="os-network__lede">
				<?php
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
				echo esc(
					$os->env->is_network()
						? __( 'The sites of this WordPress network, and the OpenStation installs that joined it from elsewhere. Every one of them shows the same site switcher.', 'desktop-mode' )
						: __( 'This site is the hub of an OpenStation network: every install listed here shows the same site switcher.', 'desktop-mode' )
				);
				?>
			</p>
			<?php if ( array() !== $members ) : ?>
				<os-button variant="ghost" os-action="check"><?php esc_html_e( 'Check sites', 'desktop-mode' ); ?></os-button>
			<?php endif; ?>
		</header>
		<ul class="os-network__sites">
			<?php
			foreach ( $sites as $site ) {
				$member = 'member' === $site['kind'] ? $members[ substr( $site['id'], strlen( 'member:' ) ) ] : null;
				site_row(
					array(
						'id'     => $site['id'],
						'name'   => $site['name'],
						'url'    => $site['url'],
						'kind'   => $site['kind'],
						'status' => $site['status'],
						'error'  => $member ? $member['error'] : '',
					),
					true
				);
			}
			?>
		</ul>
	</section>
	<section class="os-network__section">
		<h3 class="os-network__subtitle"><?php esc_html_e( 'Add a site', 'desktop-mode' ); ?></h3>
		<p class="os-network__lede">
			<?php esc_html_e( 'An install anywhere, with OpenStation active and reachable over HTTPS. Its key is pinned when it is added; on that site, open Network and enter this address to finish pairing:', 'desktop-mode' ); ?>
			<code class="os-network__code"><?php echo esc( $identity['url'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></code>
		</p>
		<?php address_form( $state, __( 'Site address', 'desktop-mode' ), 'add', __( 'Add site', 'desktop-mode' ) ); ?>
	</section>
	<?php
}

/**
 * A member's face: the network it belongs to, and the list.
 *
 * @param State $state State.
 * @param Os    $os    Host.
 */
function member_view( State $state, Os $os ) {
	$hub = \openstation_network_hub();
	?>
	<section class="os-network__section">
		<header class="os-network__header">
			<h2 class="os-network__title">
				<?php
				/* translators: %s: network name. */
				echo esc( sprintf( __( 'This site belongs to %s', 'desktop-mode' ), $hub['name'] ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
				?>
			</h2>
			<p class="os-network__lede">
				<span class="os-network__site-url"><?php echo esc( $hub['url'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></span>
				<?php if ( $hub['fetched'] > 0 ) : ?>
					<span class="os-network__meta">
						<?php
						/* translators: %s: date and time. */
						echo esc( sprintf( __( 'Site list synced %s.', 'desktop-mode' ), $os->env->format_datetime( $hub['fetched'] ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
						?>
					</span>
				<?php endif; ?>
			</p>
			<?php if ( '' !== $hub['error'] ) : ?>
				<os-notice tone="warning">
					<?php
					echo esc( $hub['error'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
					echo ' ';
					esc_html_e( 'Until the network has added this site, the switcher stays as it was.', 'desktop-mode' );
					?>
				</os-notice>
			<?php endif; ?>
			<div class="os-network__actions">
				<os-button variant="ghost" os-action="sync"><?php esc_html_e( 'Sync now', 'desktop-mode' ); ?></os-button>
				<os-button
					variant="ghost"
					os-action="leave"
					os-confirm="<?php esc_attr_e( 'Leave the network? The site switcher stops listing its sites here.', 'desktop-mode' ); ?>"
					os-confirm-label="<?php esc_attr_e( 'Leave', 'desktop-mode' ); ?>"
				><?php esc_html_e( 'Leave network', 'desktop-mode' ); ?></os-button>
			</div>
		</header>
		<?php if ( null !== $hub['list'] ) : ?>
			<ul class="os-network__sites">
				<?php
				foreach ( $hub['list']['sites'] as $site ) {
					site_row(
						array(
							'id'     => $site['id'],
							'name'   => $site['name'],
							'url'    => $site['url'],
							'kind'   => $site['kind'],
							'status' => 'paired',
							'error'  => '',
						),
						false
					);
				}
				?>
			</ul>
		<?php endif; ?>
	</section>
	<?php
}

/**
 * Neither role yet: join a network, or start one here.
 *
 * @param State $state State.
 * @param Os    $os    Host.
 */
function unpaired_view( State $state, Os $os ) {
	$identity = \openstation_network_identity();
	?>
	<section class="os-network__section">
		<h2 class="os-network__title"><?php esc_html_e( 'Join a network', 'desktop-mode' ); ?></h2>
		<p class="os-network__lede">
			<?php esc_html_e( 'Enter the address of the OpenStation network this site belongs to. Its administrator adds this site there by this address:', 'desktop-mode' ); ?>
			<code class="os-network__code"><?php echo esc( $identity['url'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes. ?></code>
		</p>
		<?php address_form( $state, __( 'Network address', 'desktop-mode' ), 'join', __( 'Join', 'desktop-mode' ) ); ?>
	</section>
	<section class="os-network__section">
		<h3 class="os-network__subtitle"><?php esc_html_e( 'Or start one here', 'desktop-mode' ); ?></h3>
		<p class="os-network__lede"><?php esc_html_e( 'Add the first site and this site becomes the hub: every site added here shows the same site switcher.', 'desktop-mode' ); ?></p>
		<?php address_form( $state, __( 'Site address', 'desktop-mode' ), 'add', __( 'Add site', 'desktop-mode' ) ); ?>
	</section>
	<?php
}

/**
 * The body.
 *
 * @param State $state State.
 * @param Os    $os    Host.
 */
function render( State $state, Os $os ) {
	$mode = mode( $os );
	echo '<div class="os-network os-network--' . esc( $mode ) . '">'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc() escapes.
	notices( $state );
	if ( 'hub' === $mode ) {
		hub_view( $state, $os );
	} elseif ( 'member' === $mode ) {
		member_view( $state, $os );
	} else {
		unpaired_view( $state, $os );
	}
	echo '</div>';
}

return App::define( APP_ID )
	->title( __( 'Network', 'desktop-mode' ) )
	->icon( ICON )
	->size( 760, 560 )
	->min_size( 520, 400 )
	// A multisite manages its network from the network admin's shell;
	// a single site, from its own.
	->admin( function_exists( 'is_multisite' ) && is_multisite() ? 'network' : 'site' )
	->can( __NAMESPACE__ . '\\can_use' )
	->state(
		array(
			'url'    => '',
			'notice' => '',
			'error'  => '',
		)
	)
	->action(
		'dismiss',
		static function ( State $state ) {
			$state->set( 'error', '' )->set( 'notice', '' );
		}
	)
	->action(
		'add',
		static function ( State $state ) {
			$member = \openstation_network_add_member( (string) $state->get( 'url' ) );
			outcome(
				$state,
				$member,
				is_wp_error( $member )
					? ''
					/* translators: %s: site name. */
					: sprintf( __( '%s is in the network. It appears in the site switcher on the next load, and on that site once it joins from its Network window.', 'desktop-mode' ), $member['name'] )
			);
			if ( ! is_wp_error( $member ) ) {
				$state->set( 'url', '' );
			}
		}
	)
	->action(
		'remove',
		static function ( State $state, Os $os, array $args ) {
			$id = isset( $args['id'] ) ? sanitize_key( (string) $args['id'] ) : '';
			outcome(
				$state,
				\openstation_network_remove_member( $id ) ? true : new \WP_Error( 'openstation_network_unknown', __( 'That site is not in the network.', 'desktop-mode' ) ),
				__( 'Removed from the network.', 'desktop-mode' )
			);
		}
	)
	->action(
		'check',
		static function ( State $state ) {
			\openstation_network_check_members();
			outcome( $state, true, __( 'Every site was checked.', 'desktop-mode' ) );
		}
	)
	->action(
		'join',
		static function ( State $state ) {
			$hub = \openstation_network_join( (string) $state->get( 'url' ) );
			outcome(
				$state,
				$hub,
				is_wp_error( $hub )
					? ''
					: ( '' === $hub['error']
						/* translators: %s: network name. */
						? sprintf( __( 'This site belongs to %s. The site switcher shows the network on the next load.', 'desktop-mode' ), $hub['name'] )
						/* translators: %s: network name. */
						: sprintf( __( 'Pinned %s. It has not added this site yet; sync once it has.', 'desktop-mode' ), $hub['name'] ) )
			);
			if ( ! is_wp_error( $hub ) ) {
				$state->set( 'url', '' );
			}
		}
	)
	->action(
		'leave',
		static function ( State $state ) {
			\openstation_network_leave();
			outcome( $state, true, __( 'Left the network.', 'desktop-mode' ) );
		}
	)
	->action(
		'sync',
		static function ( State $state ) {
			$list = \openstation_network_refresh_list();
			outcome( $state, $list, __( 'Site list synced. The switcher shows it on the next load.', 'desktop-mode' ) );
		}
	)
	->view( __NAMESPACE__ . '\\render' );
