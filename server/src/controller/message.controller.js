const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const messageCacheService = require('../services/message-cache.service');
const { emitFileMessage } = require('../socket/socketHandler');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

exports.createMessage = async (req, res) => {
  try {
    const { chat_id, sender_id, message_text, message_type = 'text', reply_to_id, referenced_message_id } = req.body;
    if (!chat_id || !sender_id) return res.status(400).json({ error: 'chat_id and sender_id are required' });
    if (!message_text || message_text.trim() === '') {
      return res.status(400).json({ error: 'message_text is required and cannot be empty' });
    }

    const chatIdStr = String(chat_id);
    const senderIdInt = parseInt(sender_id);

    const chat = await Chat.findByChatId(chatIdStr);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isMember = chat.members.some(m => m.user_id === senderIdInt);
    if (!isMember) return res.status(403).json({ error: 'User is not a member of this chat' });

    const senderUser = await prisma.user.findUnique({
      where: { user_id: senderIdInt },
      select: { user_id: true, username: true, full_name: true, profile_pic: true }
    });

    let referencedMessage = null;
    const targetReplyId = reply_to_id || referenced_message_id;
    if (targetReplyId) {
      const refMsg = await Message.findByMessageId(targetReplyId);
      if (refMsg && String(refMsg.chat_id) === String(chat.chat_id)) {
        referencedMessage = {
          message_id: String(refMsg.message_id || refMsg._id),
          message_text: refMsg.message_text,
          is_reply: true,
          sender: refMsg.sender ? {
            user_id: refMsg.sender.user_id,
            username: refMsg.sender.username,
            full_name: refMsg.sender.full_name
          } : null
        };
      }
    }

    const statusData = chat.members.map(member => ({
      user_id: member.user_id,
      status: member.user_id === senderIdInt ? 'sent' : 'delivered'
    }));

    const visibilityData = chat.members.map(member => ({
      user_id: member.user_id,
      is_visible: true
    }));

    const messageDoc = new Message({
      chat_id: chat.chat_id,
      sender_id: senderIdInt,
      sender: senderUser ? {
        user_id: senderUser.user_id,
        username: senderUser.username,
        full_name: senderUser.full_name,
        profile_pic: senderUser.profile_pic
      } : null,
      message_text: message_text.trim(),
      message_type,
      is_reply: !!targetReplyId,
      referenced_message_id: targetReplyId ? String(targetReplyId) : null,
      referenced_message: referencedMessage,
      attachments: [],
      status: statusData,
      visibility: visibilityData,
      deleted_for: []
    });

    await messageDoc.save();

    // Update Chat last_message and unhide chat for members
    await Chat.updateOne(
      { chat_id: chat.chat_id },
      {
        $set: {
          last_message: {
            message_id: messageDoc.message_id,
            sender_id: senderIdInt,
            message_text: messageDoc.message_text,
            message_type: messageDoc.message_type,
            created_at: messageDoc.created_at
          },
          updated_at: messageDoc.created_at,
          "members.$[elem].is_visible": true,
          "members.$[elem].hidden_at": null
        }
      },
      {
        arrayFilters: [{ "elem.is_archived": false }]
      }
    );

    const completeMessage = messageDoc.toObject();
    completeMessage.reply_to_id = completeMessage.referenced_message_id;
    completeMessage.reply_to_message = completeMessage.referenced_message;
    res.status(201).json({ message: 'Message sent successfully', data: completeMessage });
  } catch (error) {
    console.error('[message.createMessage]', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

exports.uploadFileAndCreateMessage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { chat_id, sender_id, message_text } = req.body;
    const chatIdStr = String(chat_id);
    const senderIdInt = parseInt(sender_id);

    const chat = await Chat.findByChatId(chatIdStr);
    if (!chat) {
      if (req.file.path) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = chat.members.some(m => m.user_id === senderIdInt);
    if (!isMember) {
      if (req.file.path) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'User is not a member of this chat' });
    }

    let messageType = 'file';
    if (req.file.mimetype.startsWith('image/')) messageType = 'image';
    else if (req.file.mimetype.startsWith('video/')) messageType = 'video';
    else if (req.file.mimetype.startsWith('audio/')) messageType = 'audio';
    else if (req.file.mimetype.includes('pdf')) messageType = 'document';

    const senderUser = await prisma.user.findUnique({
      where: { user_id: senderIdInt },
      select: { user_id: true, username: true, full_name: true, profile_pic: true }
    });

    const fileUrl = `/uploads/${req.file.filename}`;
    const attachment = {
      file_url: fileUrl,
      original_filename: req.file.originalname,
      file_type: req.file.mimetype,
      file_size: req.file.size
    };

    const statusData = chat.members.map(member => ({
      user_id: member.user_id,
      status: member.user_id === senderIdInt ? 'sent' : 'delivered'
    }));

    const messageDoc = new Message({
      chat_id: chat.chat_id,
      sender_id: senderIdInt,
      sender: senderUser ? {
        user_id: senderUser.user_id,
        username: senderUser.username,
        full_name: senderUser.full_name,
        profile_pic: senderUser.profile_pic
      } : null,
      message_text: message_text || req.file.originalname,
      message_type: messageType,
      attachments: [attachment],
      status: statusData,
      visibility: chat.members.map(m => ({ user_id: m.user_id, is_visible: true })),
      deleted_for: []
    });

    await messageDoc.save();

    await Chat.updateOne(
      { chat_id: chat.chat_id },
      {
        $set: {
          last_message: {
            message_id: messageDoc.message_id,
            sender_id: senderIdInt,
            message_text: messageDoc.message_text,
            message_type: messageDoc.message_type,
            created_at: messageDoc.created_at
          },
          updated_at: messageDoc.created_at,
          "members.$[elem].is_visible": true,
          "members.$[elem].hidden_at": null
        }
      },
      {
        arrayFilters: [{ "elem.is_archived": false }]
      }
    );

    const completeMessage = messageDoc.toObject();
    completeMessage.chat = {
      chat_id: chat.chat_id,
      chat_name: chat.chat_name,
      chat_type: chat.chat_type
    };

    emitFileMessage(chat.chat_id, completeMessage);

    res.status(201).json(completeMessage);
  } catch (err) {
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (unlinkErr) { }
    }
    console.error('[message.uploadFileAndCreateMessage]', err);
    res.status(500).json({ error: err.message });
  }
};

