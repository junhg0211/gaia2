declare module "../../../dataframe.js" {
  export class Color {
    id: number;
    name: string;
    color: string;
    parent: Layer;
    constructor(name: string, color: string, parent: Layer);
    toJSON(): { id: number; name: string; color: string };
  }

  export class Quadtree {
    drawLine(x0: number, y0: number, x1: number, y1: number, value: number, width: number, depth: number): void;
    draw(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement, colorMap: { [key: number]: string }): void;
    render(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement, colorMap: { [key: number]: string }): void;
  }

  export class Layer {
    id: number;
    name: string;
    parent: Map | Layer;
    colors: Color[];
    children: Layer[];
    quadtree: Quadtree;
    addColor(color: Color): void;
    getColorMap(): { [key: number]: string };
    draw(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement): void;
    render(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement): void;
    toJSON(): any;
  }

  export class Map {
    layer: Layer;
    getLayerById(layerId: number): Layer | null;
    getColorById(colorId: number): Color | null;
    draw(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement): void;
    render(ctx: CanvasRenderingContext2D, camera: any, canvas: HTMLCanvasElement): void;
    toJSON(): any;
  }

  export function mapFromJSON(json: any): Map;
}

declare module "../../../../dataframe.js" {
  export { Color, Quadtree, Layer, Map, mapFromJSON } from "../../../dataframe.js";
}
