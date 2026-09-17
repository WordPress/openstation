<?php
/**
 * OpenStation — First-run welcome dialog.
 *
 * Renders a one-time, self-contained modal inside the *classic*
 * WordPress admin (never inside the desktop shell or a chromeless
 * iframe) that introduces OpenStation and offers to switch it on.
 * Dismissal is persisted via the existing seen-intros registry
 * (`desktop_mode_seen_intros` user meta, slug `activation-welcome`),
 * which means the "Reset what's-new dialogs" button in OpenStation
 * Preferences → Features brings it back exactly like every other intro
 * dialog.
 *
 * The dialog is intentionally self-contained — all HTML, CSS and JS are
 * inlined into `admin_footer`. We deliberately do NOT use any of the
 * `<os-*>` shell components here because they only ship inside the
 * desktop bundle, which is precisely *not* loaded on the classic admin
 * screens where this dialog is allowed to appear.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` for this dialog. */
const OPENSTATION_WELCOME_INTRO_SLUG = 'activation-welcome';

/**
 * Decides whether the welcome dialog should render on the current request.
 *
 * Six gates:
 *
 * 1. We're inside `/wp-admin` (`is_admin()`).
 * 2. The user is logged in and can `read` (sanity gate — the dialog has
 *    no destructive surface, but anonymous output makes no sense).
 * 3. The request is NOT chromeless — chromeless pages are iframes
 *    rendering inside the desktop shell; the parent shell already shows
 *    its own UX.
 * 4. OpenStation is NOT already enabled for the user. This is a
 *    "switch to OpenStation" promo, so it has nothing to say once the
 *    user is in the shell. The desktop shell's *parent* page is admin
 *    context and is not chromeless, so without this gate the dialog
 *    re-renders there the moment the user clicks "Switch to
 *    OpenStation", which reads as a duplicate dialog because the
 *    fire-and-forget seen-intro POST races the redirect into the shell
 *    and often loses.
 * 5. The user has not already dismissed this intro.
 * 6. The `openstation_show_welcome_dialog` filter returns truthy, so
 *    sites can suppress the dialog entirely (e.g. managed-host onboarding
 *    flows that ship their own).
 *
 * @return bool
 */
function openstation_should_show_welcome_dialog() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return false;
	}
	if ( ! current_user_can( 'read' ) ) {
		return false;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return false;
	}
	if ( function_exists( 'openstation_is_enabled' ) && openstation_is_enabled() ) {
		return false;
	}
	$user_id = get_current_user_id();
	if ( openstation_has_seen_intro( $user_id, OPENSTATION_WELCOME_INTRO_SLUG ) ) {
		return false;
	}

	/**
	 * Filters whether the first-run welcome dialog should render for
	 * the current user on the current request. All earlier gates
	 * (admin context, capability, chromeless, seen-state) have
	 * already passed by the time this filter fires.
	 *
	 * @param bool $show    Whether to render the dialog. Default true.
	 * @param int  $user_id Current user ID.
	 */
	return (bool) apply_filters( 'openstation_show_welcome_dialog', true, $user_id );
}

/**
 * Returns one of OpenStation's own icons as inline SVG markup.
 *
 * Reads the outlined copies in `assets/icons/` (the ones registered with
 * Core's icon registry), which paint with `currentColor`, so the dialog's
 * CSS decides their colour. Returns an empty string for a missing file,
 * which leaves an empty icon slot rather than breaking the dialog.
 *
 * @param string $slug Icon slug, e.g. `windows`.
 * @return string Sanitised SVG markup.
 */
function openstation_welcome_dialog_icon( $slug ) {
	$path = OPENSTATION_DIR . 'assets/icons/' . sanitize_key( $slug ) . '.svg';
	if ( ! is_readable( $path ) ) {
		return '';
	}
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local plugin file, not a remote URL.
	$svg = (string) file_get_contents( $path );

	return wp_kses(
		$svg,
		array(
			'svg'  => array(
				'xmlns'       => true,
				'viewbox'     => true,
				'width'       => true,
				'height'      => true,
				'aria-hidden' => true,
				'focusable'   => true,
			),
			'path' => array(
				'd'    => true,
				'fill' => true,
			),
		)
	);
}

