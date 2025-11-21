import { Quadtree, Layer, Map, Color } from "./dataframe";

const depth = 9;

const map1 = new Map();
const layer1 = map1.layer;
const colorBackground1 = layer1.colors[0];
const colorRed1 = new Color("Red", "#ff0000", layer1)
const colorGreen1 = new Color("Green", "#00ff00", layer1)
layer1.addColor(colorRed1);
layer1.addColor(colorGreen1);
layer1.quadtree.fillCircle(0.5, 0.5, 0.5, colorRed1.id, depth);
layer1.quadtree.fillCircle(0.5, 0.5, 0.25, colorBackground1.id, depth);
layer1.quadtree.floodFill(0.5, 0.5, colorRed1.id);

const map2 = new Map();
const layer2 = map2.layer;
const colorRed2 = new Color("Red", "#ff0000", layer2)
layer2.addColor(colorRed2);
layer2.quadtree.fillCircle(0.5, 0.5, 0.5, colorRed2.id, depth);

if (JSON.stringify(layer1.quadtree) === JSON.stringify(layer2.quadtree)) {
  console.log("Test passed: The quadtrees are identical.");
} else {
  console.error("Test failed: The quadtrees are different.");
}