import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex: 1 1 auto;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}
	:host( [ hidden ] ) { display: none; }
	.layout {
		display: grid;
		flex: 1;
		min-inline-size: 0;
		min-block-size: 0;
		grid-template-columns: minmax( 0, var( --_split-start, 35% ) ) auto minmax( 0, 1fr );
		grid-template-rows: minmax( 0, 1fr );
	}
	.pane {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
	}
	::slotted( * ) { flex: 1 1 auto; min-inline-size: 0; min-block-size: 0; }
	.divider { inline-size: 0; outline: none; }
	.divider.enabled {
		position: relative;
		inline-size: 8px;
		cursor: col-resize;
		touch-action: none;
		user-select: none;
	}
	/* A narrow visual seam inside the full pointer target. */
	.divider.enabled::before, .divider.enabled::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		margin-inline: auto;
		inset-block-start: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		transition: background-color 120ms ease;
	}
	.divider.enabled::before {
		inline-size: 1px;
		block-size: 100%;
		background: var( --os-ui-border, #dcdcde );
		opacity: 0.65;
	}
	.divider.enabled::after {
		inline-size: 3px;
		block-size: 28px;
		border-radius: 999px;
		background: var( --os-ui-fg-faint, #787c82 );
	}
	.divider.enabled:hover::after, .divider.dragging::after, .divider:focus-visible::after {
		background: var( --os-ui-accent, #2271b1 );
	}
	.divider:focus-visible {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: -2px;
		border-radius: 4px;
	}
	:host( [ direction='vertical' ] ) .layout {
		grid-template-columns: minmax( 0, 1fr );
		grid-template-rows: minmax( 0, var( --_split-start, 35% ) ) auto minmax( 0, 1fr );
	}
	:host( [ direction='vertical' ] ) .divider.enabled {
		inline-size: auto;
		block-size: 8px;
		cursor: row-resize;
	}
	:host( [ direction='vertical' ] ) .divider.enabled::before { inline-size: 100%; block-size: 1px; }
	:host( [ direction='vertical' ] ) .divider.enabled::after { inline-size: 28px; block-size: 3px; }
	:host .layout.compact { grid-template-columns: minmax( 0, 1fr ); grid-template-rows: minmax( 0, 1fr ) minmax( 0, 1fr ); }
	.layout.compact .divider { display: none; }
	:host .layout.compact.start, :host .layout.compact.end { grid-template-rows: minmax( 0, 1fr ); }
	.layout.compact.start .end, .layout.compact.end .start { display: none; }
	.shield { position: fixed; inset: 0; z-index: 2147483647; cursor: col-resize; }
	:host( [ direction='vertical' ] ) .shield { cursor: row-resize; }
	.shield[hidden] { display: none; }
	@media ( prefers-reduced-motion: reduce ) {
		.divider.enabled::before, .divider.enabled::after { transition: none; }
	}
`;
