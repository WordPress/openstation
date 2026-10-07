import { css } from '../../core';
import { holoTokens, holoShimmer } from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoShimmer }

	:host {
		display: block;
		--_track-bg: var(
			--os-ui-progress-track-bg,
			var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.08 ) )
		);
		--_fill: var(
			--os-ui-progress-fill,
			var( --wp-admin-theme-color, #2271b1 )
		);
		--_height: var( --os-ui-progress-height, 6px );
		--_radius: var( --os-ui-progress-radius, 999px );
		--_label-color: var( --os-ui-progress-label-color, inherit );
		--_label-size: var( --os-ui-progress-label-size, 12px );
		--_label-gap: var( --os-ui-progress-label-gap, 4px );
		width: 100%;
		font: inherit;
		color: var( --_label-color );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: var( --_label-gap );
		font-size: var( --_label-size );
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
		height: var( --_height );
		background: var( --_track-bg );
		border-radius: var( --_radius );
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 0;
		background: var( --_fill );
		border-radius: inherit;
		transition: width 0.18s ease-out;
	}

	:host( [ tone='success' ] ) {
		--os-ui-progress-fill: var( --os-ui-success-fg, #3a8a3a );
	}
	:host( [ tone='warning' ] ) {
		--os-ui-progress-fill: var( --os-ui-warning-fg, #dba617 );
	}
	:host( [ tone='danger' ] ) {
		--os-ui-progress-fill: var( --os-ui-danger, #d63638 );
	}

	:host( [ indeterminate ] ) .fill {
		width: 100%;
		transition: none;
		background-image: var( --_fill );
		background-size: 300% 300%;
		background-repeat: no-repeat;
		animation: os-holo-shimmer 2.4s var( --_holo-loop ) infinite;
	}

	:host( [ indeterminate ][ tone ] ) .fill {
		width: 33%;
		background-image: none;
		animation: os-progress-sweep 1.1s linear infinite;
	}

	@keyframes os-progress-sweep {
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
		:host( [ indeterminate ] ) .fill,
		:host( [ indeterminate ][ tone ] ) .fill {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
`;
