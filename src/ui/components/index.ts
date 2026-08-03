/**
 * os-ui components barrel.
 *
 * Importing this file side-effect-registers every component in the
 * first batch with `customElements.define()`. After this import,
 * any `<os-*>` tag in the DOM upgrades automatically.
 *
 * Each component lives in its own folder with co-located styles
 * (`*.styles.ts`) and tests (`*.test.ts`), so a future refactor of
 * one component doesn't require touching any shared file.
 */

export { OsSection } from './os-section/os-section';
export { OsButton } from './os-button/os-button';
export { OsSwatch } from './os-swatch/os-swatch';
export { OsSwatchGrid } from './os-swatch-grid/os-swatch-grid';
export { OsSegmented, OsSegment } from './os-segmented/os-segmented';
export { OsSelect, OsOption } from './os-select/os-select';
export { OsMultiselect } from './os-multiselect/os-multiselect';
export { OsColorField } from './os-color-field/os-color-field';
export { OsRangeField } from './os-range-field/os-range-field';
export { OsTextField } from './os-text-field/os-text-field';
export { OsNumberField } from './os-number-field/os-number-field';
export { OsCheckbox } from './os-checkbox/os-checkbox';
export { OsCheckboxLabel } from './os-checkbox-label/os-checkbox-label';
export { OsSwitch } from './os-switch/os-switch';
export { OsToast, OsToastContainer } from './os-toast/os-toast';
export { OsTabs, OsTab, OsTabPanel } from './os-tabs/os-tabs';
export { OsWindowButton } from './os-window-button/os-window-button';
export { OsMenu, OsMenuItem } from './os-menu/os-menu';
export { OsContextMenu, OsContextMenuOption } from './os-context-menu/os-context-menu';
export { OsConfirmDialog, osConfirm } from './os-confirm-dialog/os-confirm-dialog';
export { OsModal } from './os-modal/os-modal';
export { OsUserSearch } from './os-user-search/os-user-search';
export { OsRolePicker } from './os-role-picker/os-role-picker';
export { OsFlyout } from './os-flyout/os-flyout';
export type { OsFlyoutPlacement } from './os-flyout/os-flyout';
export { OsTabChip } from './os-tab-chip/os-tab-chip';
export { OsStack } from './os-stack/os-stack';
export { OsCluster } from './os-cluster/os-cluster';
export { OsIcon } from './os-icon/os-icon';
export { OsBody } from './os-body/os-body';
export { OsPanel } from './os-panel/os-panel';
export { OsRow } from './os-row/os-row';
export { OsGrid } from './os-grid/os-grid';
export { OsDisplay } from './os-display/os-display';
export { OsEmptyState } from './os-empty-state/os-empty-state';
export { OsKey } from './os-key/os-key';
export { OsCode } from './os-code/os-code';
export { OsBadge } from './os-badge/os-badge';
export type { OsBadgeTone } from './os-badge/os-badge';
export { OsRibbon } from './os-ribbon/os-ribbon';
export type { OsRibbonPlacement, OsRibbonTone } from './os-ribbon/os-ribbon';
export { OsTile } from './os-tile/os-tile';
export { OsLog } from './os-log/os-log';
export type { OsLogRowRenderer } from './os-log/os-log';
export { OsSteps, OsStep } from './os-steps/os-steps';
export { OsTable } from './os-table/os-table';
export type {
	OsTableColumn,
	OsTableFilters,
	OsTableGetRowId,
	OsTableRowId,
	OsTableSort,
	OsTableSubTableFn,
	OsTableSubTableResult,
} from './os-table/os-table';
export { OsSpinner, OS_SPINNER_PRESETS } from './os-spinner/os-spinner';
export type {
	OsSpinnerConfig,
	OsSpinnerPreset,
	OsSpinnerPulse,
} from './os-spinner/os-spinner';
export { OsRelativeTime } from './os-relative-time/os-relative-time';
export { OsAvatar } from './os-avatar/os-avatar';
export type { OsAvatarPresence } from './os-avatar/os-avatar';
export { OsTextarea } from './os-textarea/os-textarea';
export { OsChip } from './os-chip/os-chip';
export type { OsChipTone, OsChipSize } from './os-chip/os-chip';
export { OsTagInput } from './os-tag-input/os-tag-input';
export type { OsTagItem } from './os-tag-input/os-tag-input';
export { OsForm } from './os-form/os-form';
export { OsSaveStatus } from './os-save-status/os-save-status';
export type {
	OsSaveStatusPhase,
	OsSaveStatusMode,
	OsSaveStatusLifecycleDetail,
} from './os-save-status/os-save-status';
export { OsCategoryPicker } from './os-category-picker/os-category-picker';
export type { OsCategoryItem } from './os-category-picker/os-category-picker';
export { OsCrumbChain } from './os-crumb-chain/os-crumb-chain';
export type { OsCrumbSegment } from './os-crumb-chain/os-crumb-chain';
export { OsCard } from './os-card/os-card';
export { OsRatingSummary } from './os-rating-summary/os-rating-summary';
export type { OsRatingBuckets } from './os-rating-summary/os-rating-summary';
export { OsNotice } from './os-notice/os-notice';
export type { OsNoticeTone } from './os-notice/os-notice';
export { OsProgressBar } from './os-progress-bar/os-progress-bar';
export type { OsProgressTone } from './os-progress-bar/os-progress-bar';

// List of tags registered by this barrel. Defined in `./tags`
// (the single source of truth, kept side-effect-free so tag-only
// consumers don't drag every component module into their bundle)
// and re-exported here for convenience. `doAction(
// COMPONENTS_REGISTERED, { tags } )` fires once from
// `src/desktop.ts` after the module graph settles, so
// subscribers needing to defer work until every `<os-*>` is
// callable have a single signal to latch onto.
export { OS_COMPONENT_TAGS } from './tags';