exports.forwardMessage = async (req, res) => {
  try {
    const { message_id, chat_ids, sender_id } = req.body;
    if (!message_id) return res.status(400).json({ error: 'message_id is required' });
    if (!chat_ids || !Array.isArray(chat_ids) || chat_ids.length === 0) {
      return res.status(400).json({ error: 'chat_ids must be a non-empty array' });
    }
    if (!sender_id) return res.status(400).json({ error: 'sender_id is required' });

    const senderIdInt = parseInt(sender_id);
    const originalMessage = await Message.findByMessageId(message_id);
    if (!originalMessage) return res.status(404).json({ error: 'Original message not found' });

    const senderUser = await prisma.user.findUnique({
      where: { user_id: senderIdInt },
      select: { user_id: true, username: true, full_name: true, profile_pic: true }
    });

    const forwardedMessages = [];
    const errors = [];

    for (const targetChatId of chat_ids) {
      try {
        const chat = await Chat.findByChatId(targetChatId);
        if (!chat) {
          errors.push({ chat_id: targetChatId, error: 'Chat not found' });
          continue;
        }

        const isMember = chat.members.some(m => m.user_id === senderIdInt);
        if (!isMember) {
          errors.push({ chat_id: targetChatId, error: 'User is not a member of this chat' });
          continue;
        }

        const statusData = chat.members.map(member => ({
          user_id: member.user_id,
          status: member.user_id === senderIdInt ? 'sent' : 'delivered'
        }));

        const forwardedMsgDoc = new Message({
          chat_id: chat.chat_id,
          sender_id: senderIdInt,
          sender: senderUser ? {
            user_id: senderUser.user_id,
            username: senderUser.username,
            full_name: senderUser.full_name,
            profile_pic: senderUser.profile_pic
          } : null,
          message_text: originalMessage.message_text || '',
          message_type: originalMessage.message_type,
          is_forward: true,
          referenced_message_id: originalMessage.message_id,
          attachments: originalMessage.attachments || [],
          status: statusData,
          visibility: chat.members.map(m => ({ user_id: m.user_id, is_visible: true })),
          deleted_for: []
        });

        await forwardedMsgDoc.save();

        await Chat.updateOne(
          { chat_id: chat.chat_id },
          {
            $set: {
              last_message: {
                message_id: forwardedMsgDoc.message_id,
                sender_id: senderIdInt,
                message_text: forwardedMsgDoc.message_text,
                message_type: forwardedMsgDoc.message_type,
                created_at: forwardedMsgDoc.created_at
              },
              updated_at: forwardedMsgDoc.created_at,
              "members.$[elem].is_visible": true,
              "members.$[elem].hidden_at": null
            }
          },
          { arrayFilters: [{ "elem.is_archived": false }] }
        );

        const completeMessage = forwardedMsgDoc.toObject();
        completeMessage.chat = {
          chat_id: chat.chat_id,
          chat_name: chat.chat_name,
          chat_type: chat.chat_type
        };

        emitFileMessage(chat.chat_id, completeMessage);
        forwardedMessages.push(completeMessage);
      } catch (chatError) {
        errors.push({ chat_id: targetChatId, error: chatError.message });
      }
    }

    res.status(201).json({
      message: `Message forwarded to ${forwardedMessages.length} chat(s)`,
      forwardedMessages,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[message.forwardMessage]', error);
    res.status(500).json({ error: 'Failed to forward message' });
  }
};

exports.getMessagesByChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = parseInt(req.query.userId || req.user?.user_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) return res.status(403).json({ error: 'User is not a member of this chat' });

    const filter = {
      chat_id: chat.chat_id,
      deleted_for: { $ne: userId }
    };

    const [messages, totalCount] = await Promise.all([
      Message.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments(filter)
    ]);

    const formattedMessages = messages.map(m => {
      const obj = m.toObject();
      obj.reply_to_id = obj.referenced_message_id;
      obj.reply_to_message = obj.referenced_message;
      return obj;
    }).reverse();

    res.json({
      messages: formattedMessages,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalMessages: totalCount,
        hasNext: page < Math.ceil(totalCount / limit),
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('[message.getMessagesByChat]', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMessageForUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(req.body.user_id || req.user?.user_id);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }

    const message = await Message.findByMessageId(id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const chat = await Chat.findByChatId(message.chat_id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) return res.status(403).json({ error: 'User is not a member of this chat' });

    await Message.updateOne(
      { message_id: message.message_id },
      { $addToSet: { deleted_for: userId } }
    );

    res.json({
      message: 'Message deleted for user',
      messageId: message.message_id,
      userId,
      removedFromDb: false
    });
  } catch (err) {
    console.error('[message.deleteMessageForUser]', err);
    res.status(500).json({ error: err.message });
  }
};

exports.markAllMessagesAsRead = async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const userIdInt = parseInt(userId);

    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const result = await Message.updateMany(
      {
        chat_id: chat.chat_id,
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
      message: `Marked ${result.modifiedCount} messages as read`,
      count: result.modifiedCount
    });
  } catch (err) {
    console.error('[message.markAllMessagesAsRead]', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteBatchMessagesForUser = async (req, res) => {
  try {
    const userId = parseInt(req.body.user_id || req.user?.user_id);
    const { message_ids } = req.body;

    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      return res.status(400).json({ error: 'message_ids array is required and cannot be empty' });
    }
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user_id' });

    const stringMessageIds = message_ids.map(id => String(id));

    const result = await Message.updateMany(
      { message_id: { $in: stringMessageIds } },
      { $addToSet: { deleted_for: userId } }
    );

    res.json({
      message: 'Messages deleted for user',
      deleted_count: result.modifiedCount,
      userId
    });
  } catch (err) {
    console.error('[message.deleteBatchMessagesForUser]', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAllMessagesInChatForUser = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = parseInt(req.body.user_id || req.user?.user_id);

    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user_id' });

    const chat = await Chat.findByChatId(chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) return res.status(403).json({ error: 'User is not a member of this chat' });

    const result = await Message.updateMany(
      { chat_id: chat.chat_id },
      { $addToSet: { deleted_for: userId } }
    );

    await messageCacheService.invalidateUserChatCache(chat.chat_id, userId);

    res.json({
      message: 'All messages in chat deleted for user',
      chatId: chat.chat_id,
      deleted_count: result.modifiedCount,
      userId
    });
  } catch (err) {
    console.error('[message.deleteAllMessagesInChatForUser]', err);
    res.status(500).json({ error: err.message });
  }
};