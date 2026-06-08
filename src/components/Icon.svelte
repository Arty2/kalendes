<script lang="ts">
  import { ICON_URLS } from '../lib/icons';
  type Props = { name: string; size?: number };
  const { name, size = 20 }: Props = $props();
  const iconUrl = $derived(ICON_URLS[name] ?? '');
</script>

<span
  class="icon"
  aria-hidden="true"
  style="--icon-url: {iconUrl}; width: {size}px; height: {size}px"
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
