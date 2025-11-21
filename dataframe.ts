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
  locked: boolean;

  constructor(name: string, color: string, parent: any) {
    this.name = name;
    this.color = color;
    this.parent = parent;
    this.id = getMap(parent).getNextColorId();
    this.locked = false;
  }

  /* serialization */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      locked: this.locked,
    };
  }
}

export class Quadtree {
  value: number | null;
  children: Quadtree[] | null;
  parent: Quadtree | Layer;
  image: HTMLCanvasElement | null; 

  constructor(value: number | null, parent: Quadtree | Layer) {
    this.value = value;
    this.children = null;
    this.parent = parent;
    this.image = null;
  }

  /* value */
  setValue(value: number) {
    if (this.isDivided()) {
      for (const child of this.children!) {
        child.setValue(value);
      }
      this.mergeIfPossible();
    }

    if (this.value === null) return;

    if (this.isLeaf() && this.getLayer().getColor(this.value).locked) return;

    this.value = value;
    this.children = null;
    this.image = null;
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

  getLayer(): Layer {
    if (this.parent instanceof Layer)
      return this.parent;
    return this.parent.getLayer();
  }

  /* quadtree */
  isLeaf() {
    return this.value !== null;
  }

  isDivided() {
    return this.value === null;
  }

  subdivide() {
    if (this.value === null) return;

    if (this.getLayer().getColor(this.value).locked) return;

    this.children = [
      new Quadtree(this.value, this),
      new Quadtree(this.value, this),
      new Quadtree(this.value, this),
      new Quadtree(this.value, this)
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
      this.image = null;
    }
  }

  getDepth() {
    if (this.children === null) return 0;

    const childDepths: number[] = this.children.map(child => child.getDepth());
    return 1 + Math.max(...childDepths);
  }

  expandQuadtrants(x: number, y: number, placeholder: number): [(x: number) => number, (y: number) => number] {
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1)
      return [(x: number) => x, (y: number) => y];

    const clone = new Quadtree(this.value, this);
    clone.children = this.children;
    this.children = [
      new Quadtree(placeholder, this),
      new Quadtree(placeholder, this),
      new Quadtree(placeholder, this),
      new Quadtree(placeholder, this),
    ];
    this.image = null;

    try {
      this.subdivide();
    } catch {}

    let xer: (x: number) => number, yer: (y: number) => number;

    if (x < 0 && y < 1) {
      this.children[3] = clone;
      x = (x + 1) / 2;
      y = (y + 1) / 2;
      xer = (x: number) => (x + 1) / 2;
      yer = (y: number) => (y + 1) / 2;
    }

    if (x > 0 && y < 0) {
      this.children[2] = clone;
      x = x / 2;
      y = (y + 1) / 2;
      xer = (x: number) => x / 2;
      yer = (y: number) => (y + 1) / 2;
    }

    if (x < 1 && y > 1) {
      this.children[1] = clone;
      x = (x + 1) / 2;
      y = y / 2;
      xer = (x: number) => (x + 1) / 2;
      yer = (y: number) => y / 2;
    }

    if (x > 1 && y > 0) {
      this.children[0] = clone;
      x = x / 2;
      y = y / 2;
      xer = (x: number) => x / 2;
      yer = (y: number) => y / 2;
    }

    const [xer2, yer2] = this.expandQuadtrants(x, y, placeholder);
    return [(x: number) => xer2(xer(x)), (y: number) => yer2(yer(y))];
  }

