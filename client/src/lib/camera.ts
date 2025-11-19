export default class Camera {
  x: number;
  y: number;
  zoom: number;
  canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, x = 0.5, y = 0.5, zoom = 1000) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.canvas = canvas;
  }

  worldToScreen(worldX: number, worldY: number): [number, number] {
    const screenX = (worldX - this.x) * this.zoom + this.canvas.width / 2;
    const screenY = (worldY - this.y) * this.zoom + this.canvas.height / 2;
    return [screenX, screenY];
  }

  screenToWorld(screenX: number, screenY: number): [number, number] {
    const worldX = (screenX - this.canvas.width / 2) / this.zoom + this.x;
    const worldY = (screenY - this.canvas.height / 2) / this.zoom + this.y;
    return [worldX, worldY];
  }

  isBoxOutsideViewbox(x1: number, y1: number, x2: number, y2: number): boolean {
    const [screenX1, screenY1] = this.worldToScreen(x1, y1);
    const [screenX2, screenY2] = this.worldToScreen(x2, y2);
    return (screenX2 < 0 || screenX1 > this.canvas.width || screenY2 < 0 || screenY1 > this.canvas.height);
  }

  setX(x: number) {
    this.x = Math.max(0, Math.min(1, x));
  }

  setY(y: number) {
    this.y = Math.max(0, Math.min(1, y));
  }

  setZoom(zoom: number) {
    this.zoom = Math.max(1000, Math.min(5000000, zoom));
  }
}
