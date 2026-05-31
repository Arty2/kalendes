<script lang="ts">
  import Icon from './Icon.svelte';

  type Props = { size?: number };
  const { size = 12 }: Props = $props();

  const label = 'Local — not synced to a URL';
</script>

<span class="local-badge" title={label} aria-label={label} role="img">
  <Icon name="cloud-off" {size} />
</span>

<style>
  .local-badge {
    display: inline-flex;
    align-items: center;
    opacity: 0.5;
    flex: none;
  }
</style>
