import { css } from '../../core';

export const styles = css`
	:host {
		position: absolute;
		width: var( --os-ui-ribbon-size, 90px );
		height: var( --os-ui-ribbon-size, 90px );
		overflow: hidden;
		pointer-events: none;
		z-index: var( --os-ui-ribbon-z, 2 );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.banner {
		position: absolute;
		display: block;
		width: var( --os-ui-ribbon-banner-width, 140px );
		padding: var( --os-ui-ribbon-padding, 4px 0 );
		text-align: center;
		font: var(
			--os-ui-ribbon-font,
			700 10px/1.4 var( --os-font, system-ui )
		);
		letter-spacing: var( --os-ui-ribbon-tracking, 0.06em );
		text-transform: uppercase;
		color: var( --os-ui-ribbon-fg, var( --os-ui-fg-on-accent, #fff ) );

		background: var(
			--os-ui-ribbon-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		background-size: 260% 260%;
		background-position: 30% 40%;
		box-shadow: var(
			--os-ui-ribbon-shadow,
			0 2px 4px rgba( 0, 0, 0, 0.2 )
		);
	}

	:host( :not( [ placement ] ) ),
	:host( [ placement='top-end' ] ) {
		inset-block-start: 0;
		inset-inline-end: 0;
	}
	:host( :not( [ placement ] ) ) .banner,
	:host( [ placement='top-end' ] ) .banner {
		inset-block-start: var( --os-ui-ribbon-banner-offset, 20px );
		inset-inline-end: var( --os-ui-ribbon-banner-pull, -36px );
		transform: rotate( 45deg );
	}

	:host( [ placement='top-start' ] ) {
		inset-block-start: 0;
		inset-inline-start: 0;
	}
	:host( [ placement='top-start' ] ) .banner {
		inset-block-start: var( --os-ui-ribbon-banner-offset, 20px );
		inset-inline-start: var( --os-ui-ribbon-banner-pull, -36px );
		transform: rotate( -45deg );
	}

	:host( [ placement='bottom-end' ] ) {
		inset-block-end: 0;
		inset-inline-end: 0;
	}
	:host( [ placement='bottom-end' ] ) .banner {
		inset-block-end: var( --os-ui-ribbon-banner-offset, 20px );
		inset-inline-end: var( --os-ui-ribbon-banner-pull, -36px );
		transform: rotate( -45deg );
	}

	:host( [ placement='bottom-start' ] ) {
		inset-block-end: 0;
		inset-inline-start: 0;
	}
	:host( [ placement='bottom-start' ] ) .banner {
		inset-block-end: var( --os-ui-ribbon-banner-offset, 20px );
		inset-inline-start: var( --os-ui-ribbon-banner-pull, -36px );
		transform: rotate( 45deg );
	}

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

	:host( [ tone='success' ] ) .banner {
		background: var( --os-ui-ribbon-success, var( --os-ui-success-fg, #1a7f37 ) );
	}
	:host( [ tone='warning' ] ) .banner {
		background: var( --os-ui-ribbon-warning, var( --os-ui-warning-bg, #9a6700 ) );
	}
	:host( [ tone='danger' ] ) .banner {
		background: var( --os-ui-ribbon-danger, var( --os-ui-danger, #cf222e ) );
	}
	:host( [ tone='info' ] ) .banner {
		background: var( --os-ui-ribbon-info, var( --os-ui-info-bg, #0969da ) );
	}
	:host( [ tone='neutral' ] ) .banner {
		background: var( --os-ui-ribbon-neutral, var( --os-ui-surface, #57606a ) );
	}
`;
