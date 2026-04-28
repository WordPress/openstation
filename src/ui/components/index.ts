/**
 * wpd-ui components barrel.
 *
 * Importing this file side-effect-registers every component in the
 * first batch with `customElements.define()`. After this import,
 * any `<wpd-*>` tag in the DOM upgrades automatically.
 *
 * Each component lives in its own folder with co-located styles
 * (`*.styles.ts`) and tests (`*.test.ts`), so a future refactor of
 * one component doesn't require touching any shared file.
 */

export { WpdSection } from './wpd-section/wpd-section';
export { WpdButton } from './wpd-button/wpd-button';
export { WpdSwatch } from './wpd-swatch/wpd-swatch';
export { WpdSwatchGrid } from './wpd-swatch-grid/wpd-swatch-grid';
export { WpdSegmented, WpdSegment } from './wpd-segmented/wpd-segmented';
export { WpdSelect, WpdOption } from './wpd-select/wpd-select';
export { WpdColorField } from './wpd-color-field/wpd-color-field';
export { WpdRangeField } from './wpd-range-field/wpd-range-field';
export { WpdTextField } from './wpd-text-field/wpd-text-field';
export { WpdNumberField } from './wpd-number-field/wpd-number-field';
export { WpdCheckbox } from './wpd-checkbox/wpd-checkbox';
export { WpdCheckboxLabel } from './wpd-checkbox-label/wpd-checkbox-label';
export { WpdToast, WpdToastContainer } from './wpd-toast/wpd-toast';
export { WpdTabs, WpdTab, WpdTabPanel } from './wpd-tabs/wpd-tabs';
export { WpdWindowButton } from './wpd-window-button/wpd-window-button';
export { WpdMenu, WpdMenuItem } from './wpd-menu/wpd-menu';
export { WpdTabChip } from './wpd-tab-chip/wpd-tab-chip';
export { WpdStack } from './wpd-stack/wpd-stack';
export { WpdCluster } from './wpd-cluster/wpd-cluster';
export { WpdIcon } from './wpd-icon/wpd-icon';
export { WpdBody } from './wpd-body/wpd-body';
export { WpdPanel } from './wpd-panel/wpd-panel';
export { WpdRow } from './wpd-row/wpd-row';
export { WpdGrid } from './wpd-grid/wpd-grid';
export { WpdDisplay } from './wpd-display/wpd-display';
export { WpdEmptyState } from './wpd-empty-state/wpd-empty-state';
export { WpdKey } from './wpd-key/wpd-key';
export { WpdCode } from './wpd-code/wpd-code';
export { WpdBadge } from './wpd-badge/wpd-badge';
export type { WpdBadgeTone } from './wpd-badge/wpd-badge';
export { WpdLog } from './wpd-log/wpd-log';
export type { WpdLogRowRenderer } from './wpd-log/wpd-log';
export { WpdSteps, WpdStep } from './wpd-steps/wpd-steps';
export { WpdTable } from './wpd-table/wpd-table';
export type {
	WpdTableColumn,
	WpdTableFilters,
	WpdTableGetRowId,
	WpdTableRowId,
	WpdTableSort,
	WpdTableSubTableFn,
	WpdTableSubTableResult,
} from './wpd-table/wpd-table';
export { WpdSpinner, WPD_SPINNER_PRESETS } from './wpd-spinner/wpd-spinner';
export type {
	WpdSpinnerConfig,
	WpdSpinnerPreset,
	WpdSpinnerPulse,
} from './wpd-spinner/wpd-spinner';

// List of tags registered by this barrel. `doAction(
// COMPONENTS_REGISTERED, { tags } )` fires once from
// `src/desktop.ts` after the module graph settles, so
// subscribers needing to defer work until every `<wpd-*>` is
// callable have a single signal to latch onto.
export const WPD_COMPONENT_TAGS = [
	'wpd-section',
	'wpd-button',
	'wpd-swatch',
	'wpd-swatch-grid',
	'wpd-segmented',
	'wpd-segment',
	'wpd-select',
	'wpd-option',
	'wpd-color-field',
	'wpd-range-field',
	'wpd-text-field',
	'wpd-number-field',
	'wpd-checkbox',
	'wpd-checkbox-label',
	'wpd-toast',
	'wpd-toast-container',
	'wpd-tabs',
	'wpd-tab',
	'wpd-tabpanel',
	'wpd-window-button',
	'wpd-menu',
	'wpd-menu-item',
	'wpd-tab-chip',
	'wpd-stack',
	'wpd-cluster',
	'wpd-icon',
	'wpd-body',
	'wpd-panel',
	'wpd-row',
	'wpd-grid',
	'wpd-display',
	'wpd-empty-state',
	'wpd-key',
	'wpd-code',
	'wpd-badge',
	'wpd-log',
	'wpd-steps',
	'wpd-step',
	'wpd-table',
	'wpd-spinner',
] as const;
