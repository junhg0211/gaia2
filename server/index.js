import { WebSocketServer } from 'ws';
import { Map } from "../dataframe.js";

/* server setup */
const port = 48829;
const host = "0.0.0.0";

let map = new Map();

const connections = [];
const commands = [
  {
    prefix: 'load',
    action: (announce, send, content, args) => {
      send(JSON.stringify(map.toJSON()));
    }
  }
]

function announce(message) {
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
    console.log(`${ws._socket.remoteAddress} << ${content}`);

    // handle commands
    for (const command of commands) {
      if (content.startsWith(command.prefix)) {
        const args = content.slice(command.prefix.length).trim().split('\t');
        command.action(announce, (msg) => {
          console.log(`${ws._socket.remoteAddress} >> ${msg}`);
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

console.log('WebSocket server is running on ws://localhost:8080');
