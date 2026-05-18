import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		--wpd-progress-track-bg: var(
			--desktop-mode-control-bg,
			rgba( 0, 0, 0, 0.08 )
		);
		--wpd-progress-fill: var(
			--wp-admin-theme-color,
			#2271b1
		);
		--wpd-progress-height: 6px;
		--wpd-progress-radius: 999px;
		--wpd-progress-label-color: inherit;
		--wpd-progress-label-size: 12px;
		--wpd-progress-label-gap: 4px;
		width: 100%;
		font: inherit;
		color: var( --wpd-progress-label-color );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: var( --wpd-progress-label-gap );
		font-size: var( --wpd-progress-label-size );
		line-height: 1.3;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.percent {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
		flex-shrink: 0;
	}

	.track {
		position: relative;
		width: 100%;
		height: var( --wpd-progress-height );
		background: var( --wpd-progress-track-bg );
		border-radius: var( --wpd-progress-radius );
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 0;
		background: var( --wpd-progress-fill );
		border-radius: inherit;
		transition: width 0.18s ease-out;
	}

	/* Tone modifiers — same custom-property surface. */
	:host( [ tone='success' ] ) {
		--wpd-progress-fill: var(
			--desktop-mode-status-success,
			#3a8a3a
		);
	}
	:host( [ tone='warning' ] ) {
		--wpd-progress-fill: var(
			--desktop-mode-status-warning,
			#dba617
		);
	}
	:host( [ tone='danger' ] ) {
		--wpd-progress-fill: var(
			--desktop-mode-status-danger,
			#d63638
		);
	}

	/* Indeterminate — sweeping bar across the track. */
	:host( [ indeterminate ] ) .fill {
		width: 33%;
		animation: wpd-progress-sweep 1.1s linear infinite;
		transition: none;
	}

	@keyframes wpd-progress-sweep {
		0% {
			transform: translateX( -120% );
		}
		100% {
			transform: translateX( 320% );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		.fill {
			transition: none;
		}
		:host( [ indeterminate ] ) .fill {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
`;
