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

    isBoxOutsideViewbox(x1, y1, x2, y2) {
      const [screenX1, screenY1] = this.worldToScreen(x1, y1);
      const [screenX2, screenY2] = this.worldToScreen(x2, y2);
      return (screenX2 < 0 || screenX1 > canvas.width || screenY2 < 0 || screenY1 > canvas.height);
    }
  }

  let camera = new Camera();

  function renderGrid() {
    const gridUnit = 1;
    ctx.strokeStyle = '#777777';
    ctx.lineWidth = 1;
    const leftx = camera.worldToScreen(0, 0)[0] % (gridUnit * camera.zoom);
    for (let x = leftx; x < canvas.width; x += gridUnit * camera.zoom) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    const topy = camera.worldToScreen(0, 0)[1] % (gridUnit * camera.zoom);
    for (let y = topy; y < canvas.height; y += gridUnit * camera.zoom) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function draw() {
    map.draw(ctx, camera, canvas);
  }

  function render() {
    if (!ctx) return;

    /* Clear canvas */
    ctx.fillStyle = '#19191e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* render map */
    if (map !== null) {
      map.render(ctx, camera, canvas);
    }

    /* render grid */
    renderGrid();
  }

  /* dataframe render setup */
  let map = null;

  /* event handlers */
  let keys = new Set();
  let mouse = { startX: 0, startY: 0, x: 0, y: 0, buttons: 0 };

  let canvasContainerDiv;
  function onresize() {
    canvas.style.width = `${canvasContainerDiv.clientWidth}px`;
    canvas.style.height = `${canvasContainerDiv.clientHeight}px`;
    canvas.width = canvasContainerDiv.clientWidth * window.devicePixelRatio;
    canvas.height = canvasContainerDiv.clientHeight * window.devicePixelRatio;
    render();
  }

  function onkeydown(event) {
    keys.add(event.key);
  }

  function onkeyup(event) {
    keys.delete(event.key);
  }

  function onmousemove(event) {
    mouse.x = event.clientX * window.devicePixelRatio;
    mouse.y = event.clientY * window.devicePixelRatio;

    if (mouse.buttons & 2) {
      const deltaX = (mouse.startX - mouse.x) / camera.zoom;
      const deltaY = (mouse.startY - mouse.y) / camera.zoom;
      camera.x += deltaX;
      camera.y += deltaY;
      mouse.startX = mouse.x;
      mouse.startY = mouse.y;
      render();
    }
  }

  function onmousebuttondown(event) {
    mouse.startX = event.clientX * window.devicePixelRatio;
    mouse.startY = event.clientY * window.devicePixelRatio;
    mouse.buttons |= (1 << event.button);

    if (mouse.buttons & 2) {
      canvas.style.cursor = 'grabbing';
    }
  }

  function onmousebuttonup(event) {
    mouse.buttons &= ~(1 << event.button);

    if (!(mouse.buttons & 2)) {
      canvas.style.cursor = 'default';
    }
  }

  function onwheel(event) {
    const normalDelta = event.deltaX + event.deltaY;
    const [dx, dy] = [mouse.x - canvas.width / 2, mouse.y - canvas.height / 2];
    const [mouseWorldX, mouseWorldY] = camera.screenToWorld(mouse.x, mouse.y);
    camera.x = mouseWorldX;
    camera.y = mouseWorldY;
    camera.zoom *= Math.exp(-normalDelta / 1000);
    camera.zoom = Math.max(1000, Math.min(5000000, camera.zoom));
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    render();
  }

  /* onMount and onDestroy lifecycle hooks */
  const protocol = [
    {
      prefix: "map",
      action: (send, args) => {
        map = mapFromJSON(JSON.parse(args[0]));
        draw();
        render();
      }
    }
  ];

  onMount(() => {
    /* Initialize canvas */
    canvasContainerDiv = document.querySelector('.canvas-container');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    onresize();

    /* event handling */
    window.addEventListener('resize', onresize);
    window.addEventListener('keydown', onkeydown);
    window.addEventListener('keyup', onkeyup);
    window.addEventListener('mousemove', onmousemove);
    window.addEventListener('mousedown', onmousebuttondown);
    window.addEventListener('mouseup', onmousebuttonup);
    window.addEventListener('wheel', onwheel);

    /* Initialize WebSocket */
    socket = new WebSocket(wsurl);

    socket.addEventListener('open', () => {
      socket.send("load");
    });

    socket.addEventListener('message', (event) => {
      const data = event.data.split('\t');
      const prefix = data[0];
      const args = data.slice(1);

      for (const command of protocol) {
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

<div class="main-container">
  <div class="toolbar">툴바</div>
  <div class="canvas-container">
    <canvas id="canvas"></canvas>
  </div>
  <div class="properties-container">속성</div>
</div>

<style>
  .main-container {
    display: flex;
    height: 100vh;
  }

  .toolbar {
    width: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .canvas-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .properties-container {
    width: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
