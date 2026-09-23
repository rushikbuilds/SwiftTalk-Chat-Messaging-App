const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const { initSocketEmitter } = require('./socket/socketEmitter');
const { testConnection } = require('./config/database');
const { initRedis, closeRedis, isAvailable: isRedisAvailable } = require('./config/redis');
const { connectMongo, disconnectMongo, isMongoConnected } = require('./config/mongo');
const { initSessionCleanupCron } = require("./cron/sessionCleanup")
const passport = require('./config/passport');

const dotenv = require('dotenv');
const envFile = '.env';
const envPath = path.join(__dirname, '..', envFile);
const result = dotenv.config({ path: envPath });

const app = express();
const server = http.createServer(app);

const cors = require('cors');

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://localhost:3000",
  "https://127.0.0.1:3000",
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
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cache-Control", "Pragma", "Expires"],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400
}));

// Minimal session for oauth
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60_000 },
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => {
  res.json({
    message: 'SwiftTalk Chat Server is running!',
    version: '1.1.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      messages: '/api/messages',
      chats: '/api/chats',
      ai: '/api/ai',
      health: '/health'
    }
  });
});

const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const chatRoutes = require('./routes/chat.routes');
const authRoutes = require('./routes/auth.routes');
const uploadRoutes = require('./routes/upload.routes');
const notificationRoutes = require('./routes/notification.routes');
const aiRoutes = require('./routes/ai.routes');
const taskRoutes = require('./routes/task.router');

app.use(passport.initialize());
app.use(passport.session());

app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/uploads', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tasks', taskRoutes);

app.use(express.static('.'));

// Global error-handling middleware (must be registered AFTER all routes)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${req.method} ${req.originalUrl} — ${status} — ${message}`);
  console.error(err.stack || err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : message,
  });
});

app.get('/health', async (req, res) => {
  const dbStatus = await testConnection();
  const redisStatus = isRedisAvailable();
  const mongoStatus = isMongoConnected();
  res.json({
    service: 'api',
    status: 'running',
    database: dbStatus ? 'connected' : 'disconnected',
    mongodb: mongoStatus ? 'connected' : 'disconnected',
    redis: redisStatus ? 'connected' : 'fallback (in-memory)',
    mode: redisStatus ? 'full' : 'degraded'
  });
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await disconnectMongo();
  await closeRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await disconnectMongo();
  await closeRedis();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:');
  console.error(err.stack || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:');
  console.error(reason);
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  const dbConnected = await testConnection();

  if (!dbConnected) {
    process.exit(1);
  }

  // Connect to MongoDB for chats and messages
  await connectMongo();

  try {
    await initRedis();
    console.log('Redis connected successfully.');
    await initSocketEmitter();
  } catch (error) {
    console.warn('[WARN] Redis init failed, falling back to in-memory:', error.message);
  }

  server.listen(PORT, () => {
    console.log(`SwiftTalk server running on port ${PORT}`);
  });

  initSessionCleanupCron();
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