  /* image representation */
  fillPolygon(polygon: [number, number][], value: number, depth: number) {
    if (this.value !== null && this.getLayer().getColor(this.value).locked) return;

    const polygonContainsPoint = (px: number, py: number, polygon: [number, number][]) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    if (depth <= 0 || depth === undefined) {
      const containsCenter = polygonContainsPoint(0.5, 0.5, polygon);

      if (containsCenter) return this.setValue(value);
      else return;
    }

    /* check if polygon completely contains this quadtree node */
    const linesIntersect = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => { 
      const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
      if (denom === 0) return false;
      const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
      const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
      return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    };

    const polygonContainsRect = (polygon: [number, number][]) => {
      if (!polygonContainsPoint(0, 0, polygon)) return false;
      if (!polygonContainsPoint(1, 0, polygon)) return false;
      if (!polygonContainsPoint(0, 1, polygon)) return false;
      if (!polygonContainsPoint(1, 1, polygon)) return false;

      for (let i = 0; i < polygon.length - 1; i++) {
        const x0 = polygon[i][0], y0 = polygon[i][1];
        const x1 = polygon[i + 1][0], y1 = polygon[i + 1][1];

        if (linesIntersect(x0, y0, x1, y1, 0, 0, 1, 0)) return false;
        if (linesIntersect(x0, y0, x1, y1, 1, 0, 1, 1)) return false;
        if (linesIntersect(x0, y0, x1, y1, 1, 1, 0, 1)) return false;
        if (linesIntersect(x0, y0, x1, y1, 0, 1, 0, 0)) return false;
      }

      return true;
    };

    if (polygonContainsRect(polygon)) return this.setValue(value);

    /* check if polygon is completely outside this quadtree node */
    const polygonMinX = Math.min(...polygon.map(p => p[0])); 
    const polygonMaxX = Math.max(...polygon.map(p => p[0]));
    const polygonMinY = Math.min(...polygon.map(p => p[1]));
    const polygonMaxY = Math.max(...polygon.map(p => p[1]));

    if (polygonMaxX <= 0 || polygonMinX >= 1 || polygonMaxY <= 0 || polygonMinY >= 1) return;

    this.subdivide();

    this.getChild(0).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2]), value, depth - 1);
    this.getChild(1).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2]), value, depth - 1);
    this.getChild(2).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2 - 1]), value, depth - 1);
    this.getChild(3).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2 - 1]), value, depth - 1);

    this.mergeIfPossible();
  }

  fillCircle(x: number, y: number, radius: number, value: number, depth: number) {
    if (this.value !== null && this.getLayer().getColor(this.value).locked) return;

    if (depth <= 0 || depth === undefined) {
      const distance = Math.hypot(x - 0.5, y - 0.5);
      const containsCenter = distance <= radius;

      if (containsCenter) return this.setValue(value);
      else return;
    }

    /* check if circle is completely outside this quadtree node */
    const closestX = Math.max(0, Math.min(1, x));
    const closestY = Math.max(0, Math.min(1, y));
    const distance = Math.hypot(closestX - x, closestY - y);

    if (distance >= radius)
      return;

    /* check if circle completely contains this quadtree node */
    const maxDistance = Math.max(
      Math.hypot(x - 0, y - 0),
      Math.hypot(x - 1, y - 0),
      Math.hypot(x - 0, y - 1),
      Math.hypot(x - 1, y - 1)
    );
    if (maxDistance <= radius) return this.setValue(value);

    this.subdivide();

    this.getChild(0).fillCircle(x * 2, y * 2, radius * 2, value, depth - 1);
    this.getChild(1).fillCircle(x * 2 - 1, y * 2, radius * 2, value, depth - 1);
    this.getChild(2).fillCircle(x * 2, y * 2 - 1, radius * 2, value, depth - 1);
    this.getChild(3).fillCircle(x * 2 - 1, y * 2 - 1, radius * 2, value, depth - 1);

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
    this.fillCircle(x0, y0, halfWidth, value, depth);
    this.fillCircle(x1, y1, halfWidth, value, depth);
    this.fillPolygon(corners, value, depth);
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
    const luv = this.getChild(0).getValueAt(lux, luy);
    if (luv !== null) return luv;

    const rux = lux - 1, ruy = luy;
    const ruv = this.getChild(1).getValueAt(rux, ruy);
    if (ruv !== null) return ruv;

    const ldx = lux, ldy = luy - 1;
    const ldv = this.getChild(2).getValueAt(ldx, ldy);
    if (ldv !== null) return ldv;

    const rdx = lux - 1, rdy = luy - 1;
    return this.getChild(3).getValueAt(rdx, rdy);
  }

  removeColor(colorId: number, placeholder: number) {
    if (this.isLeaf()) {
      if (this.getValue() === colorId) {
        this.setValue(placeholder);
      }
      return;
    }

    for (const child of this.children!) {
      child.removeColor(colorId, placeholder);
    }

    this.mergeIfPossible();
  }

  /* draw on ctx */
  draw(colorMap: { [key: number]: string }) {
    const depth = this.getDepth();
    if (depth > 12) return;

    if (depth < 4) {
      // draw it manually
      const imgSize = 1 << depth;
      this.image = null;
      this.image = document.createElement("canvas");
      this.image.width = imgSize;
      this.image.height = imgSize;

      const offscreenCtx: CanvasRenderingContext2D = this.image.getContext("2d")!;
      offscreenCtx.fillStyle = "transparent";
      offscreenCtx.fillRect(0, 0, imgSize, imgSize);

      const fillRect = (node: Quadtree, x: number, y: number, size: number) => {
        if (node.isLeaf()) {
          const color = colorMap[node.getValue() ?? -1];
          if (color === "transparent") return;
          offscreenCtx.fillStyle = color;
          offscreenCtx.fillRect(x, y, size, size);
          return;
        }

        const halfSize = size / 2;
        fillRect(node.getChild(0), x, y, halfSize);
        fillRect(node.getChild(1), x + halfSize, y, halfSize);
        fillRect(node.getChild(2), x, y + halfSize, halfSize);
        fillRect(node.getChild(3), x + halfSize, y + halfSize, halfSize);
      };

      fillRect(this, 0, 0, imgSize);
      return;
    }

    if (this.children !== null)
      this.children.forEach(child => child.draw(colorMap));

    const imgSize = 1 << depth;
    this.image = null;
    this.image = document.createElement("canvas");
    this.image.width = imgSize;
    this.image.height = imgSize;

    const offscreenCtx: CanvasRenderingContext2D = this.image.getContext("2d")!;
    if (imgSize === 1) { 
      offscreenCtx.fillStyle = colorMap[this.getValue() ?? -1];
      offscreenCtx.fillRect(0, 0, 1, 1);
      return;
    }

    const halfSize = 1 << (depth - 1);
    if (this.children === null)
      throw new Error("Quadtree children should not be null when drawing divided node.");
    offscreenCtx.imageSmoothingEnabled = false;
    offscreenCtx.clearRect(0, 0, imgSize, imgSize);
    offscreenCtx.drawImage(this.getChild(0).image!, 0, 0, halfSize, halfSize);
    offscreenCtx.drawImage(this.getChild(1).image!, halfSize, 0, halfSize, halfSize);
    offscreenCtx.drawImage(this.getChild(2).image!, 0, halfSize, halfSize, halfSize);
    offscreenCtx.drawImage(this.getChild(3).image!, halfSize, halfSize, halfSize, halfSize);
  }

  render(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    canvas: HTMLCanvasElement,
    colorMap: { [key: number]: string }, x = 0, y = 0, step = 0
  ) {
    if (this.image) {
      const [sx, sy] = camera.worldToScreen(x, y);
      const size = camera.zoom * Math.pow(0.5, step) + 1;
      ctx.imageSmoothingEnabled = false;
      if (size <= 1) return;
      if (sx + size < 0 || sy + size < 0 || sx > canvas.width || sy > canvas.height) return;
      if (this.image.width >= size && this.image.height >= size) {
        ctx.drawImage(this.image, sx, sy, size, size);
        return;
      }
    }

    if (camera.isBoxOutsideViewbox(x, y, x + Math.pow(0.5, step), y + Math.pow(0.5, step))) {
      return;
    }

    if (this.isLeaf()) {
      const color = colorMap[this.value ?? -1];
      if (color === "transparent") return;

      ctx.fillStyle = color;
      const [sx, sy] = camera.worldToScreen(x, y);
      const size = camera.zoom * Math.pow(0.5, step) + 1;
      if (size < 1) return;
      ctx.fillRect(sx, sy, size, size);
      return;
    }

    step++;
    this.getChild(0).render(ctx, camera, canvas, colorMap, x, y, step);
    this.getChild(1).render(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step), y, step);
    this.getChild(2).render(ctx, camera, canvas, colorMap, x, y + Math.pow(0.5, step), step);
    this.getChild(3).render(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step), y + Math.pow(0.5, step), step);
  }

  /* serialization */
  toJSON(): any {
    if (this.children === null) {
      if (this.value === null)
        throw new Error("Cannot serialize a quadtree leaf with null value.");
      return this.value;
    } else {
      return [
        this.getChild(0).toJSON(),
        this.getChild(1).toJSON(),
        this.getChild(2).toJSON(),
        this.getChild(3).toJSON()
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
  opacity: number;
  constructor(name: string, parent: Map | Layer) {
    this.name = name;
    this.parent = parent;
    this.colors = [new Color("Transparent", "transparent", this)];
    this.children = [];
    this.quadtree = new Quadtree(this.colors[0].id, this);
    this.id = getMap(parent).getNextLayerId();
    this.opacity = 1.0;
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
    const colorMap: { [key: number]: string } = { NaN: "transparent" };
    for (const color of this.colors) {
      colorMap[color.id] = color.color;
    }
    return colorMap;
  }

  getColor(colorId: number): Color {
    for (const color of this.colors) {
      if (color.id === colorId)
        return color;
    }
    throw new Error(`Color with id ${colorId} not found in layer ${this.name}.`);
  }

  /* draw on ctx */
  draw() {
    this.quadtree.draw(this.getColorMap());
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    ctx.globalAlpha = this.opacity;
    this.quadtree.render(ctx, camera, canvas, this.getColorMap());
    ctx.globalAlpha = 1.0;
    for (const child of this.children) {
      child.render(ctx, camera, canvas);
    }
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
  draw() {
    this.layer.draw();
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
  layer.colors = json.colors.map((colorJson: { name: string; color: string; id: number; locked: boolean }) => {
    const color = new Color(colorJson.name, colorJson.color, layer);
    color.id = colorJson.id;
    color.locked = colorJson.locked;
    return color;
  });
  layer.quadtree = quadtreeFromJSON(json.quadtree, layer);
  layer.children = json.children.map((childJson: any) => layerFromJSON(childJson, layer));
  return layer;
}

function quadtreeFromJSON(json: any, parent: Layer | Quadtree): Quadtree {
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
