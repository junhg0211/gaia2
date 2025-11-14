<script>
  import { onMount, onDestroy } from 'svelte';

  const wsurl = 'ws://localhost:48829';
  let socket;
  let messages = [];

  let input;

  onMount(() => {
    socket = new WebSocket(wsurl);

    socket.addEventListener('open', () => {
      console.log('WebSocket connection established');
    });

    socket.addEventListener('message', (event) => {
      messages = [...messages, event.data];
    });

    socket.addEventListener('close', () => {
      console.log('WebSocket connection closed');
    });
  });

  onDestroy(() => {
    if (socket) {
      socket.close();
    }
  });
</script>

<div>
  <h2>WebSocket Messages:</h2>
  <ul>
    {#each messages as message}
      <li>{message}</li>
    {/each}
  </ul>
</div>

<input type="text" bind:this={input} />
<button on:click={() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(input.value);
    input.value = '';
  }
  }}>Send</button>
