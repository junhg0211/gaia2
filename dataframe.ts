/* data */
interface Camera {
  worldToScreen(x: number, y: number): [number, number];
  isBoxOutsideViewbox(x0: number, y0: number, x1: number, y1: number): boolean;
  zoom: number;
}
export class Color {
  name: string;
  color: string;
  parent: any;
  id: number;

  constructor(name: string, color: string, parent: any) {
    this.name = name;
    this.color = color;
    this.parent = parent;
    this.id = getMap(parent).getNextColorId();
  }

  /* serialization */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      color: this.color
    };
  }
}

export class Quadtree {
  value: number | null;
  children: Quadtree[] | null;
  parent: Quadtree | Layer | Map;
  image: HTMLCanvasElement | null; 

  constructor(value: number | null, parent: Quadtree | Layer | Map) {
    this.value = value;
    this.children = null;
    this.parent = parent;
    this.image = null;
  }

  /* value */
  setValue(value: number) {
    this.value = value;
    this.children = null;
  }

  getValue(): number {
    if (this.value === null)
      throw new Error("Cannot get value of a divided quadtree node.");
    return this.value;
  }

  /* children */
  getChild(index: number) {
    if (this.children === null)
      throw new Error("Cannot get child of a leaf quadtree node.");
    return this.children[index];
  }

  /* quadtree */
  isLeaf() {
    return this.value !== null;
  }

  isDivided() {
    return this.value === null;
  }

  subdivide() {
    if (this.isDivided()) return;

    this.children = [
      new Quadtree(this.value, this), // top-left
      new Quadtree(this.value, this), // top-right
      new Quadtree(this.value, this), // bottom-left
      new Quadtree(this.value, this)  // bottom-right
    ];
    this.value = null;
  }

  mergeIfPossible() {
    if (this.children === null) return;

    for (const child of this.children) child.mergeIfPossible();

    const firstValue = this.getChild(0).isLeaf() ? this.getChild(0).getValue() : null;
    if (firstValue === null)
      return;

    const allSame = this.children.every(child => child.isLeaf() && child.getValue() === firstValue);
    if (allSame) {
      this.value = firstValue;
      this.children = null;
    }
  }

  getDepth() {
    if (this.children === null) return 0;

    const childDepths: number[] = this.children.map(child => child.getDepth());
    return 1 + Math.max(...childDepths);
  }

