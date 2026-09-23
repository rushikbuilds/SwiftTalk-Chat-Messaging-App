const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');

const envFile = '.env';
const envPath = path.join(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const { initializeSocket, setupRedisAdapter } = require('./socket/socketHandler');
const { initRedis, closeRedis, isAvailable: isRedisAvailable } = require('./config/redis');
const { connectMongo, disconnectMongo, isMongoConnected } = require('./config/mongo');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://localhost:3000",
  "https://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
  "https://localhost:3002",
  "https://127.0.0.1:3002",
  "https://rushik8626.github.io",
  "https://swiftalk.vercel.app",
  "https://switftalk.vercel.app",
  "https://swifttalk-kv2qalfll-rushikeshs-projects-0260b878.vercel.app",
  "https://swifttalk-api.me"
];

const checkCorsOrigin = function (origin, callback) {
  if (!origin || allowedOrigins.includes(origin) ||
    (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ||
    (origin && (origin.includes('.trycloudflare.com') || origin.includes('.github.io') || origin.includes('swifttalk-api.me') || origin.includes('vercel.app')))) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
};

app.use(cors({
  origin: checkCorsOrigin,
  credentials: true
}));

const io = new Server(server, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 100 * 1024 * 1024,
  cors: {
    origin: checkCorsOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'SwiftTalk WebSocket Server',
    version: '1.2.0',
    status: 'running',
    connections: io.engine ? io.engine.clientsCount : 0,
    endpoints: {
      health: '/health',
      socket: '/socket.io/ (WebSocket & Polling)'
    }
  });
});

app.get('/health', (req, res) => {
  const redisStatus = isRedisAvailable();
  const mongoStatus = isMongoConnected();
  res.json({
    service: 'websocket',
    status: 'running',
    connections: io.engine ? io.engine.clientsCount : 0,
    mongodb: mongoStatus ? 'connected' : 'disconnected',
    redis: redisStatus ? 'connected' : 'fallback (in-memory)',
    mode: redisStatus ? 'cluster' : 'single-node'
  });
});

// Initialize socket events and namespaces
initializeSocket(io);

const closeGracefully = async (signal) => {
  console.log(`[wsServer] ${signal} received. Shutting down gracefully...`);
  try {
    io.close(() => {
      console.log('[wsServer] Closed all socket connections.');
    });
  } catch (err) {
    console.warn('[wsServer] Error closing io:', err.message);
  }
  await disconnectMongo();
  await closeRedis();
  server.close(() => {
    console.log('[wsServer] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[wsServer FATAL] Uncaught Exception:');
  console.error(err.stack || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[wsServer FATAL] Unhandled Promise Rejection:');
  console.error(reason);
});

const WS_PORT = process.env.WS_PORT || 3002;

async function startWsServer() {
  await connectMongo();

  try {
    await initRedis();
    console.log('[wsServer] Redis connected successfully.');
    await setupRedisAdapter(io);
  } catch (error) {
    console.warn('[wsServer WARN] Redis init failed, falling back to in-memory:', error.message);
  }

  server.listen(WS_PORT, () => {
    console.log(`SwiftTalk WebSocket server running on port ${WS_PORT}`);
  });
}

if (require.main === module) {
  startWsServer();
}

module.exports = { app, server, io, startWsServer };
