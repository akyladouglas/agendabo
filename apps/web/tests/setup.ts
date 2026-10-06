/**
 * Setup do Vitest (web). Stub global de <transition>/<transition-group>:
 * happy-dom nao anima, e os wrappers de radix-vue dependem deles.
 */
import { config } from '@vue/test-utils';

config.global.stubs = {
  ...config.global.stubs,
  transition: true,
  'transition-group': true,
};
