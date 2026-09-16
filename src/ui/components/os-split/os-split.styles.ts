import { css } from '../../core';

export const styles = css`
	:host { display: flex; flex: 1 1 auto; min-inline-size: 0; min-block-size: 0; overflow: hidden; }
	:host( [ hidden ] ) { display: none; }
	.layout {
		display: grid; flex: 1; min-inline-size: 0; min-block-size: 0;
		grid-template-columns: minmax( 0, var( --_split-start, 35% ) ) auto minmax( 0, 1fr );
		grid-template-rows: minmax( 0, 1fr );
	}
	.pane { display: flex; flex-direction: column; min-inline-size: 0; min-block-size: 0; overflow: auto; }
	::slotted( * ) { flex: 1 1 auto; min-inline-size: 0; min-block-size: 0; }
	.divider { inline-size: 0; outline: none; }
	.divider.enabled {
		inline-size: 8px; cursor: col-resize; touch-action: none;
		background: var( --os-ui-border, #dcdcde );
	}
	.divider.enabled:hover, .divider:focus-visible { background: var( --os-ui-accent, #2271b1 ); }
	.divider:focus-visible { outline: 2px solid var( --os-ui-accent, #2271b1 ); outline-offset: -2px; }
	:host( [ direction='vertical' ] ) .layout {
		grid-template-columns: minmax( 0, 1fr );
		grid-template-rows: minmax( 0, var( --_split-start, 35% ) ) auto minmax( 0, 1fr );
	}
	:host( [ direction='vertical' ] ) .divider.enabled { inline-size: auto; block-size: 8px; cursor: row-resize; }
	:host .layout.compact { grid-template-columns: minmax( 0, 1fr ); grid-template-rows: minmax( 0, 1fr ) minmax( 0, 1fr ); }
	.layout.compact .divider { display: none; }
	:host .layout.compact.start, :host .layout.compact.end { grid-template-rows: minmax( 0, 1fr ); }
	.layout.compact.start .end, .layout.compact.end .start { display: none; }
	.shield { position: fixed; inset: 0; z-index: 2147483647; cursor: grabbing; }
	.shield[hidden] { display: none; }
`;
