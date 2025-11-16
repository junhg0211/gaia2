/* data */
export class Color {
  constructor(name, color, parent) {
    this.name = name;
    this.color = color;
    this.parent = parent;
    this.id = getMap(parent).getNextColorId();
  }

  /* serialization */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color
    };
  }
}

function polygonContainsPoint(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export class Quadtree {
  constructor(value, parent) {
    this.value = value;
    this.children = null;
    this.parent = parent;
  }

  /* value */
  setValue(value) {
    this.value = value;
    this.children = null;
  }

  getValue() {
    if (this.isDivided())
      throw new Error("Cannot get value of a divided quadtree node.");
    return this.value;
  }

  /* children */
  getChild(index) {
    if (this.isLeaf())
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
    if (this.isLeaf()) return;

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

  /* image representation */
  fillPolygon(polygon, value, depth) {
    if (depth <= 0 || depth === undefined) {
      const containsCenter = polygonContainsPoint(polygon, 0.5, 0.5);

      if (containsCenter) return this.setValue(value);
      else return;
    }

    const luIncluded = polygonContainsPoint(polygon, 0, 0);
    const ruIncluded = polygonContainsPoint(polygon, 1, 0);
    const ldIncluded = polygonContainsPoint(polygon, 0, 1);
    const rdIncluded = polygonContainsPoint(polygon, 1, 1);
    if (luIncluded && ruIncluded && ldIncluded && rdIncluded)
      return this.setValue(value);
    if (!(luIncluded || ruIncluded || ldIncluded || rdIncluded)) return;

    this.subdivide();

    const luPolygon = polygon.map(([x, y]) => [x * 0.5, y * 0.5]);
    const ruPolygon = polygon.map(([x, y]) => [0.5 + x * 0.5, y * 0.5]);
    const ldPolygon = polygon.map(([x, y]) => [x * 0.5, 0.5 + y * 0.5]);
    const rdPolygon = polygon.map(([x, y]) => [0.5 + x * 0.5, 0.5 + y * 0.5]);
    this.children[0].fillPolygon(luPolygon, value, depth - 1);
    this.children[1].fillPolygon(ruPolygon, value, depth - 1);
    this.children[2].fillPolygon(ldPolygon, value, depth - 1);
    this.children[3].fillPolygon(rdPolygon, value, depth - 1);

    this.mergeIfPossible();
  }

  fillCircle(x, y, radius, value, depth) {
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

  drawLine(x0, y0, x1, y1, value, width, depth) {
    const theta = Math.atan2(y1 - y0, x1 - x0);
    const halfWidth = width / 2;
    const corners = [
      [x0 + halfWidth * Math.cos(theta + Math.PI / 2), y0 + halfWidth * Math.sin(theta + Math.PI / 2)],
      [x0 + halfWidth * Math.cos(theta - Math.PI / 2), y0 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta - Math.PI / 2), y1 + halfWidth * Math.sin(theta - Math.PI / 2)],
      [x1 + halfWidth * Math.cos(theta + Math.PI / 2), y1 + halfWidth * Math.sin(theta + Math.PI / 2)]
    ];
    this.fillPolygon(corners, value, depth);
    this.fillCircle(x0, y0, halfWidth, value, depth);
    this.fillCircle(x1, y1, halfWidth, value, depth);
  }

  overwrite(otherQuadtree, includeFunction) {
    if (otherQuadtree.isLeaf()) {
      if (includeFunction(otherQuadtree.getValue()))
        this.setValue(otherQuadtree.getValue());
      return;
    }

    this.subdivide();
    for (let i = 0; i < 4; i++)
      this.children[i].overwrite(otherQuadtree.getChild(i), includeFunction);
    this.mergeIfPossible();
  }

  getValueAt(x, y) {
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;

    if (this.isLeaf())
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
  draw(ctx, camera, canvas, colorMap, x = 0, y = 0, step = 1) {
    if (this.isLeaf()) {
      const color = colorMap[this.value];
      if (color === "transparent") return;

      ctx.fillStyle = color;
      const [sx, sy] = camera.worldToScreen(x, y);
      const size = camera.zoom * Math.pow(0.5, step - 1);
      ctx.fillRect(sx, sy, size, size);
    } else {
      step++;
      this.getChild(0).draw(ctx, camera, canvas, colorMap, x, y, step);
      this.getChild(1).draw(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step - 1), y, step);
      this.getChild(2).draw(ctx, camera, canvas, colorMap, x, y + Math.pow(0.5, step - 1), step);
      this.getChild(3).draw(ctx, camera, canvas, colorMap, x + Math.pow(0.5, step - 1), y + Math.pow(0.5, step - 1), step);
    }
  }

  /* serialization */
  toJSON() {
    if (this.isLeaf()) {
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
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.colors = [new Color("Transparent", "transparent", this)];
    this.children = [];
    this.quadtree = new Quadtree(this.colors[0].id, this);
    this.id = getMap(parent).getNextLayerId();
  }

  /* colors */
  addColor(color) {
    this.colors.push(color);
  }

  includesColor(colorName) {
    return this.colors.some(color => color.name === colorName);
  }

  /* children */
  addChild(layer) {
    this.children.push(layer);
  }

  includesLayer(layerId) {
    return this.children.some(layer => layer.getId() === layerId);
  }

  includesColor(colorId) {
    return this.colors.some(color => color.id === colorId);
  }

  /* draw on ctx */
  draw(ctx, camera, canvas) {
    const colorMap = {};
    for (const color of this.colors) {
      colorMap[color.id] = color.color;
    }

    this.quadtree.draw(ctx, camera, canvas, colorMap);
  }

  /* serialization */
  toJSON() {
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

  /* draw on ctx */
  draw(ctx, camera, canvas) {
    this.layer.draw(ctx, camera, canvas);
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

function getMap(thing) {
  if (thing instanceof Map)
    return thing;
  return thing.parent;
}

/* deserialization */
export function mapFromJSON(json) {
  const map = new Map();
  map.layer = layerFromJSON(json.layer, map);
  map.nextLayerId = json.nextLayerId;
  map.nextColorId = json.nextColorId;
  return map;
}

function layerFromJSON(json, parent) {
  const layer = new Layer(json.name, parent);
  layer.id = json.id;
  layer.colors = json.colors.map(colorJson => {
    const color = new Color(colorJson.name, colorJson.color, layer);
    color.id = colorJson.id;
    return color;
  });
  layer.quadtree = quadtreeFromJSON(json.quadtree, layer);
  layer.children = json.children.map(childJson => layerFromJSON(childJson, layer));
  return layer;
}

function quadtreeFromJSON(json, parent) {
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
