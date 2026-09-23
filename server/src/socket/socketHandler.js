const { PrismaClient } = require('@prisma/client');
const jwtService = require('../services/jwt.service');
const notificationService = require('../services/notification.service');
const messageCacheService = require('../services/message-cache.service');
const { deleteCache } = require('../services/cache.service');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const redis = require("../config/redis");
const { createAdapter } = require('@socket.io/redis-adapter');
const { setLocalIo } = require('./socketEmitter');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

let ioInstance = null;

const setupRedisAdapter = async (io) => {
  if (!redis.isAvailable()) {
    console.log('Redis is in fallback mode. Socket.IO using default in-memory adapter.');
    return false;
  }

  try {
    const pubClient = await redis.createDuplicateClient();
    const subClient = await redis.createDuplicateClient();

    if (pubClient && subClient) {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('Socket.IO Redis Adapter initialized successfully.');
      return true;
    }
  } catch (error) {
    console.warn('[socketHandler] Failed to attach Redis adapter, using in-memory:', error.message);
  }
  return false;
};

const _processCompleteFileMessage = async (fileData, socket, io, userId) => {
  try {
    const { chat_id, message_text, fileBuffer, fileName, fileType, fileSize, tempId } = fileData;
    const sender_id = userId;

    const chat = await Chat.findByChatId(chat_id);
    if (!chat) {
      socket.emit('file_upload_error', {
        error: 'Chat not found',
        tempId
      });
      return;
    }

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) {
      socket.emit('file_upload_error', {
        error: 'You are not a member of this chat',
        tempId
      });
      return;
    }

    const uploadsDir = path.join(__dirname, '../../uploads');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(fileName);
    const nameWithoutExt = path.basename(fileName, ext);
    const serverFilename = nameWithoutExt + '-' + uniqueSuffix + ext;
    const filePath = path.join(uploadsDir, serverFilename);

    await fs.promises.mkdir(uploadsDir, { recursive: true });

    let buffer = fileBuffer;
    if (typeof fileBuffer === 'string') {
      buffer = Buffer.from(fileBuffer, 'base64');
    }

    try {
      await fs.promises.writeFile(filePath, buffer);
    } catch (writeErr) {
      socket.emit('file_upload_error', {
        error: 'Failed to save file to disk',
        details: writeErr.message,
        tempId: tempId
      });
      return;
    }

    const fileUrl = `/uploads/${serverFilename}`;

    let messageType = 'file';
    if (fileType.startsWith('image/')) {
      messageType = 'image';
    } else if (fileType.startsWith('video/')) {
      messageType = 'video';
    } else if (fileType.startsWith('audio/')) {
      messageType = 'audio';
    } else if (fileType.includes('pdf')) {
      messageType = 'document';
    }

    const statusData = chat.members.map(member => ({
      user_id: member.user_id,
      status: member.user_id === sender_id ? 'sent' : 'delivered'
    }));

    const visibilityData = chat.members.map(member => ({
      user_id: member.user_id,
      is_visible: true
    }));

    const targetReplyId = fileData.reply_to_id || fileData.referenced_message_id;
    let referencedMsg = null;
    if (targetReplyId) {
      const ref = await Message.findByMessageId(targetReplyId);
      if (ref && String(ref.chat_id) === String(chat.chat_id)) {
        referencedMsg = {
          message_id: String(ref.message_id || ref._id),
          message_text: ref.message_text,
          is_reply: true,
          sender: ref.sender ? {
            user_id: ref.sender.user_id,
            username: ref.sender.username,
            full_name: ref.sender.full_name
          } : null
        };
      }
    }

    const messageDoc = new Message({
      chat_id: chat.chat_id,
      sender_id: sender_id,
      sender: {
        user_id: socket.user.user_id,
        username: socket.user.username,
        full_name: socket.user.full_name,
        profile_pic: socket.user.profile_pic
      },
      message_text: message_text || fileName,
      message_type: messageType,
      is_reply: !!targetReplyId,
      referenced_message_id: targetReplyId ? String(targetReplyId) : null,
      referenced_message: referencedMsg,
      attachments: [{
        file_url: fileUrl,
        original_filename: fileName,
        file_type: fileType,
        file_size: fileSize
      }],
      status: statusData,
      visibility: visibilityData,
      deleted_for: []
    });

    await messageDoc.save();

    await Chat.updateOne(
      { chat_id: chat.chat_id },
      {
        $set: {
          last_message: {
            message_id: messageDoc.message_id,
            sender_id: sender_id,
            message_text: messageDoc.message_text,
            message_type: messageDoc.message_type,
            created_at: messageDoc.created_at
          },
          updated_at: messageDoc.created_at,
          "members.$[elem].is_visible": true,
          "members.$[elem].hidden_at": null
        }
      },
      { arrayFilters: [{ "elem.is_archived": false }] }
    );

    const completeMessage = messageDoc.toObject();
    completeMessage.reply_to_id = completeMessage.referenced_message_id;
    completeMessage.reply_to_message = completeMessage.referenced_message;
    completeMessage.chat = {
      chat_id: chat.chat_id,
      chat_name: chat.chat_name,
      chat_type: chat.chat_type,
      chat_image: chat.chat_image
    };

    io.to(`chat_${chat.chat_id}`).emit('new_message', {
      ...completeMessage,
      tempId
    });

    chat.members.forEach(member => {
      if (member.user_id !== sender_id) {
        io.to(`user_${member.user_id}`).emit('new_message', {
          ...completeMessage,
          tempId
        });
      }
    });

    messageCacheService.addMessageToCache(chat.chat_id, completeMessage).catch(() => { });

    const fileMessageRecipientIds = chat.members
      .map(m => m.user_id)
      .filter(id => id !== sender_id);

    if (fileMessageRecipientIds.length > 0) {
      try {
        const fileInfo = completeMessage.attachments[0];
        await notificationService.notifyNewMessage(
          {
            sender_username: completeMessage.sender.username,
            sender_profile_pic: completeMessage.sender.profile_pic,
            message_text: fileInfo?.original_filename || `Shared a ${messageType}`,
            chat_id: chat.chat_id,
            chat_name: completeMessage.chat.chat_name || completeMessage.sender.username,
            chat_type: completeMessage.chat.chat_type,
            chat_image: completeMessage.chat.chat_image,
            message_type: messageType
          },
          fileMessageRecipientIds
        );
      } catch (pushError) {
        console.warn('[socket._processCompleteFileMessage] Push notification failed:', pushError.message);
      }
    }

    socket.emit('file_upload_success', {
      message_id: completeMessage.message_id,
      tempId,
      file_url: fileUrl,
      original_filename: fileName,
      status: 'sent',
      timestamp: completeMessage.created_at
    });

  } catch (error) {
    console.error('[socket._processCompleteFileMessage]', error);
    socket.emit('file_upload_error', {
      error: 'Failed to process file',
      details: error.message,
      tempId: fileData.tempId
    });
  }
};

