import { WebSocketServer } from 'ws';
import { Map, Color } from "../dataframe.js";

/* server setup */
const port = 48829;
const host = "0.0.0.0";

let map = new Map();

const connections = [];
const commands = [
  {
    prefix: 'load',
    action: (announce, send, content, args) => {
      send(`map\t${JSON.stringify(map.toJSON())}`);
    }
  },
  {
    prefix: 'newcolor',
    action: (announce, send, content, args) => {
      let [layerId, colorName, colorValue] = args;
      layerId = parseInt(layerId);

      const layer = map.getLayerById(layerId);
      const color = new Color(colorName, colorValue, layer);
      layer.addColor(color);
      announce(`newcolor\t${layer.id}\t${colorName}\t${colorValue}`);
    }
  },
  {
    prefix: 'drawline',
    action: (announce, send, content, args) => {
      let [x0, y0, x1, y1, brushSize, colorId, depth] = args;
      x0 = parseFloat(x0);
      y0 = parseFloat(y0);
      x1 = parseFloat(x1);
      y1 = parseFloat(y1);
      brushSize = parseFloat(brushSize);
      colorId = parseInt(colorId);
      depth = parseInt(depth);

      const color = map.getColorById(colorId);
      color.parent.quadtree.drawLine(x0, y0, x1, y1, color.id, brushSize, depth);
      announce(`drawline\t${x0}\t${y0}\t${x1}\t${y1}\t${brushSize}\t${colorId}\t${depth}`);
    }
  }
]

function announce(message) {
  console.log(`<< ${message.length > 100 ? message.slice(0, 100) + '...' : message}  (${message.length})`);
  for (const ws of connections) {
    ws.send(message);
  }
}

function send(ws, message) {
  ws.send(message);
}

const wss = new WebSocketServer({ port, host });

wss.on('connection', (ws) => {
  console.log(`${ws._socket.remoteAddress} == connected`);
  connections.push(ws);

  ws.on('message', (message) => {
    const content = message.toString();
    console.log(`${ws._socket.remoteAddress} >> ${content.length > 100 ? content.slice(0, 100) + '...' : content}  (${content.length})`);

    // handle commands
    for (const command of commands) {
      if (content.startsWith(command.prefix)) {
        const args = content.slice(command.prefix.length).trim().split('\t');
        command.action(announce, (msg) => {
          console.log(`${ws._socket.remoteAddress} << ${msg.length > 100 ? msg.slice(0, 100) + '...' : msg}  (${msg.length})`);
          send(ws, msg);
        }, content, args);
        return;
      }
    }
  });

  ws.on('close', () => {
    console.log(`${ws._socket.remoteAddress} == disconnected`);
    const index = connections.indexOf(ws);
    if (index !== -1) {
      connections.splice(index, 1);
    }
  });
});

console.log(`WebSocket server is running on ws://localhost:${port}`);
