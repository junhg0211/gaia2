<script>
  import Layer from "$lib/components/Layer.svelte";
  import { onMount, onDestroy } from 'svelte';
  import { mapFromJSON, Color } from "../../../dataframe.js";
  import "bootstrap-icons/font/bootstrap-icons.css";

  /* websocket setup */
  const wsurl = 'ws://localhost:48829';
  let socket;

  const protocol = [
    {
      prefix: "map",
      action: (send, args) => {
        map = mapFromJSON(JSON.parse(args[0]));
        selectColor(map.layer.colors[0]);
        draw();
        render();
      }
    },
    {
      prefix: "newcolor",
      action: (send, args) => {
        const layerId = parseInt(args[0]);
        const colorName = args[1];
        const colorValue = args[2];

        const layer = map.getLayerById(layerId);
        if (!layer) return;
        const newColor = new Color(colorName, colorValue, layer);
        layer.colors.push(newColor);
        rerender();
      }
    },
    {
      prefix: 'drawline',
      action: (send, args) => {
        const x0 = parseFloat(args[0]);
        const y0 = parseFloat(args[1]);
        const x1 = parseFloat(args[2]);
        const y1 = parseFloat(args[3]);
        const brushSize = parseFloat(args[4]);
        const colorId = parseInt(args[5]);
        const layer = map.layer;
        const color = map.getColorById(colorId);
        if (!color) return;
        layer.quadtree.drawLine(x0, y0, x1, y1, color.id, brushSize, 10);
        layer.draw();
        render();
      }
    },
  ];

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

    setZoom(zoom) {
      this.zoom = Math.max(1000, Math.min(5000000, zoom));
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
    if (!ctx) return;
    if (!map) return;

    map.draw(ctx, camera, canvas);
  }

  function render() {
    if (!ctx) return;

    /* Clear canvas */
    ctx.fillStyle = '#19191e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* render map */
    if (!map) return;

    map.render(ctx, camera, canvas);

    /* render grid */
    renderGrid();

    if (selectedTool.onrender) {
      selectedTool.onrender(ctx, toolVar);
    }
  }

  /* dataframe render setup */
  let map = null;
  let selectedColor = null;
  let mapRender = false;

  function selectColor(color) {
    selectedColor = color;
  }

  function rerender() {
    mapRender = !mapRender;
  }

  /* event handlers */
  let keys = new Set();
  let mouse = { startX: 0, startY: 0, x: 0, y: 0, buttons: 0 };

  let canvasContainerDiv;
  function onresize() {
    canvas.style.width = `0`;
    canvas.style.height = `0`;

    canvas.style.width = `${canvasContainerDiv.clientWidth}px`;
    canvas.style.height = `${canvasContainerDiv.clientHeight}px`;
    canvas.width = canvasContainerDiv.clientWidth * window.devicePixelRatio;
    canvas.height = canvasContainerDiv.clientHeight * window.devicePixelRatio;
    render();
  }

  function onkeydown(event) {
    keys.add(event.key);

    if (selectedTool.onkeydown) {
      selectedTool.onkeydown(event, toolVar);
    }

    for (const tool of tools) {
      if (event.key === tool.shortcut) {
        selectTool(tool);
        break;
      }
    }
  }

  function onkeyup(event) {
    keys.delete(event.key);

    if (selectedTool.onkeyup) {
      selectedTool.onkeyup(event, toolVar);
    }
  }

  function onmousemove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * window.devicePixelRatio;
    mouse.y = (event.clientY - rect.top) * window.devicePixelRatio;
    mouse.dx = mouse.x - mouse.startX;
    mouse.dy = mouse.y - mouse.startY;

    if (mouse.buttons & 2) {
      const deltaX = (mouse.startX - mouse.x) / camera.zoom;
      const deltaY = (mouse.startY - mouse.y) / camera.zoom;
      camera.x += deltaX;
      camera.y += deltaY;
      mouse.startX = mouse.x;
      mouse.startY = mouse.y;
      render();
    }

    if (selectedTool.onmousemove) {
      selectedTool.onmousemove(event, toolVar);
    }
  }

  function onmousebuttondown(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * window.devicePixelRatio;
    mouse.y = (event.clientY - rect.top) * window.devicePixelRatio;
    mouse.startX = mouse.x;
    mouse.startY = mouse.y;
    mouse.buttons |= (1 << event.button);

    if (selectedTool.onmousebuttondown) {
      selectedTool.onmousebuttondown(event, toolVar);
    }
  }

  function onmousebuttonup(event) {
    mouse.buttons &= ~(1 << event.button);

    if (selectedTool.onmousebuttonup) {
      selectedTool.onmousebuttonup(event, toolVar);
    }
  }

  function onwheel(event) {
    const normalDelta = event.deltaX + event.deltaY;
    const [dx, dy] = [mouse.x - canvas.width / 2, mouse.y - canvas.height / 2];
    const [mouseWorldX, mouseWorldY] = camera.screenToWorld(mouse.x, mouse.y);
    camera.x = mouseWorldX;
    camera.y = mouseWorldY;
    camera.setZoom(camera.zoom * Math.exp(-normalDelta / 1000));
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    render();
  }

  /* tools */
  let selectedTool = {};
  const toolVar = {};
  const tools = [
    {
      name: '커서',
      shortcut: 'v',
      icon: 'cursor',
      onstart: () => {},
      onend: () => {},
      onmousemove: () => {},
      onmousebuttondown: () => {},
      onmousebuttonup: () => {},
      onkeyup: () => {},
      onkeydown: () => {},
      onrender: () => {},
    },
    {
      name: '브러시',
      shortcut: 'b',
      icon: 'brush',
      onstart: () => {
        canvas.style.cursor = 'crosshair';
        toolVar.brushSize = toolVar.brushSize ? toolVar.brushSize : 0.01;
      },
      onend: () => {
        canvas.style.cursor = 'default';
      },
      onmousemove: (e) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        if (toolVar.isDrawing) {
          const [x0, y0] = camera.screenToWorld(mouse.x, mouse.y);
          const [x1, y1] = camera.screenToWorld(toolVar.previousMouseX, toolVar.previousMouseY);
          socket.send(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${toolVar.brushSize}\t${selectedColor.id}\t${10}`);
        }

        toolVar.previousMouseX = mouse.x;
        toolVar.previousMouseY = mouse.y;
        render();
      },
      onmousebuttondown: (e) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        toolVar.isDrawing = true;
      },
      onmousebuttonup: () => {
        toolVar.isDrawing = false;
      },
      onkeyup: (e) => {
        if (e.key === '[') {
          toolVar.brushSize *= 0.9;
        }
        if (e.key === ']') {
          toolVar.brushSize *= 1.1;
        }
        render();
      },
      onkeydown: () => {},
      onrender: () => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        ctx.strokeStyle = selectedColor.hex;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, toolVar.brushSize * camera.zoom / window.devicePixelRatio, 0, 2 * Math.PI);
        ctx.stroke();
      },
    },
  ];

  function selectTool(tool) {
    if (tool instanceof Object) {
      if (selectedTool.onend) {
        selectedTool.onend(toolVar);
      }
      selectedTool = tool;
      render();
      if (selectedTool.onstart) {
        selectedTool.onstart(toolVar);
      }
      return;
    }

    const foundTool = tools.find(t => t.name === tool);
    if (!foundTool) {
      return;
    }

    if (selectedTool.onend) {
      selectedTool.onend(toolVar);
    }

    selectedTool = foundTool;
    render();

    if (selectedTool.onstart) {
      selectedTool.onstart(toolVar);
    }
  }

  selectTool(tools[0]);

  /* onMount and onDestroy lifecycle hooks */
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
    canvas.addEventListener('mousemove', onmousemove);
    canvas.addEventListener('mousedown', onmousebuttondown);
    canvas.addEventListener('mouseup', onmousebuttonup);
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
  <div class="toolbar">
    {#each tools as tool}
      <button
          class="tool-button"
          disabled={selectedTool.name === tool.name}
          on:click={() => selectTool(tool)}
          title="{tool.name} ({tool.shortcut})"
      >
        <i class="bi bi-{tool.icon}"></i>
      </button>
    {/each}
  </div>
  <div class="canvas-container">
    <canvas id="canvas"></canvas>
  </div>
  <div class="properties-container">
    {#if map}
      {#key mapRender}
        <Layer layer={map.layer} {socket} {selectedColor} {selectColor} {rerender} />
      {/key}
    {/if}
  </div>
</div>

<style>
  .main-container {
    display: flex;
    height: 100vh;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }

  .tool-button {
    background: none;
    border: none;
    color: white;
    font-size: 24px;
    padding: 10px;
    cursor: pointer;
  }

  .tool-button:hover {
    background-color: #333333;
  }

  .tool-button:disabled {
    color: #555555;
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
    padding: 8px;
  }
</style>
