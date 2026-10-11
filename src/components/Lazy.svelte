<script lang="ts" generics="P extends Record<string, any>">
  // Mounts a code-split component (see lib/lazy-components.ts) the first time
  // `when` turns true, then keeps it mounted — the dialogs gate themselves on
  // ui state, so they still need to see it go false to close.
  import { untrack, type Component } from 'svelte';
  import { loadComponent, resolvedComponent } from '../lib/lazy-components';

  type Props = {
    when: boolean;
    load: () => Promise<{ default: Component<P> }>;
    props?: P;
  };
  const { when, load, props = {} as P }: Props = $props();

  // Already-fetched (a remount) renders synchronously, with no blank frame.
  let Loaded = $state<Component<P> | null>(
    untrack(() => resolvedComponent(load) as Component<P> | undefined) ?? null,
  );
  let pending = false;
  $effect(() => {
    if (!when || Loaded || pending) return;
    pending = true;
    loadComponent(load)
      .then((c) => {
        Loaded = c as Component<P>;
      })
      .catch(() => {
        // Let the next open retry (main.ts reloads on a stale-deploy chunk error).
      })
      .finally(() => {
        pending = false;
      });
  });
</script>

{#if Loaded}
  <Loaded {...props} />
{/if}