/**
 * Prints the welcome dialog markup, styles and dismiss script into
 * `admin_footer`.
 *
 * Self-contained on purpose: everything is scoped under the
 * `.os-welcome` namespace so it cannot collide with the host
 * admin theme. The dismiss button POSTs to the seen-intros REST route,
 * which is exactly the same endpoint the in-shell intros use.
 *
 * The look is deliberately quiet: a light card with a dark panel that
 * shows two OpenStation windows, the holo mark, and Pulse kept to the
 * feature icons. Every colour is a literal from the brand palette rather
 * than a `--os-*` token, because `variables.css` is not loaded in classic
 * admin. Spacing sits on an 8px grid.
 */
function openstation_render_welcome_dialog() {
	if ( ! openstation_should_show_welcome_dialog() ) {
		return;
	}

	$rest_url   = esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) );
	$rest_nonce = wp_create_nonce( 'wp_rest' );
	$ajax_url   = esc_url_raw( admin_url( 'admin-ajax.php' ) );
	$ajax_nonce = wp_create_nonce( 'save-openstation' );
	$slug       = OPENSTATION_WELCOME_INTRO_SLUG;
	$font_url   = OPENSTATION_URL . 'assets/fonts/Geist-Variable.woff2';
	$mono_url   = OPENSTATION_URL . 'assets/fonts/GeistMono-Variable.woff2';
	$mark_url   = OPENSTATION_URL . 'assets/images/openstation-mark-holo.svg';

	// All user-facing strings are passed through translation; the dialog
	// is keyboard-dismissible (Escape) and moves initial focus to the
	// primary CTA.
	$title    = __( 'Welcome to OpenStation', 'desktop-mode' );
	$body     = __( 'Your admin, as a desktop. Keep several screens open at once and move between tasks without losing your place.', 'desktop-mode' );
	$later    = __( 'Not now', 'desktop-mode' );
	$enable   = __( 'Switch to OpenStation', 'desktop-mode' );
	$enabling = __( 'Switching…', 'desktop-mode' );

	$features = array(
		array(
			'icon'  => 'windows',
			'title' => __( 'Work in windows', 'desktop-mode' ),
			'desc'  => __( 'Posts, media and settings side by side.', 'desktop-mode' ),
		),
		array(
			'icon'  => 'apps',
			'title' => __( 'Apps for everyday tasks', 'desktop-mode' ),
			'desc'  => __( 'Fast lists with bulk actions and previews.', 'desktop-mode' ),
		),
		array(
			'icon'  => 'dock',
			'title' => __( 'A dock for your screens', 'desktop-mode' ),
			'desc'  => __( 'Pin what you use most, one click away.', 'desktop-mode' ),
		),
		array(
			'icon'  => 'command',
			/* translators: %s: the keyboard shortcut that opens search, e.g. ⌘K. */
			'title' => __( 'Search with %s', 'desktop-mode' ),
			'desc'  => __( 'Jump to any screen or run a command.', 'desktop-mode' ),
			'kbd'   => true,
		),
	);
	?>
