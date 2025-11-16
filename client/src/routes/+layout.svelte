<script>
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
  <style>
    body, html {
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
  </style>
</svelte:head>

{@render children()}
