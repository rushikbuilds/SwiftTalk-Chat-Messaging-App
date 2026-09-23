const userCacheService = require('../services/user-cache.service');
const messageCacheService = require('../services/message-cache.service');
const notificationService = require('../services/notification.service');
const socketEmitter = require('../socket/socketEmitter');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

// Helper to batch-hydrate user profiles from MySQL
const hydrateMembersWithProfiles = async (members) => {
  if (!members || members.length === 0) return [];
  const userIds = members.map(m => m.user_id);
  const users = await prisma.user.findMany({
    where: { user_id: { in: userIds } },
    select: {
      user_id: true,
      username: true,
      full_name: true,
      profile_pic: true,
      status_message: true,
      is_online: true,
      last_seen: true
    }
  });

  const userMap = new Map();
  users.forEach(u => userMap.set(u.user_id, u));

  return members.map(m => {
    const memObj = m.toObject ? m.toObject() : m;
    return {
      ...memObj,
      user: userMap.get(m.user_id) || {
        user_id: m.user_id,
        username: 'Unknown User',
        full_name: 'Unknown User'
      }
    };
  });
};

exports.createChat = async (req, res) => {
  try {
    const { chat_type, chat_name, member_ids, admin_id, description } = req.body;
    let groupImagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!chat_type || !['private', 'group'].includes(chat_type)) {
      return res.status(400).json({ error: 'Invalid chat type. Must be "private" or "group"' });
    }

    let parsedMemberIds = member_ids;
    if (!member_ids) {
      return res.status(400).json({ error: 'member_ids array is required' });
    }

    if (typeof member_ids === 'string') {
      try {
        parsedMemberIds = JSON.parse(member_ids);
      } catch (e) {
        return res.status(400).json({ error: 'member_ids must be a valid JSON array string' });
      }
    }

    if (!Array.isArray(parsedMemberIds) || parsedMemberIds.length === 0) {
      return res.status(400).json({ error: 'member_ids must be a non-empty array' });
    }

    const memberIntIds = parsedMemberIds.map(id => parseInt(id));

    if (chat_type === 'private' && memberIntIds.length !== 2) {
      return res.status(400).json({ error: 'Private chat must have exactly 2 members' });
    }
    if (chat_type === 'group' && !chat_name) {
      return res.status(400).json({ error: 'Group chat must have a chat_name' });
    }
    if (chat_type === 'group' && !admin_id) {
      return res.status(400).json({ error: 'Group chat must have an admin_id' });
    }
    if (chat_type === 'group' && !memberIntIds.includes(parseInt(admin_id))) {
      return res.status(400).json({ error: 'Admin must be a member of the group' });
    }

    // Verify users exist in MySQL
    const users = await prisma.user.findMany({
      where: { user_id: { in: memberIntIds } }
    });
    if (users.length !== memberIntIds.length) {
      return res.status(404).json({ error: 'One or more users not found' });
    }

    let privateChatKey = null;
    if (chat_type === 'private') {
      const sortedIds = [...memberIntIds].sort((a, b) => a - b);
      privateChatKey = sortedIds.join('_');

      const existingChat = await Chat.findOne({
        chat_type: 'private',
        private_chat_key: privateChatKey
      });

      if (existingChat) {
        const hydratedMembers = await hydrateMembersWithProfiles(existingChat.members);
        const existingChatObj = existingChat.toObject();
        existingChatObj.members = hydratedMembers;
        return res.status(200).json({
          message: 'Private chat already exists',
          chat: existingChatObj
        });
      }
    }

    const membersData = memberIntIds.map(userId => ({
      user_id: userId,
      joined_at: new Date(),
      role: chat_type === 'group' && parseInt(userId) === parseInt(admin_id) ? 'admin' : 'member',
      is_visible: true,
      is_archived: false,
      pinned: false
    }));

    const chatDoc = new Chat({
      chat_type,
      chat_name: chat_type === 'group' ? chat_name : null,
      description: chat_type === 'group' && description ? description : null,
      chat_image: groupImagePath,
      created_by: chat_type === 'group' ? parseInt(admin_id) : memberIntIds[0],
      private_chat_key: privateChatKey,
      members: membersData
    });

    await chatDoc.save();

    const hydratedMembers = await hydrateMembersWithProfiles(chatDoc.members);
    const chatResponse = chatDoc.toObject();
    chatResponse.members = hydratedMembers;
    chatResponse.admins = hydratedMembers.filter(m => m.role === 'admin');

    if (chat_type === 'group') {
      const otherMembers = memberIntIds.filter(id => id !== parseInt(admin_id));
      const adminUser = users.find(u => u.user_id === parseInt(admin_id));

      for (const targetUserId of otherMembers) {
        socketEmitter.emitToUser(targetUserId, 'you_were_added_to_group', {
          chat_id: chatDoc.chat_id,
          group_name: chatDoc.chat_name,
          added_by: adminUser?.full_name || 'Admin',
          chat_image: chatDoc.chat_image,
          message: `You were added to "${chatDoc.chat_name}" by ${adminUser?.full_name || 'an admin'}`
        });
      }
    }

    res.status(201).json({
      message: 'Chat created successfully',
      chat: chatResponse
    });

    for (const memberId of memberIntIds) {
      await userCacheService.invalidateChatMemberships(memberId);
    }
  } catch (error) {
    console.error('[chat.createChat]', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
};

exports.getChatById = async (req, res) => {
  try {
    const { id } = req.params;

    const chat = await Chat.findByChatId(id);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const hydratedMembers = await hydrateMembersWithProfiles(chat.members);

    // Fetch latest message from MongoDB
    const latestMessage = await Message.findOne({
      chat_id: chat.chat_id,
      deleted_for: { $ne: req.user?.user_id }
    }).sort({ created_at: -1 });

    const chatObj = chat.toObject();
    chatObj.members = hydratedMembers;
    chatObj.admins = hydratedMembers.filter(m => m.role === 'admin');
    chatObj.messages = latestMessage ? [latestMessage.toObject()] : [];

    res.json({ chat: chatObj });
  } catch (error) {
    console.error('[chat.getChatById]', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
};

exports.getActiveChats = async (req, res) => {
  try {
    const userId = req.user?.user_id || req.params?.userId || req.query?.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const userIdInt = parseInt(userId);

    const chats = await Chat.find({
      members: {
        $elemMatch: {
          user_id: userIdInt,
          is_visible: { $ne: false }
        }
      }
    })
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const chatIds = chats.map(c => c.chat_id);

    // Unread count aggregate
    const unreadAggregate = await Message.aggregate([
      {
        $match: {
          chat_id: { $in: chatIds },
          "status.user_id": userIdInt,
          "status.status": { $ne: 'read' },
          deleted_for: { $ne: userIdInt }
        }
      },
      {
        $group: {
          _id: "$chat_id",
          count: { $sum: 1 }
        }
      }
    ]);

    const unreadMap = {};
    unreadAggregate.forEach(item => {
      unreadMap[item._id] = item.count;
    });

    // Hydrate members
    const allMemberUserIds = new Set();
    chats.forEach(c => (c.members || []).forEach(m => allMemberUserIds.add(m.user_id)));

    const users = await prisma.user.findMany({
      where: { user_id: { in: Array.from(allMemberUserIds) } },
      select: {
        user_id: true,
        username: true,
        full_name: true,
        profile_pic: true,
        status_message: true,
        is_online: true
      }
    });

    const userMap = new Map();
    users.forEach(u => userMap.set(u.user_id, u));

    const activeChats = chats.map(chat => {
      const chatObj = chat.toObject();
      const userMemberState = (chatObj.members || []).find(m => m.user_id === userIdInt) || {};

      chatObj.members = (chatObj.members || []).map(m => ({
        ...m,
        user: userMap.get(m.user_id) || null
      }));
      chatObj.unread_count = unreadMap[chat.chat_id] || 0;
      chatObj.pinned = userMemberState.pinned || userMemberState.is_pinned || false;
      chatObj.is_pinned = chatObj.pinned;
      chatObj.is_archived = userMemberState.is_archived || false;
      chatObj.last_message_timestamp = chat.last_message?.created_at || chat.updated_at || chat.created_at;

      if (chatObj.last_message && chatObj.last_message.message_id) {
        const senderUser = userMap.get(chatObj.last_message.sender_id);
        chatObj.last_message = {
          message_id: chatObj.last_message.message_id,
          sender_id: chatObj.last_message.sender_id,
          message_type: chatObj.last_message.message_type || 'text',
          message_text: chatObj.last_message.message_text || '',
          preview_text: chatObj.last_message.message_text || '',
          created_at: chatObj.last_message.created_at,
          sender: senderUser ? {
            user_id: senderUser.user_id,
            username: senderUser.username,
            full_name: senderUser.full_name
          } : null,
          has_attachment: chatObj.last_message.message_type && chatObj.last_message.message_type !== 'text'
        };
      }

      return chatObj;
    });

    res.json({
      success: true,
      chats: activeChats,
      activeChats: activeChats
    });
  } catch (error) {
    console.error('[chat.getActiveChats]', error);
    res.status(500).json({ error: 'Failed to get active chats' });
  }
};

exports.getUserChatsPreview = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const userIdInt = parseInt(userId);

    const query = {
      members: {
        $elemMatch: {
          user_id: userIdInt,
          is_visible: true
        }
      }
    };

    const [chats, totalCount] = await Promise.all([
      Chat.find(query)
        .sort({ updated_at: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Chat.countDocuments(query)
    ]);

    const chatIds = chats.map(c => c.chat_id);

    // Aggregate unread counts
    const unreadAggregate = await Message.aggregate([
      {
        $match: {
          chat_id: { $in: chatIds },
          "status.user_id": userIdInt,
          "status.status": { $ne: 'read' },
          deleted_for: { $ne: userIdInt }
        }
      },
      {
        $group: {
          _id: "$chat_id",
          count: { $sum: 1 }
        }
      }
    ]);

    const unreadMap = {};
    unreadAggregate.forEach(item => {
      unreadMap[item._id] = item.count;
    });

    // Hydrate members from MySQL
    const allMemberUserIds = new Set();
    chats.forEach(c => c.members.forEach(m => allMemberUserIds.add(m.user_id)));

    const users = await prisma.user.findMany({
      where: { user_id: { in: Array.from(allMemberUserIds) } },
      select: {
        user_id: true,
        username: true,
        full_name: true,
        profile_pic: true,
        status_message: true,
        is_online: true
      }
    });

    const userMap = new Map();
    users.forEach(u => userMap.set(u.user_id, u));

    const chatPreviews = chats.map(chat => {
      const userMemberState = chat.members.find(m => m.user_id === userIdInt) || {};
      const hydratedMembers = chat.members.map(m => {
        const memObj = m.toObject ? m.toObject() : m;
        return {
          ...memObj,
          user: userMap.get(m.user_id) || null
        };
      });

      let preview = {
        chat_id: chat.chat_id,
        chat_type: chat.chat_type,
        chat_name: chat.chat_name,
        chat_image: chat.chat_image,
        created_at: chat.created_at,
        pinned: userMemberState.pinned || false,
        is_archived: userMemberState.is_archived || false,
        members: hydratedMembers,
        admins: hydratedMembers.filter(m => m.role === 'admin'),
        last_message: null,
        last_message_timestamp: null,
        unread_count: unreadMap[chat.chat_id] || 0
      };

      if (chat.last_message && chat.last_message.message_id) {
        const lm = chat.last_message;
        const senderUser = userMap.get(lm.sender_id);

        preview.last_message = {
          message_id: lm.message_id,
          message_type: lm.message_type || 'text',
          preview_text: lm.message_text,
          created_at: lm.created_at,
          sender: senderUser ? {
            user_id: senderUser.user_id,
            username: senderUser.username,
            full_name: senderUser.full_name
          } : null,
          has_attachment: lm.message_type !== 'text'
        };
        preview.last_message_timestamp = lm.created_at;
      }

      return preview;
    });

    res.json({
      chats: chatPreviews,
      count: chatPreviews.length,
      total: totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit))
    });
  } catch (error) {
    console.error('[chat.getUserChatsPreview]', error);
    res.status(500).json({ error: 'Failed to get chats preview' });
  }
};

exports.addChatMember = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (chat.chat_type !== 'group') {
      return res.status(400).json({ error: 'Can only add members to group chats' });
    }

    const userIdInt = parseInt(user_id);
    const existingMember = chat.members.find(m => m.user_id === userIdInt);
    if (existingMember) return res.status(409).json({ error: 'User is already a member' });

    const newUser = await prisma.user.findUnique({
      where: { user_id: userIdInt },
      select: {
        user_id: true,
        username: true,
        full_name: true,
        profile_pic: true,
        is_online: true,
        last_seen: true
      }
    });

    if (!newUser) return res.status(404).json({ error: 'User not found' });

    chat.members.push({
      user_id: userIdInt,
      role: 'member',
      joined_at: new Date(),
      is_visible: true,
      is_archived: false,
      pinned: false
    });

    await chat.save();

    socketEmitter.emitToChat(chat.chat_id, 'member_added', {
      chat_id: chat.chat_id,
      member: {
        user_id: newUser.user_id,
        username: newUser.username,
        full_name: newUser.full_name,
        profile_pic: newUser.profile_pic
      },
      timestamp: new Date(),
      message: `${newUser.full_name || newUser.username} joined the group`
    });

    const currentUser = await prisma.user.findUnique({
      where: { user_id: req.user?.user_id },
      select: { user_id: true, username: true, full_name: true }
    });

    socketEmitter.emitToUser(userIdInt, 'you_were_added_to_group', {
      chat_id: chat.chat_id,
      group_name: chat.chat_name,
      added_by: currentUser?.full_name || 'Admin',
      chat_image: chat.chat_image,
      message: `You were added to "${chat.chat_name}" by ${currentUser?.full_name || 'an admin'}`
    });

    try {
      await notificationService.notifyUserAddedToGroup(userIdInt, {
        chat_id: chat.chat_id,
        chat_name: chat.chat_name,
        added_by_username: currentUser?.username || 'Admin'
      });
    } catch (pushError) {
      console.warn('[chat.addChatMember] Push notification failed:', pushError.message);
    }

    res.status(201).json({
      message: 'Member added successfully',
      member: {
        user_id: newUser.user_id,
        username: newUser.username,
        full_name: newUser.full_name,
        profile_pic: newUser.profile_pic,
        is_online: newUser.is_online
      }
    });
  } catch (error) {
    console.error('[chat.addChatMember]', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

exports.removeChatMember = async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const userIdInt = parseInt(userId);

    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (chat.chat_type !== 'group') {
      return res.status(400).json({ error: 'Can only remove members from group chats' });
    }

    const memberIndex = chat.members.findIndex(m => m.user_id === userIdInt);
    if (memberIndex === -1) return res.status(404).json({ error: 'Member not found in this chat' });

    const removedUser = await prisma.user.findUnique({
      where: { user_id: userIdInt },
      select: {
        user_id: true,
        username: true,
        full_name: true,
        profile_pic: true
      }
    });

    chat.members.splice(memberIndex, 1);

    if (chat.members.length === 0) {
      await Chat.deleteOne({ _id: chat._id });
      await Message.deleteMany({ chat_id: chat.chat_id });
    } else {
      await chat.save();
    }

    socketEmitter.emitToChat(chat.chat_id, 'member_removed', {
      chat_id: chat.chat_id,
      removed_member: removedUser,
      timestamp: new Date(),
      message: `${removedUser?.full_name || removedUser?.username} was removed from the group`
    });

    const currentUser = await prisma.user.findUnique({
      where: { user_id: req.user?.user_id },
      select: { user_id: true, username: true, full_name: true }
    });

    socketEmitter.emitToUser(userIdInt, 'you_were_removed_from_group', {
      chat_id: chat.chat_id,
      group_name: chat.chat_name,
      removed_by: currentUser?.full_name || 'Admin',
      message: `You were removed from "${chat.chat_name}" by ${currentUser?.full_name || 'an admin'}`
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('[chat.removeChatMember]', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

exports.updateChat = async (req, res) => {
  try {
    const { id } = req.params;
    const { chat_name, description } = req.body;
    let chatImagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const chat = await Chat.findByChatId(id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const oldName = chat.chat_name;
    const oldDesc = chat.description;

    if (chat_name) chat.chat_name = chat_name.trim();
    if (description) chat.description = description.trim();
    if (chatImagePath) chat.chat_image = chatImagePath;

    await chat.save();

    const hydratedMembers = await hydrateMembersWithProfiles(chat.members);
    const chatObj = chat.toObject();
    chatObj.members = hydratedMembers;

    try {
      const memberIds = chat.members.map(m => m.user_id);
      const currentUser = await prisma.user.findUnique({
        where: { user_id: req.user?.user_id },
        select: { username: true }
      });

      let changeType = 'info';
      if (chat_name && oldName !== chat_name) changeType = 'name';
      else if (chatImagePath) changeType = 'image';
      else if (description && oldDesc !== description) changeType = 'description';

      await notificationService.notifyGroupInfoChange(memberIds, {
        chat_id: chat.chat_id,
        chat_name: chat.chat_name,
        change_type: changeType,
        changed_by_username: currentUser?.username || 'Admin'
      });
    } catch (pushError) {
      console.warn('[chat.updateChat] Push notification failed:', pushError.message);
    }

    res.json({ message: 'Chat updated successfully', chat: chatObj });
  } catch (error) {
    console.error('[chat.updateChat]', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
};

exports.getChatInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const chat = await Chat.findByChatId(id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const hydratedMembers = await hydrateMembersWithProfiles(chat.members);

    res.json({
      chat_id: chat.chat_id,
      chat_name: chat.chat_name,
      chat_type: chat.chat_type,
      chat_image: chat.chat_image,
      description: chat.description,
      created_at: chat.created_at,
      member_count: chat.members.length,
      members: hydratedMembers.map(m => m.user),
      admins: hydratedMembers.filter(m => m.role === 'admin').map(m => m.user)
    });
  } catch (error) {
    console.error('[chat.getChatInfo]', error);
    res.status(500).json({ error: 'Failed to get chat info' });
  }
};

exports.exitGroupChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatId || !userId) return res.status(400).json({ error: 'chatId and user_id are required' });

    const userIdInt = parseInt(userId);
    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (chat.chat_type !== 'group') {
      return res.status(400).json({ error: 'Can only exit group chats.' });
    }

    const memberIndex = chat.members.findIndex(m => m.user_id === userIdInt);
    if (memberIndex === -1) return res.status(403).json({ error: 'You are not a member of this chat' });

    const exitingUser = await prisma.user.findUnique({
      where: { user_id: userIdInt },
      select: { user_id: true, username: true, full_name: true, profile_pic: true }
    });

    chat.members.splice(memberIndex, 1);
    const remainingMembers = chat.members.length;

    if (remainingMembers === 0) {
      await Chat.deleteOne({ _id: chat._id });
      await Message.deleteMany({ chat_id: chat.chat_id });
    } else {
      await chat.save();
    }

    if (exitingUser) {
      socketEmitter.emitToChat(chat.chat_id, 'member_exited', {
        chat_id: chat.chat_id,
        exiting_member: exitingUser,
        remaining_members: remainingMembers,
        timestamp: new Date(),
        message: `${exitingUser.full_name || exitingUser.username} left the group`
      });
    }

    res.json({
      message: 'Successfully exited group chat',
      chat_id: chat.chat_id,
      remaining_members: remainingMembers
    });
  } catch (error) {
    console.error('[chat.exitGroupChat]', error);
    res.status(500).json({ error: 'Failed to exit group chat' });
  }
};

exports.pinChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatId || !userId) return res.status(400).json({ error: 'chatId and user_id are required' });

    const userIdInt = parseInt(userId);
    const updated = await Chat.updateOne(
      { chat_id: String(chatId), "members.user_id": userIdInt },
      { $set: { "members.$.pinned": true } }
    );

    if (updated.matchedCount === 0) return res.status(403).json({ error: 'Not a member of this chat' });
    res.json({ message: 'Chat Pinned successfully', chat_id: chatId, status: 'pinned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.unpinChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatId || !userId) return res.status(400).json({ error: 'chatId and user_id are required' });

    const userIdInt = parseInt(userId);
    const updated = await Chat.updateOne(
      { chat_id: String(chatId), "members.user_id": userIdInt },
      { $set: { "members.$.pinned": false } }
    );

    if (updated.matchedCount === 0) return res.status(403).json({ error: 'Not a member of this chat' });
    res.json({ message: 'Chat Unpinned successfully', chat_id: chatId, status: 'unpinned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.batchPinChats = async (req, res) => {
  try {
    const { chatIds } = req.body;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ error: 'chatIds array is required' });
    }
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const userIdInt = parseInt(userId);
    const stringChatIds = chatIds.map(id => String(id));

    await Chat.updateMany(
      { chat_id: { $in: stringChatIds }, "members.user_id": userIdInt },
      { $set: { "members.$.pinned": true } }
    );

    res.json({
      message: `${stringChatIds.length} chats pinned successfully`,
      pinned_count: stringChatIds.length,
      chat_ids: stringChatIds
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.batchMarkReadChats = async (req, res) => {
  try {
    const { chatIds } = req.body;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ error: 'chatIds array is required' });
    }
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const userIdInt = parseInt(userId);
    const stringChatIds = chatIds.map(id => String(id));

    const result = await Message.updateMany(
      {
        chat_id: { $in: stringChatIds },
        "status.user_id": userIdInt,
        "status.status": { $ne: 'read' }
      },
      {
        $set: {
          "status.$[elem].status": "read",
          "status.$[elem].updated_at": new Date()
        }
      },
      {
        arrayFilters: [{ "elem.user_id": userIdInt }]
      }
    );

    res.json({
      message: `Marked messages as read in ${stringChatIds.length} chats`,
      marked_count: result.modifiedCount,
      chat_ids: stringChatIds
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.batchDeleteChats = async (req, res) => {
  try {
    const { chatIds } = req.body;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ error: 'chatIds array is required' });
    }
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const userIdInt = parseInt(userId);
    const stringChatIds = chatIds.map(id => String(id));

    // Hide chat from user
    await Chat.updateMany(
      { chat_id: { $in: stringChatIds }, "members.user_id": userIdInt },
      {
        $set: {
          "members.$.is_visible": false,
          "members.$.hidden_at": new Date()
        }
      }
    );

    // Hide messages in chats from user
    await Message.updateMany(
      { chat_id: { $in: stringChatIds } },
      { $addToSet: { deleted_for: userIdInt } }
    );

    await Promise.all(stringChatIds.map(cid => messageCacheService.invalidateUserChatCache(cid, userIdInt)));

    res.json({
      message: `${stringChatIds.length} chats deleted successfully`,
      deleted_count: stringChatIds.length,
      chat_ids: stringChatIds
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.user_id || parseInt(req.body.user_id);
    if (!chatId || !userId) return res.status(400).json({ error: 'chatId and user_id are required' });

    const userIdInt = parseInt(userId);
    const chatIdStr = String(chatId);

    const updated = await Chat.updateOne(
      { chat_id: chatIdStr, "members.user_id": userIdInt },
      {
        $set: {
          "members.$.is_visible": false,
          "members.$.hidden_at": new Date()
        }
      }
    );

    if (updated.matchedCount === 0) return res.status(403).json({ error: 'Not a member of this chat' });

    await Message.updateMany(
      { chat_id: chatIdStr },
      { $addToSet: { deleted_for: userIdInt } }
    );

    await messageCacheService.invalidateUserChatCache(chatIdStr, userIdInt);

    res.json({ message: 'Chat deleted successfully', chat_id: chatId, status: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};