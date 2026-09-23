const mongoose = require('mongoose');

let isConnected = false;

const connectMongo = async () => {
  if (isConnected) return mongoose.connection;

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/swifttalk';

  try {
    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = conn.connection.readyState === 1;
    console.log(`[MongoDB] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
    return conn.connection;
  } catch (error) {
    console.error('[MongoDB] Initial connection error:', error.message);
    // Don't crash immediately; let caller handle or continue with warning
    isConnected = false;
    return null;
  }
};

mongoose.connection.on('connected', () => {
  isConnected = true;
  console.log('[MongoDB] Connection state: CONNECTED');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  console.error('[MongoDB] Connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('[MongoDB] Connection lost. Reconnecting...');
});

const isMongoConnected = () => isConnected && mongoose.connection.readyState === 1;

const disconnectMongo = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[MongoDB] Disconnected gracefully');
  }
};

module.exports = {
  connectMongo,
  disconnectMongo,
  isMongoConnected,
  mongoose
};
