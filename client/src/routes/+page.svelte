<script>
  import { onMount, onDestroy } from 'svelte';
  import { Map, deserializeMap } from "../../../dataframe.js";

  /* websocket setup */
  const wsurl = 'ws://localhost:48829';
  let socket;

  /* canvas setup */
  let canvas;
  let ctx;

  function draw() {
    if (!ctx) return;

    /* Clear canvas */
    ctx.fillStyle = '#19191e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /* dataframe render setup */
  let map = null;

  /* onMount and onDestroy lifecycle hooks */
  const commands = [
    {
      prefix: "map",
      action: (send, args) => {
        map = deserializeMap(args[0]);
        draw();
      }
    }
  ];

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
      const data = event.data.split('\t');
      const prefix = data[0];
      const args = data.slice(1);

      for (const command of commands) {
        if (command.prefix === prefix) {
          command.action(socket.send.bind(socket), args);
          break;
        }
      }
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