const initializeSocket = (io) => {
  ioInstance = io;
  setLocalIo(io);

  const registrationNamespace = io.of('/registration');

  registrationNamespace.on('connection', (socket) => {

    socket.on('monitor_registration', async (data) => {
      const { username } = data;
      if (username) {
        await redis.set(`registration:socket:${username}`, String(socket.id), { EX: 300 });

        socket.emit('monitoring_started', { username });
      }
    });

    socket.on('cancel_registration', async (data) => {
      const { username } = data;
      if (username) {
        await deleteCache(`auth:pending-reg:${username}`);
        socket.emit('registration_cancelled', { username });

        await redis.del(`registration:socket:${username}`);
      }
    });

    socket.on('disconnect', async () => {
      await cleanupRegistrationBySocket(socket);
    });
  });

  const loginNamespace = io.of('/login');

  loginNamespace.on('connection', (socket) => {

    socket.on('monitor_login', async (data) => {
      const { userId } = data;
      if (userId) {
        await redis.set(`login:socket:${userId}`, String(socket.id), { EX: 300 });

        socket.emit('monitoring_started', { userId });
      }
    });

    socket.on('cancel_login', async (data) => {
      const { userId } = data;
      if (userId) {
        await deleteCache(`auth:pending-login:${userId}`);
        socket.emit('login_cancelled', { userId });

        await redis.del(`login:socket:${userId}`);
      }
    });

    socket.on('disconnect', async () => {
      await cleanupLoginBySocket(socket);
    });
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwtService.verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { user_id: decoded.user_id },
        select: {
          user_id: true,
          username: true,
          full_name: true,
          profile_pic: true,
          status_message: true
        }
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', async (socket) => {

    const user = socket.user;
    const userId = user.user_id;

    await redis.hSet(`active:user:${userId}`, {
      socketId: String(socket.id),
      username: String(user.username || ''),
      full_name: String(user.full_name || ''),
      profile_pic: String(user.profile_pic || ''),
      status: "online",
      lastSeen: new Date().toISOString()
    });

    await redis.expire(`active:user:${userId}`, 86400);

    await redis.set(`socket:user:${socket.id}`, String(userId), { EX: 86400 });

    await prisma.user.update({
      where: { user_id: userId },
      data: {
        is_online: true,
        last_seen: new Date()
      }
    });

    const userChats = await Chat.find({
      members: {
        $elemMatch: {
          user_id: userId,
          is_visible: true
        }
      }
    }, { chat_id: 1, chat_name: 1, chat_type: 1 });

    userChats.forEach(chat => {
      socket.join(`chat_${chat.chat_id}`);
    });

    socket.join(`user_${userId}`);

    await prisma.session.create({
      data: {
        user_id: userId,
        device_info: socket.handshake.headers['user-agent'] || 'Unknown',
        ip_address: socket.handshake.address,
        last_active: new Date()
      }
    }).catch(() => {
      prisma.session.updateMany({
        where: { user_id: userId },
        data: { last_active: new Date() }
      });
    });

    socket.broadcast.emit('user_online', {
      user_id: userId,
      username: user.username,
      full_name: user.full_name,
      status: 'online'
    });

    socket.emit('connected', {
      message: 'Successfully connected',
      user: user,
      chats: userChats
    });

    socket.on('send_message', async (messageData, ack) => {
      try {
        const { chat_id, message_text, message_type = 'text', reply_to_id, tempId } = messageData;
        const sender_id = userId;

        if (!chat_id) {
          const errorData = {
            error: 'chat_id is required',
            tempId
          };
          socket.emit('message_error', errorData);
          if (typeof ack === 'function') ack({ success: false, error: 'chat_id is required' });
          return;
        }

        if (!message_text || message_text.trim() === '') {
          const errorData = {
            error: 'message_text cannot be empty',
            tempId
          };
          socket.emit('message_error', errorData);
          if (typeof ack === 'function') ack({ success: false, error: 'message_text cannot be empty' });
          return;
        }

        const chat = await Chat.findByChatId(chat_id);
        if (!chat) {
          const errorData = { error: 'Chat not found', tempId };
          socket.emit('message_error', errorData);
          if (typeof ack === 'function') ack({ success: false, error: 'Chat not found' });
          return;
        }

        const isMember = chat.members.some(m => m.user_id === userId);
        if (!isMember) {
          const errorData = {
            error: 'You are not a member of this chat',
            tempId
          };
          socket.emit('message_error', errorData);
          if (typeof ack === 'function') ack({ success: false, error: 'Not a chat member' });
          return;
        }

        if (chat.chat_type === 'private' && chat.members.length >= 2) {
          const firstMember = chat.members[0];
          const secondMember = chat.members[1];
          const blockedUsers = await prisma.blockedUser.findMany({
            where: {
              OR: [
                { user_id: firstMember.user_id, blocked_user_id: secondMember.user_id },
                { user_id: secondMember.user_id, blocked_user_id: firstMember.user_id }
              ]
            }
          });

          if (blockedUsers.length > 0) {
            const errorData = {
              error: 'User is blocked',
              tempId
            };
            socket.emit('message_error', errorData);
            if (typeof ack === 'function') ack({ success: false, error: 'User blocked' });
            return;
          }
        }

        let referencedMsg = null;
        const targetReplyId = reply_to_id || messageData.referenced_message_id;
        if (targetReplyId) {
          const ref = await Message.findByMessageId(targetReplyId);
          if (!ref || String(ref.chat_id) !== String(chat.chat_id)) {
            const errorData = {
              error: 'Referenced message not found or not in this chat',
              tempId
            };
            socket.emit('message_error', errorData);
            if (typeof ack === 'function') ack({ success: false, error: 'Invalid referenced message' });
            return;
          }
          referencedMsg = {
            message_id: String(ref.message_id || ref._id),
            message_text: ref.message_text,
            is_reply: true,
            sender: ref.sender ? {
              user_id: ref.sender.user_id,
              username: ref.sender.username,
              full_name: ref.sender.full_name
            } : null
          };
        }

        const statusData = chat.members.map(member => ({
          user_id: member.user_id,
          status: member.user_id === userId ? 'sent' : 'delivered'
        }));

        const visibilityData = chat.members.map(member => ({
          user_id: member.user_id,
          is_visible: true
        }));

        const messageDoc = new Message({
          chat_id: chat.chat_id,
          sender_id: userId,
          sender: {
            user_id: user.user_id,
            username: user.username,
            full_name: user.full_name,
            profile_pic: user.profile_pic
          },
          message_text: message_text.trim(),
          message_type,
          is_reply: !!targetReplyId,
          referenced_message_id: targetReplyId ? String(targetReplyId) : null,
          referenced_message: referencedMsg,
          attachments: [],
          status: statusData,
          visibility: visibilityData,
          deleted_for: []
        });

        await messageDoc.save();

        await Chat.updateOne(
          { chat_id: chat.chat_id },
          {
            $set: {
              last_message: {
                message_id: messageDoc.message_id,
                sender_id: userId,
                message_text: messageDoc.message_text,
                message_type: messageDoc.message_type,
                created_at: messageDoc.created_at
              },
              updated_at: messageDoc.created_at,
              "members.$[elem].is_visible": true,
              "members.$[elem].hidden_at": null
            }
          },
          { arrayFilters: [{ "elem.is_archived": false }] }
        );

        const completeMessage = messageDoc.toObject();
        completeMessage.reply_to_id = completeMessage.referenced_message_id;
        completeMessage.reply_to_message = completeMessage.referenced_message;
        completeMessage.chat = {
          chat_id: chat.chat_id,
          chat_name: chat.chat_name,
          chat_type: chat.chat_type,
          chat_image: chat.chat_image
        };

        io.to(`chat_${chat.chat_id}`).emit('new_message', {
          ...completeMessage,
          tempId: messageData.tempId
        });

        chat.members.forEach(member => {
          if (member.user_id !== userId) {
            io.to(`user_${member.user_id}`).emit('new_message', {
              ...completeMessage,
              tempId: messageData.tempId
            });
          }
        });

        messageCacheService.addMessageToCache(chat.chat_id, completeMessage).catch(() => { });

        const recipientIds = chat.members
          .map(m => m.user_id)
          .filter(id => id !== userId);

        if (recipientIds.length > 0) {
          try {
            await notificationService.notifyNewMessage(
              {
                sender_username: completeMessage.sender.username,
                sender_profile_pic: completeMessage.sender.profile_pic,
                message_text: completeMessage.message_text,
                chat_id: chat.chat_id,
                chat_name: completeMessage.chat.chat_name || completeMessage.sender.username,
                chat_type: completeMessage.chat.chat_type,
                chat_image: completeMessage.chat.chat_image,
                message_type: completeMessage.message_type
              },
              recipientIds
            );
          } catch (pushError) {
            console.warn('[socket.send_message] Push notification failed:', pushError.message);
          }
        }

        socket.emit('message_sent', {
          message_id: completeMessage.message_id,
          tempId: messageData.tempId,
          status: 'sent',
          timestamp: completeMessage.created_at
        });

        if (typeof ack === 'function') {
          ack({
            success: true,
            message_id: completeMessage.message_id,
            tempId: messageData.tempId
          });
        }

      } catch (error) {
        console.error('[socket.send_message]', error);
        socket.emit('message_error', {
          error: 'Failed to send message',
          details: error.message,
          tempId: messageData.tempId
        });
        if (typeof ack === 'function') ack({ success: false, error: error.message });
      }
    });

    socket.on('update_message_status', async (statusData) => {
      try {
        const { message_id, status } = statusData;

        if (!message_id || !status) {
          socket.emit('status_error', { error: 'message_id and status are required' });
          return;
        }

        if (!['delivered', 'read'].includes(status)) {
          socket.emit('status_error', { error: 'Invalid status. Must be "delivered" or "read"' });
          return;
        }

        const message = await Message.findByMessageId(message_id);
        if (!message) {
          socket.emit('status_error', { error: 'Message not found' });
          return;
        }

        const now = new Date();
        const existingStatusIndex = (message.status || []).findIndex(s => s.user_id === userId);

        if (existingStatusIndex >= 0) {
          message.status[existingStatusIndex].status = status;
          message.status[existingStatusIndex].updated_at = now;
        } else {
          if (!message.status) message.status = [];
          message.status.push({
            user_id: userId,
            status: status,
            updated_at: now
          });
        }

        await message.save();

        io.to(`chat_${message.chat_id}`).emit('message_status_updated', {
          message_id: message.message_id,
          chat_id: message.chat_id,
          user_id: userId,
          status: status,
          updated_at: now
        });

      } catch (error) {
        console.error('[socket.update_message_status]', error);
        socket.emit('status_error', {
          error: 'Failed to update message status',
          details: error.message
        });
      }
    });

    socket.on('update_message', async (messageData) => {
      try {
        const { message_id, message_text } = messageData;
        const sender_id = userId;

        if (!message_id) {
          socket.emit('update_error', { error: 'message_id is required' });
          return;
        }

        if (!message_text || message_text.trim() === '') {
          socket.emit('update_error', { error: 'message_text is required and cannot be empty' });
          return;
        }

        const message = await Message.findByMessageId(message_id);

        if (!message) {
          socket.emit('update_error', { error: 'Message not found' });
          return;
        }

        if (message.sender_id !== sender_id) {
          socket.emit('update_error', { error: 'Only the sender can edit this message' });
          return;
        }

        const createdAt = new Date(message.created_at);
        const now = new Date();
        const timeDiffInHours = (now - createdAt) / (1000 * 60 * 60);

        if (timeDiffInHours > 2) {
          socket.emit('update_error', {
            error: 'Messages can only be edited within 2 hours of sending',
            messageSentAt: createdAt,
            editWindowExpiredAt: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000),
            timeSinceSent: `${timeDiffInHours.toFixed(2)} hours`
          });
          return;
        }

        message.message_text = message_text.trim();
        message.updated_at = new Date();
        message.updated = true;
        await message.save();

        const chat = await Chat.findByChatId(message.chat_id);
        if (chat && chat.last_message && String(chat.last_message.message_id) === String(message.message_id)) {
          chat.last_message.message_text = message.message_text;
          await chat.save();
        }

        io.to(`chat_${message.chat_id}`).emit('message_updated', {
          message_id: message.message_id,
          message_text: message.message_text,
          updated_at: message.updated_at,
          updated: message.updated,
          sender: message.sender
        });

        messageCacheService.updateMessageInCache(message.message_id, message.chat_id, message_text.trim()).catch(() => { });

        socket.emit('message_update_success', {
          message_id: message.message_id,
          data: message
        });

      } catch (error) {
        console.error('[socket.update_message]', error);
        socket.emit('update_error', {
          error: 'Failed to update message',
          details: error.message
        });
      }
    });

    socket.on('delete_message_for_all', async (data) => {
      try {
        const { message_id } = data;

        if (!message_id) {
          socket.emit('delete_error', { error: 'message_id is required' });
          return;
        }

        const message = await Message.findByMessageId(message_id);

        if (!message) {
          return socket.emit('delete_error', { error: 'Message not found' });
        }

        const isSender = message.sender_id === userId;

        const chat = await Chat.findByChatId(message.chat_id);
        const member = chat ? chat.members.find(m => m.user_id === userId) : null;
        const isAdmin = member && (member.role === 'admin' || member.role === 'creator');

        if (!isSender && !isAdmin) {
          return socket.emit('delete_error', {
            error: 'Only message sender or group admin can delete this message'
          });
        }

        if (message.attachments && message.attachments.length > 0) {
          await Promise.all(
            message.attachments.map(async (attachment) => {
              try {
                const filePath = path.join(__dirname, '../../', attachment.file_url);
                await fs.promises.unlink(filePath).catch(() => {});
              } catch (err) {
                console.warn('[socket.delete_message_for_all] File cleanup failed:', err.message);
              }
            })
          );
        }

        await Message.deleteOne({ _id: message._id });

        if (chat && chat.last_message && String(chat.last_message.message_id) === String(message.message_id)) {
          const prevMsg = await Message.findOne({ chat_id: chat.chat_id }).sort({ created_at: -1 });
          if (prevMsg) {
            chat.last_message = {
              message_id: prevMsg.message_id,
              sender_id: prevMsg.sender_id,
              message_text: prevMsg.message_text,
              created_at: prevMsg.created_at
            };
          } else {
            chat.last_message = null;
          }
          await chat.save();
        }

        messageCacheService.removeMessageFromCache(message.message_id, message.chat_id).catch(() => { });

        io.to(`chat_${message.chat_id}`).emit('message_deleted_for_all', {
          message_id: message.message_id,
          chat_id: message.chat_id,
          deleted_by_user_id: userId,
          deleted_by_type: isSender ? 'sender' : 'admin',
          deleted_at: new Date()
        });

        socket.emit('delete_success', {
          message: 'Message deleted successfully for all members',
          message_id: message.message_id,
          deleted_by: isSender ? 'sender' : 'admin'
        });

      } catch (error) {
        console.error('[socket.delete_message_for_all]', error);
        socket.emit('delete_error', {
          error: 'Failed to delete message',
          details: error.message
        });
      }
    });

    socket.on('delete_message_for_user', async (data) => {
      try {
        const { message_id } = data;

        if (!message_id) {
          socket.emit('delete_error', { error: 'message_id is required' });
          return;
        }

        const message = await Message.findByMessageId(message_id);

        if (!message) {
          return socket.emit('delete_error', { error: 'Message not found' });
        }

        const chat = await Chat.findByChatId(message.chat_id);
        const isUserInChat = chat && chat.members.some(m => m.user_id === userId);

        if (!isUserInChat) {
          return socket.emit('delete_error', { error: 'User is not a member of this chat' });
        }

        if (!message.deleted_for) message.deleted_for = [];
        if (!message.deleted_for.includes(userId)) {
          message.deleted_for.push(userId);
        }

        if (message.visibility) {
          const vis = message.visibility.find(v => v.user_id === userId);
          if (vis) {
            vis.is_visible = false;
            vis.hidden_at = new Date();
          }
        }

        const allDeleted = chat.members.every(m => message.deleted_for.includes(m.user_id));

        if (allDeleted) {
          if (message.attachments && message.attachments.length > 0) {
            await Promise.all(
              message.attachments.map(async (attachment) => {
                try {
                  const filePath = path.join(__dirname, '../../', attachment.file_url);
                  await fs.promises.unlink(filePath).catch(() => {});
                } catch (err) {
                  console.warn('[socket.delete_message_for_user] File cleanup failed:', err.message);
                }
              })
            );
          }

          await Message.deleteOne({ _id: message._id });

          if (chat && chat.last_message && String(chat.last_message.message_id) === String(message.message_id)) {
            const prevMsg = await Message.findOne({ chat_id: chat.chat_id }).sort({ created_at: -1 });
            if (prevMsg) {
              chat.last_message = {
                message_id: prevMsg.message_id,
                sender_id: prevMsg.sender_id,
                message_text: prevMsg.message_text,
                created_at: prevMsg.created_at
              };
            } else {
              chat.last_message = null;
            }
            await chat.save();
          }

          messageCacheService.removeMessageFromCache(message.message_id, message.chat_id).catch(() => { });

          io.to(`chat_${message.chat_id}`).emit('message_deleted_for_all', {
            message_id: message.message_id,
            chat_id: message.chat_id,
            deleted_by_user_id: userId,
            deleted_by_type: 'auto_cascade',
            reason: 'Hidden for all members',
            deleted_at: new Date()
          });

          return socket.emit('delete_success', {
            message: 'Message deleted for user and removed from database (hidden for all members)',
            message_id: message.message_id,
            removed_from_db: true
          });
        }

        await message.save();

        socket.emit('delete_success', {
          message: 'Message deleted for you',
          message_id: message.message_id,
          removed_from_db: false
        });

      } catch (error) {
        console.error('[socket.delete_message_for_user]', error);
        socket.emit('delete_error', {
          error: 'Failed to delete message for user',
          details: error.message
        });
      }
    });

    socket.on('typing_start', (data) => {
      const { chat_id, user_id, username } = data;
      socket.to(`chat_${chat_id}`).emit('user_typing', {
        user_id,
        username,
        chat_id
      });
    });

    socket.on('typing_stop', (data) => {
      const { chat_id, user_id } = data;
      socket.to(`chat_${chat_id}`).emit('user_stopped_typing', {
        user_id,
        chat_id
      });
    });

    socket.on('join_chat', async (data) => {
      try {
        const { chat_id } = data;

        if (!chat_id) {
          socket.emit('error', { message: 'chat_id is required' });
          return;
        }

        const chat = await Chat.findByChatId(chat_id);

        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const isMember = chat.members && chat.members.some(m => m.user_id === userId);

        if (isMember) {
          socket.join(`chat_${chat.chat_id}`);
          socket.emit('chat_joined', { chat_id: chat.chat_id });

          socket.to(`chat_${chat.chat_id}`).emit('user_joined_chat', {
            user_id: userId,
            chat_id: chat.chat_id
          });
        } else {
          socket.emit('error', { message: 'Not authorized to join this chat' });
        }

      } catch (error) {
        console.error('[socket.join_chat]', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    socket.on('leave_chat', (data) => {
      const { chat_id } = data;
      socket.leave(`chat_${chat_id}`);
      socket.to(`chat_${chat_id}`).emit('user_left_chat', {
        user_id: userId,
        chat_id
      });
    });

    socket.on('update_status', async (data) => {
      try {
        const { status_message } = data;

        await prisma.user.update({
          where: { user_id: userId },
          data: { status_message }
        });

        const key = `active:user:${userId}`;
        const exists = await redis.exists(key);

        if (exists) {
          await redis.hSet(key, {
            status_message: String(status_message || ''),
            lastSeen: new Date().toISOString()
          });
        }


        socket.broadcast.emit('user_status_updated', {
          user_id: userId,
          status_message
        });

      } catch (error) {
        console.error('[socket.update_status]', error);
        socket.emit('error', { message: 'Failed to update status' });
      }
    });

    socket.on('get_online_users', async () => {
      try {
        const onlineUsers = await getOnlineUsers();
        socket.emit('online_users', onlineUsers);
      } catch (err) {
        console.error('[socket.get_online_users]', err);
        socket.emit('online_users', []);  // fail-safe
      }
    });

    socket.on('send_file_message', async (fileData, ack) => {
      try {
        const { chat_id, message_text, fileBuffer, fileName, fileType, fileSize, tempId } = fileData;

        if (!chat_id) {
          socket.emit('file_upload_error', {
            error: 'chat_id is required',
            tempId
          });
          if (typeof ack === 'function') ack({ success: false, error: 'chat_id is required' });
          return;
        }

        if (!fileBuffer || !fileName) {
          socket.emit('file_upload_error', {
            error: 'File buffer and fileName are required',
            tempId
          });
          if (typeof ack === 'function') ack({ success: false, error: 'File buffer and fileName are required' });
          return;
        }

        const MAX_FILE_SIZE = 50 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
          socket.emit('file_upload_error', {
            error: `File size exceeds 50MB limit (${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
            tempId
          });
          if (typeof ack === 'function') ack({ success: false, error: 'File size exceeds limit' });
          return;
        }

        await _processCompleteFileMessage(fileData, socket, io, userId);

        if (typeof ack === 'function') {
          ack({
            success: true,
            tempId
          });
        }

      } catch (error) {
        socket.emit('file_upload_error', {
          error: 'Failed to upload file',
          details: error.message,
          tempId: fileData.tempId
        });
        if (typeof ack === 'function') ack({ success: false, error: error.message });
      }
    });


    socket.on('send_file_message_chunk', async (chunkData, ack) => {
      try {
        const {
          tempId,
          chunk,
          chunkIndex,
          totalChunks,
          isFirstChunk,
          isLastChunk,
          chat_id,
          fileName,
          fileSize,
          fileType,
          message_text
        } = chunkData;

        if (isFirstChunk) {
          await redis.hSet(`file:meta:${tempId}`, {
            chat_id: String(chat_id),
            fileName: String(fileName || ''),
            fileSize: String(fileSize || 0),
            fileType: String(fileType || ''),
            message_text: String(message_text || ''),
            userId: String(userId),
            totalChunks: String(totalChunks),
            receivedChunks: '0'
          });
          await redis.expire(`file:meta:${tempId}`, 600);
        }

        await redis.rPush(`file:chunks:${tempId}`, JSON.stringify({
          index: chunkIndex,
          data: chunk
        }));
        await redis.expire(`file:chunks:${tempId}`, 600);

        const received = await redis.hIncrBy(`file:meta:${tempId}`, 'receivedChunks', 1);

        if (typeof ack === 'function') {
          ack({ success: true, chunkIndex, receivedChunks: received });
        }

        if (isLastChunk && received === totalChunks) {
          const meta = await redis.hGetAll(`file:meta:${tempId}`);
          const chunksData = await redis.lRange(`file:chunks:${tempId}`, 0, -1);

          const chunks = chunksData
            .map(c => JSON.parse(c))
            .sort((a, b) => a.index - b.index)
            .map(c => c.data);

          const completeBase64 = chunks.join('');

          await _processCompleteFileMessage({
            chat_id: meta.chat_id,
            fileName: meta.fileName,
            fileSize: parseInt(meta.fileSize),
            fileType: meta.fileType,
            message_text: meta.message_text,
            fileBuffer: completeBase64,
            tempId
          }, socket, io, parseInt(meta.userId));

          await redis.del(`file:meta:${tempId}`);
          await redis.del(`file:chunks:${tempId}`);
        }
      } catch (error) {
        console.error('[socket.send_file_message_chunk]', error);
        if (typeof ack === 'function') {
          ack({ success: false, error: error.message });
        }
      }
    });

    socket.on('file_upload_progress', (progressData) => {
      const { chat_id, progress, tempId } = progressData;
      socket.emit('file_upload_progress_update', {
        progress,
        tempId
      });
    });

    socket.on('disconnect', async () => {
      try {
        const userIdStr = await redis.get(`socket:user:${socket.id}`);
        const userId = userIdStr ? parseInt(userIdStr) : null;

        if (userId) {
          const userData = await redis.hGetAll(`active:user:${userId}`);
          if (userData) {
            try {
              await Promise.race([
                prisma.user.update({
                  where: { user_id: userId },
                  data: {
                    is_online: false,
                    last_seen: new Date()
                  }
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Update timeout')), 5000)
                )
              ]);

              prisma.session.updateMany({
                where: { user_id: userId },
                data: { last_active: new Date() }
              }).catch(() => { });

              socket.broadcast.emit('user_offline', {
                user_id: userId,
                username: userData.username,
                lastSeen: new Date()
              });


            } catch (dbError) {
              console.warn('[socket.disconnect] DB update failed:', dbError.message);
            }
          }

          await redis.del(`active:user:${userId}`);
          await redis.del(`socket:user:${socket.id}`);
        }

      } catch (error) {
        console.error('[socket.disconnect]', error);
      }


    });

    socket.on('error', (error) => {
      console.error('[socket.error] Socket error for user', userId, ':', error);
    });
  });
};

const getOnlineUsers = async () => {
  let cursor = '0';
  const result = [];

  do {
    const reply = await redis.scan(cursor, {
      MATCH: "active:user:*",
      COUNT: 50
    });

    cursor = reply.cursor;
    const keys = reply.keys;

    for (const key of keys) {
      const userData = await redis.hGetAll(key);
      if (!userData || Object.keys(userData).length === 0) continue;

      const userId = key.split(":")[2];

      result.push({
        user_id: parseInt(userId),
        username: userData.username,
        full_name: userData.full_name,
        profile_pic: userData.profile_pic,
        status: userData.status,
        lastSeen: userData.lastSeen
      });
    }
  } while (cursor !== '0');

  return result;
};


const cleanupRegistrationBySocket = async (socket) => {
  const authController = require('../controller/auth.controller');
  const pendingRegistrations = authController.getPendingRegistrations();

  let cursor = '0';

  do {
    const reply = await redis.scan(cursor, {
      MATCH: "registration:socket:*",
      COUNT: 50
    });

    cursor = reply.cursor;
    const keys = reply.keys;

    for (const key of keys) {
      const storedSocketId = await redis.get(key);

      if (storedSocketId === socket.id) {

        const parts = key.split(":");
        const username = parts[2];

        const registrationData = pendingRegistrations.get(username);
        if (registrationData) {
          clearTimeout(registrationData.timeoutId);
          pendingRegistrations.delete(username);
        }

        await redis.del(key);

        return;
      }
    }
  } while (cursor !== '0');
};

const cleanupLoginBySocket = async (socket) => {
  const authController = require('../controller/auth.controller');
  const pendingLogins = authController.getPendingLogins();

  let cursor = '0';

  do {
    const reply = await redis.scan(cursor, {
      MATCH: "login:socket:*",
      COUNT: 50
    });

    cursor = reply.cursor;
    const keys = reply.keys;

    for (const key of keys) {
      const storedSocketId = await redis.get(key);

      if (storedSocketId === socket.id) {

        const parts = key.split(":");
        const userId = parseInt(parts[2]);

        const loginData = pendingLogins.get(userId);
        if (loginData) {
          clearTimeout(loginData.timeoutId);
          pendingLogins.delete(userId);
        }

        await redis.del(key);

        return;
      }
    }
  } while (cursor !== '0');
};

const isUserOnline = async (userId) => {
  const exists = await redis.exists(`active:user:${userId}`);
  return exists === 1;
};

const sendNotificationToUser = async (userId, notification) => {
  const userData = await redis.hGetAll(`active:user:${userId}`);
  if (userData && userData.socketId && ioInstance) {
    ioInstance.to(userData.socketId).emit('notification', notification);
    return true;
  }
  return false;
};

const sendNotificationToChat = (chatId, event, data) => {
  if (ioInstance) {
    ioInstance.to(`chat_${chatId}`).emit(event, data);
    return true;
  }
  return false;
};

const emitFileMessage = async (chatId, messageData) => {
  if (ioInstance) {
    ioInstance.to(`chat_${chatId}`).emit('new_message', messageData);
    return true;
  }
  return false;
};

module.exports = {
  initializeSocket,
  setupRedisAdapter,
  getOnlineUsers,
  isUserOnline,
  sendNotificationToUser,
  sendNotificationToChat,
  emitFileMessage
};
