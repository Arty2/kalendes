<script lang="ts">
  import { emojiRuns, titleGlyphs } from '../lib/event-display';

  // A calendar's name for display: emoji runs opt out of the name face's
  // font-size-adjust (--name-x-height), which sizes by x-height and would
  // shrink them, as the emoji face's x-height is near its full height.
  let { name }: { name: string } = $props();
  const runs = $derived(emojiRuns(titleGlyphs(name)));
</script>

{#each runs as run, i (i)}{#if run.emoji}<span class="emoji">{run.text}</span>{:else}{run.text}{/if}{/each}

<style>
  .emoji {
    font-size-adjust: none;
  }
</style>
