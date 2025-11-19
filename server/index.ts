import WebSocket, { WebSocketServer } from 'ws';
import { Map, Color, Layer } from "../dataframe.ts";

/* server setup */
const port = 48829;
const host = "0.0.0.0";

let map = new Map();

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
      layer.addColor(color);
      announce(`newcolor\t${layer.id}\t${colorName}\t${colorValue}`);
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
        const placeholder = map.layer.colors[0]?.id || 1;
        const [xer1, yer1] = map.layer.quadtree.expandQuadtrants(minX, minY, placeholder);
        const [xer2, yer2] = map.layer.quadtree.expandQuadtrants(maxX, maxY, placeholder);
        announce(`expand\t${minX}\t${minY}\t${maxX}\t${maxY}`);
        x0 = xer2(xer1(x0));
        y0 = yer2(yer1(y0));
        x1 = xer2(xer1(x1));
        y1 = yer2(yer1(y1));
      }

      const color = map.getColorById(colorId);
      if (!color) return;
      color.parent.quadtree.drawLine(x0, y0, x1, y1, color.id, brushSize, depth);
      announce(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${brushSize}\t${colorId}\t${depth}`);
    }
  },
  {
    prefix: 'fillpolygon',
    action: (announce, send, content, args) => {
      let [rawLayerId, rawPolygon, rawColorId, rawDepth] = args;
      const layerId = parseInt(rawLayerId);
      const colorId = parseInt(rawColorId);
      const depth = parseInt(rawDepth);

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
        const placeholder = map.layer.colors[0]?.id || 1;
        const expandLayer = (layer: Layer) => {
          const [xer1, yer1] = layer.quadtree.expandQuadtrants(minX, minY, placeholder);
          const [xer2, yer2] = layer.quadtree.expandQuadtrants(maxX, maxY, placeholder);
          for (const child of layer.children) {
            expandLayer(child);
          }
          return [(x: number) => xer2(xer1(x)), (y: number) => yer2(yer1(y))];
        };
        const [xer, yer] = expandLayer(map.layer);
        announce(`expand\t${minX}\t${minY}\t${maxX}\t${maxY}`);

        for (let i = 0; i < polygon.length; i++) {
          const [x, y] = polygon[i];
          polygon[i] = [xer(x), yer(y)];
        }
      }

      layer.quadtree.fillPolygon(polygon, color.id, depth);
      const polygonString = polygon.map(([x, y]) => `${x},${y}`).join(';');
      announce(`fillpolygon\t${layerId}\t${polygonString}\t${colorId}\t${depth}`);
    }
  },
]

function announce(message: string): void {
  console.log(`<< ${message.length > 100 ? message.slice(0, 100) + '...' : message}  (${message.length})`);
  for (const ws of connections) {
    ws.send(message);
  }
}

function send(ws: WebSocket, message: string): void {
  ws.send(message);
}

const wss = new WebSocketServer({ port, host });

wss.on('connection', (ws: WebSocket, req: any) => {
  const remoteAddress = req.socket.remoteAddress;
  console.log(`${remoteAddress} == connected`);
  connections.push(ws);

  ws.on('message', (message: any) => {
    const content = message.toString();
    console.log(`${remoteAddress} >> ${content.length > 100 ? content.slice(0, 100) + '...' : content}  (${content.length})`);

    // handle commands
    for (const command of commands) {
      if (content.startsWith(command.prefix)) {
        const args = content.slice(command.prefix.length).trim().split('\t');
        command.action(announce, (msg: string) => {
          console.log(`${remoteAddress} << ${msg.length > 100 ? msg.slice(0, 100) + '...' : msg}  (${msg.length})`);
          send(ws, msg);
        }, content, args);
        return;
      }
    }
  });

  ws.on('close', () => {
    console.log(`${remoteAddress} == disconnected`);
    const index = connections.indexOf(ws);
    if (index !== -1) {
      connections.splice(index, 1);
    }
  });
});

console.log(`WebSocket server is running on ws://localhost:${port}`);
