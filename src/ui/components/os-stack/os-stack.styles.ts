/**
 * `<os-stack>` — shadow-DOM styles.
 *
 * `--os-ui-stack-gap` + `--os-ui-stack-align` are writable by callers
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
		gap: var( --os-ui-stack-gap, 12px );
		align-items: var( --os-ui-stack-align, stretch );
		padding: var( --os-ui-stack-padding, 0 );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
