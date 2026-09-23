/**
 * Message Cache Service
 * Handles caching of messages and chat message lists.
 * Uses the generic cache service for simple key-value operations
 * and direct Redis for list operations (rPush, lRange).
 */

const redis = require('../config/redis');
const { getCache, setCache, deleteCache } = require('./cache.service');
const Message = require('../models/mongo/Message');

const MESSAGE_CACHE_SIZE = 100;
const MESSAGE_TTL = 3600;
const CHAT_MESSAGES_TTL = 1800;

const cacheMessage = async (message) => {
  try {
    const msgId = message.message_id || message._id;
    const messageKey = `message:${msgId}`;
    return await setCache(messageKey, message, MESSAGE_TTL);
  } catch (error) {
    return false;
  }
};

const getCachedMessage = async (messageId) => {
  try {
    const messageKey = `message:${messageId}`;
    return await getCache(messageKey);
  } catch (error) {
    return null;
  }
};

const cacheRecentMessages = async (chatId, userId, messages) => {
  try {
    const chatMessagesKey = `chat:messages:${chatId}:user:${userId}`;
    await redis.del(chatMessagesKey);

    const messageIds = messages.map(m => String(m.message_id || m._id));
    if (messageIds.length > 0) await redis.rPush(chatMessagesKey, ...messageIds);

    await redis.expire(chatMessagesKey, CHAT_MESSAGES_TTL);
    await Promise.all(messages.map(msg => cacheMessage(msg)));
    await setCache(`chat:messages:updated:${chatId}:user:${userId}`, Date.now(), CHAT_MESSAGES_TTL);

    return true;
  } catch (error) {
    return false;
  }
};

const getCachedRecentMessages = async (chatId, userId, limit = 50) => {
  try {
    const chatMessagesKey = `chat:messages:${chatId}:user:${userId}`;
    const messageIds = await redis.lRange(chatMessagesKey, -limit, -1);

    if (!messageIds || messageIds.length === 0) return null;

    const messages = await Promise.all(messageIds.reverse().map(async (id) => await getCachedMessage(id)));
    const validMessages = messages.filter(m => m !== null);

    if (validMessages.length < messageIds.length * 0.8) return null;

    return validMessages;
  } catch (error) {
    return null;
  }
};

const addMessageToCache = async (chatId, message) => {
  try {
    await cacheMessage(message);
    await invalidateChatCache(chatId);
    return true;
  } catch (error) {
    return false;
  }
};

const removeMessageFromCache = async (messageId, chatId) => {
  try {
    await deleteCache(`message:${messageId}`);
    if (chatId) await invalidateChatCache(chatId);
    return true;
  } catch (error) {
    return false;
  }
};

const invalidateChatCache = async (chatId) => {
  try {
    let cursor = '0';
    const keysToDelete = [];

    do {
      const reply = await redis.scan(cursor, {
        MATCH: `chat:messages:${chatId}:user:*`,
        COUNT: 100
      });

      cursor = reply.cursor;
      keysToDelete.push(...reply.keys);
    } while (cursor !== '0');

    let cursor2 = '0';
    do {
      const reply = await redis.scan(cursor2, { MATCH: `chat:messages:updated:${chatId}:user:*`, COUNT: 100 });
      cursor2 = reply.cursor;
      keysToDelete.push(...reply.keys);
    } while (cursor2 !== '0');

    // Collect individual message IDs from list keys
    const allMessageIds = new Set();
    for (const key of keysToDelete) {
      if (key.includes(':user:') && !key.includes('updated')) {
        const messageIds = await redis.lRange(key, 0, -1);
        if (messageIds) {
          messageIds.forEach(id => allMessageIds.add(id));
        }
      }
    }

    if (allMessageIds.size > 0) {
      await Promise.all(Array.from(allMessageIds).map(id => deleteCache(`message:${id}`)));
    }

    if (keysToDelete.length > 0) {
      await Promise.all(keysToDelete.map(key => redis.del(key)));
    }

    return true;
  } catch (error) {
    return false;
  }
};

const invalidateUserChatCache = async (chatId, userId) => {
  try {
    const chatMessagesKey = `chat:messages:${chatId}:user:${userId}`;
    const updatedKey = `chat:messages:updated:${chatId}:user:${userId}`;
    await redis.del(chatMessagesKey);
    await redis.del(updatedKey);
    return true;
  } catch (error) {
    return false;
  }
};

const fetchAndCacheMessages = async (chatId, userId, limit = 50) => {
  try {
    const chatIdStr = String(chatId);
    const userIdInt = parseInt(userId);

    const messages = await Message.find({
      chat_id: chatIdStr,
      deleted_for: { $ne: userIdInt }
    })
      .sort({ created_at: -1 })
      .limit(MESSAGE_CACHE_SIZE);

    const messageObjs = messages.map(m => m.toObject());

    // Cache the messages with user-specific key
    if (messageObjs.length > 0) {
      await cacheRecentMessages(chatIdStr, userIdInt, messageObjs);
    }

    // Return only the requested limit
    return messageObjs.slice(0, limit);
  } catch (error) {
    console.error('Error fetching and caching messages:', error.message);
    throw error;
  }
};

/**
 * Get messages (cache-first strategy)
 * @param {string|number} chatId
 * @param {number} userId
 * @param {number} limit
 * @returns {Array} messages
 */
const getMessages = async (chatId, userId, limit = 50) => {
  try {
    const chatIdStr = String(chatId);
    const parsedUserId = parseInt(userId);
    const parsedLimit = parseInt(limit) || 50;

    if (!chatId || isNaN(parsedUserId)) {
      throw new Error(`Invalid parameters: chatId=${chatId}, userId=${userId}`);
    }

    const cached = await getCachedRecentMessages(chatIdStr, parsedUserId, parsedLimit);
    if (cached && cached.length > 0) {
      return cached;
    }

    return await fetchAndCacheMessages(chatIdStr, parsedUserId, parsedLimit);
  } catch (error) {
    console.error('Error getting messages:', error.message);
    throw error;
  }
};

module.exports = {
  cacheMessage,
  getCachedMessage,
  cacheRecentMessages,
  getCachedRecentMessages,
  addMessageToCache,
  removeMessageFromCache,
  invalidateChatCache,
  invalidateUserChatCache,
  fetchAndCacheMessages,
  getMessages
};
