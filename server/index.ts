import WebSocket, { WebSocketServer } from 'ws';
import { Map, Color, Layer, mapFromJSON } from "../dataframe.ts";
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import path from 'path';
import { get } from 'http';

/* server setup (HTTPS for WSS) */
const port = parseInt(process.env.PORT || '48829', 10);
const host = process.env.HOST || "0.0.0.0";

// TLS credentials: env vars or default local dev files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, 'key.pem');
const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, 'cert.pem');

let tlsOptions: { key?: Buffer; cert?: Buffer } = {};
try {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    tlsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } else {
    console.warn(`TLS key/cert not found. Expected at:\n  key: ${keyPath}\n  cert: ${certPath}`);
  }
} catch (err) {
  console.error('Failed to read TLS credentials:', err);
}

let map = new Map();
const mapPath = 'map.json';
if (fs.existsSync(mapPath)) {
  const mapData = fs.readFileSync(mapPath, 'utf-8');
  const mapJSON = JSON.parse(mapData);
  map = mapFromJSON(mapJSON);
}

const connections: WebSocket[] = [];
type Command = {
  prefix: string;
  action: (announce: (msg: string) => void, send: (msg: string) => void, content: string, args: string[]) => void;
};

const commands: Command[] = [
  {
    prefix: 'load',
    action: (announce, send, content, args) => {
      send(`map\t${JSON.stringify(map.toJSON())}`);
    }
  },
  {
    prefix: 'newcolor',
    action: (announce, send, content, args) => {
      let [rawLayerId, colorName, colorValue] = args;
      const layerId = parseInt(rawLayerId);

      const layer = map.getLayerById(layerId);
      if (!layer) return;
      const color = new Color(colorName, colorValue, layer);
      announce(`newcolor\t${layer.id}\t${colorName}\t${colorValue}`);
      layer.addColor(color);
      console.log(`${getTimestamp()} New color created: ${color.id} (${color.name}, ${color.color}) in layer ${layer.id}`);
    }
  },
  {
    prefix: 'newlayer',
    action: (announce, send, content, args) => {
      let [rawParentLayerId, layerName] = args;
      const parentLayerId = parseInt(rawParentLayerId);

      const parentLayer = map.getLayerById(parentLayerId);
      if (!parentLayer) return;
      const newLayer = new Layer(layerName, parentLayer);
      announce(`newlayer\t${parentLayer.id}\t${layerName}`);
      parentLayer.children.push(newLayer);
      console.log(`${getTimestamp()} New layer created: ${newLayer.id} (${newLayer.name}) under layer ${parentLayer.id}`);
    }
  },
  {
    prefix: 'drawline',
    action: (announce, send, content, args) => {
      let [rawX0, rawY0, rawX1, rawY1, rawBrushSize, rawColorId, rawDepth] = args;
      let x0 = parseFloat(rawX0);
      let y0 = parseFloat(rawY0);
      let x1 = parseFloat(rawX1);
      let y1 = parseFloat(rawY1);
      const brushSize = parseFloat(rawBrushSize);
      const colorId = parseInt(rawColorId);
      const depth = parseInt(rawDepth);

      const minX = Math.min(x0, x1) - brushSize / 2;
      const minY = Math.min(y0, y1) - brushSize / 2;
      const maxX = Math.max(x0, x1) + brushSize / 2;
      const maxY = Math.max(y0, y1) + brushSize / 2;

      if (minX < 0 || minY < 0 || maxX > 1 || maxY > 1) {
        announce(`expand\t${minX}\t${minY}\t${maxX}\t${maxY}`);
        const placeholder = map.layer.colors[0]?.id || 1;
        const [xer1, yer1] = map.layer.quadtree.expandQuadtrants(minX, minY, placeholder);
        const [xer2, yer2] = map.layer.quadtree.expandQuadtrants(maxX, maxY, placeholder);
        x0 = xer2(xer1(x0));
        y0 = yer2(yer1(y0));
        x1 = xer2(xer1(x1));
        y1 = yer2(yer1(y1));

        const sizeFactor = 1 / (xer2(xer1(1)) - xer2(xer1(0)));
        map.size *= sizeFactor;
      }

      const color = map.getColorById(colorId);
      if (!color) return;
      announce(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${brushSize}\t${colorId}\t${depth}`);
      color.parent.quadtree.drawLine(x0, y0, x1, y1, color, brushSize, depth);
      console.log(`${getTimestamp()} Draw line on color ${color.id} (${color.name}) in layer ${color.parent.id}: (${x0}, ${y0}) to (${x1}, ${y1}), brush size ${brushSize}, depth ${depth}`);
    }
  },
  {
    prefix: 'fillpolygon',
    action: (announce, send, content, args) => {
      let [rawLayerId, rawPolygon, rawColorId, rawDepth] = args;
      const layerId = parseInt(rawLayerId);
      const colorId = parseInt(rawColorId);
      let depth = parseInt(rawDepth);

      const layer = map.getLayerById(layerId);
      if (!layer) return;
      const color = map.getColorById(colorId);
      if (!color) return;

      const polygon: [number, number][] = rawPolygon.split(';').map(pair => {
        const [xStr, yStr] = pair.split(',');
        return [parseFloat(xStr), parseFloat(yStr)];
      });

      const maxX = Math.max(...polygon.map(([x, _]) => x));
      const maxY = Math.max(...polygon.map(([_, y]) => y));
      const minX = Math.min(...polygon.map(([x, _]) => x));
      const minY = Math.min(...polygon.map(([_, y]) => y));

      if (minX < 0 || minY < 0 || maxX > 1 || maxY > 1) {
        announce(`expand\t${minX}\t${minY}\t${maxX}\t${maxY}`);
        const placeholder = layer.colors[0]?.id || 1;
        const expandLayer = (layer: Layer) => {
          const [xer1, yer1] = layer.quadtree.expandQuadtrants(minX, minY, placeholder);
          const [xer2, yer2] = layer.quadtree.expandQuadtrants(maxX, maxY, placeholder);
          for (const child of layer.children) {
            expandLayer(child);
          }
          return [(x: number) => xer2(xer1(x)), (y: number) => yer2(yer1(y))];
        };
        const [xer, yer] = expandLayer(map.layer);
        depth += 1 / (xer(1) - xer(0));
        const sizeFactor = 1 / (xer(1) - xer(0));
        map.size *= sizeFactor;

        for (let i = 0; i < polygon.length; i++) {
          const [x, y] = polygon[i];
          polygon[i] = [xer(x), yer(y)];
        }
      }

      const polygonString = polygon.map(([x, y]) => `${x},${y}`).join(';');
      announce(`fillpolygon\t${layerId}\t${polygonString}\t${colorId}\t${depth}`);
      layer.quadtree.fillPolygon(polygon, color, depth);
      console.log(`${getTimestamp()} Fill polygon on color ${color.id} (${color.name}) in layer ${layer.id}: [${polygonString}], depth ${depth}`);
    }
  },
  {
    prefix: 'renamecolor',
    action: (announce, send, content, args) => {
      let [rawColorId, newName] = args;
      const colorId = parseInt(rawColorId);

      const color = map.getColorById(colorId);
      if (!color) return;
      announce(`renamecolor\t${colorId}\t${newName}`);
      color.name = newName;
      console.log(`${getTimestamp()} Rename color ${color.id} to ${newName} in layer ${color.parent.id}`);
    }
  },
  {
    prefix: 'changecolor',
    action: (announce, send, content, args) => {
      let [rawColorId, newColorValue] = args;
      const colorId = parseInt(rawColorId);

      const color = map.getColorById(colorId);
      if (!color) return;
      announce(`changecolor\t${colorId}\t${newColorValue}`);
      color.color = newColorValue;
      console.log(`${getTimestamp()} Change color ${color.id} to ${newColorValue} in layer ${color.parent.id}`);
    }
  },
  {
    prefix: 'removecolor',
    action: (announce, send, content, args) => {
      let [rawColorId] = args;
      const colorId = parseInt(rawColorId);

      const color = map.getColorById(colorId);
      if (!color) return;
      const parentLayer: Layer = color.parent;
      announce(`removecolor\t${colorId}`);
      color.locked = false;
      parentLayer.quadtree.removeColor(colorId, parentLayer.colors[0]?.id || 1);
      parentLayer.colors = parentLayer.colors.filter(c => c.id !== colorId);
      console.log(`${getTimestamp()} Remove color ${color.id} (${color.name}) from layer ${parentLayer.id}`);
    }
  },
  {
    prefix: 'save',
    action: (announce, send, content, args) => {
      const mapJSON = JSON.stringify(map.toJSON());
      fs.writeFileSync(mapPath, mapJSON);
      console.log(`${getTimestamp()} Map saved to ${mapPath}`);
    }
  },
  {
    prefix: 'renamelayer',
    action: (announce, send, content, args) => {
      let [rawLayerId, newName] = args;
      const layerId = parseInt(rawLayerId);
      const layer = map.getLayerById(layerId);
      if (!layer) return;
      announce(`renamelayer\t${layerId}\t${newName}`);
      layer.name = newName;
      console.log(`${getTimestamp()} Rename layer ${layer.id} to ${newName}`);
    }
  },
  {
    prefix: 'removelayer',
    action: (announce, send, content, args) => {
      let [rawLayerId] = args;
      const layerId = parseInt(rawLayerId);
      const layer = map.getLayerById(layerId);
      if (!layer) return;
      if (layer === map.layer) return;
      const parentLayer = layer.parent as Layer;
      announce(`removelayer\t${layerId}`);
      parentLayer.children = parentLayer.children.filter(l => l.id !== layerId);
      console.log(`${getTimestamp()} Remove layer ${layer.id} from parent layer ${parentLayer.id}`);
    }
  },
  {
    prefix: "setcolorlock",
    action: (announce, send, content, args) => {
      let [rawColorId, rawLocked] = args;
      const colorId = parseInt(rawColorId);
      const locked = rawLocked === '1';

      const color = map.getColorById(colorId);
      if (!color) return;
      announce(`setcolorlock\t${colorId}\t${locked ? 1 : 0}`);
      color.locked = locked;
      console.log(`${getTimestamp()} Set color lock ${color.id} (${color.name}) in layer ${color.parent.id} to ${locked}`);
    }
  },
  {
    prefix: 'fill',
    action: (announce, send, content, args) => {
      let [rawLayerId, rawX, rawY, rawColorId] = args;
      const layerId = parseInt(rawLayerId);
      const x = parseFloat(rawX);
      const y = parseFloat(rawY);
      const colorId = parseInt(rawColorId);

      const layer = map.getLayerById(layerId);;
      if (!layer) return;
      const color = map.getColorById(colorId);
      if (!color) return;

      announce(`fill\t${layerId}\t${x}\t${y}\t${colorId}`);
      layer.quadtree.floodFill(x, y, color.id);
      console.log(`${getTimestamp()} Fill on color ${color.id} (${color.name}) in layer ${layer.id} at (${x}, ${y})`);
    }
  },
  {
    prefix: "loadlayer",
    action: (announce, send, content, args) => {
      let [rawLayerId] = args;
      const layerId = parseInt(rawLayerId);

      const layer = map.getLayerById(layerId);
      if (!layer) return;
      send(`layer\t${layerId}\t${JSON.stringify(layer.toJSON())}`);
    }
  },
  {
    prefix: "setmapsize",
    action: (announce, send, content, args) => {
      let [rawSize] = args;
      const newSize = parseFloat(rawSize);
      announce(`setmapsize\t${newSize}`);
      map.size = newSize;
      console.log(`${getTimestamp()} Set map size to ${newSize}`);
    }
  },
  {
    prefix: "loadimage",
    action: (announce, send, content, args) => {
      const [rawLayerId, rawWidth, rawHeight, rawColorPairs, rawPixelData] = args;
      const layerId = parseInt(rawLayerId);
      const width = parseInt(rawWidth);
      const height = parseInt(rawHeight);

      const layer = map.getLayerById(layerId);
      if (!layer) return;

      const colorMap: { [key: number]: Color } = {};
      const colorPairs = JSON.parse(rawColorPairs) as { name: string; color: string }[];
      for (let i = 0; i < colorPairs.length; i++) {
        const pair = colorPairs[i];
        const color = new Color(pair.name, pair.color, layer);
        layer.addColor(color);
        colorMap[i] = color;
      }

      const pixelData = JSON.parse(rawPixelData) as number[][];

      const pixelHeight = height / map.size / pixelData.length;
      const pixelWidth = width / map.size / pixelData[0].length;

      // Quadtree-based image compression
      interface Region {
        x: number;
        y: number;
        w: number;
        h: number;
      }

      // Calculate detail metric for categorical data
      const calculateDetailMetric = (region: Region): number => {
        const { x, y, w, h } = region;
        const categoryCounts: { [key: number]: number } = {};
        let totalPixels = 0;
        
        for (let j = y; j < y + h; j++) {
          for (let i = x; i < x + w; i++) {
            if (j < pixelData.length && i < pixelData[j].length) {
              const category = pixelData[j][i];
              categoryCounts[category] = (categoryCounts[category] || 0) + 1;
              totalPixels++;
            }
          }
        }

        if (totalPixels === 0) return 0;

        // If all pixels are the same category, no detail (should merge)
        const uniqueCategories = Object.keys(categoryCounts).length;
        if (uniqueCategories === 1) return 0;

        // Calculate entropy-based metric: higher entropy = more diverse = more detail
        // Entropy measures the unpredictability/diversity of categories
        let entropy = 0;
        for (const count of Object.values(categoryCounts)) {
          const probability = count / totalPixels;
          entropy -= probability * Math.log2(probability);
        }
        
        // Detail metric = entropy * region size
        // High entropy (diverse categories) * large region = high detail metric
        return entropy * (w * h);
      };

      // Get the most common color in a region
      const getMostCommonColor = (region: Region): number => {
        const { x, y, w, h } = region;
        const colorCounts: { [key: number]: number } = {};
        
        for (let j = y; j < y + h; j++) {
          for (let i = x; i < x + w; i++) {
            if (j < pixelData.length && i < pixelData[j].length) {
              const color = pixelData[j][i];
              colorCounts[color] = (colorCounts[color] || 0) + 1;
            }
          }
        }

        let maxCount = 0;
        let mostCommonColor = 0;
        for (const [color, count] of Object.entries(colorCounts)) {
          if (count > maxCount) {
            maxCount = count;
            mostCommonColor = parseInt(color);
          }
        }

        return mostCommonColor;
      };

      // Recursive compression function
      const compressRegion = (region: Region, threshold: number = 1.0) => {
        const { x, y, w, h } = region;
        
        // Don't subdivide if region is too small (minimum 2x2 for better detail)
        if (w <= 1 || h <= 1) {
          const colorValue = getMostCommonColor(region);
          const colorId = colorMap[colorValue]?.id || layer.colors[0].id;
          const depth = Math.min(Math.log2(1 / pixelWidth), Math.log2(1 / pixelHeight));
          
          layer.quadtree.fillRect(
            pixelWidth * x,
            pixelHeight * y,
            pixelWidth * (x + w),
            pixelHeight * (y + h),
            colorId,
            depth
          );
          return;
        }

        const detailMetric = calculateDetailMetric(region);
        
        // If detail metric is below threshold, fill the entire region with most common color
        if (detailMetric <= threshold) {
          const colorValue = getMostCommonColor(region);
          const colorId = colorMap[colorValue]?.id || layer.colors[0].id;
          const depth = Math.min(Math.log2(1 / pixelWidth), Math.log2(1 / pixelHeight), 12);
          
          layer.quadtree.fillRect(
            pixelWidth * x,
            pixelHeight * y,
            pixelWidth * (x + w),
            pixelHeight * (y + h),
            colorId,
            depth
          );
          return;
        }

        // Otherwise, subdivide into 4 quadrants
        const midW = Math.floor(w / 2);
        const midH = Math.floor(h / 2);
        
        if (midW > 0 && midH > 0) {
          compressRegion({ x, y, w: midW, h: midH }, threshold);
          compressRegion({ x: x + midW, y, w: w - midW, h: midH }, threshold);
          compressRegion({ x, y: y + midH, w: midW, h: h - midH }, threshold);
          compressRegion({ x: x + midW, y: y + midH, w: w - midW, h: h - midH }, threshold);
        }
      };

      // Start compression with adaptive threshold
      const totalPixels = pixelData.length * pixelData[0].length;
      const adaptiveThreshold = Math.sqrt(totalPixels) * 0.001; // Lower value = more detail preserved
      
      console.log(`${getTimestamp()} Starting compression with adaptive threshold: ${adaptiveThreshold}`);
      compressRegion({ x: 0, y: 0, w: pixelData[0].length, h: pixelData.length }, adaptiveThreshold);
      console.log(`${getTimestamp()} Compression complete`);

      announce(`map\t${JSON.stringify(map.toJSON())}`);
    }
  },
  {
    prefix: "draw",
    action: (announce, send, content, args) => {
      const [rawLayerId] = args;
      const layerId = parseInt(rawLayerId);

      const layer = map.getLayerById(layerId);
      if (!layer) return;
      announce(`draw\t${layerId}`);
    }
  },
  {
    prefix: "addcolorfilter",
    action: (announce, send, content, args) => {
      const [rawColorId, rawValue] = args;
      const colorId = parseInt(rawColorId);
      const value = parseInt(rawValue);

      const color = map.getColorById(colorId);;
      if (!color) return;
      if (color.filterAts.includes(value)) return;
      announce(`addcolorfilter\t${colorId}\t${value}`);
      color.filterAts.push(value);
      console.log(`${getTimestamp()} Add color filter ${value} to color ${color.id} (${color.name}) in layer ${color.parent.id}`);
    }
  },
  {
    prefix: "removecolorfilter",
    action: (announce, send, content, args) => {
      const [rawColorId, rawValue] = args;
      const colorId = parseInt(rawColorId);
      const value = parseInt(rawValue);

      const color = map.getColorById(colorId);;
      if (!color) return;
      announce(`removecolorfilter\t${colorId}\t${value}`);
      color.filterAts = color.filterAts.filter(v => v !== value);
      console.log(`${getTimestamp()} Remove color filter ${value} from color ${color.id} (${color.name}) in layer ${color.parent.id}`);
    }
  }
]

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

function announce(message: string): void {
  console.log(`${getTimestamp()} << ${message.length > 100 ? message.slice(0, 100) + '...' : message}  (${message.length})`);
  for (const ws of connections) {
    ws.send(message);
  }
}

function send(ws: WebSocket, message: string): void {
  ws.send(message);
}

// Create HTTPS server to enable WSS
const httpsServer = https.createServer(tlsOptions, (_req, res) => {
  // Optional: respond to health checks
  res.writeHead(200);
  res.end('OK');
});

httpsServer.listen(port, host, () => {
  console.log(`${getTimestamp()} HTTPS server listening on https://${host}:${port}`);
});

// Attach WebSocketServer to HTTPS server (WSS)
const wss = new WebSocketServer({ server: httpsServer });

wss.on('connection', (ws: WebSocket, req: any) => {
  const remoteAddress = req.socket.remoteAddress;
  console.log(`${getTimestamp()} ${remoteAddress} == connected`);
  connections.push(ws);

  ws.on('message', (message: any) => {
    const content = message.toString();
    console.log(`${getTimestamp()} ${remoteAddress} >> ${content.length > 100 ? content.slice(0, 100) + '...' : content}  (${content.length})`);

    // handle commands
    for (const command of commands) {
      if (content.startsWith(command.prefix + '\t') || content === command.prefix) {
        const args = content.slice(command.prefix.length).trim().split('\t');
        command.action(announce, (msg: string) => {
          console.log(`${getTimestamp()} ${remoteAddress} << ${msg.length > 100 ? msg.slice(0, 100) + '...' : msg}  (${msg.length})`);
          send(ws, msg);
        }, content, args);
        return;
      }
    }
  });

  ws.on('close', () => {
    console.log(`${getTimestamp()} ${remoteAddress} == disconnected`);
    const index = connections.indexOf(ws);
    if (index !== -1) {
      connections.splice(index, 1);
    }
  });
});

console.log(`${getTimestamp()} WSS server is running on wss://${host}:${port}`);
