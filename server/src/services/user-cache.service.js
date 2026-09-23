/**
 * User Cache Service
 * Caches user profiles, chat memberships, and friend lists.
 * Uses the generic cache service for all operations.
 */

const { getCache, setCache, deleteCache, getCached, deleteCacheByPattern } = require('./cache.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { Chat } = require('../models/mongo');

// TTL configurations (in seconds)
const USER_PROFILE_TTL = 3600; // 1 hour
const CHAT_MEMBERSHIPS_TTL = 1800; // 30 minutes
const FRIEND_LIST_TTL = 1800; // 30 minutes

// --- User Profile ---

const cacheUserProfile = async (user) => {
  try {
    const userKey = `user:profile:${user.user_id}`;
    return await setCache(userKey, {
      user_id: user.user_id,
      username: user.username || '',
      email: user.email || '',
      full_name: user.full_name || '',
      profile_pic: user.profile_pic || '',
      status_message: user.status_message || '',
      bio: user.bio || '',
      created_at: user.created_at || new Date().toISOString()
    }, USER_PROFILE_TTL);
  } catch (error) {
    return false;
  }
};

const getCachedUserProfile = async (userId) => {
  try {
    return await getCache(`user:profile:${userId}`);
  } catch (error) {
    return null;
  }
};

const getUserProfile = async (userId) => {
  return await getCached(
    `user:profile:${userId}`,
    async () => {
      const user = await prisma.user.findUnique({
        where: { user_id: userId },
        select: {
          user_id: true,
          username: true,
          email: true,
          full_name: true,
          profile_pic: true,
          status_message: true,
          created_at: true
        }
      });
      return user || null;
    },
    USER_PROFILE_TTL
  );
};

// --- Chat Memberships ---

const cacheChatMemberships = async (userId, chats) => {
  try {
    const membershipKey = `user:chats:${userId}`;
    return await setCache(membershipKey, chats, CHAT_MEMBERSHIPS_TTL);
  } catch (error) {
    return false;
  }
};

const getCachedChatMemberships = async (userId) => {
  try {
    return await getCache(`user:chats:${userId}`);
  } catch (error) {
    return null;
  }
};

const getChatMemberships = async (userId) => {
  return await getCached(
    `user:chats:${userId}`,
    async () => {
      const chatsFromDb = await Chat.find({ 'members.user_id': userId }).lean();

      const chats = chatsFromDb.map(c => {
        const member = (c.members || []).find(m => m.user_id === userId);
        return {
          chat_id: c.chat_id,
          chat_name: c.chat_name,
          chat_type: c.chat_type,
          created_at: c.created_at,
          is_pinned: member?.is_pinned || false
        };
      });

      return chats.length > 0 ? chats : null;
    },
    CHAT_MEMBERSHIPS_TTL
  );
};

// --- Friend List ---

const cacheFriendList = async (userId, friends) => {
  try {
    const friendListKey = `user:friends:${userId}`;

    // Also cache individual friend profiles
    for (const friend of friends) {
      await cacheUserProfile(friend);
    }

    return await setCache(friendListKey, friends, FRIEND_LIST_TTL);
  } catch (error) {
    return false;
  }
};

const getCachedFriendList = async (userId) => {
  try {
    return await getCache(`user:friends:${userId}`);
  } catch (error) {
    return null;
  }
};

const getFriendList = async (userId) => {
  return await getCached(
    `user:friends:${userId}`,
    async () => {
      const friends1 = await prisma.friendship.findMany({
        where: {
          user1_id: userId,
          status: 'accepted'
        },
        include: {
          user2: {
            select: {
              user_id: true,
              username: true,
              email: true,
              full_name: true,
              profile_pic: true,
              bio: true,
              created_at: true
            }
          }
        }
      });

      const friends2 = await prisma.friendship.findMany({
        where: {
          user2_id: userId,
          status: 'accepted'
        },
        include: {
          user1: {
            select: {
              user_id: true,
              username: true,
              email: true,
              full_name: true,
              profile_pic: true,
              bio: true,
              created_at: true
            }
          }
        }
      });

      const friends = [
        ...friends1.map(f => f.user2),
        ...friends2.map(f => f.user1)
      ];

      return friends.length > 0 ? friends : null;
    },
    FRIEND_LIST_TTL
  );
};

// --- Invalidation ---

const invalidateUserProfile = async (userId) => {
  return await deleteCache(`user:profile:${userId}`);
};

const invalidateChatMemberships = async (userId) => {
  return await deleteCache(`user:chats:${userId}`);
};

const invalidateFriendList = async (userId) => {
  return await deleteCache(`user:friends:${userId}`);
};

const invalidateAllUserCaches = async (userId) => {
  try {
    await Promise.all([
      invalidateUserProfile(userId),
      invalidateChatMemberships(userId),
      invalidateFriendList(userId)
    ]);
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  cacheUserProfile,
  getCachedUserProfile,
  getUserProfile,
  invalidateUserProfile,
  
  cacheChatMemberships,
  getCachedChatMemberships,
  getChatMemberships,
  invalidateChatMemberships,
  
  cacheFriendList,
  getCachedFriendList,
  getFriendList,
  invalidateFriendList,
  
  invalidateAllUserCaches
};
