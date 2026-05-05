import { css } from '../../core';

/**
 * Styles for `<wpd-multiselect>`.
 *
 * Two surfaces share this stylesheet:
 *   - The trigger button (lives inside the component's shadow DOM).
 *   - The popover (rendered into `document.body` so it escapes any
 *     overflow-clipping ancestor).
 *
 * The popover rules are scoped via `:host` from the multi-select's
 * shadow stylesheet and ALSO via `:where(...)` from the global rule
 * below — the popover lives outside the shadow tree so it can't
 * inherit through `:host`. We append a global rule via the same
 * `css` template tag so plugin authors don't need to import another
 * stylesheet to make the popover paint.
 */

export const multiselectStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --desktop-mode-text, #1d2327 );
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-multiselect__label {
		font-size: 12px;
		color: var( --desktop-mode-muted, #646970 );
	}

	.wpd-multiselect__trigger {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		min-width: 0;
		padding: 7px 12px 7px 12px;
		background: rgba( 0, 0, 0, 0.05 );
		border: 1px solid transparent;
		border-radius: 7px;
		font: inherit;
		font-size: 13px;
		color: var( --desktop-mode-text, #1d2327 );
		cursor: pointer;
		text-align: start;
		transition: background-color 0.12s ease, border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	.wpd-multiselect__trigger:hover {
		background: rgba( 0, 0, 0, 0.08 );
	}

	.wpd-multiselect__trigger:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}

	.wpd-multiselect__trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.wpd-multiselect__trigger[ data-active='true' ] {
		color: var( --wp-admin-theme-color, #2271b1 );
		font-weight: 600;
	}

	.wpd-multiselect__summary {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wpd-multiselect__chevron {
		color: var( --desktop-mode-muted, #646970 );
		flex-shrink: 0;
		transition: color 0.12s ease, transform 0.18s ease;
	}

	.wpd-multiselect__trigger:hover .wpd-multiselect__chevron,
	.wpd-multiselect__trigger:focus-visible .wpd-multiselect__chevron {
		color: var( --desktop-mode-text, #1d2327 );
	}

	:host( [ open ] ) .wpd-multiselect__chevron {
		transform: rotate( 180deg );
	}
`;

/**
 * Global popover styles. Appended once at module-evaluation time so
 * a popover element appended to `document.body` paints correctly
 * even though it lives outside the multi-select's shadow tree. The
 * style element is idempotent — re-importing the module doesn't
 * stack duplicates.
 */
function _installGlobalPopoverStyles(): void {
	const STYLE_ID = 'wpd-multiselect-popover-styles';
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = `
.wpd-multiselect__popover {
	position: fixed;
	z-index: 100000;
	max-height: 320px;
	overflow-y: auto;
	min-width: 200px;
	padding: 4px 0;
	background: var( --desktop-mode-window-bg, #fff );
	color: var( --desktop-mode-text, #1d2327 );
	border: 1px solid var( --desktop-mode-window-border, #c3c4c7 );
	border-radius: 8px;
	box-shadow: 0 8px 28px rgba( 0, 0, 0, 0.18 );
	font: inherit;
	font-size: 13px;
}

.wpd-multiselect__clear {
	display: block;
	width: 100%;
	padding: 6px 12px;
	font: inherit;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	text-align: start;
	border: 0;
	border-bottom: 1px solid var( --desktop-mode-window-border, #dcdcde );
	background: transparent;
	color: var( --wp-admin-theme-color, #2271b1 );
	cursor: pointer;
}

.wpd-multiselect__clear:hover {
	background: color-mix(
		in srgb,
		var( --wp-admin-theme-color, #2271b1 ) 10%,
		transparent
	);
}

.wpd-multiselect__option {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	cursor: pointer;
	user-select: none;
}

.wpd-multiselect__option:hover {
	background: rgba( 0, 0, 0, 0.05 );
}

.wpd-multiselect__option[ data-disabled='true' ] {
	opacity: 0.5;
	cursor: not-allowed;
}

.wpd-multiselect__option > span {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.wpd-multiselect__option > input[ type='checkbox' ] {
	margin: 0;
	flex-shrink: 0;
	accent-color: var( --wp-admin-theme-color, #2271b1 );
}

.wpd-multiselect__empty {
	padding: 8px 12px;
	color: var( --desktop-mode-muted, #646970 );
	font-style: italic;
}

.wpd-multiselect__loading {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	color: var( --desktop-mode-muted, #646970 );
	font-size: 12px;
}

.wpd-multiselect__spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	border: 2px solid currentColor;
	border-top-color: transparent;
	animation: wpd-multiselect-spin 0.8s linear infinite;
}

@keyframes wpd-multiselect-spin {
	to { transform: rotate( 360deg ); }
}
`;
	document.head.appendChild( style );
}

if ( typeof document !== 'undefined' ) {
	_installGlobalPopoverStyles();
}
