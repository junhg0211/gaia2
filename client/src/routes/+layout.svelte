<script>
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
  <style>
    @font-face {
      font-family: 'unifont';
      src: url("/fonts/unifont-17.0.03.otf") format('truetype');
      font-weight: normal;
      font-style: normal;
    }

    body, html {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #2c2c2c;
      color: white;
      font-family: 'unifont', monospace;
    }

    button, input, select, textarea {
      font-family: 'unifont', monospace;
    }
  </style>
</svelte:head>

{@render children()}
