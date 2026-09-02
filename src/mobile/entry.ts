/**
 * Phone-layer lazy bundle — entry.
 *
 * Builds `assets/js/mobile[.min].js`. Registers the `<os-*>`
 * components the layer's DOM uses (each `defineComponent` is a
 * no-op when another bundle got there first), then publishes the
 * factory the main bundle's loader awaits.
 *
 * Nothing runs at load beyond that assignment: the shell decides
 * when to `mount()`, and unmounts on the way out of the phone band.
 */
import '../ui/components/os-button/os-button';
import '../ui/components/os-confirm-dialog/os-confirm-dialog';
import '../ui/components/os-context-menu/os-context-menu';
import '../ui/components/os-text-field/os-text-field';
import { mountMobileLayer } from './layer';
import type { MobileApi } from './types';

const factory: MobileApi = {
	mount: mountMobileLayer,
};

window.openStationMobile = factory;
