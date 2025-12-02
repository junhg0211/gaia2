import Camera from "./camera";

/* data */
export class Color {
  name: string;
  color: string;
  parent: Layer;
  id: number;
  locked: boolean;
  filterAts: number[];
  // Cache for mapping filter colorId -> owning Layer
  private _filterLayerCache?: globalThis.Map<number, Layer>;

  constructor(name: string, color: string, parent: Layer) {
    this.name = name;
    this.color = color;
    this.parent = parent;
    this.id = getMap(parent).getNextColorId();
    this.locked = false;
    this.filterAts = [];
  }

  /* get layer */
  getLayer(): Layer {
    return this.parent;
  }

  /* serialization */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      locked: this.locked,
      filterAts: this.filterAts
    };
  }

  // Resolve and cache owning layer for a filter color id
  getFilterLayer(filterAt: number): Layer {
    if (!this._filterLayerCache) this._filterLayerCache = new globalThis.Map();
    const cached = this._filterLayerCache.get(filterAt);
    if (cached) return cached;
    const layer = getMap(this.parent).getLayerByColorId(filterAt);
    this._filterLayerCache.set(filterAt, layer);
    return layer;
  }
}

export class Quadtree {
  value: number | null;
  children: Quadtree[] | null;
  parent: Quadtree | Layer;
  image: HTMLCanvasElement | null; 
  changes: boolean;
  // Memoized bounding box for this node
  private _bbox?: [number, number, number, number];

  constructor(value: number | null, parent: Quadtree | Layer) {
    this.value = value;
    this.children = null;
    this.parent = parent;
    this.image = null;
    this.changes = true;
  }

  /* value */
  setValue(value: number) {
    this.changes = true;

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
    return this.value !== null && this.children === null;
  }

  isDivided() {
    return this.children instanceof Array;
  }

