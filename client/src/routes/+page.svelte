<script>
  import { onMount, onDestroy } from 'svelte';

  /* websocket setup */
  const wsurl = 'ws://localhost:48829';
  let socket;
  let messages = [];

  /* canvas setup */
  let canvas;
  let ctx;

  function draw() {
    if (!ctx) return;

    /* Clear canvas */
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /* onMount and onDestroy lifecycle hooks */
  onMount(() => {
    /* Initialize canvas */
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;

    draw();

    /* Initialize WebSocket */
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
  <canvas id="canvas"></canvas>
</div>
