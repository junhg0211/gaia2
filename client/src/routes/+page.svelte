<script lang="ts">
  import Layer from "$lib/components/Layer.svelte";
  import Camera from "$lib/camera";
  import { onMount, onDestroy } from 'svelte';
  import { mapFromJSON, Color, Map, Layer as LayerClass } from "../../../dataframe";
  import "bootstrap-icons/font/bootstrap-icons.css";

  /* websocket setup */
  const wsurl = 'ws://localhost:48829';
  let socket: WebSocket;
  type ProtocolCommand = {
    prefix: string;
    action: (send: (msg: string) => void, args: string[]) => void;
  };

  const protocol: ProtocolCommand[] = [
    {
      prefix: "map",
      action: (_send, args) => {
        map = mapFromJSON(JSON.parse(args[0]));
        selectColor(map.layer.colors[0]);
        draw();
        render();
      }
    },
    {
      prefix: "newcolor",
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const colorName = args[1];
        const colorValue = args[2];

        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        const newColor = new Color(colorName, colorValue, layer);
        layer.colors.push(newColor);
        rerender();
      }
    },
    {
      prefix: "newlayer",
      action: (_send, args) => {
        const parentLayerId = parseInt(args[0]);
        const layerName = args[1];

        const parentLayer = map!.getLayerById(parentLayerId);
        if (!parentLayer) return;
        const newLayer = new LayerClass(layerName, parentLayer);
        parentLayer.children.push(newLayer);
        rerender();
      }
    },
    {
      prefix: 'drawline',
      action: (_send, args) => {
        const x0 = parseFloat(args[0]);
        const y0 = parseFloat(args[1]);
        const x1 = parseFloat(args[2]);
        const y1 = parseFloat(args[3]);
        const brushSize = parseFloat(args[4]);
        const colorId = parseInt(args[5]);
        const depth = parseInt(args[6]);
        const layer = map!.layer;
        const color = map!.getColorById(colorId);
        if (!color) return;
        layer.quadtree.drawLine(x0, y0, x1, y1, color.id, brushSize, depth);
        layer.draw(ctx, camera, canvas);
        render();
      }
    },
    {
      prefix: 'fillpolygon',
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const polygonStr = args[1];
        const colorId = parseInt(args[2]);
        const depth = parseInt(args[3]);

        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        const color = map!.getColorById(colorId);
        if (!color) return;

        const polygon: [number, number][] = polygonStr.split(';').map(coordStr => {
          const [xStr, yStr] = coordStr.split(',');
          return [parseFloat(xStr), parseFloat(yStr)];
        });

        layer.quadtree.fillPolygon(polygon, color.id, depth);
        layer.draw(ctx, camera, canvas);
        render();
      }
    },
    {
      prefix: 'expand',
      action: (_send, args) => {
        const minX = parseFloat(args[0]);
        const minY = parseFloat(args[1]);
        const maxX = parseFloat(args[2]);
        const maxY = parseFloat(args[3]);
        const placeholder = parseInt(args[4]);

        const expandLayer = (layer: LayerClass) => {
          const [xer1, yer1] = layer.quadtree.expandQuadtrants(minX, minY, placeholder);
          const [xer2, yer2] = layer.quadtree.expandQuadtrants(maxX, maxY, placeholder);
          camera.setX(xer2(xer1(camera.x)));
          camera.setY(yer2(yer1(camera.y)));
          const sizeFactor = 1 / (xer2(xer1(1)) - xer2(xer1(0)));
          camera.setZoom(camera.zoom * sizeFactor);
          toolVar.brushSize /= sizeFactor;
          for (const child of layer.children) {
            expandLayer(child);
          }
        };
        expandLayer(map!.layer);
        render();
      }
    },
    {
      prefix: 'renamecolor',
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const newName = args[1];
        const color = map!.getColorById(colorId);
        if (!color) return;
        color.name = newName;
        rerender();
      }
    },
    {
      prefix: 'changecolor',
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const newColorValue = args[1];
        const color = map!.getColorById(colorId);
        if (!color) return;
        color.color = newColorValue;
        rerender();
      }
    },
    {
      prefix: 'removecolor',
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const color = map!.getColorById(colorId);
        if (!color) return;
        const parentLayer: LayerClass = color.parent;
        parentLayer.colors = parentLayer.colors.filter(c => c.id !== colorId);
        parentLayer.quadtree.removeColor(colorId, parentLayer.colors[0]?.id || 1);
        rerender();
        parentLayer.draw(ctx, camera, canvas);
        render();
        if (selectedColor?.id === colorId) {
          selectColor(parentLayer.colors[0] || null);
        }
      }
    },
    {
      prefix: 'renamelayer',
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const newName = args[1];
        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        layer.name = newName;
        rerender();
      }
    },
    {
      prefix: "removelayer",
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        if (!layer.parent) return;
        if (!(layer.parent instanceof LayerClass)) return;
        layer.parent.children = layer.parent.children.filter(l => l.id !== layerId);
        rerender();
        render();
      }
    }
  ];

  /* canvas setup */
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;

  let camera!: Camera;

  function draw(): void {
    if (!ctx) return;
    if (!map) return;

    map.draw(ctx, camera, canvas);
  }

  function renderBackground() {
    if (!ctx) return;

    ctx.fillStyle = "#19191e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function renderGrid() {
    if (!ctx) return;
    if (!camera) return;

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

  function render(): void {
    if (!ctx) return;

    renderBackground();

    if (!map) return;
    map.render(ctx, camera, canvas);

    renderGrid();

    selectedTool?.onrender?.(ctx);
  }

  /* dataframe render setup */
  let map: Map | null = null;
  let selectedColor: Color | null = null;
  let mapRender = false;

  function selectColor(color: Color) {
    selectedColor = color;
  }

  function rerender() {
    mapRender = !mapRender;
  }

  /* event handlers */
  let keys = new Set<string>();
  let mouse: { startX: number; startY: number; x: number; y: number; dx: number; dy: number; buttons: number } = { startX: 0, startY: 0, x: 0, y: 0, dx: 0, dy: 0, buttons: 0 };

  let canvasContainerDiv!: HTMLDivElement;
  function onresize(): void {
    canvas.style.width = `0`;
    canvas.style.height = `0`;

    canvas.style.width = `${canvasContainerDiv.clientWidth}px`;
    canvas.style.height = `${canvasContainerDiv.clientHeight}px`;
    canvas.width = canvasContainerDiv.clientWidth * window.devicePixelRatio;
    canvas.height = canvasContainerDiv.clientHeight * window.devicePixelRatio;
    render();
  }

  function onkeydown(event: KeyboardEvent) {
    keys.add(event.key);

    selectedTool?.onkeydown?.(event);

    for (const tool of tools) {
      if (event.key === tool.shortcut) {
        selectTool(tool);
        break;
      }
    }
  }

  function onkeyup(event: KeyboardEvent) {
    keys.delete(event.key);

    if (event.key === " ") {
      canvas.style.cursor = "default";
    }

    selectedTool?.onkeyup?.(event);
  }

  function onkeypress(event: KeyboardEvent) {
    selectedTool?.onkeypress?.(event);
  }

  function onmousemove(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * window.devicePixelRatio;
    mouse.y = (event.clientY - rect.top) * window.devicePixelRatio;
    mouse.dx = mouse.x - mouse.startX;
    mouse.dy = mouse.y - mouse.startY;

    if (mouse.buttons & 2 || (keys.has(" ") && mouse.buttons & 1)) {
      const deltaX = (mouse.startX - mouse.x) / camera.zoom;
      const deltaY = (mouse.startY - mouse.y) / camera.zoom;
      camera.setX(camera.x + deltaX);
      camera.setY(camera.y + deltaY);
      mouse.startX = mouse.x;
      mouse.startY = mouse.y;
      render();
    }

    selectedTool?.onmousemove?.(event);
  }

  function onmousebuttondown(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * window.devicePixelRatio;
    mouse.y = (event.clientY - rect.top) * window.devicePixelRatio;
    mouse.startX = mouse.x;
    mouse.startY = mouse.y;
    mouse.buttons |= (1 << event.button);

    selectedTool?.onmousebuttondown?.(event);
  }

  function onmousebuttonup(event: MouseEvent) {
    mouse.buttons &= ~(1 << event.button);

    selectedTool?.onmousebuttonup?.(event);
  }

  function onwheel(event: WheelEvent) {
    if (!ctx) return;
    if (!camera) return;

    if (keys.has("Alt")) {
      const normalDelta = event.deltaX + event.deltaY;
      const [dx, dy] = [mouse.x - canvas.width / 2, mouse.y - canvas.height / 2];
      const [mouseWorldX, mouseWorldY] = camera.screenToWorld(mouse.x, mouse.y);
      camera.setX(mouseWorldX);
      camera.setY(mouseWorldY);
      camera.setZoom(camera.zoom * Math.exp(-normalDelta / 1000));
      camera.setX(camera.x - dx / camera.zoom);
      camera.setY(camera.y - dy / camera.zoom);
      render();
      return;
    }

    camera.setX(camera.x + event.deltaX / camera.zoom);
    camera.setY(camera.y + event.deltaY / camera.zoom);
    render();
  }

  /* tools */
  type Tool = {
    name: string;
    shortcut: string;
    icon: string;
    onstart?: () => void;
    onend?: () => void;
    onmousemove?: (e: MouseEvent) => void;
    onmousebuttondown?: (e: MouseEvent) => void;
    onmousebuttonup?: (e: MouseEvent) => void;
    onkeyup?: (e: KeyboardEvent) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    onrender?: (ctx: CanvasRenderingContext2D) => void;
    onkeypress?: (e: KeyboardEvent) => void;
  };

  let selectedTool: Tool;
  type ToolVar = {
    brushSize: number;
    isDrawing: boolean;
    previousMouseX: number;
    previousMouseY: number;
    polygon: [number, number][];
    startX: number;
    startY: number;
    mouseX: number;
    mouseY: number;
  };
  const toolVar: ToolVar = {
    brushSize: 0.01,
    isDrawing: false,
    previousMouseX: 0,
    previousMouseY: 0,
    polygon: [],
    startX: 0,
    startY: 0,
    mouseX: 0,
    mouseY: 0,
  };
  const tools: Tool[] = [
    {
      name: '자',
      shortcut: 'r',
      icon: 'arrows',
      onstart: () => {
        if (!canvas) return;
        canvas.style.cursor = 'crosshair';
        toolVar.startX = 0;
        toolVar.startY = 0;
        toolVar.mouseX = 0;
        toolVar.mouseY = 0;
        render();
      }, 
      onend: () => {
        if (!canvas) return;
        canvas.style.cursor = 'default';
        render();
      },
      onmousebuttondown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;

        toolVar.isDrawing = true;
        [toolVar.startX, toolVar.startY] = camera.screenToWorld(mouse.x, mouse.y);
      },
      onmousemove: () => {
        if (!ctx) return;
        if (!map) return;
        if (!toolVar.isDrawing) return;

        [toolVar.mouseX, toolVar.mouseY] = camera.screenToWorld(mouse.x, mouse.y);
        render();
      },
      onrender: () => {
        if (!ctx) return;
        if (!map) return;
        if (toolVar.startX === 0 && toolVar.startY === 0 && toolVar.mouseX === 0 && toolVar.mouseY === 0) return;

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [startX, startY] = camera.worldToScreen(toolVar.startX, toolVar.startY);
        const [endX, endY] = camera.worldToScreen(toolVar.mouseX, toolVar.mouseY);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        const dist = Math.hypot(toolVar.startX - toolVar.mouseX, toolVar.startY - toolVar.mouseY);
        const midScreenX = (startX + endX) / 2;
        const midScreenY = (startY + endY) / 2;
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.fillText(dist.toFixed(2), midScreenX + 5, midScreenY - 5);
      },
      onmousebuttonup: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;

        toolVar.isDrawing = false;
        render();
      },
    },
    {
      name: '영역 채우기',
      shortcut: 'f',
      icon: 'feather',
      onmousebuttondown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        toolVar.isDrawing = true;
        toolVar.polygon = [camera.screenToWorld(mouse.x, mouse.y)];
      },
      onmousemove: (_e: MouseEvent) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (!toolVar.isDrawing) return;

        const [wx, wy] = camera.screenToWorld(mouse.x, mouse.y);
        toolVar.polygon.push([wx, wy]);
        render();
      },
      onmousebuttonup: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        toolVar.isDrawing = false;
        const layer = selectedColor.parent;
        const polygonStr = toolVar.polygon.map(([x, y]) => `${x},${y}`).join(';');
        const depth = Math.log2(camera.zoom * window.devicePixelRatio);
        socket.send(`fillpolygon\t${layer.id}\t${polygonStr}\t${selectedColor.id}\t${depth}`);
        render();
      },
      onrender: () => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (!toolVar.isDrawing) return;

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [startX, startY] = camera.worldToScreen(toolVar.polygon[0][0], toolVar.polygon[0][1]);
        ctx.moveTo(startX, startY);
        for (let i = 1; i < toolVar.polygon.length; i++) {
          const [sx, sy] = camera.worldToScreen(toolVar.polygon[i][0], toolVar.polygon[i][1]);
          ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.stroke();
      },
      onstart: () => {
        if (!canvas) return;
        canvas.style.cursor = 'crosshair';
      },
      onend: () => {
        if (!canvas) return;
        canvas.style.cursor = 'default';
      },
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
      onmousemove: (_e: MouseEvent) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        if (toolVar.isDrawing) {
          const [x0, y0] = camera.screenToWorld(mouse.x, mouse.y);
          const [x1, y1] = camera.screenToWorld(toolVar.previousMouseX, toolVar.previousMouseY);
          const depth = Math.log2(camera.zoom * window.devicePixelRatio);
          socket.send(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${toolVar.brushSize}\t${selectedColor.id}\t${depth}`);
        }

        toolVar.previousMouseX = mouse.x;
        toolVar.previousMouseY = mouse.y;
        render();
      },
      onmousebuttondown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        toolVar.isDrawing = true;
      },
      onmousebuttonup: () => {
        toolVar.isDrawing = false;
      },
      onkeypress: (e: KeyboardEvent) => {
        if (e.key === '[') {
          toolVar.brushSize *= 0.9;
        }
        if (e.key === ']') {
          toolVar.brushSize *= 1.1;
        }
        render();
      },
      onrender: () => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, toolVar.brushSize * camera.zoom / window.devicePixelRatio, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, toolVar.brushSize * camera.zoom / window.devicePixelRatio, 0, 2 * Math.PI);
        ctx.stroke();
      },
    },
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
      onkeypress: () => {},
    },
  ];

  function selectTool(tool: Tool | string) {
    if (typeof tool !== 'string') {
      selectedTool?.onend?.();
      selectedTool = tool;
      render();
      selectedTool?.onstart?.();
      return;
    }

    const foundTool = tools.find(t => t.name === tool);
    if (!foundTool) return;

    selectedTool?.onend?.();
    selectedTool = foundTool;
    render();
    selectedTool?.onstart?.();
  }

  selectTool(tools[tools.length - 1]);

  /* onMount and onDestroy lifecycle hooks */
  onMount(() => {
    /* Initialize canvas */
    canvasContainerDiv = document.querySelector('.canvas-container') as HTMLDivElement;
    canvas = document.getElementById('canvas') as HTMLCanvasElement;
    ctx = canvas.getContext('2d')!;
    camera = new Camera(canvas);
    draw();
    onresize();

    /* event handling */
    window.addEventListener('resize', onresize);
    window.addEventListener('keydown', onkeydown);
    window.addEventListener('keyup', onkeyup);
    window.addEventListener('keypress', onkeypress);
    canvas.addEventListener('mousemove', onmousemove);
    canvas.addEventListener('mousedown', onmousebuttondown);
    canvas.addEventListener('mouseup', onmousebuttonup);
    window.addEventListener('wheel', onwheel);

    /* Initialize WebSocket */
    socket = new WebSocket(wsurl);

    socket.addEventListener('open', () => {
      socket.send("load");
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
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

  /* map functions */
  function saveMap() {
    if (!socket) return;
    if (!map) return;

    const mapJSON = JSON.stringify(map.toJSON());
    socket.send(`save`);
  }

  function reloadMap() {
    if (!socket) return;
    socket.send(`load`);
  }
</script>

<div class="main-container">
  <div class="toolbar">
    {#each tools.toReversed() as tool}
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
    <div class="properties-section">
      <div class="section-title">동작 팔레트</div>
      {#if socket}
        <button on:click={saveMap}>저장</button>
        <button on:click={reloadMap}>새로고침</button>
      {/if}
    </div>
    <div class="properties-section">
      <div class="section-title">레이어 속성</div>
      {#if map}
        {#key mapRender}
          <Layer layer={map.layer} {socket} {selectedColor} {selectColor} {rerender} {render} removeable={false} />
        {/key}
      {/if}
    </div>
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

  .properties-section {
    margin-bottom: 16px;
  }

  .properties-section button {
    background: none;
    border: none;
    color: white;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 14px;
  }

  .section-title {
    font-weight: bold;
    margin-bottom: 8px;
  }
</style>