  subdivide() {
    if (this.value === null) return;
    if (this.getLayer().getColor(this.value).locked) return;

    this.changes = true;

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

    this.changes = true;

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

  getNeighbors(): Quadtree[] {
    // Get the bounding box of this node relative to root
    const [x0, y0, x1, y1] = this.getBoundingBox();
    
    // Get root quadtree
    let root: Quadtree = this;
    while (root.parent instanceof Quadtree) {
      root = root.parent;
    }
    
    // Collect all leaf neighbors that share an edge
    const neighbors: Quadtree[] = [];
    const collectNeighbors = (node: Quadtree, nx0: number, ny0: number, nx1: number, ny1: number) => {
      if (node === this) return;
      
      if (node.isLeaf()) {
        // Check if edges touch
        const sharesEdge = 
          // Left/right edge: same x, overlapping y
          (Math.abs(nx1 - x0) < 1e-10 && ny0 < y1 && ny1 > y0) ||
          (Math.abs(nx0 - x1) < 1e-10 && ny0 < y1 && ny1 > y0) ||
          // Top/bottom edge: same y, overlapping x
          (Math.abs(ny1 - y0) < 1e-10 && nx0 < x1 && nx1 > x0) ||
          (Math.abs(ny0 - y1) < 1e-10 && nx0 < x1 && nx1 > x0);
        
        if (sharesEdge) {
          neighbors.push(node);
        }
        return;
      }
      
      // Recurse into children
      const midX = (nx0 + nx1) / 2;
      const midY = (ny0 + ny1) / 2;
      collectNeighbors(node.getChild(0), nx0, ny0, midX, midY);
      collectNeighbors(node.getChild(1), midX, ny0, nx1, midY);
      collectNeighbors(node.getChild(2), nx0, midY, midX, ny1);
      collectNeighbors(node.getChild(3), midX, midY, nx1, ny1);
    };
    
    collectNeighbors(root, 0, 0, 1, 1);
    neighbors.sort((a, b) => a.getDepth() - b.getDepth());
    return neighbors;
  }

  private getBoundingBox(): [number, number, number, number] {
    // Returns [x0, y0, x1, y1] of this node relative to root
    if (this._bbox) return this._bbox;
    if (!(this.parent instanceof Quadtree)) {
      this._bbox = [0, 0, 1, 1];
      return this._bbox;
    }
    
    const [px0, py0, px1, py1] = this.parent.getBoundingBox();
    const midX = (px0 + px1) / 2;
    const midY = (py0 + py1) / 2;
    
    const index = this.parent.children!.indexOf(this);
    if (index === 0) this._bbox = [px0, py0, midX, midY];
    else if (index === 1) this._bbox = [midX, py0, px1, midY];
    else if (index === 2) this._bbox = [px0, midY, midX, py1];
    else if (index === 3) this._bbox = [midX, midY, px1, py1];
    else throw new Error("Node not found in parent's children");
    return this._bbox;
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
    this.changes = true;

    try {
      this.subdivide();
    } catch {}

    let xer: (x: number) => number, yer: (y: number) => number;

    if (x <= 0 && y < 1) {
      this.children[3] = clone;
      x = (x + 1) / 2;
      y = (y + 1) / 2;
      xer = (x: number) => (x + 1) / 2;
      yer = (y: number) => (y + 1) / 2;
    }

    if (x > 0 && y <= 0) {
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

  getAddressFromLayer() {
    const layer = this.getLayer();
    let x = 0, y = 0;
    let depth = 0;
    let node: Quadtree | Layer = this;
    const path = [];
    while (node instanceof Quadtree && node.parent instanceof Quadtree) {
      const parent: Quadtree = node.parent;
      const index = parent.children!.indexOf(node);
      if (index === 0) {
        path.push(0);
      }
      if (index === 1) {
        path.push(1);
        x += Math.pow(2, depth);
      }
      if (index === 2) {
        path.push(2);
        y += Math.pow(2, depth);
      }
      if (index === 3) {
        path.push(3);
        x += Math.pow(2, depth);
        y += Math.pow(2, depth);
      }
      depth++;
      node = parent;
    }
    return { x, y, depth, path: path.reverse() };
  }

  /* image representation */
  fillPolygon(polygon: [number, number][], color: Color, depth: number) {
    if (this.value !== null && this.getLayer().getColor(this.value).locked) return;

    this.changes = true;

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
      // Quick reject: if polygon center not inside, skip costly filter evaluation
      const containsCenter = polygonContainsPoint(0.5, 0.5, polygon);
      if (!containsCenter) return;

      // Correct filter evaluation: check overlap of this node's region
      // against the other layer's quadtree without mutating either tree.
      const [rx0, ry0, rx1, ry1] = this.getBoundingBox();
      // Per-operation cache for overlap queries keyed by layer+color+node
      const opCache = (Quadtree as any)._opCache as globalThis.Map<string, boolean> | undefined;
      if (!(Quadtree as any)._opCache) (Quadtree as any)._opCache = new globalThis.Map();
      const cache: globalThis.Map<string, boolean> = (Quadtree as any)._opCache;

      const overlapsColorInRegion = (root: Quadtree, target: number, layerId: number): boolean => {
        const key = `${layerId}:${target}:${rx0},${ry0},${rx1},${ry1}`;
        const cached = cache.get(key);
        if (cached !== undefined) return cached;

        // DFS from root with region clipping to avoid relying on path
        const dfs = (n: Quadtree, nx0: number, ny0: number, nx1: number, ny1: number): boolean => {
          if (nx1 <= rx0 || nx0 >= rx1 || ny1 <= ry0 || ny0 >= ry1) return false;
          if (n.isLeaf()) return n.getValue() === target;
          const midX = (nx0 + nx1) / 2;
          const midY = (ny0 + ny1) / 2;
          return (
            dfs(n.getChild(0), nx0, ny0, midX, midY) ||
            dfs(n.getChild(1), midX, ny0, nx1, midY) ||
            dfs(n.getChild(2), nx0, midY, midX, ny1) ||
            dfs(n.getChild(3), midX, midY, nx1, ny1)
          );
        };
        const result = dfs(root, 0, 0, 1, 1);
        cache.set(key, result);
        return result;
      };

      let possible = color.filterAts.length === 0;
      if (!possible && color.filterAts.length > 0) {
        const map = getMap(this.getLayer());
        for (const filterAt of color.filterAts) {
          const layer: Layer = map.getLayerByColorId(filterAt);
          if (overlapsColorInRegion(layer.quadtree, filterAt, layer.id)) { possible = true; break; }
        }
      }

      if (!possible) return;
      // Center already checked at start
      return this.setValue(color.id);
    }

    /* check if polygon is completely outside this quadtree node */
    const polygonMinX = Math.min(...polygon.map(p => p[0])); 
    const polygonMaxX = Math.max(...polygon.map(p => p[0]));
    const polygonMinY = Math.min(...polygon.map(p => p[1]));
    const polygonMaxY = Math.max(...polygon.map(p => p[1]));

    if (polygonMaxX <= 0 || polygonMinX >= 1 || polygonMaxY <= 0 || polygonMinY >= 1) return;

    this.subdivide();
    this.getChild(0).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2]), color, depth - 1);
    this.getChild(1).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2]), color, depth - 1);
    this.getChild(2).fillPolygon(polygon.map(p => [p[0] * 2, p[1] * 2 - 1]), color, depth - 1);
    this.getChild(3).fillPolygon(polygon.map(p => [p[0] * 2 - 1, p[1] * 2 - 1]), color, depth - 1);
    this.mergeIfPossible();
  }

  fillCircle(x: number, y: number, radius: number, color: Color, depth: number) {
    if (this.value !== null && this.getLayer().getColor(this.value).locked) return;

    this.changes = true;

    if (depth <= 0 || depth === undefined) {
      const distance = Math.hypot(x - 0.5, y - 0.5);
      const containsCenter = distance <= radius;

      if (containsCenter) return this.setValue(color.id);
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
    if (maxDistance <= radius) return this.setValue(color.id);

    this.subdivide();
    this.getChild(0).fillCircle(x * 2, y * 2, radius * 2, color, depth - 1);
    this.getChild(1).fillCircle(x * 2 - 1, y * 2, radius * 2, color, depth - 1);
    this.getChild(2).fillCircle(x * 2, y * 2 - 1, radius * 2, color, depth - 1);
    this.getChild(3).fillCircle(x * 2 - 1, y * 2 - 1, radius * 2, color, depth - 1);
    this.mergeIfPossible();
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, value: number, depth: number) {
    if (this.value !== null && this.getLayer().getColor(this.value).locked) return;

    this.changes = true;

    if (depth <= 0 || depth === undefined) {
      const containsCenter = (0.5 >= x0 && 0.5 <= x1 && 0.5 >= y0 && 0.5 <= y1);

      if (containsCenter) return this.setValue(value);
      else return;
    }
    
    /* check if rectangle completely contains this quadtree node */
    if (x0 <= 0 && x1 >= 1 && y0 <= 0 && y1 >= 1) return this.setValue(value);
    /* check if rectangle is completely outside this quadtree node */
    if (x1 <= 0 || x0 >= 1 || y1 <= 0 || y0 >= 1) return;

    this.subdivide();

    this.getChild(0).fillRect(x0 * 2, y0 * 2, x1 * 2, y1 * 2, value, depth - 1);
    this.getChild(1).fillRect(x0 * 2 - 1, y0 * 2, x1 * 2 - 1, y1 * 2, value, depth - 1);
    this.getChild(2).fillRect(x0 * 2, y0 * 2 - 1, x1 * 2, y1 * 2 - 1, value, depth - 1);
    this.getChild(3).fillRect(x0 * 2 - 1, y0 * 2 - 1, x1 * 2 - 1, y1 * 2 - 1, value, depth - 1);

    this.mergeIfPossible();
  }

  floodFill(x: number, y: number, value: number) {
    // Use strict outside check (allow filling exactly on boundary coordinates)
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    this.changes = true;

    // Descend to leaf containing (x,y)
    if (this.isDivided()) {
      const lux = x * 2, luy = y * 2;
      this.isDivided() && this.getChild(0).floodFill(lux, luy, value);
      this.isDivided() && this.getChild(1).floodFill(lux - 1, luy, value);
      this.isDivided() && this.getChild(2).floodFill(lux, luy - 1, value);
      this.isDivided() && this.getChild(3).floodFill(lux - 1, luy - 1, value);
      return;
    }

    const originalValue = this.getValue();
    if (originalValue === value) return;
    if (this.getLayer().getColor(originalValue).locked) return;

    // BFS over adjacent leaf nodes that have originalValue
    const stack: Quadtree[] = [this];
    const visited = new Set<Quadtree>();
    const changed: Quadtree[] = [];

    while (stack.length) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (!node.isLeaf()) {
        // If encountered a divided node (should be rare once we start at leaf), just descend
        const [x0, y0, x1, y1] = node.getBoundingBox();
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        node.floodFill(cx, cy, value); // delegate
        continue;
      }
      const v = node.getValue();
      if (v !== originalValue) continue;
      if (node.getLayer().getColor(v).locked) continue;
      node.setValue(value);
      changed.push(node);
      // Explore neighbors
      node.getNeighbors().forEach(n => {
        if (!visited.has(n)) stack.push(n);
      });
    }

    // After all changes, attempt upward merging from each changed node
    for (const leaf of changed) {
      let p: Quadtree | null = leaf.parent instanceof Quadtree ? leaf.parent : null;
      while (p) {
        const beforeChildren = p.children;
        p.mergeIfPossible();
        // If this level just collapsed, attempt moving further up
        if (p.isLeaf() && beforeChildren !== null) {
          p = p.parent instanceof Quadtree ? p.parent : null;
          continue;
        }
        p = p.parent instanceof Quadtree ? p.parent : null;
      }
    }
    // Final merge pass on root
    let root: Quadtree = this;
    while (root.parent instanceof Quadtree) root = root.parent;
    root.mergeIfPossible();
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: Color, width: number, depth: number) {
    const theta = Math.atan2(y1 - y0, x1 - x0);
    const halfWidth = width / 2;
    const corners: [number, number][] = [
      [x0 + halfWidth * Math.cos(theta + Math.PI / 2), y0 + halfWidth * Math.sin(theta + Math.PI / 2)],
      [x0 + halfWidth * Math.cos(theta - Math.PI / 2), y0 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta - Math.PI / 2), y1 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta + Math.PI / 2), y1 + halfWidth * Math.sin(theta + Math.PI / 2)]
    ];
    this.fillCircle(x0, y0, halfWidth, color, depth);
    this.fillCircle(x1, y1, halfWidth, color, depth);
    this.fillPolygon(corners, color, depth);
  }

  getValueAt(x: number, y: number): number | null {
    if (x <= 0 || x > 1 || y <= 0 || y > 1) return null;

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
    this.changes = true;

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
    if (!this.changes) return;
    this.changes = false;

    const depth = this.getDepth();

    if (depth <= 4) {
      this.image = document.createElement("canvas");
      this.image.width = 1 << depth;
      this.image.height = 1 << depth;
      const offscreenCtx: CanvasRenderingContext2D = this.image.getContext("2d")!;

      const drawNode = (node: Quadtree, x: number, y: number, size: number) => {
        if (node.isLeaf()) {
          offscreenCtx.fillStyle = colorMap[node.getValue() ?? -1];
          offscreenCtx.fillRect(x, y, size, size);
          return;
        }

        const halfSize = size / 2;
        if (node.children !== null) {
          drawNode(node.getChild(0), x, y, halfSize);
          drawNode(node.getChild(1), x + halfSize, y, halfSize);
          drawNode(node.getChild(2), x, y + halfSize, halfSize);
          drawNode(node.getChild(3), x + halfSize, y + halfSize, halfSize);
        }
      };
      drawNode(this, 0, 0, 1 << depth);
      return;
    }

    if (this.children !== null)
      this.children.forEach(child => child.draw(colorMap));

    const imgSize = Math.min(1 << depth, 1 << 10);
    this.image = document.createElement("canvas");
    this.image.width = imgSize;
    this.image.height = imgSize;

    const offscreenCtx: CanvasRenderingContext2D = this.image.getContext("2d")!;
    if (this.isLeaf()) { 
      offscreenCtx.fillStyle = colorMap[this.getValue() ?? -1];
      offscreenCtx.fillRect(0, 0, 1, 1);
      return;
    }

    const halfSize = imgSize / 2;
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
    const [sx, sy] = camera.worldToScreen(x, y);
    const size = camera.zoom * Math.pow(0.5, step) + 1;
    const debug = false;

    if (sx + size < 0 || sx > canvas.width || sy + size < 0 || sy > canvas.height) return;
    if (this.isLeaf() && colorMap[this.getValue() ?? -1] === "transparent") return;

    if (camera.zoom * window.devicePixelRatio * Math.pow(0.5, step) <= Math.min(canvas.width, canvas.height)) {
      if (this.image === null) this.draw(colorMap);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image!, sx, sy, size, size);
      
      if (debug) {
        ctx.strokeStyle = "red";
        ctx.lineWidth = window.devicePixelRatio;
        ctx.strokeRect(sx, sy, size, size);
      }

      return;
    }

    if (this.isDivided()) {
      const halfSize = Math.pow(0.5, step + 1);
      this.getChild(0).render(ctx, camera, canvas, colorMap, x, y, step + 1);
      this.getChild(1).render(ctx, camera, canvas, colorMap, x + halfSize, y, step + 1);
      this.getChild(2).render(ctx, camera, canvas, colorMap, x, y + halfSize, step + 1);
      this.getChild(3).render(ctx, camera, canvas, colorMap, x + halfSize, y + halfSize, step + 1);
    } else {
      if (this.image === null) this.draw(colorMap);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = colorMap[this.getValue() ?? -1];
      ctx.fillRect(sx, sy, size, size);
      
      if (debug) {
        ctx.strokeStyle = "blue";
        ctx.lineWidth = window.devicePixelRatio;
        ctx.strokeRect(sx, sy, size, size);
      }

      return;
    }
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
    this.colors = [new Color("공허", "transparent", this)];
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

  getAddress(x: number, y: number) {
    const node = this.quadtree;
    let depth = 0;
    let cx = x;
    let cy = y;
    const path = [];
    while (node.isDivided()) {
      const half = 1 << depth;
      let quadrant = 0;
      if (cx >= half) {
        cx -= half;
        quadrant += 1;
      }
      if (cy >= half) {
        cy -= half;
        quadrant += 2;
      }
      depth++;
      path.push(quadrant);
    }
    return { x: cx, y: cy, depth, path };
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

  updateFromLayer(layer: Layer) {
    this.id = layer.id;
    this.name = layer.name;
    this.colors = layer.colors;
    this.children = layer.children;
    this.quadtree = layer.quadtree;
    this.opacity = layer.opacity;
  }
}

