<script lang="ts">
  type Props = { name: string; size?: number };
  const { name, size = 20 }: Props = $props();
</script>

<span
  class="icon"
  aria-hidden="true"
  style="--icon-url: url('/icons/{name}.svg'); width: {size}px; height: {size}px"
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
