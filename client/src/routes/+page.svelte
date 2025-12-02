<script lang="ts">
  import Layer from "$lib/components/Layer.svelte";
  import Camera from "../../../camera";
  import { onMount, onDestroy } from 'svelte';
  import { mapFromJSON, Color, Map, Layer as LayerClass, layerFromJSON } from "../../../dataframe";
  import "bootstrap-icons/font/bootstrap-icons.css";

  /* websocket setup */
  let wsurl: string;
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
      prefix: "draw",
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        layer.draw();
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
        layer.quadtree.drawLine(x0, y0, x1, y1, color, brushSize, depth);
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

        layer.quadtree.fillPolygon(polygon, color, depth);
        layer.draw();
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
          return [(x: number) => xer2(xer1(x)), (y: number) => yer2(yer1(y))];
        };
        const [xer, _] = expandLayer(map!.layer);
        map!.size *= 1 / (xer(1) - xer(0));
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
        color.getLayer().draw();
        rerender();
        render();
      }
    },
    {
      prefix: 'removecolor',
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const color = map!.getColorById(colorId);
        if (!color) return;
        const parentLayer: LayerClass = color.parent;
        parentLayer.quadtree.removeColor(colorId, parentLayer.colors[0]?.id || 1);
        parentLayer.colors = parentLayer.colors.filter(c => c.id !== colorId);
        rerender();
        parentLayer.draw();
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
    },
    {
      prefix: "setcolorlock",
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const locked = args[1] === '1';
        const color = map!.getColorById(colorId);
        if (!color) return;
        color.locked = locked;
        rerender();
      }
    },
    {
      prefix: "fill",
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const wx = parseFloat(args[1]);
        const wy = parseFloat(args[2]);
        const colorId = parseInt(args[3]);
        const layer = map!.getLayerById(layerId);
        if (!layer) return;
        const color = map!.getColorById(colorId);
        if (!color) return;

        layer.quadtree.floodFill(wx, wy, color.id);
        layer.draw();
        render();
      }
    },
    {
      prefix: 'layer',
      action: (_send, args) => {
        const layerId = parseInt(args[0]);
        const originalLayer = map?.getLayerById(layerId);
        const layer = layerFromJSON(JSON.parse(args[1]), originalLayer?.parent || map!);
        originalLayer?.updateFromLayer(layer);
        layer.draw();
        render();
      }
    },
    {
      prefix: "setmapsize",
      action: (_send, args) => {
        let [rawSize] = args;
        const newSize = parseFloat(rawSize);
        if (!map) return;
        map.size = newSize;
        render();
      }
    },
    {
      prefix: "addcolorfilter",
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const filterAt = parseInt(args[1]);
        const color = map!.getColorById(colorId);
        if (!color) return;
        if (color.filterAts.includes(filterAt)) return;
        color.filterAts.push(filterAt);
        rerender();
      },
    },
    {
      prefix: "removecolorfilter",
      action: (_send, args) => {
        const colorId = parseInt(args[0]);
        const filterAt = parseInt(args[1]);
        const color = map!.getColorById(colorId);
        if (!color) return;
        color.filterAts = color.filterAts.filter(v => v !== filterAt);
        rerender();
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

    map.draw();
  }

  function renderBackground() {
    if (!ctx) return;

    ctx.fillStyle = "#19191e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function renderGrid() {
    if (!ctx) return;
    if (!camera) return;
    if (!map) return;

    const preferredGridSizeInPixels = 300 * window.devicePixelRatio;
    let gridUnit = 1000;
    while (gridUnit * camera.zoom > preferredGridSizeInPixels) {
      if (gridUnit.toString().endsWith('1')) {
        gridUnit /= 2;
      } else if (gridUnit.toString().endsWith('5')) {
        gridUnit /= 2.5;
      } else {
        gridUnit /= 2;
      }
    }
    const gridSize = gridUnit * camera.zoom;
    ctx.strokeStyle = '#77777777';
    ctx.lineWidth = window.devicePixelRatio;
    const [leftx, topy] = [camera.worldToScreen(0, 0)[0] % gridSize, camera.worldToScreen(0, 0)[1] % gridSize];
    ctx.beginPath();
    for (let x = leftx; x < canvas.width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = topy; y < canvas.height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    /* coordinates */
    ctx.font = `${8 * window.devicePixelRatio}px Arial`;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    for (let x = leftx; x < canvas.width; x += gridSize) {
      const text = distanceString(camera.screenToWorld(x, 0)[0] * map.size);
      const width = ctx.measureText(text).width;
      ctx.fillStyle = "black";
      ctx.fillRect((x + 2) - width / 2, 0, width, 12 * window.devicePixelRatio);
      ctx.fillStyle = "white";
      ctx.fillText(text, x + 2, 12 * window.devicePixelRatio);
    }
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let y = topy; y < canvas.height; y += gridSize) {
      const text = distanceString(camera.screenToWorld(0, y)[1] * map.size);
      const width = ctx.measureText(text).width;
      ctx.fillStyle = "black";
      ctx.fillRect(2, y - 6 * window.devicePixelRatio, width, 8 * window.devicePixelRatio);
      ctx.fillStyle = "white";
      ctx.fillText(text, 2, y);
    }

    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.beginPath();
    const [x1, y1] = camera.worldToScreen(0, 0);
    ctx.moveTo(Math.max(0, Math.min(canvas.width, x1)), Math.max(0, Math.min(canvas.height, y1)));
    const [x2, y2] = camera.worldToScreen(1, 0);
    ctx.lineTo(Math.max(0, Math.min(canvas.width, x2)), Math.max(0, Math.min(canvas.height, y2)));
    const [x3, y3] = camera.worldToScreen(1, 1);
    ctx.lineTo(Math.max(0, Math.min(canvas.width, x3)), Math.max(0, Math.min(canvas.height, y3)));
    const [x4, y4] = camera.worldToScreen(0, 1);
    ctx.lineTo(Math.max(0, Math.min(canvas.width, x4)), Math.max(0, Math.min(canvas.height, y4)));
    ctx.closePath();
    ctx.stroke();

    /* scale indicator */
    const indicatorHeight = 12 * window.devicePixelRatio;
    const gridCount = Math.floor((1000 * window.devicePixelRatio) / gridSize);
    ctx.fillStyle = "white";
    ctx.fillRect(8, canvas.height - indicatorHeight - 12, gridSize * gridCount + 4, indicatorHeight + 4);
    ctx.fillStyle = "black";
    ctx.fillRect(9, canvas.height - indicatorHeight - 11, gridSize * gridCount + 2, indicatorHeight + 2);
    for (let i = 0; i < gridCount; i++) {
      ctx.fillStyle = i % 2 == 0 ? "white" : "black";
      ctx.fillRect(10 + i * gridSize, canvas.height - indicatorHeight - 10, gridSize, indicatorHeight);
      
      const text = distanceString(gridUnit * (i + 1) * map.size);
      ctx.fillStyle = i % 2 == 0 ? "black" : "white";
      ctx.font = `${8 * window.devicePixelRatio}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(text, 10 + (i + 1) * gridSize - 4, canvas.height - 12);
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
  let depthDelta = 0;
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

        const dist = Math.hypot(toolVar.startX - toolVar.mouseX, toolVar.startY - toolVar.mouseY) * map.size;
        const midScreenX = (startX + endX) / 2;
        const midScreenY = (startY + endY) / 2;
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.fillText(distanceString(dist), midScreenX + 5, midScreenY - 5);
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
      name: '채우기',
      shortcut: 'g',
      icon: 'paint-bucket',
      onmousebuttondown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (selectedColor === null) return;

        const [wx, wy] = camera.screenToWorld(mouse.x, mouse.y);
        socket.send(`fill\t${selectedColor.getLayer().id}\t${wx}\t${wy}\t${selectedColor.id}`)
        render();
      },
    },
    {
      name: '사각형 채우기',
      shortcut: 'm',
      icon: 'square',
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

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [startX, startY] = camera.worldToScreen(toolVar.startX, toolVar.startY);
        const [endX, endY] = camera.worldToScreen(toolVar.mouseX, toolVar.mouseY);
        ctx.rect(startX, startY, endX - startX, endY - startY);
        ctx.stroke();
      },
      onmousebuttonup: (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!ctx) return;
        if (!map) return;
        if (selectedColor === null) return;
        toolVar.isDrawing = false;
        const [wx, wy] = camera.screenToWorld(mouse.x, mouse.y);
        const polygon = [
          [toolVar.startX, toolVar.startY],
          [wx, toolVar.startY],
          [wx, wy],
          [toolVar.startX, wy],
        ];
        const polygonStr = polygon.map(([x, y]) => `${x},${y}`).join(';');
        const layer = selectedColor.parent;
        const depth = Math.log2(camera.zoom) + depthDelta;
        socket.send(`fillpolygon\t${layer.id}\t${polygonStr}\t${selectedColor.id}\t${depth}`);

        toolVar.startX = 0;
        toolVar.startY = 0;
        toolVar.mouseX = 0;
        toolVar.mouseY = 0;
        render();
      },
    },
    {
      name: "다각형 채우기",
      shortcut: 'p',
      icon: "hexagon",
      onstart: () => {
        if (!canvas) return;
        canvas.style.cursor = 'crosshair';
        toolVar.polygon = [];
        render();
      },
      onend: () => {
        if (!canvas) return;
        canvas.style.cursor = 'default';
      },
      onmousebuttonup: (e: MouseEvent) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (e.button !== 0) return;

        const [wx, wy] = camera.screenToWorld(mouse.x, mouse.y);
        toolVar.polygon.push([wx, wy]);
        render();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (toolVar.polygon.length < 3) return;
        if (e.key !== "Enter") return;

        const layer = selectedColor.parent;
        const polygonStr = toolVar.polygon.map(([x, y]) => `${x},${y}`).join(';');
        const depth = Math.log2(camera.zoom) + depthDelta;
        socket.send(`fillpolygon\t${layer.id}\t${polygonStr}\t${selectedColor.id}\t${depth}`);
        toolVar.polygon = [];
        render();
      },
      onrender: () => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (toolVar.polygon.length === 0) return;

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [startX, startY] = camera.worldToScreen(toolVar.polygon[0][0], toolVar.polygon[0][1]);
        ctx.moveTo(startX, startY);
        for (let i = 1; i < toolVar.polygon.length; i++) {
          const [sx, sy] = camera.worldToScreen(toolVar.polygon[i][0], toolVar.polygon[i][1]);
          ctx.lineTo(sx, sy);
        }
        ctx.lineTo(mouse.x, mouse.y);
        ctx.closePath();
        ctx.stroke();
      },
      onmousemove: (_e: MouseEvent) => {
        if (!ctx) return;
        if (!map) return;
        if (!selectedColor) return;
        if (toolVar.polygon.length === 0) return;

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
        const depth = Math.log2(camera.zoom) + depthDelta;
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
        toolVar.polygon = [];
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
          const depth = Math.log2(camera.zoom) + depthDelta;
          socket.send(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${toolVar.brushSize}\t${selectedColor.id}\t${depth}`);
          toolVar.polygon.push([x0, y0]);
          render();
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
        toolVar.polygon.push(camera.screenToWorld(mouse.x, mouse.y));
      },
      onmousebuttonup: () => {
        toolVar.isDrawing = false;
        if (!selectedColor) return;
        socket.send(`draw\t${selectedColor.parent.id}`);
        toolVar.polygon = [];
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

        if (toolVar.isDrawing) {
          ctx.strokeStyle = selectedColor.color !== "transparent" ? selectedColor.color : 'white';
          ctx.lineWidth = toolVar.brushSize * camera.zoom / window.devicePixelRatio * 2;
          ctx.lineCap = "round"
          ctx.lineJoin = "round";
          ctx.beginPath();
          for (const [x, y] of toolVar.polygon) {
            const [sx, sy] = camera.worldToScreen(x, y);
            ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }

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
    const defaultHost = 'sch.shtelo.org';
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    wsurl = prompt("웹소켓 서버 주소를 입력해주세요:", defaultHost) || defaultHost;
    if (!wsurl.startsWith('ws://') && !wsurl.startsWith('wss://')) wsurl = scheme + wsurl;
    if (!wsurl.match(/:\d+/)) wsurl += ":48829";

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
    alert("맵이 저장되었습니다.");
  }

  function reloadMap() {
    if (!socket) return;
    socket.send(`load`);
  }

  function resizeMap(e: Event) {
    if (!socket) return;
    if (!map) return;

    const newSize = parseFloat((e.target as HTMLInputElement).value);
    socket.send(`setmapsize\t${newSize}`);
  }

  function distanceString(distance: number): string {
    const absDistance = Math.abs(distance);
    if (absDistance >= 1000000) {
      return (distance / 1000000).toFixed(3) + " km";
    } else if (absDistance >= 1000) {
      return (distance / 1000).toFixed(3) + " m";
    } else if (absDistance >= 1) {
      return distance.toFixed(3) + " mm";
    } else if (absDistance >= 0.001) {
      return (distance * 1000).toFixed(3) + " um";
    } else {
      return (distance * 1000000).toFixed(3) + " nm";
    }
  }

  function loadImage() {
    if (!selectedColor) {
      alert("레이어가 선택되지 않았습니다.");
      return;
    }
    const layer = selectedColor.getLayer();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: Event) => {
      const rawWidth = prompt("이미지가 차지할 실제 너비 (km 단위):", "100");
      if (!rawWidth) return;
      const width = parseFloat(rawWidth) * 1000000;
      if (isNaN(width) || width <= 0) {
        alert("유효한 숫자를 입력해주세요.");
        return; 
      }

      const rawHeight = prompt("이미지가 차지할 실제 높이 (km 단위):", "100");
      if (!rawHeight) return;
      const height = parseFloat(rawHeight) * 1000000;
      if (isNaN(height) || height <= 0) {
        alert("유효한 숫자를 입력해주세요.");
        return;
      }

      const colors = prompt("이미지에서 사용할 색상들을 쉼표(,)로 구분하여 입력해주세요 (예: 빨강,#ff0000,초록,#00ff00,파랑,#0000ff):", "검정,#000000,흰색,#ffffff");
      if (!colors) return;
      const colorList = colors.split(',').map(s => s.trim());
      if (colorList.length % 2 !== 0) {
        alert("색상 입력이 올바르지 않습니다. 이름과 색상 값이 쌍으로 입력되어야 합니다.");
        return;
      }
      const colorPairs: { name: string; color: string }[] = [];
      for (let i = 0; i < colorList.length; i += 2) {
        colorPairs.push({ name: colorList[i], color: colorList[i + 1] });
      }

      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        alert("파일이 선택되지 않았습니다.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = img.width;
          offscreenCanvas.height = img.height;
          const offscreenCtx = offscreenCanvas.getContext('2d')!;
          offscreenCtx.drawImage(img, 0, 0);
          const imageData = offscreenCtx.getImageData(0, 0, img.width, img.height);

          let pixelData: number[][] = [];
          for (let y = 0; y < img.height; y++) {
            let row: number[] = [];
            for (let x = 0; x < img.width; x++) {
              const offset = (y * img.width + x) * 4;
              const r = imageData.data[offset];
              const g = imageData.data[offset + 1];
              const b = imageData.data[offset + 2];
              const a = imageData.data[offset + 3];
              const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toLowerCase()}`;
              const closestColor = getClosestColor(r, g, b, a, colorPairs.map(c => c.color));
              row.push(colorPairs.findIndex(c => c.color === closestColor));
            }
            pixelData.push(row);
          }
          socket.send(`loadimage\t${layer.id}\t${width}\t${height}\t${JSON.stringify(colorPairs)}\t${JSON.stringify(pixelData)}`);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    
    // 같은 파일을 다시 선택해도 onchange가 발생하도록 value를 초기화
    input.addEventListener('click', () => {
      input.value = '';
    });
    
    input.click();
  }

  function getClosestColor(r: number, g: number, b: number, a: number, colorList: string[]): string {
    let closestColor = '';
    let closestDistance = Infinity;
    for (const colorStr of colorList) {
      const color = hexToRgba(colorStr);
      if (!color) continue;
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      const da = a - color.a;
      const distance = dr * dr + dg * dg + db * db + da * da;
      if (distance < closestDistance) {
        closestDistance = distance;
        closestColor = colorStr;
      }
    }
    return closestColor;
  }

  function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | null {
    if (hex.startsWith('#')) {
      hex = hex.slice(1);
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 255 };
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return { r, g, b, a };
    }
    return null;
  }

  function saveImage() {
    if (!map) {
      alert("맵이 로드되지 않았습니다.");
      return;
    }

    const canvasSize = prompt("저장할 이미지의 해상도 (픽셀 단위):", (map.size / 250000).toString());
    if (!canvasSize) return;
    const cs = parseInt(canvasSize);
    if (isNaN(cs) || cs <= 0) {
      alert("유효한 해상도를 입력해주세요.");
      return;
    }

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = cs;
    offscreenCanvas.height = cs;
    const offscreenCtx = offscreenCanvas.getContext('2d')!;
    map.renderToImage(offscreenCanvas, offscreenCtx, map.size, map.size);

    const dataURL = offscreenCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'map_image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* title */
  $: title = `Gaia 2${socket ? ` :: ${wsurl?.replaceAll(/^(wss?|https?):\/\/|:48829$/g, '')}` : ""}`;
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

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
      <div class="section-title">맵 설정</div>
      {#if map}
        <div class="map-setting">
          <span class="map-setting-label">맵 크기 (mm)</span>
          <span class="map-setting-input"><input type="number" value={map.size} on:input={resizeMap}></span>
        </div>
        <div class="map-setting">
          <span class="map-setting-label">깊이 델타</span>
          <span class="map-setting-input"><input type="number" bind:value={depthDelta}></span>
        </div>
      {/if}
    </div>
    <div class="properties-section">
      <div class="section-title">동작 팔레트</div>
      {#if socket}
        <button on:click={saveMap}>저장</button>
        <button on:click={reloadMap}>새로고침</button>
      {/if}
      {#if map}
        <button on:click={draw}>그리기</button>
      {/if}
      <button on:click={loadImage}>이미지 불러오기</button>
      <button on:click={saveImage}>이미지 저장하기</button>
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
    border-radius: 4px;
    transition: all 0.2s;
  }

  .tool-button:hover {
    background-color: #444444;
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
    border-radius: 4px;
    transition: all 0.2s;
  }

  .properties-section button:hover {
    background-color: #444444;
  }

  .section-title {
    font-weight: bold;
    margin-bottom: 8px;
  }

  .map-setting {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
  }

  .map-setting-label {
    flex: 1;
  }

  .map-setting-input {
    flex: 1;
  }

  .map-setting-input input {
    box-sizing: border-box;
    width: 100%;
    padding: 4px;
    border: 1px solid #555555;
    border-radius: 4px;
    background-color: #222222;
    color: white;
  }
</style>