<style id="os-welcome-style">
	@font-face {
		font-family: "OpenStation Geist";
		src: url( "<?php echo esc_url( $font_url ); ?>" ) format( "woff2" );
		font-weight: 100 900;
		font-style: normal;
		font-display: swap;
	}
	@font-face {
		font-family: "OpenStation Geist Mono";
		src: url( "<?php echo esc_url( $mono_url ); ?>" ) format( "woff2" );
		font-weight: 100 900;
		font-style: normal;
		font-display: swap;
	}
	.os-welcome,
	.os-welcome * {
		box-sizing: border-box;
	}
	.os-welcome {
		/* Brand palette, as literals: see the render function's docblock. */
		--_void: #0c0b0f;
		--_obsidian: #1a1721;
		--_astro: #33303a;
		--_silver: #4d4a52;
		--_pewter: #66636b;
		--_osmium: #99969c;
		--_ash: #b3afb5;
		--_cloud: #ccc8ce;
		--_mist: #e6e2e6;
		--_haze: #f4f1f4;
		--_starlight: #fffbff;
		--_pulse: #f252fc;

		position: fixed;
		inset: 0;
		z-index: 100000;
		display: flex;
		padding: 24px;
		overflow-y: auto;
		background: rgba( 12, 11, 15, 0.72 );
		backdrop-filter: blur( 16px );
		-webkit-backdrop-filter: blur( 16px );
		animation: os-welcome-fade 240ms ease-out;
		font-family: "OpenStation Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 16px;
		line-height: 1.5;
		color: var( --_obsidian );
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}
	@keyframes os-welcome-fade {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
	@keyframes os-welcome-pop {
		from { opacity: 0; transform: translateY( 8px ); }
		to   { opacity: 1; transform: translateY( 0 ); }
	}
	.os-welcome__card {
		/* margin:auto centres the card and still lets a short viewport scroll to its top. */
		margin: auto;
		width: 100%;
		max-width: 820px;
		min-height: 544px;
		display: grid;
		grid-template-columns: 5fr 6fr;
		overflow: hidden;
		background: var( --_starlight );
		border-radius: 13px;
		box-shadow:
			0 0 0 1px rgba( 12, 11, 15, 0.08 ),
			0 32px 64px -24px rgba( 12, 11, 15, 0.48 );
		animation: os-welcome-pop 320ms cubic-bezier( 0.22, 1, 0.36, 1 ) both;
	}

	/* ---- Dark panel: two windows on the station ------------------- */

	.os-welcome__art {
		position: relative;
		overflow: hidden;
		isolation: isolate;
		background:
			radial-gradient( 1px 1px at 12% 18%, rgba( 255, 251, 255, 0.55 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 78% 12%, rgba( 255, 251, 255, 0.4 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 64% 44%, rgba( 255, 251, 255, 0.3 ) 50%, transparent 51% ),
			radial-gradient( 1.5px 1.5px at 88% 62%, rgba( 255, 251, 255, 0.45 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 22% 72%, rgba( 255, 251, 255, 0.35 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 46% 88%, rgba( 255, 251, 255, 0.3 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 8% 48%, rgba( 255, 251, 255, 0.3 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 94% 90%, rgba( 255, 251, 255, 0.35 ) 50%, transparent 51% ),
			radial-gradient( 1px 1px at 36% 8%, rgba( 255, 251, 255, 0.35 ) 50%, transparent 51% ),
			radial-gradient( 60% 45% at 85% 100%, rgba( 236, 155, 255, 0.1 ), transparent 70% ),
			radial-gradient( 50% 40% at 0% 30%, rgba( 159, 152, 255, 0.07 ), transparent 70% ),
			var( --_void );
	}
	.os-welcome__art::after {
		content: "";
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			linear-gradient( 180deg, rgba( 12, 11, 15, 0.85 ) 0%, rgba( 12, 11, 15, 0 ) 22% ),
			linear-gradient( 0deg, rgba( 12, 11, 15, 0.6 ) 0%, rgba( 12, 11, 15, 0 ) 26% );
	}
	.os-welcome .os-welcome__mark {
		position: absolute;
		top: 32px;
		inset-inline-start: 32px;
		z-index: 2;
		display: block;
		width: 40px;
		height: 40px;
		max-width: none;
	}
	.os-welcome__pair {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 300px;
		height: 276px;
		transform: translate( -50%, -44% );
		direction: ltr;
	}
	.os-welcome__win {
		position: absolute;
		overflow: hidden;
		border-radius: 9px;
		/* The window greys sit a step above the palette's dark ramp so the art reads against Void. */
		background: #201d28;
		border: 1px solid rgba( 255, 251, 255, 0.12 );
		box-shadow: 0 18px 36px -12px rgba( 0, 0, 0, 0.7 );
		font-size: 9px;
		line-height: 1;
	}
	.os-welcome__win--posts { left: 0; top: 0; width: 236px; height: 184px; }
	.os-welcome__win--media { right: 0; bottom: 0; width: 236px; height: 160px; }
	.os-welcome__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 24px;
		padding: 0 8px;
		font-weight: 500;
		color: var( --_mist );
		border-bottom: 1px solid rgba( 255, 251, 255, 0.08 );
	}
	.os-welcome__bar-title { display: flex; align-items: center; gap: 8px; }
	.os-welcome__bar-title i { width: 7px; height: 7px; border: 1px solid var( --_osmium ); border-radius: 50%; }
	.os-welcome__bar-ctl { display: flex; gap: 8px; }
	.os-welcome__bar-ctl i { display: block; width: 6px; height: 6px; border: 1px solid #77747c; border-radius: 1.5px; }
	.os-welcome__bar-ctl i:first-child { height: 0; border-width: 1px 0 0; margin-top: 3px; border-radius: 0; }
	.os-welcome__rows { padding: 8px; }
	.os-welcome__row {
		display: grid;
		grid-template-columns: 7px 1fr 34px;
		align-items: center;
		gap: 8px;
		height: 24px;
		border-bottom: 1px solid rgba( 255, 251, 255, 0.07 );
	}
	.os-welcome__row i { width: 7px; height: 7px; border: 1px solid #5c5963; border-radius: 2px; }
	.os-welcome__row b { height: 5px; border-radius: 3px; background: #5c5963; }
	.os-welcome__row em { height: 9px; border-radius: 999px; background: #3e3b46; }
	.os-welcome__row--head b,
	.os-welcome__row--head em { background: #3e3b46; }
	.os-welcome__row--selected { background: rgba( 255, 251, 255, 0.05 ); }
	.os-welcome__thumbs { padding: 8px; display: grid; grid-template-columns: repeat( 4, 1fr ); gap: 8px; }
	.os-welcome__thumbs i {
		display: block;
		aspect-ratio: 1;
		border-radius: 4px;
		background: linear-gradient( 150deg, #34303d, #27242f );
		border: 1px solid rgba( 255, 251, 255, 0.06 );
	}
	.os-welcome__thumbs i:nth-child( 3n + 1 ) { background: linear-gradient( 150deg, #3a3444, #2a2633 ); }
	.os-welcome__thumbs i:nth-child( 5 ) {
		background:
			radial-gradient( circle at 70% 30%, rgba( 236, 155, 255, 0.22 ), transparent 60% ),
			linear-gradient( 150deg, #36313f, #25222c );
	}

	/* ---- Content column ------------------------------------------- */

	.os-welcome__main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		text-align: start;
	}
	.os-welcome__content {
		display: grid;
		gap: 24px;
		padding: 32px;
	}
	.os-welcome__head {
		display: grid;
		gap: 8px;
	}
	.os-welcome .os-welcome__title {
		margin: 0;
		padding: 0;
		font-family: inherit;
		font-size: 24px;
		line-height: 1.3;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var( --_obsidian );
		text-wrap: balance;
	}
	.os-welcome .os-welcome__lede {
		margin: 0;
		font-size: 16px;
		line-height: 1.5;
		color: var( --_silver );
	}
	.os-welcome .os-welcome__features {
		display: grid;
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.os-welcome .os-welcome__feature {
		display: flex;
		gap: 16px;
		margin: 0;
	}
	.os-welcome__icon {
		flex: none;
		width: 20px;
		height: 20px;
		color: var( --_pulse );
	}
	.os-welcome__icon svg {
		display: block;
		width: 20px;
		height: 20px;
	}
	.os-welcome__feature-title {
		display: block;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.4;
		color: var( --_obsidian );
	}
	.os-welcome .os-welcome__feature-desc {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var( --_pewter );
	}
	.os-welcome .os-welcome__kbd {
		display: inline-block;
		margin: 0;
		padding: 0 8px;
		font-family: "OpenStation Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
		color: var( --_astro );
		background: var( --_haze );
		border: 1px solid var( --_mist );
		border-bottom-color: var( --_cloud );
		border-radius: 5px;
		white-space: nowrap;
	}

	/* Anchored to the bottom of the card, however long the copy runs. */
	.os-welcome__actions {
		margin-top: auto;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 32px 32px;
	}
	.os-welcome .os-welcome__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		margin: 0;
		padding: 0 16px;
		font-family: inherit;
		font-size: 14px;
		font-weight: 500;
		line-height: 1;
		border-radius: 8px;
		border: 1px solid var( --_obsidian );
		box-shadow: none;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}
	.os-welcome .os-welcome__btn:focus-visible {
		outline: 2px solid var( --_obsidian );
		outline-offset: 2px;
	}
	.os-welcome .os-welcome__btn--primary {
		color: var( --_starlight );
		background: var( --_obsidian );
	}
	.os-welcome .os-welcome__btn--primary:hover {
		background: var( --_astro );
		border-color: var( --_astro );
	}
	.os-welcome .os-welcome__btn--secondary {
		color: var( --_obsidian );
		background: transparent;
	}
	.os-welcome .os-welcome__btn--secondary:hover {
		background: var( --_haze );
	}
	.os-welcome .os-welcome__btn[disabled] {
		opacity: 0.64;
		cursor: progress;
	}
	body.os-welcome-open {
		overflow: hidden;
	}

	/* ---- Narrow screens ------------------------------------------- */

	@media ( max-width: 760px ) {
		.os-welcome__card {
			grid-template-columns: 1fr;
			min-height: 0;
		}
		.os-welcome__art {
			height: 216px;
		}
		.os-welcome__pair {
			transform: translate( -50%, -44% ) scale( 0.64 );
		}
	}
	@media ( max-width: 480px ) {
		.os-welcome {
			padding: 16px;
		}
		.os-welcome .os-welcome__mark {
			top: 24px;
			inset-inline-start: 24px;
		}
		.os-welcome__content {
			padding: 24px;
		}
		.os-welcome__actions {
			padding: 0 24px 24px;
		}
		.os-welcome .os-welcome__btn {
			flex: 1 1 auto;
		}
	}
	@media ( prefers-reduced-motion: reduce ) {
		.os-welcome,
		.os-welcome__card {
			animation: none !important;
		}
		.os-welcome .os-welcome__btn {
			transition: none;
		}
	}
</style>
<div
	class="os-welcome"
	role="dialog"
	aria-modal="true"
	aria-labelledby="os-welcome-title"
	aria-describedby="os-welcome-desc"
	data-slug="<?php echo esc_attr( $slug ); ?>"
>
	<div class="os-welcome__card">
		<div class="os-welcome__art" aria-hidden="true">
			<img class="os-welcome__mark" src="<?php echo esc_url( $mark_url ); ?>" alt="" width="40" height="40" />
			<div class="os-welcome__pair">
				<div class="os-welcome__win os-welcome__win--posts">
					<div class="os-welcome__bar">
						<span class="os-welcome__bar-title"><i></i><?php echo esc_html__( 'Posts', 'desktop-mode' ); ?></span>
						<span class="os-welcome__bar-ctl"><i></i><i></i><i></i></span>
					</div>
					<div class="os-welcome__rows">
						<div class="os-welcome__row os-welcome__row--head"><i></i><b style="width:40%"></b><em></em></div>
						<div class="os-welcome__row"><i></i><b style="width:78%"></b><em></em></div>
						<div class="os-welcome__row os-welcome__row--selected"><i></i><b style="width:62%"></b><em></em></div>
						<div class="os-welcome__row"><i></i><b style="width:84%"></b><em></em></div>
						<div class="os-welcome__row"><i></i><b style="width:55%"></b><em></em></div>
						<div class="os-welcome__row"><i></i><b style="width:70%"></b><em></em></div>
					</div>
				</div>
				<div class="os-welcome__win os-welcome__win--media">
					<div class="os-welcome__bar">
						<span class="os-welcome__bar-title"><i></i><?php echo esc_html__( 'Media', 'desktop-mode' ); ?></span>
						<span class="os-welcome__bar-ctl"><i></i><i></i><i></i></span>
					</div>
					<div class="os-welcome__thumbs">
						<i></i><i></i><i></i><i></i>
						<i></i><i></i><i></i><i></i>
					</div>
				</div>
			</div>
		</div>
		<div class="os-welcome__main">
			<div class="os-welcome__content">
				<div class="os-welcome__head">
					<h2 id="os-welcome-title" class="os-welcome__title">
						<?php echo esc_html( $title ); ?>
					</h2>
					<p id="os-welcome-desc" class="os-welcome__lede">
						<?php echo esc_html( $body ); ?>
					</p>
				</div>
				<ul class="os-welcome__features">
					<?php foreach ( $features as $feature ) : ?>
						<li class="os-welcome__feature">
							<span class="os-welcome__icon" aria-hidden="true">
								<?php echo openstation_welcome_dialog_icon( $feature['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitised with wp_kses() in the helper. ?>
							</span>
							<div>
								<strong class="os-welcome__feature-title">
									<?php
									if ( ! empty( $feature['kbd'] ) ) {
										echo wp_kses(
											sprintf(
												esc_html( $feature['title'] ),
												'<kbd class="os-welcome__kbd" data-os-welcome-shortcut>⌘K</kbd>'
											),
											array(
												'kbd' => array(
													'class'  => true,
													'data-*' => true,
												),
											)
										);
									} else {
										echo esc_html( $feature['title'] );
									}
									?>
								</strong>
								<p class="os-welcome__feature-desc">
									<?php echo esc_html( $feature['desc'] ); ?>
								</p>
							</div>
						</li>
					<?php endforeach; ?>
				</ul>
			</div>
			<div class="os-welcome__actions">
				<button
					type="button"
					class="os-welcome__btn os-welcome__btn--secondary"
					data-os-welcome-cta
				>
					<?php echo esc_html( $later ); ?>
				</button>
				<button
					type="button"
					class="os-welcome__btn os-welcome__btn--primary"
					data-os-welcome-enable
					data-label-idle="<?php echo esc_attr( $enable ); ?>"
					data-label-busy="<?php echo esc_attr( $enabling ); ?>"
				>
					<?php echo esc_html( $enable ); ?>
				</button>
			</div>
		</div>
	</div>
</div>
<script id="os-welcome-script">
( function () {
	var root = document.querySelector( '.os-welcome' );
	if ( ! root ) {
		return;
	}
	var cfg = {
		url:       <?php echo wp_json_encode( $rest_url ); ?>,
		nonce:     <?php echo wp_json_encode( $rest_nonce ); ?>,
		slug:      <?php echo wp_json_encode( $slug ); ?>,
		ajaxUrl:   <?php echo wp_json_encode( $ajax_url ); ?>,
		ajaxNonce: <?php echo wp_json_encode( $ajax_nonce ); ?>,
	};

	document.body.classList.add( 'os-welcome-open' );

	// The shell answers Cmd+K and Ctrl+K alike; show the one this keyboard has.
	var shortcut = root.querySelector( '[data-os-welcome-shortcut]' );
	if ( shortcut && ! /Mac|iPhone|iPad|iPod/.test( navigator.platform || navigator.userAgent ) ) {
		shortcut.textContent = 'Ctrl K';
	}

	// Focus the primary CTA so keyboard users land somewhere meaningful.
	var primary = root.querySelector( '[data-os-welcome-enable]' )
		|| root.querySelector( '[data-os-welcome-cta]' );
	if ( primary ) {
		try { primary.focus( { preventScroll: true } ); } catch ( e ) {}
	}

	function close() {
		if ( ! root || ! root.parentNode ) {
			return;
		}
		root.parentNode.removeChild( root );
		document.body.classList.remove( 'os-welcome-open' );
		document.removeEventListener( 'keydown', onKey );
	}

	// Rebuilds an absolute URL onto the origin the admin page was actually
	// loaded from. `rest_url()` / `admin_url()` are pinned to `site_url()`,
	// but the admin may be viewed through a different origin — a reverse
	// proxy, a Flexible-SSL edge, a mapped multisite domain, or simply an
	// HTTPS dev proxy in front of an HTTP site. POSTing the *absolute*
	// site_url URL from such a page is cross-origin (and mixed-content when
	// the page is HTTPS and site_url is HTTP); the browser blocks it, the
	// dismissal never reaches the server, and the dialog re-renders on every
	// page load. Reissuing the request to `window.location.origin` keeps it
	// same-origin — where the logged-in cookie (domain-scoped, not
	// port-scoped) and the `wp_rest` nonce (session-bound, origin-agnostic)
	// are both valid.
	function sameOrigin( url ) {
		try {
			var parsed = new URL( url, window.location.href );
			return window.location.origin + parsed.pathname + parsed.search;
		} catch ( e ) {
			return url;
		}
	}

	function persist() {
		// Fire-and-forget. The seen-intros endpoint always returns the
		// post-mutation list, but we don't need it here; if the request
		// fails (offline, REST disabled) the dialog will simply show
		// again next page load — exactly the behavior a user would
		// expect from a "save my dismissal" call that didn't reach the
		// server.
		var url     = sameOrigin( cfg.url );
		var payload = JSON.stringify( { slug: cfg.slug } );

		// Prefer `navigator.sendBeacon`: it is queued by the browser and
		// survives the navigation that "Switch to OpenStation" triggers
		// without the keepalive caveats, and it is inherently
		// same-origin-credentialed. The `wp_rest` nonce rides along as
		// `_wpnonce` (REST cookie auth reads it from `$_REQUEST`), and the
		// Blob's `application/json` type lets the REST server parse the
		// `slug` body param.
		try {
			if ( navigator.sendBeacon ) {
				var beaconUrl = url +
					( url.indexOf( '?' ) === -1 ? '?' : '&' ) +
					'_wpnonce=' + encodeURIComponent( cfg.nonce );
				var blob = new Blob( [ payload ], { type: 'application/json' } );
				if ( navigator.sendBeacon( beaconUrl, blob ) ) {
					return;
				}
			}
		} catch ( e ) {}

		// Fallback: `keepalive: true` keeps the POST alive across the
		// "Switch to OpenStation" redirect on browsers without sendBeacon.
		try {
			var headers = { 'Content-Type': 'application/json' };
			if ( cfg.nonce ) {
				headers[ 'X-WP-Nonce' ] = cfg.nonce;
			}
			fetch( url, {
				method: 'POST',
				credentials: 'same-origin',
				keepalive: true,
				headers: headers,
				body: payload,
			} ).catch( function () {} );
		} catch ( e ) {}
	}

	function dismiss() {
		persist();
		close();
	}

	var enabling = false;

	function enableNow( btn ) {
		if ( enabling ) {
			return;
		}
		enabling = true;
		var idle = btn.getAttribute( 'data-label-idle' ) || btn.textContent;
		var busy = btn.getAttribute( 'data-label-busy' ) || idle;
		btn.disabled = true;
		btn.textContent = busy;

		// Persist the dismissal in parallel — even if the AJAX save fails
		// the user explicitly asked to turn the mode on, so they don't
		// need to see the welcome again.
		persist();

		var form = new FormData();
		form.append( 'action', 'save-openstation' );
		form.append( 'nonce', cfg.ajaxNonce );
		form.append( 'enabled', '1' );

		fetch( sameOrigin( cfg.ajaxUrl ), {
			method: 'POST',
			credentials: 'same-origin',
			body: form,
		} ).then( function ( r ) {
			return r.json().catch( function () { return null; } );
		} ).then( function ( data ) {
			var redirect = data && data.success && data.data && data.data.redirect
				? data.data.redirect
				: null;
			if ( redirect ) {
				window.location.href = redirect;
				return;
			}
			// Fallback — reload so the shell takes over (the AJAX endpoint
			// already wrote the user meta, so this request will boot
			// straight into OpenStation via the portal flow).
			window.location.reload();
		} ).catch( function () {
			enabling = false;
			btn.disabled = false;
			btn.textContent = idle;
		} );
	}

	root.addEventListener( 'click', function ( event ) {
		var target = event.target;
		if ( ! ( target instanceof Element ) ) {
			return;
		}
		var enableBtn = target.closest( '[data-os-welcome-enable]' );
		if ( enableBtn ) {
			event.preventDefault();
			enableNow( enableBtn );
			return;
		}
		if ( target.closest( '[data-os-welcome-cta]' ) ) {
			event.preventDefault();
			dismiss();
			return;
		}
		// Backdrop click — outside the card.
		if ( target === root ) {
			event.preventDefault();
			dismiss();
		}
	} );

	function onKey( event ) {
		if ( event.key === 'Escape' || event.key === 'Esc' ) {
			event.preventDefault();
			dismiss();
		}
	}
	document.addEventListener( 'keydown', onKey );
} )();
</script>
	<?php
}
add_action( 'admin_footer', 'openstation_render_welcome_dialog' );
