<?php
/**
 * Desktop Mode — First-run welcome dialog.
 *
 * Renders a one-time, self-contained modal inside the *classic* WordPress
 * admin (never inside the desktop shell or a chromeless iframe) telling
 * the user where the "Switch to Desktop Mode" button lives in the admin
 * bar. Dismissal is persisted via the existing seen-intros registry
 * (`desktop_mode_seen_intros` user meta, slug `activation-welcome`),
 * which means the "Reset what's-new dialogs" button in OS Settings →
 * Features brings it back exactly like every other intro dialog.
 *
 * The dialog is intentionally self-contained — all HTML, CSS and JS are
 * inlined into `admin_footer`. We deliberately do NOT use any of the
 * `<wpd-*>` shell components here because they only ship inside the
 * desktop bundle, which is precisely *not* loaded on the classic admin
 * screens where this dialog is allowed to appear.
 *
 * @package Desktop_Mode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` for this dialog. */
const DESKTOP_MODE_WELCOME_INTRO_SLUG = 'activation-welcome';

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
 * 4. Desktop Mode is NOT already enabled for the user. This is a
 *    "switch to Desktop Mode" promo, so it has nothing to say once the
 *    user is in the shell. The desktop shell's *parent* page is admin
 *    context and is not chromeless, so without this gate the dialog
 *    re-renders there the moment the user clicks "Enable it now" — read
 *    as a duplicate dialog, because the fire-and-forget seen-intro POST
 *    races the redirect into the shell and often loses.
 * 5. The user has not already dismissed this intro.
 * 6. The `desktop_mode_show_welcome_dialog` filter returns truthy, so
 *    sites can suppress the dialog entirely (e.g. managed-host onboarding
 *    flows that ship their own).
 *
 * @since 0.8.2
 *
 * @return bool
 */
function desktop_mode_should_show_welcome_dialog() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return false;
	}
	if ( ! current_user_can( 'read' ) ) {
		return false;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return false;
	}
	if ( function_exists( 'desktop_mode_is_enabled' ) && desktop_mode_is_enabled() ) {
		return false;
	}
	$user_id = get_current_user_id();
	if ( desktop_mode_has_seen_intro( $user_id, DESKTOP_MODE_WELCOME_INTRO_SLUG ) ) {
		return false;
	}

	/**
	 * Filters whether the first-run welcome dialog should render for
	 * the current user on the current request. All earlier gates
	 * (admin context, capability, chromeless, seen-state) have
	 * already passed by the time this filter fires.
	 *
	 * @since 0.8.2
	 *
	 * @param bool $show    Whether to render the dialog. Default true.
	 * @param int  $user_id Current user ID.
	 */
	return (bool) apply_filters( 'desktop_mode_show_welcome_dialog', true, $user_id );
}

/**
 * Prints the welcome dialog markup, styles and dismiss script into
 * `admin_footer`.
 *
 * Self-contained on purpose: everything is scoped under the
 * `.desktop-mode-welcome` namespace so it cannot collide with the host
 * admin theme. The dismiss button POSTs to the seen-intros REST route,
 * which is exactly the same endpoint the in-shell intros use.
 *
 * @since 0.8.2
 */
function desktop_mode_render_welcome_dialog() {
	if ( ! desktop_mode_should_show_welcome_dialog() ) {
		return;
	}

	$rest_url    = esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) );
	$rest_nonce  = wp_create_nonce( 'wp_rest' );
	$ajax_url    = esc_url_raw( admin_url( 'admin-ajax.php' ) );
	$ajax_nonce  = wp_create_nonce( 'save-desktop-mode' );
	$slug        = DESKTOP_MODE_WELCOME_INTRO_SLUG;

	// All user-facing strings are passed through translation; the dialog
	// is keyboard-dismissible (Escape) and moves initial focus to the
	// primary CTA.
	$title    = __( 'Welcome to Desktop Mode', 'desktop-mode' );
	$subtitle = __( 'A floating, window-based workspace for the WordPress admin — more like a real OS, less like a webpage.', 'desktop-mode' );
	$body     = __( 'Desktop Mode reimagines the WordPress admin as a true desktop environment. Open multiple admin screens side-by-side, drag and drop content between windows, and keep your work in view as you move between tasks.', 'desktop-mode' );
	$cta      = __( 'Got it', 'desktop-mode' );
	$enable   = __( 'Enable it now', 'desktop-mode' );
	$enabling = __( 'Enabling…', 'desktop-mode' );
	$close_a  = __( 'Close', 'desktop-mode' );

	$features = array(
		array(
			'icon'  => '🪟',
			'title' => __( 'Multi-window workspace', 'desktop-mode' ),
			'desc'  => __( 'Open Posts, Media and Plugins in their own draggable, resizable windows. Tile, cascade or stack them however you work best.', 'desktop-mode' ),
		),
		array(
			'icon'  => '⚡',
			'title' => __( 'Native, table-driven apps', 'desktop-mode' ),
			'desc'  => __( 'Posts, Pages, Users and Plugins are reimplemented as fast native windows with sticky headers, bulk actions, multi-select and inline previews.', 'desktop-mode' ),
		),
		array(
			'icon'  => '🎨',
			'title' => __( 'Wallpapers, dock & themes', 'desktop-mode' ),
			'desc'  => __( 'Make it yours. Choose a wallpaper, pin your favorite screens to the dock, and switch accent colors — all from OS Settings.', 'desktop-mode' ),
		),
		array(
			'icon'  => '🤖',
			'title' => __( 'AI Copilot, built in', 'desktop-mode' ),
			'desc'  => __( 'Press ⌘K anywhere to ask the AI Assistant — it can run commands, navigate windows and answer questions about your site.', 'desktop-mode' ),
		),
	);
	?>
