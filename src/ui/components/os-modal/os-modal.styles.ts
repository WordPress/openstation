import { css } from '../../core';
import { holoTokens } from '../../holo';

export const modalStyles = css`
	${ holoTokens }

	:host {
		display: none;
		position: fixed;
		inset: 0;
		align-items: center;
		justify-content: center;
		background: var( --os-ui-scrim, rgba( 0, 0, 0, 0.45 ) );

		background-image: var( --os-ui-scrim-image, none );
		background-repeat: var( --os-ui-scrim-image-repeat, repeat );
		background-size: var( --os-ui-scrim-image-size, auto );
		background-position: var( --os-ui-scrim-image-position, center );
		backdrop-filter: blur( 2px );
		z-index: 10000;

		--os-ui-fg: var( --os-ui-modal-text, #f0f0f1 );
		--os-ui-fg-muted: var( --os-ui-modal-text-muted, #a7aaad );
		--os-ui-border: var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );

		--os-window-bg: var( --os-ui-modal-field-bg, #2c3338 );

		--os-ui-button-bg-hover: var(
			--os-ui-modal-button-bg-hover,
			rgba( 255, 255, 255, 0.08 )
		);

		--os-ui-surface: var( --os-ui-modal-surface, #2c3338 );
		--os-ui-surface-elevated: var(
			--os-ui-modal-surface-elevated,
			#3c434a
		);
		--os-ui-border-strong: var(
			--os-ui-modal-border-strong,
			rgba( 255, 255, 255, 0.35 )
		);

		--os-ui-hover: var( --os-ui-modal-hover, rgba( 255, 255, 255, 0.08 ) );

		--os-ui-notice-color: var( --os-ui-modal-text, #f0f0f1 );

		--os-ui-card-bg: var( --os-ui-modal-surface, #2c3338 );
		--os-ui-card-fg: var( --os-ui-modal-text, #f0f0f1 );
		--os-ui-card-border: var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
		--os-ui-card-border-hover: var(
			--os-ui-modal-border-strong,
			rgba( 255, 255, 255, 0.35 )
		);
	}

	:host( [ open ] ) {
		display: flex;
		animation: os-modal-scrim var( --_holo-t ) var( --_holo-ease );
	}

	:host( [ open ] ) .dialog {
		animation: os-modal-dialog var( --_holo-t ) var( --_holo-spring );
	}

	@keyframes os-modal-scrim {
		from {
			opacity: 0;
		}
	}

	@keyframes os-modal-dialog {
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
		max-width: 92vw;
		max-height: 90vh;

		background-color: var( --os-ui-modal-bg, #1d2327 );

		background-image: var( --os-ui-dialog-bg-image, none );
		background-repeat: var( --os-ui-dialog-bg-image-repeat, repeat );
		background-size: var( --os-ui-dialog-bg-image-size, auto );
		background-position: var( --os-ui-dialog-bg-image-position, center );
		color: var( --os-ui-modal-fg, var( --os-fg, #fff ) );
		border: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 10px;
		box-shadow: 0 20px 50px rgba( 0, 0, 0, 0.6 );
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:host( [ size='sm' ] ) .dialog {
		width: min( 360px, 92vw );
	}

	:host( :not( [ size ] ) ) .dialog,
	:host( [ size='md' ] ) .dialog {
		width: min( 540px, 92vw );
	}

	:host( [ size='lg' ] ) .dialog {
		width: min( 760px, 94vw );
	}

	.header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.06 ) );
	}

	.title {
		margin: 0;
		flex: 1;
		font-size: 15px;
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		gap: 6px;
	}
	.header-actions ::slotted( * ) {
		margin-inline-start: 6px;
	}

	.close {
		background: transparent;
		border: 0;
		color: inherit;
		font-size: 18px;
		line-height: 1;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		opacity: 0.7;
	}
	.close:hover {
		opacity: 1;
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.08 ) );
	}

	.body {
		padding: 16px 20px;
		overflow: auto;
		flex: 1 1 auto;
		font-size: 13px;
		line-height: 1.5;
	}

	.footer {
		padding: 12px 20px 16px;
		border-top: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.06 ) );
	}

	.footer slot {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}

	:host( [ mandatory ] ) .close {
		display: none;
	}
`;