  /* image representation */
  fillPolygon(polygon: [number, number][], value: number, depth: number) {
    function polygonContainsPoint(px: number, py: number, polygon: [number, number][]): boolean {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    if (depth <= 0 || depth === undefined) {
      const containsCenter = polygonContainsPoint(0.5, 0.5, polygon);

      if (containsCenter) return this.setValue(value);
      else return;
    }

    // check if polygon completely outside square
    const polygonMinX = Math.min(...polygon.map(p => p[0]));
    const polygonMaxX = Math.max(...polygon.map(p => p[0]));
    const polygonMinY = Math.min(...polygon.map(p => p[1]));
    const polygonMaxY = Math.max(...polygon.map(p => p[1]));

    if (polygonMaxX < 0 || polygonMinX > 1 || polygonMaxY < 0 || polygonMinY > 1)
      return; // polygon completely outside square

    this.subdivide();

    this.getChild(0).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2]), value, depth - 1);
    this.getChild(1).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2]), value, depth - 1);
    this.getChild(2).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2 - 1]), value, depth - 1);
    this.getChild(3).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2 - 1]), value, depth - 1);

    this.mergeIfPossible();
  }

  fillCircle(x: number, y: number, radius: number, value: number, depth: number) {
    if (depth <= 0 || depth === undefined) {
      const distance = Math.hypot(x - 0.5, y - 0.5);
      const containsCenter = distance <= radius;

      if (containsCenter) return this.setValue(value);
      else return;
    }

    // closest point in square to circle center
    const closestX = Math.max(0, Math.min(1, x));
    const closestY = Math.max(0, Math.min(1, y));
    const distance = Math.hypot(closestX - x, closestY - y);

    if (distance >= radius)
      return; // circle does not intersect square

    this.subdivide();

    this.getChild(0).fillCircle(x * 2, y * 2, radius * 2, value, depth - 1);         // top-left
    this.getChild(1).fillCircle(x * 2 - 1, y * 2, radius * 2, value, depth - 1);     // top-right
    this.getChild(2).fillCircle(x * 2, y * 2 - 1, radius * 2, value, depth - 1);     // bottom-left
    this.getChild(3).fillCircle(x * 2 - 1, y * 2 - 1, radius * 2, value, depth - 1); // bottom-right

    this.mergeIfPossible();
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, value: number, width: number, depth: number) {
    const theta = Math.atan2(y1 - y0, x1 - x0);
    const halfWidth = width / 2;
    const corners: [number, number][] = [
      [x0 + halfWidth * Math.cos(theta + Math.PI / 2), y0 + halfWidth * Math.sin(theta + Math.PI / 2)],
      [x0 + halfWidth * Math.cos(theta - Math.PI / 2), y0 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta - Math.PI / 2), y1 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta + Math.PI / 2), y1 + halfWidth * Math.sin(theta + Math.PI / 2)]
    ];
    this.fillPolygon(corners, value, depth);
    this.fillCircle(x0, y0, halfWidth, value, depth);
    this.fillCircle(x1, y1, halfWidth, value, depth);
  }

  overwrite(otherQuadtree: Quadtree, includeFunction: (value: number | null) => boolean) {
    if (otherQuadtree.isLeaf()) {
      if (includeFunction(otherQuadtree.getValue()))
        this.setValue(otherQuadtree.getValue());
      return;
    }

    this.subdivide();
    if (this.children === null)
      throw new Error("Quadtree children should not be null after subdivision.");

    for (let i = 0; i < 4; i++)
      this.children[i].overwrite(otherQuadtree.getChild(i), includeFunction);

    this.mergeIfPossible();
  }

  getValueAt(x: number, y: number): number | null {
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;

    if (this.children === null)
      return this.getValue();

    const lux = x * 2, luy = y * 2;
    const luv = this.children[0].getValueAt(lux, luy);
    if (luv !== null) return luv;

    const rux = lux - 1, ruy = luy;
    const ruv = this.children[1].getValueAt(rux, ruy);
    if (ruv !== null) return ruv;

    const ldx = lux, ldy = luy - 1;
    const ldv = this.children[2].getValueAt(ldx, ldy);
    if (ldv !== null) return ldv;

    const rdx = lux - 1, rdy = luy - 1;
    return this.children[3].getValueAt(rdx, rdy);
  }

  /* draw on ctx */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    canvas: HTMLCanvasElement,
    colorMap: { [key: number]: string }
  ) {
    const depth = this.getDepth();
    if (depth > 8) {
      this.image = null;
      if (this.children === null) return;
      this.children.forEach(child => child.draw(ctx, camera, canvas, colorMap));
      return;
    } else if (depth !== 8) {
      this.image = null;
      return;
    }

    const imgSize = 1 << depth;
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = imgSize;
    offscreenCanvas.height = imgSize;
    const offscreenCtx: CanvasRenderingContext2D | null = offscreenCanvas.getContext("2d");
    if (offscreenCtx === null) return;

    for (let iy = 0; iy < imgSize; iy++) {
      for (let ix = 0; ix < imgSize; ix++) {
        const value = this.getValueAt(ix / imgSize, iy / imgSize);
        const color = colorMap[value ?? -1];
        if (color === "transparent") continue;

        offscreenCtx.fillStyle = color;
        offscreenCtx.fillRect(ix, iy, 1, 1);
      }
    }

    this.image = offscreenCanvas;
    return;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement, colorMap: { [key: number]: string }, x = 0, y = 0, step = 1) {
    if (this.image) {
      const [sx, sy] = camera.worldToScreen(x, y);
      const size = camera.zoom * Math.pow(0.5, step - 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image, sx, sy, size, size);
      return;
    }

    if (camera.isBoxOutsideViewbox(x, y, x + Math.pow(0.5, step - 1), y + Math.pow(0.5, step - 1))) {
      return;
    }

    if (this.isLeaf()) {
      const color = colorMap[this.value ?? -1];
      if (color === "transparent") return;

      ctx.fillStyle = color;
      const [sx, sy] = camera.worldToScreen(x, y);
      const size = camera.zoom * Math.pow(0.5, step - 1);
      ctx.fillRect(sx, sy, size, size);
      return;
    }

    step++;
    this.getChild(0).render(ctx, camera, canvas, colorMap, x, y, step);
    this.getChild(1).render(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step - 1), y, step);
    this.getChild(2).render(ctx, camera, canvas, colorMap, x, y + Math.pow(0.5, step - 1), step);
    this.getChild(3).render(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step - 1), y + Math.pow(0.5, step - 1), step);
  }

  /* serialization */
  toJSON(): any {
    if (this.children === null) {
      if (this.value === null)
        throw new Error("Cannot serialize a quadtree leaf with null value.");
      return this.value;
    } else {
      return [
        this.children[0].toJSON(),
        this.children[1].toJSON(),
        this.children[2].toJSON(),
        this.children[3].toJSON()
      ];
    }
  }
}

