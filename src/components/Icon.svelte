<script lang="ts">
  import { ICON_URLS } from '../lib/icons';
  // A number is px; a string is any CSS length (e.g. one tracking the text).
  type Props = { name: string; size?: number | string };
  const { name, size = 20 }: Props = $props();
  const iconUrl = $derived(ICON_URLS[name] ?? '');
  const length = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<span
  class="icon"
  aria-hidden="true"
  style="--icon-url: {iconUrl}; width: {length}; height: {length}"
></span>

<style>
  .icon {
    display: inline-block;
    background-color: currentColor;
    -webkit-mask: var(--icon-url) no-repeat center / contain;
    mask: var(--icon-url) no-repeat center / contain;
    flex-shrink: 0;
  }
</style>
