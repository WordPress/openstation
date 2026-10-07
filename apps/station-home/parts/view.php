<?php

namespace OpenStation\Apps\StationHome;

use OpenStation\App\Os;
use OpenStation\App\State;
use function OpenStation\App\Html\esc;
use function OpenStation\App\Html\tag;

defined( 'ABSPATH' ) || exit;

function text( $value ) {
	return esc( html_entity_decode( (string) $value, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
}

function greeting( $hour, $name ) {
	if ( $hour < 12 ) {

		return sprintf( __( 'Good morning, %s', 'desktop-mode' ), $name );
	}
	if ( $hour < 18 ) {

		return sprintf( __( 'Good afternoon, %s', 'desktop-mode' ), $name );
	}

	return sprintf( __( 'Good evening, %s', 'desktop-mode' ), $name );
}

function icon( $class ) {
	return '<span class="dashicons ' . esc( $class ) . '" aria-hidden="true"></span>';
}

function card_icon( $value ) {
	if ( 0 === strpos( $value, 'dashicons-' ) ) {
		return icon( $value );
	}
	return tag(
		'img',
		array(
			'src'     => $value,
			'alt'     => '',
			'loading' => 'lazy',
		)
	);
}

function status_tone( $status ) {
	switch ( $status ) {
		case 'publish':
			return 'success';
		case 'pending':
		case 'future':
			return 'warning';
		case 'private':
			return 'info';
		default:
			return 'neutral';
	}
}

function quick_action( array $action ) {
	$inner = icon( $action['icon'] ) . '<span>' . esc( $action['label'] ) . '</span>';
	if ( in_array( $action['kind'], array( 'url', 'external' ), true ) && ! empty( $action['url'] ) ) {
		return tag(
			'a',
			array(
				'class'  => 'os-station-home__action',
				'os-key' => $action['id'],
				'href'   => $action['url'],
				'title'  => $action['label'],
				'target' => 'external' === $action['kind'] ? '_blank' : false,
				'rel'    => 'external' === $action['kind'] ? 'noopener' : false,
			),
			$inner
		);
	}

	return tag(
		'os-button',
		array(
			'class'     => 'os-station-home__action',
			'os-key'    => $action['id'],
			'variant'   => 'ghost',
			'fill-cell' => true,
			'title'     => $action['label'],
			'os-action' => 'launch',
			'os-arg-id' => $action['id'],
		),
		$inner
	);
}

function render( State $state, Os $os ) {
	$snapshot = snapshot( $os );
	$hour     = (int) $os->env->format_datetime( time(), 'G' );
	?>
	<div class="desktop-mode-station-home" data-os-station-home-root>
		<div class="os-station-home__layout">
			<aside class="os-station-home__rail" aria-label="<?php esc_attr_e( 'Station Home', 'desktop-mode' ); ?>">
				<div class="os-station-home__brand">
					<img
						class="os-station-home__brand-mark"
						src="<?php echo esc_url( OPENSTATION_URL . 'assets/images/openstation-mark.svg' ); ?>"
						alt=""
						width="36"
						height="36"
					/>
					<span>OpenStation</span>
				</div>
				<div class="os-station-home__location" aria-current="page">
					<span aria-hidden="true"></span>
					<?php esc_html_e( 'Station Home', 'desktop-mode' ); ?>
				</div>
				<div class="os-station-home__mesh" aria-hidden="true"></div>
				<nav class="os-station-home__actions" aria-label="<?php esc_attr_e( 'Quick actions', 'desktop-mode' ); ?>">
					<?php
					foreach ( $snapshot['quickActions'] as $action ) {
						echo quick_action( $action );
					}
					?>
				</nav>
			</aside>

			<main class="os-station-home__main">
				<header class="os-station-home__intro">
					<div>
						<h1 id="os-station-home-title"><?php echo text( greeting( $hour, $snapshot['userName'] ) );                                                                                     ?></h1>
						<p>
							<?php
							if ( '' !== (string) $snapshot['siteName'] ) {

								echo text( sprintf( __( 'Pick up where you left off on %s.', 'desktop-mode' ), $snapshot['siteName'] ) );
							} else {
								esc_html_e( 'Pick up where you left off.', 'desktop-mode' );
							}
							?>
						</p>
					</div>
					<os-button
						class="os-station-home__refresh"
						variant="ghost"
						os-action="refresh"
						aria-label="<?php esc_attr_e( 'Refresh Station Home', 'desktop-mode' ); ?>"
						title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>"
					>
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
				</header>

				<section class="os-station-home__section" aria-labelledby="os-station-home-work-heading">
					<h2 id="os-station-home-work-heading"><?php esc_html_e( 'Continue working', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__work">
						<?php work( $snapshot['work'] ); ?>
					</div>
				</section>

				<section class="os-station-home__section" aria-labelledby="os-station-home-pulse-heading">
					<h2 id="os-station-home-pulse-heading"><?php esc_html_e( 'Site pulse', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__pulse">
						<?php foreach ( $snapshot['metrics'] as $metric ) : ?>
							<article class="os-station-home__metric" os-key="<?php echo esc( $metric['id'] );                                                                                    ?>">
								<div class="os-station-home__metric-label">
									<?php echo icon( $metric['icon'] );                                                                                     ?>
									<span><?php echo esc( $metric['label'] );                                                                                    ?></span>
								</div>
								<strong><?php echo esc( number_format_i18n( $metric['value'] ) );                                                                                    ?></strong>
							</article>
						<?php endforeach; ?>
					</div>
				</section>

				<section class="os-station-home__section" aria-labelledby="os-station-home-attention-heading">
					<h2 id="os-station-home-attention-heading"><?php esc_html_e( 'Needs attention', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__attention">
						<?php attention_rows( $snapshot['attention'] ); ?>
					</div>
				</section>

				<?php if ( array() !== $snapshot['cardPreferences'] ) : ?>
					<section class="os-station-home__section os-station-home__cards-section" aria-labelledby="os-station-home-cards-heading">
						<div class="os-station-home__section-heading">
							<h2 id="os-station-home-cards-heading"><?php esc_html_e( 'From your plugins', 'desktop-mode' ); ?></h2>
							<os-button variant="ghost" size="sm" os-action="customize">
								<span class="dashicons dashicons-admin-generic" aria-hidden="true"></span>
								<?php esc_html_e( 'Customize', 'desktop-mode' ); ?>
							</os-button>
						</div>
						<div class="os-station-home__cards">
							<?php cards( $snapshot['cards'] ); ?>
						</div>
					</section>
				<?php endif; ?>
			</main>
		</div>

		<?php card_modal( (bool) $state->get( 'customizing' ), $snapshot['cardPreferences'] ); ?>
	</div>
	<?php
}

function work( array $work ) {
	if ( array() === $work ) {
		?>
		<os-empty-state
			icon="welcome-write-blog"
			heading="<?php esc_attr_e( 'Your desk is clear', 'desktop-mode' ); ?>"
			description="<?php esc_attr_e( 'Start something new and it will be waiting here when you return.', 'desktop-mode' ); ?>"
		></os-empty-state>
		<?php
		return;
	}
	foreach ( $work as $item ) {
		?>
		<a class="os-station-home__work-row" os-key="<?php echo esc( $item['id'] );                                                                                    ?>" href="<?php echo esc_url( $item['editUrl'] ); ?>">
			<span class="os-station-home__row-icon"><?php echo icon( $item['icon'] );                                                                                     ?></span>
			<span class="os-station-home__row-copy">
				<span class="os-station-home__row-title"><?php echo text( $item['title'] );                                                                                     ?></span>
				<span class="os-station-home__row-meta"><?php echo text( $item['typeLabel'] );                                                                                     ?></span>
			</span>
			<os-badge tone="<?php echo esc( status_tone( $item['status'] ) );                                                                                    ?>"><?php echo esc( $item['statusLabel'] );                                                                                    ?></os-badge>
			<?php if ( '' !== $item['modifiedGmt'] ) : ?>
				<os-relative-time datetime="<?php echo esc( $item['modifiedGmt'] );                                                                                    ?>" compact></os-relative-time>
			<?php endif; ?>
			<?php echo icon( 'dashicons-arrow-right-alt2' );                                                                                     ?>
		</a>
		<?php
	}
}

function attention_rows( array $attention ) {
	if ( array() === $attention ) {
		?>
		<div class="os-station-home__all-clear">
			<?php echo icon( 'dashicons-yes-alt' );                                                                                     ?>
			<span>
				<strong><?php esc_html_e( 'All clear', 'desktop-mode' ); ?></strong>
				<span><?php esc_html_e( 'Nothing needs your attention right now.', 'desktop-mode' ); ?></span>
			</span>
		</div>
		<?php
		return;
	}
	foreach ( $attention as $item ) {
		?>
		<a class="os-station-home__attention-row" os-key="<?php echo esc( $item['id'] );                                                                                    ?>" href="<?php echo esc_url( $item['url'] ); ?>">
			<span class="os-station-home__attention-count">
				<?php echo icon( $item['icon'] );                                                                                     ?>
				<strong><?php echo esc( number_format_i18n( $item['count'] ) );                                                                                    ?></strong>
			</span>
			<span class="os-station-home__attention-copy">
				<strong><?php echo text( $item['label'] );                                                                                     ?></strong>
				<span><?php echo text( $item['description'] );                                                                                     ?></span>
			</span>
			<?php echo icon( 'dashicons-arrow-right-alt2' );                                                                                     ?>
		</a>
		<?php
	}
}

function cards( array $cards ) {
	if ( array() === $cards ) {
		?>
		<div class="os-station-home__cards-empty">
			<?php echo icon( 'dashicons-admin-plugins' );                                                                                     ?>
			<span>
				<strong><?php esc_html_e( 'Make this space yours', 'desktop-mode' ); ?></strong>
				<span><?php esc_html_e( 'Use Customize to opt in to information from your plugins.', 'desktop-mode' ); ?></span>
			</span>
		</div>
		<?php
		return;
	}
	foreach ( $cards as $card ) {
		$linked = '' !== (string) $card['url'];
		$detail = '' !== (string) $card['detail'] ? $card['detail'] : $card['description'];
		$inner  = '<span class="os-station-home__card-head">'
			. '<span class="os-station-home__card-icon">' . card_icon( $card['icon'] ) . '</span>'
			. '<span><strong>' . text( $card['label'] ) . '</strong>'
			. ( '' !== (string) $card['provider'] ? '<span>' . text( $card['provider'] ) . '</span>' : '' )
			. '</span></span>';
		if ( '' !== (string) $card['value'] ) {
			$inner .= '<strong class="os-station-home__card-value">' . text( $card['value'] ) . '</strong>';
		}
		if ( '' !== (string) $detail ) {
			$inner .= '<span class="os-station-home__card-detail">' . text( $detail ) . '</span>';
		}
		if ( $linked ) {
			$label  = '' !== (string) $card['actionLabel'] ? $card['actionLabel'] : __( 'Open', 'desktop-mode' );
			$inner .= '<span class="os-station-home__card-action">' . text( $label ) . icon( 'dashicons-arrow-right-alt2' ) . '</span>';
		}
		echo tag(
			$linked ? 'a' : 'article',
			array(
				'class'     => 'os-station-home__card',
				'os-key'    => $card['id'],
				'data-tone' => $card['tone'],
				'href'      => $linked ? $card['url'] : false,
				'target'    => $linked && $card['external'] ? '_blank' : false,
				'rel'       => $linked && $card['external'] ? 'noopener' : false,
			),
			$inner
		);
	}
}

function card_modal( $open, array $preferences ) {
	?>
	<os-modal
		class="os-station-home__card-modal"
		title="<?php esc_attr_e( 'Customize Station Home', 'desktop-mode' ); ?>"
		size="md"
		os-action="customize_close" <?php echo esc_attr( $open ? 'open' : '' ); ?>>
		<p class="os-station-home__card-modal-intro">
			<?php esc_html_e( 'Choose which plugin cards can show information on your Station Home.', 'desktop-mode' ); ?>
		</p>
		<div class="os-station-home__card-preferences">
			<?php
			foreach ( $preferences as $preference ) {
				echo tag(
					'os-switch',
					array(
						'os-key'      => $preference['id'],
						'value'       => $preference['id'],
						'label'       => html_entity_decode( (string) $preference['label'], ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
						'description' => implode(
							' — ',
							array_filter(
								array(
									html_entity_decode( (string) $preference['provider'], ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
									html_entity_decode( (string) $preference['description'], ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
								)
							)
						),
						'block'       => true,
						'size'        => 'sm',
						'tone'        => 'accent',
						'checked'     => (bool) $preference['enabled'],
						'os-action'   => 'toggle_card',
						'os-arg-id'   => $preference['id'],
					)
				);
			}
			?>
		</div>
	</os-modal>
	<?php
}