export class Layer {
  id: number;
  name: string;
  parent: Map | Layer;
  colors: Color[];
  children: Layer[];
  quadtree: Quadtree;
  constructor(name: string, parent: Map | Layer) {
    this.name = name;
    this.parent = parent;
    this.colors = [new Color("Transparent", "transparent", this)];
    this.children = [];
    this.quadtree = new Quadtree(this.colors[0].id, this);
    this.id = getMap(parent).getNextLayerId();
  }

  /* colors */
  addColor(color: Color) {
    this.colors.push(color);
  }

  /* children */
  addChild(layer: Layer) {
    this.children.push(layer);
  }

  includesLayer(layerId: number): boolean {
    return this.children.some(layer => layer.id === layerId);
  }

  includesColor(colorId: number): boolean {
    return this.colors.some(color => color.id === colorId);
  }

  getColorMap() {
    const colorMap: { [key: number]: string } = {};
    for (const color of this.colors) {
      colorMap[color.id] = color.color;
    }
    return colorMap;
  }

  /* draw on ctx */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    this.quadtree.draw(ctx, camera, canvas, this.getColorMap());
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    this.quadtree.render(ctx, camera, canvas, this.getColorMap());
  }

  /* serialization */
  toJSON(): { id: number; name: string; colors: any[]; quadtree: any; children: any[] } {
    return {
      id: this.id,
      name: this.name,
      colors: this.colors.map(color => color.toJSON()),
      quadtree: this.quadtree.toJSON(),
      children: this.children.map(child => child.toJSON())
    };
  }
}

export class Map {
  nextLayerId: number;
  nextColorId: number;
  layer: Layer;
  constructor() {
    this.nextLayerId = 1;
    this.nextColorId = 1;
    this.layer = new Layer("Root", this);
  }

  /* ids */
  getNextLayerId() {
    return this.nextLayerId++;
  }

  getNextColorId() {
    return this.nextColorId++;
  }

  getLayerById(layerId: number): Layer | null {
    function searchLayer(layer: Layer, layerId: number): Layer | null {
      if (layer.id === layerId) return layer;
      for (const childLayer of layer.children) {
        const result = searchLayer(childLayer, layerId);
        if (result) return result;
      }
      return null;
    }
    return searchLayer(this.layer, layerId);
  }

  getColorById(colorId: number): Color | null {
    function searchLayerForColor(layer: Layer, colorId: number): Color | null {
      for (const color of layer.colors) {
        if (color.id === colorId) return color;
      }
      for (const childLayer of layer.children) {
        const result = searchLayerForColor(childLayer, colorId);
        if (result) return result;
      }
      return null;
    }
    return searchLayerForColor(this.layer, colorId);
  }

  /* draw on ctx */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    this.layer.draw(ctx, camera, canvas);
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    this.layer.render(ctx, camera, canvas);
  }

  /* serialization */
  toJSON() {
    return {
      layer: this.layer.toJSON(),
      nextLayerId: this.nextLayerId,
      nextColorId: this.nextColorId
    };
  }
}

function getMap(thing: Map | Layer): Map {
  if (thing instanceof Map)
    return thing;
  return getMap(thing.parent);
}

/* deserialization */
export function mapFromJSON(json: any): Map {
  const map = new Map();
  map.layer = layerFromJSON(json.layer, map);
  map.nextLayerId = json.nextLayerId;
  map.nextColorId = json.nextColorId;
  return map;
}

function layerFromJSON(json: any, parent: Map | Layer): Layer {
  const layer = new Layer(json.name, parent);
  layer.id = json.id;
  layer.colors = json.colors.map((colorJson: { name: string; color: string; id: number; }) => {
    const color = new Color(colorJson.name, colorJson.color, layer);
    color.id = colorJson.id;
    return color;
  });
  layer.quadtree = quadtreeFromJSON(json.quadtree, layer);
  layer.children = json.children.map((childJson: any) => layerFromJSON(childJson, layer));
  return layer;
}

function quadtreeFromJSON(json: any, parent: Map | Layer | Quadtree): Quadtree {
  if (Array.isArray(json)) {
    const node = new Quadtree(null, parent);
    node.children = [
      quadtreeFromJSON(json[0], node),
      quadtreeFromJSON(json[1], node),
      quadtreeFromJSON(json[2], node),
      quadtreeFromJSON(json[3], node)
    ];
    return node;
  } else {
    return new Quadtree(json, parent);
  }
}