<style id="desktop-mode-welcome-style">
	.desktop-mode-welcome,
	.desktop-mode-welcome * {
		box-sizing: border-box;
	}
	.desktop-mode-welcome {
		position: fixed;
		inset: 0;
		z-index: 100000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: radial-gradient(
				ellipse at 30% 20%,
				rgba( 56, 189, 248, 0.32 ),
				transparent 60%
			),
			radial-gradient(
				ellipse at 70% 80%,
				rgba( 16, 185, 129, 0.26 ),
				transparent 55%
			),
			rgba( 8, 14, 26, 0.62 );
		backdrop-filter: blur( 14px ) saturate( 140% );
		-webkit-backdrop-filter: blur( 14px ) saturate( 140% );
		animation: desktop-mode-welcome-fade 360ms cubic-bezier( 0.22, 1, 0.36, 1 );
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
			"Helvetica Neue", Arial, sans-serif;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}
	@keyframes desktop-mode-welcome-fade {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
	@keyframes desktop-mode-welcome-pop {
		0%   { opacity: 0; transform: translateY( 14px ) scale( 0.96 ); }
		100% { opacity: 1; transform: translateY( 0 ) scale( 1 ); }
	}
	@keyframes desktop-mode-welcome-arrow {
		0%, 100% { transform: translateX( 0 ); opacity: 0.85; }
		50%      { transform: translateX( 6px ); opacity: 1; }
	}
	@keyframes desktop-mode-welcome-shimmer {
		0%   { background-position: 0% 50%; }
		100% { background-position: 200% 50%; }
	}
	.desktop-mode-welcome__card {
		position: relative;
		width: 100%;
		max-width: 760px;
		border-radius: 22px;
		overflow: hidden;
		background: linear-gradient(
			145deg,
			rgba( 255, 255, 255, 0.98 ) 0%,
			rgba( 244, 250, 253, 0.98 ) 100%
		);
		box-shadow:
			0 1px 0 rgba( 255, 255, 255, 0.85 ) inset,
			0 30px 60px -20px rgba( 8, 47, 73, 0.55 ),
			0 18px 36px -18px rgba( 14, 165, 233, 0.45 );
		animation: desktop-mode-welcome-pop 460ms cubic-bezier( 0.22, 1, 0.36, 1 ) both;
		animation-delay: 60ms;
	}
	.desktop-mode-welcome__card::before {
		content: "";
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(
			135deg,
			rgba( 14, 165, 233, 0.65 ),
			rgba( 6, 182, 212, 0.55 ),
			rgba( 16, 185, 129, 0.55 )
		);
		-webkit-mask: linear-gradient( #000 0 0 ) content-box,
			linear-gradient( #000 0 0 );
		-webkit-mask-composite: xor;
		        mask-composite: exclude;
		pointer-events: none;
	}
	.desktop-mode-welcome__hero {
		position: relative;
		padding: 36px 36px 24px;
		background: linear-gradient(
			135deg,
			#0f172a 0%,
			#0e7490 45%,
			#06b6d4 100%
		);
		background-size: 200% 200%;
		animation: desktop-mode-welcome-shimmer 14s ease infinite alternate;
		color: #fff;
		overflow: hidden;
	}
	.desktop-mode-welcome__hero::after {
		content: "";
		position: absolute;
		inset: 0;
		background:
			radial-gradient( circle at 85% 15%, rgba( 56, 189, 248, 0.35 ), transparent 45% ),
			radial-gradient( circle at 15% 90%, rgba( 16, 185, 129, 0.22 ), transparent 50% ),
			linear-gradient( rgba( 255, 255, 255, 0.05 ) 1px, transparent 1px ) 0 0 / 28px 28px,
			linear-gradient( 90deg, rgba( 255, 255, 255, 0.05 ) 1px, transparent 1px ) 0 0 / 28px 28px;
		pointer-events: none;
		mask-image: radial-gradient( ellipse at 50% 40%, #000 35%, transparent 80% );
		-webkit-mask-image: radial-gradient( ellipse at 50% 40%, #000 35%, transparent 80% );
	}
	.desktop-mode-welcome__eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #fff;
		background: rgba( 255, 255, 255, 0.18 );
		border: 1px solid rgba( 255, 255, 255, 0.28 );
		border-radius: 999px;
		backdrop-filter: blur( 6px );
		-webkit-backdrop-filter: blur( 6px );
	}
	.desktop-mode-welcome__eyebrow-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #22d3ee;
		box-shadow: 0 0 0 4px rgba( 34, 211, 238, 0.28 );
	}
	.desktop-mode-welcome__title {
		margin: 14px 0 6px;
		font-size: 26px;
		line-height: 1.2;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: #fff;
	}
	.desktop-mode-welcome__subtitle {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: rgba( 255, 255, 255, 0.85 );
	}
	.desktop-mode-welcome__body {
		padding: 24px 36px 24px;
		font-size: 14.5px;
		line-height: 1.6;
		color: #1f2937;
	}
	.desktop-mode-welcome__lede {
		margin: 0;
		font-size: 14.5px;
		color: #374151;
	}
	.desktop-mode-welcome__features {
		display: grid;
		grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
		gap: 14px;
		margin: 20px 0 0;
		padding: 0;
		list-style: none;
	}
	.desktop-mode-welcome__feature {
		position: relative;
		padding: 14px 14px 14px 52px;
		background: linear-gradient(
			145deg,
			rgba( 255, 255, 255, 0.85 ),
			rgba( 240, 249, 255, 0.85 )
		);
		border: 1px solid rgba( 14, 165, 233, 0.18 );
		border-radius: 12px;
		box-shadow: 0 1px 0 rgba( 255, 255, 255, 0.9 ) inset,
			0 2px 6px -2px rgba( 8, 47, 73, 0.08 );
	}
	.desktop-mode-welcome__feature-icon {
		position: absolute;
		top: 12px;
		left: 12px;
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9px;
		background: linear-gradient( 135deg, rgba( 14, 165, 233, 0.16 ), rgba( 16, 185, 129, 0.16 ) );
		border: 1px solid rgba( 14, 165, 233, 0.22 );
		font-size: 16px;
		line-height: 1;
	}
	.desktop-mode-welcome__feature-title {
		display: block;
		margin: 0 0 2px;
		font-size: 13.5px;
		font-weight: 700;
		color: #0f172a;
	}
	.desktop-mode-welcome__feature-desc {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: #475569;
	}
	.desktop-mode-welcome__hint {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 18px 0 0;
		padding: 14px 16px;
		background: linear-gradient(
			135deg,
			rgba( 14, 165, 233, 0.08 ),
			rgba( 16, 185, 129, 0.08 )
		);
		border: 1px solid rgba( 14, 165, 233, 0.22 );
		border-radius: 12px;
		font-size: 13.5px;
		color: #0c4a6e;
	}
	.desktop-mode-welcome__hint-icon {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient( 135deg, #0ea5e9, #06b6d4 );
		color: #fff;
		font-size: 14px;
		line-height: 1;
		animation: desktop-mode-welcome-arrow 1.8s ease-in-out infinite;
	}
	.desktop-mode-welcome__hint-icon::before {
		content: "→";
		font-weight: 700;
	}
	.desktop-mode-welcome__hint code {
		display: inline-block;
		padding: 2px 6px;
		margin: 0 2px;
		background: rgba( 255, 255, 255, 0.85 );
		border: 1px solid rgba( 14, 165, 233, 0.28 );
		border-radius: 5px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		color: #0369a1;
	}
	.desktop-mode-welcome__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 0 36px 28px;
	}
	.desktop-mode-welcome__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 38px;
		padding: 8px 18px;
		font-size: 14px;
		font-weight: 600;
		font-family: inherit;
		line-height: 1;
		border-radius: 10px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: transform 120ms ease, box-shadow 120ms ease,
			background 120ms ease, color 120ms ease;
	}
	.desktop-mode-welcome__btn:focus-visible {
		outline: 2px solid #0ea5e9;
		outline-offset: 2px;
	}
	.desktop-mode-welcome__btn--ghost {
		background: transparent;
		color: #475569;
		border-color: transparent;
	}
	.desktop-mode-welcome__btn--ghost:hover {
		background: rgba( 15, 23, 42, 0.06 );
		color: #0f172a;
	}
	.desktop-mode-welcome__btn--secondary {
		color: #0369a1;
		background: rgba( 14, 165, 233, 0.10 );
		border-color: rgba( 14, 165, 233, 0.28 );
	}
	.desktop-mode-welcome__btn--secondary:hover {
		background: rgba( 14, 165, 233, 0.16 );
		color: #075985;
	}
	.desktop-mode-welcome__btn--primary {
		color: #fff;
		background: linear-gradient( 135deg, #0369a1, #0ea5e9 55%, #06b6d4 );
		background-size: 180% 180%;
		box-shadow: 0 10px 24px -10px rgba( 14, 165, 233, 0.75 ),
			0 4px 10px -4px rgba( 6, 182, 212, 0.55 );
	}
	.desktop-mode-welcome__btn--primary:hover {
		transform: translateY( -1px );
		background-position: 100% 50%;
		box-shadow: 0 14px 30px -12px rgba( 14, 165, 233, 0.85 ),
			0 6px 14px -4px rgba( 6, 182, 212, 0.65 );
	}
	.desktop-mode-welcome__btn--primary:active {
		transform: translateY( 0 );
	}
	.desktop-mode-welcome__btn[disabled] {
		opacity: 0.65;
		cursor: progress;
	}
	.desktop-mode-welcome__close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		background: rgba( 255, 255, 255, 0.18 );
		color: #fff;
		border: 1px solid rgba( 255, 255, 255, 0.25 );
		border-radius: 50%;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		transition: background 120ms ease, transform 120ms ease;
	}
	.desktop-mode-welcome__close:hover {
		background: rgba( 255, 255, 255, 0.32 );
		transform: rotate( 90deg );
	}
	.desktop-mode-welcome__close:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	body.desktop-mode-welcome-open {
		overflow: hidden;
	}
	@media ( max-width: 760px ) {
		.desktop-mode-welcome__features {
			grid-template-columns: 1fr;
		}
	}
	@media ( max-width: 600px ) {
		.desktop-mode-welcome__hero {
			padding: 28px 24px 20px;
		}
		.desktop-mode-welcome__body,
		.desktop-mode-welcome__actions {
			padding-left: 24px;
			padding-right: 24px;
		}
		.desktop-mode-welcome__title {
			font-size: 22px;
		}
		.desktop-mode-welcome__actions {
			flex-direction: column-reverse;
			align-items: stretch;
		}
		.desktop-mode-welcome__btn {
			width: 100%;
		}
	}
	@media ( prefers-reduced-motion: reduce ) {
		.desktop-mode-welcome,
		.desktop-mode-welcome__card,
		.desktop-mode-welcome__hero,
		.desktop-mode-welcome__hint-icon {
			animation: none !important;
		}
	}
</style>
<div
	class="desktop-mode-welcome"
	role="dialog"
	aria-modal="true"
	aria-labelledby="desktop-mode-welcome-title"
	aria-describedby="desktop-mode-welcome-desc"
	data-slug="<?php echo esc_attr( $slug ); ?>"
>
	<div class="desktop-mode-welcome__card">
		<button
			type="button"
			class="desktop-mode-welcome__close"
			aria-label="<?php echo esc_attr( $close_a ); ?>"
			data-desktop-mode-welcome-dismiss
		>&times;</button>
		<div class="desktop-mode-welcome__hero">
			<span class="desktop-mode-welcome__eyebrow">
				<span class="desktop-mode-welcome__eyebrow-dot" aria-hidden="true"></span>
				<?php echo esc_html__( 'New here', 'desktop-mode' ); ?>
			</span>
			<h2 id="desktop-mode-welcome-title" class="desktop-mode-welcome__title">
				<?php echo esc_html( $title ); ?>
			</h2>
			<p class="desktop-mode-welcome__subtitle">
				<?php echo esc_html( $subtitle ); ?>
			</p>
		</div>
		<div class="desktop-mode-welcome__body">
			<p id="desktop-mode-welcome-desc" class="desktop-mode-welcome__lede">
				<?php echo esc_html( $body ); ?>
			</p>
			<ul class="desktop-mode-welcome__features">
				<?php foreach ( $features as $feature ) : ?>
					<li class="desktop-mode-welcome__feature">
						<span class="desktop-mode-welcome__feature-icon" aria-hidden="true">
							<?php echo esc_html( $feature['icon'] ); ?>
						</span>
						<strong class="desktop-mode-welcome__feature-title">
							<?php echo esc_html( $feature['title'] ); ?>
						</strong>
						<p class="desktop-mode-welcome__feature-desc">
							<?php echo esc_html( $feature['desc'] ); ?>
						</p>
					</li>
				<?php endforeach; ?>
			</ul>
			<p class="desktop-mode-welcome__hint">
				<span class="desktop-mode-welcome__hint-icon" aria-hidden="true"></span>
				<?php
				printf(
					/* translators: %s: the label of the admin bar button. */
					esc_html__( 'Prefer to switch yourself? Click %s in the top-right of your admin bar.', 'desktop-mode' ),
					'<code>' . esc_html__( 'Switch to Desktop Mode', 'desktop-mode' ) . '</code>'
				);
				?>
			</p>
		</div>
		<div class="desktop-mode-welcome__actions">
			<button
				type="button"
				class="desktop-mode-welcome__btn desktop-mode-welcome__btn--secondary"
				data-desktop-mode-welcome-cta
			>
				<?php echo esc_html( $cta ); ?>
			</button>
			<button
				type="button"
				class="desktop-mode-welcome__btn desktop-mode-welcome__btn--primary"
				data-desktop-mode-welcome-enable
				data-label-idle="<?php echo esc_attr( $enable ); ?>"
				data-label-busy="<?php echo esc_attr( $enabling ); ?>"
			>
				<?php echo esc_html( $enable ); ?>
			</button>
		</div>
	</div>
</div>
<script id="desktop-mode-welcome-script">
( function () {
	var root = document.querySelector( '.desktop-mode-welcome' );
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

	document.body.classList.add( 'desktop-mode-welcome-open' );

	// Focus the primary CTA so keyboard users land somewhere meaningful.
	var primary = root.querySelector( '[data-desktop-mode-welcome-enable]' )
		|| root.querySelector( '[data-desktop-mode-welcome-cta]' );
	if ( primary ) {
		try { primary.focus( { preventScroll: true } ); } catch ( e ) {}
	}

	function close() {
		if ( ! root || ! root.parentNode ) {
			return;
		}
		root.parentNode.removeChild( root );
		document.body.classList.remove( 'desktop-mode-welcome-open' );
		document.removeEventListener( 'keydown', onKey );
	}

	function persist() {
		// Fire-and-forget. The seen-intros endpoint always returns the
		// post-mutation list, but we don't need it here; if the request
		// fails (offline, REST disabled) the dialog will simply show
		// again next page load — exactly the behavior a user would
		// expect from a "save my dismissal" call that didn't reach the
		// server.
		//
		// `keepalive: true` keeps the POST alive across the navigation
		// that "Enable it now" triggers — otherwise the redirect into the
		// shell can abort the in-flight request and the dismissal is lost.
		// (The `desktop_mode_is_enabled()` gate already stops the dialog
		// re-rendering in the shell, but this keeps the seen-state correct
		// for the classic admin too, e.g. if the user switches back.)
		try {
			var headers = { 'Content-Type': 'application/json' };
			if ( cfg.nonce ) {
				headers[ 'X-WP-Nonce' ] = cfg.nonce;
			}
			fetch( cfg.url, {
				method: 'POST',
				credentials: 'same-origin',
				keepalive: true,
				headers: headers,
				body: JSON.stringify( { slug: cfg.slug } ),
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
		form.append( 'action', 'save-desktop-mode' );
		form.append( 'nonce', cfg.ajaxNonce );
		form.append( 'enabled', '1' );

		fetch( cfg.ajaxUrl, {
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
			// straight into Desktop Mode via the portal flow).
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
		var enableBtn = target.closest( '[data-desktop-mode-welcome-enable]' );
		if ( enableBtn ) {
			event.preventDefault();
			enableNow( enableBtn );
			return;
		}
		if ( target.closest( '[data-desktop-mode-welcome-dismiss]' ) ||
			target.closest( '[data-desktop-mode-welcome-cta]' ) ) {
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
add_action( 'admin_footer', 'desktop_mode_render_welcome_dialog' );