export class Map {
  nextLayerId: number;
  nextColorId: number;
  layer: Layer;
  size: number;
  constructor() {
    this.nextLayerId = 1;
    this.nextColorId = 1;
    this.layer = new Layer("Root", this);
    this.size = 1_000_000_000;
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

  getLayerByColorId(filterAt: number): Layer {
    function searchLayerForColor(layer: Layer, colorId: number): Layer | null {
      for (const color of layer.colors) {
        if (color.id === colorId) return layer;
      }
      for (const childLayer of layer.children) {
        const result = searchLayerForColor(childLayer, colorId);
        if (result) return result;
      }
      return null;
    }
    const layer = searchLayerForColor(this.layer, filterAt);
    if (layer === null)
      throw new Error(`Color with id ${filterAt} not found in any layer.`);
    return layer;
  }

  /* image rendering */
  draw() {
    this.layer.draw();
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, canvas: HTMLCanvasElement) {
    this.layer.render(ctx, camera, canvas);
  }

  renderToImage(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const camera = new Camera(canvas);
    camera.zoomToFit(width, this.size);
    this.render(ctx, camera, canvas);
  }

  /* serialization */
  toJSON() {
    return {
      layer: this.layer.toJSON(),
      nextLayerId: this.nextLayerId,
      nextColorId: this.nextColorId,
      size: this.size
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
  map.size = json.size;
  return map;
}

export function layerFromJSON(json: any, parent: Map | Layer): Layer {
  const layer = new Layer(json.name, parent);
  layer.id = json.id;
  layer.colors = json.colors.map((colorJson: { name: string; color: string; id: number; locked: boolean; filterAts: number[] }) => {
    const color = new Color(colorJson.name, colorJson.color, layer);
    color.id = colorJson.id;
    color.locked = colorJson.locked;
    color.filterAts = colorJson.filterAts || [];
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
