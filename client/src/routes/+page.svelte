<script>
  import { onMount, onDestroy } from 'svelte';
  import { Map, mapFromJSON } from "../../../dataframe.js";

  /* websocket setup */
  const wsurl = 'ws://localhost:48829';
  let socket;

  /* canvas setup */
  let canvas;
  let ctx;

  class Camera {
    constructor(x = 0.5, y = 0.5, zoom = 1000) {
      this.x = x;
      this.y = y;
      this.zoom = zoom;
    }

    worldToScreen(worldX, worldY) {
      const screenX = (worldX - this.x) * this.zoom + canvas.width / 2;
      const screenY = (worldY - this.y) * this.zoom + canvas.height / 2;
      return [screenX, screenY];
    }

    screenToWorld(screenX, screenY) {
      const worldX = (screenX - canvas.width / 2) / this.zoom + this.x;
      const worldY = (screenY - canvas.height / 2) / this.zoom + this.y;
      return [worldX, worldY];
    }
  }

  let camera = new Camera();

  function draw() {
    if (!ctx) return;

    /* Clear canvas */
    ctx.fillStyle = '#19191e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* draw map */
    if (map !== null) {
      map.draw(ctx, camera, canvas);
    }
  }

  /* dataframe render setup */
  let map = null;

  /* onMount and onDestroy lifecycle hooks */
  const commands = [
    {
      prefix: "map",
      action: (send, args) => {
        map = mapFromJSON(JSON.parse(args[0]));
        draw();
      }
    }
  ];

  onMount(() => {
    /* Initialize canvas */
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;

    draw();

    /* Initialize WebSocket */
    socket = new WebSocket(wsurl);

    socket.addEventListener('open', () => {
      socket.send("load");
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

    socket.addEventListener('close', () => { });
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
