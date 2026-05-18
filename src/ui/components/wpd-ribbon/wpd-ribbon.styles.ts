/**
 * `<wpd-ribbon>` — diagonal corner banner.
 *
 * The host is a square `overflow: hidden` window pinned to the chosen
 * corner of its (positioned) parent. Inside, a wider `.banner` strip
 * is rotated 45° so the visible slice reads as a ribbon wrapping the
 * corner. The wrapper geometry — width, banner offset — is sized via
 * CSS custom properties so plugin authors can tune sizes without
 * forking the styles.
 *
 * Why a separate wrapper + banner element rather than a single
 * rotated element: clipping. The `overflow: hidden` on the host is
 * what cuts the strip's overhang into a triangular outline. Rotating
 * the host directly leaves a rectangle floating off the corner.
 *
 * Logical-property positioning (`inset-inline-*`, `inset-block-*`)
 * does the LTR/RTL flip on the wrapper for free. The 45° rotation,
 * however, has no inline-aware variant — we explicitly flip the
 * rotation sign under `[dir='rtl']` so the visual band still leans
 * "downward-into-the-card" rather than backward.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		position: absolute;
		width: var( --wpd-ribbon-size, 90px );
		height: var( --wpd-ribbon-size, 90px );
		overflow: hidden;
		pointer-events: none;
		z-index: var( --wpd-ribbon-z, 2 );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.banner {
		position: absolute;
		display: block;
		width: var( --wpd-ribbon-banner-width, 140px );
		padding: var( --wpd-ribbon-padding, 4px 0 );
		text-align: center;
		font: var(
			--wpd-ribbon-font,
			700 10px/1.4 var( --desktop-mode-font, system-ui )
		);
		letter-spacing: var( --wpd-ribbon-tracking, 0.06em );
		text-transform: uppercase;
		color: var( --wpd-ribbon-fg, #fff );
		background: var(
			--wpd-ribbon-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		box-shadow: var(
			--wpd-ribbon-shadow,
			0 2px 4px rgba( 0, 0, 0, 0.2 )
		);
	}

	/* ─── Placement: top-end (default) ───────────────────────────────
	   Wrapper pinned to the top-inline-end corner. Banner translates
	   into the wrapper diagonally so its visible slice reads
	   left-to-right going upward in LTR. */
	:host( :not( [ placement ] ) ),
	:host( [ placement='top-end' ] ) {
		inset-block-start: 0;
		inset-inline-end: 0;
	}
	:host( :not( [ placement ] ) ) .banner,
	:host( [ placement='top-end' ] ) .banner {
		inset-block-start: var( --wpd-ribbon-banner-offset, 20px );
		inset-inline-end: var( --wpd-ribbon-banner-pull, -36px );
		transform: rotate( 45deg );
	}

	/* ─── Placement: top-start ───────────────────────────────────── */
	:host( [ placement='top-start' ] ) {
		inset-block-start: 0;
		inset-inline-start: 0;
	}
	:host( [ placement='top-start' ] ) .banner {
		inset-block-start: var( --wpd-ribbon-banner-offset, 20px );
		inset-inline-start: var( --wpd-ribbon-banner-pull, -36px );
		transform: rotate( -45deg );
	}

	/* ─── Placement: bottom-end ──────────────────────────────────── */
	:host( [ placement='bottom-end' ] ) {
		inset-block-end: 0;
		inset-inline-end: 0;
	}
	:host( [ placement='bottom-end' ] ) .banner {
		inset-block-end: var( --wpd-ribbon-banner-offset, 20px );
		inset-inline-end: var( --wpd-ribbon-banner-pull, -36px );
		transform: rotate( -45deg );
	}

	/* ─── Placement: bottom-start ────────────────────────────────── */
	:host( [ placement='bottom-start' ] ) {
		inset-block-end: 0;
		inset-inline-start: 0;
	}
	:host( [ placement='bottom-start' ] ) .banner {
		inset-block-end: var( --wpd-ribbon-banner-offset, 20px );
		inset-inline-start: var( --wpd-ribbon-banner-pull, -36px );
		transform: rotate( 45deg );
	}

	/* RTL: flip the rotation sign so the diagonal still hugs the
	   physical corner the user sees. \`inset-inline-*\` already takes
	   care of the wrapper position itself. */
	:host-context( [ dir='rtl' ] ):host( :not( [ placement ] ) ) .banner,
	:host-context( [ dir='rtl' ] ):host( [ placement='top-end' ] ) .banner {
		transform: rotate( -45deg );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='top-start' ] ) .banner {
		transform: rotate( 45deg );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='bottom-end' ] ) .banner {
		transform: rotate( 45deg );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='bottom-start' ] ) .banner {
		transform: rotate( -45deg );
	}

	/* ─── Tones ──────────────────────────────────────────────────────
	   Match \`<wpd-badge>\`'s palette so the two surfaces feel like a
	   set. Default (no tone, or \`primary\`) uses the admin theme
	   accent so the ribbon picks up per-scheme tints automatically. */
	:host( [ tone='success' ] ) .banner {
		background: var( --wpd-ribbon-success, #1a7f37 );
	}
	:host( [ tone='warning' ] ) .banner {
		background: var( --wpd-ribbon-warning, #9a6700 );
	}
	:host( [ tone='danger' ] ) .banner {
		background: var( --wpd-ribbon-danger, #cf222e );
	}
	:host( [ tone='info' ] ) .banner {
		background: var( --wpd-ribbon-info, #0969da );
	}
	:host( [ tone='neutral' ] ) .banner {
		background: var( --wpd-ribbon-neutral, #57606a );
	}
`;
