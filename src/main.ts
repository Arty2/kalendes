import { mount } from 'svelte';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';

const target = document.getElementById('app');
if (!target) throw new Error('No #app element');

mount(App, { target });

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}
