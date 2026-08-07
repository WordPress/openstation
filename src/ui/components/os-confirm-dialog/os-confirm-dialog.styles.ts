import { css } from '../../core';
import { holoTokens } from '../../holo';

export const dialogStyles = css`
	${ holoTokens }

	:host {
		display: none;
		position: fixed;
		inset: 0;
		align-items: center;
		justify-content: center;
		background: var( --os-ui-scrim, rgba( 0, 0, 0, 0.45 ) );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-scrim-image, none );
		background-repeat: var( --os-ui-scrim-image-repeat, repeat );
		background-size: var( --os-ui-scrim-image-size, auto );
		background-position: var( --os-ui-scrim-image-position, center );
		backdrop-filter: blur( 2px );
		z-index: 10000;
	}

	/*
	 * Same arrival as <os-modal>: the scrim fades, the dialog lands on
	 * the spring. Duplicated rather than shared because the two
	 * components have separate shadow roots and separate keyframe
	 * scopes — an @keyframes in one is invisible to the other, so the
	 * only way to share it would be a fragment in src/ui/holo.ts, and
	 * a two-line animation used twice does not earn one.
	 */
	:host( [ open ] ) {
		display: flex;
		animation: os-confirm-scrim var( --_holo-t ) var( --_holo-ease );
	}

	:host( [ open ] ) .dialog {
		animation: os-confirm-dialog var( --_holo-t ) var( --_holo-spring );
	}

	@keyframes os-confirm-scrim {
		from {
			opacity: 0;
		}
	}

	@keyframes os-confirm-dialog {
		from {
			opacity: 0;
			transform: scale( 0.96 ) translateY( 8px );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ open ] ),
		:host( [ open ] ) .dialog {
			animation: none;
		}
	}

	.dialog {
		width: min( 420px, 92vw );
		/* Longhand on purpose: the texture slot below owns
		   background-image, and the shorthand would reset it. The
		   fallback must be a literal colour — --os-bg is the
		   wallpaper token and can hold a gradient, which is invalid as
		   a background-color and would leave the dialog transparent. */
		background-color: var( --os-ui-confirm-dialog-bg, #1d2327 );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-dialog-bg-image, none );
		background-repeat: var( --os-ui-dialog-bg-image-repeat, repeat );
		background-size: var( --os-ui-dialog-bg-image-size, auto );
		background-position: var( --os-ui-dialog-bg-image-position, center );
		color: var( --os-ui-confirm-dialog-fg, var( --os-fg, #fff ) );
		border: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 10px;
		box-shadow: 0 20px 50px rgba( 0, 0, 0, 0.6 );
		padding: 20px 22px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		position: relative;
	}

	.close {
		position: absolute;
		top: 8px;
		right: 10px;
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: var( --os-ui-confirm-dialog-fg-muted, var( --os-ui-fg-muted, rgba( 255, 255, 255, 0.7 ) ) );
		cursor: pointer;
		font-size: 22px;
		line-height: 1;
		padding: 0;
	}
	.close:hover {
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.08 ) );
		color: inherit;
	}

	.title {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 600;
	}

	.message {
		margin: 0;
		color: var( --os-ui-confirm-dialog-fg-muted, var( --os-ui-fg-muted, rgba( 255, 255, 255, 0.7 ) ) );
		line-height: 1.45;
		white-space: pre-line;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 6px;
	}

	.btn {
		border: 0;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 13px;
		cursor: pointer;
		font-weight: 500;
	}

	.btn--secondary {
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.08 ) );
		color: inherit;
	}
	.btn--secondary:hover {
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.14 ) );
	}

	.btn--primary {
		background: var( --wp-admin-theme-color, #2271b1 );
		color: var( --os-ui-fg-on-accent, #fff );
	}
	.btn--primary:hover {
		filter: brightness( 1.08 );
	}

	.btn--danger {
		background: var( --os-ui-danger, #d63638 );
		color: var( --os-ui-fg-on-accent, #fff );
	}
	.btn--danger:hover {
		filter: brightness( 1.08 );
	}
`;
