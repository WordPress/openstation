/**
 * `<wpd-stack>` — shadow-DOM styles.
 *
 * `--wpd-stack-gap` + `--wpd-stack-align` are writable by callers
 * either through the attribute (via the component's `render`
 * setter) or by any ancestor that set the custom property — lets a
 * theme dial the entire stack rhythm without a component-level
 * override.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --wpd-stack-gap, 12px );
		align-items: var( --wpd-stack-align, stretch );
		padding: var( --wpd-stack-padding, 0 );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
