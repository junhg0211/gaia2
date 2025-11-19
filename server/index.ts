import WebSocket, { WebSocketServer } from 'ws';
import { Map, Color } from "../dataframe.ts";

/* server setup */
const port = 48829;
const host = "0.0.0.0";

let map = new Map();
let c = new Color('red', '#ff0000', map.layer);
map.layer.addColor(c);
map.layer.quadtree.fillPolygon([[0.1, 0.1], [0.2, 0.1], [0.1, 0.2], [0.2, 0.2]], c.id, 10);

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
      const x0 = parseFloat(rawX0);
      const y0 = parseFloat(rawY0);
      const x1 = parseFloat(rawX1);
      const y1 = parseFloat(rawY1);
      const brushSize = parseFloat(rawBrushSize);
      const colorId = parseInt(rawColorId);
      const depth = parseInt(rawDepth);

      const color = map.getColorById(colorId);
      if (!color) return;
      color.parent.quadtree.drawLine(x0, y0, x1, y1, color.id, brushSize, depth);
      announce(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${brushSize}\t${colorId}\t${depth}`);
    }
  }
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
