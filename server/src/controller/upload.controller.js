const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { uploadProfile, uploadGroup, uploadFiles } = require('../config/upload');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

exports.uploadProfilePic = [
  uploadProfile.single('profile_pic'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;

      await prisma.user.update({
        where: { user_id: req.user.user_id },
        data: { profile_pic: fileUrl }
      });

      res.status(200).json({
        message: 'Profile picture uploaded successfully',
        file_url: fileUrl,
        filename: req.file.filename
      });
    } catch (error) {
      console.error('[upload.uploadProfilePic]', error);
      res.status(500).json({ error: 'Error uploading profile picture' });
    }
  }
];

exports.uploadGroupImage = [
  uploadGroup.single('chat_image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      const { chatId } = req.body;

      if (chatId) {
        const chat = await Chat.findByChatId(chatId);
        if (chat) {
          chat.chat_image = fileUrl;
          await chat.save();
        }
      }

      res.status(200).json({
        message: 'Group image uploaded successfully',
        file_url: fileUrl,
        filename: req.file.filename
      });
    } catch (error) {
      console.error('[upload.uploadGroupImage]', error);
      res.status(500).json({ error: 'Error uploading group image' });
    }
  }
];

exports.uploadAttachment = [
  uploadFiles.single('attachment'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      res.status(200).json({
        message: 'Attachment uploaded successfully',
        file_url: `/uploads/${req.file.filename}`,
        file_type: req.file.mimetype,
        file_size: req.file.size,
        filename: req.file.filename
      });
    } catch (error) {
      console.error('[upload.uploadAttachment]', error);
      res.status(500).json({ error: 'Error uploading attachment' });
    }
  }
];

exports.getChatImage = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../../uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const chat = await Chat.findOne({
      chat_image: { $regex: filename }
    });

    if (!chat) return res.status(404).json({ error: 'Chat image not found' });
    const isMember = chat.members.some(m => m.user_id === req.user?.user_id);
    if (!isMember) return res.status(403).json({ error: 'Access denied. You are not a member of this chat.' });

    res.sendFile(filePath);
  } catch (error) {
    console.error('[upload.getChatImage]', error);
    res.status(500).json({ error: 'Error serving file' });
  }
};

exports.getAttachment = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../../uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const message = await Message.findOne({
      "attachments.file_url": { $regex: filename }
    });

    if (!message) return res.status(404).json({ error: 'File not found in any accessible conversation' });

    const chat = await Chat.findByChatId(message.chat_id);
    if (!chat || !chat.members.some(m => m.user_id === req.user?.user_id)) {
      return res.status(403).json({ error: 'Access denied. You are not a member of this conversation.' });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('[upload.getAttachment]', error);
    res.status(500).json({ error: 'Error serving file' });
  }
};

exports.getProfilePicture = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../../uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Profile picture not found' });

    res.sendFile(filePath);
  } catch (error) {
    console.error('[upload.getProfilePicture]', error);
    res.status(500).json({ error: 'Error serving file' });
  }
};

exports.getFile = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../../uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const userWithProfilePic = await prisma.user.findFirst({
      where: { OR: [{ profile_pic: `/uploads/${filename}` }, { profile_pic: `uploads/${filename}` }, { profile_pic: filename }] }
    });
    if (userWithProfilePic) return res.sendFile(filePath);

    const chatWithImage = await Chat.findOne({
      chat_image: { $regex: filename }
    });
    if (chatWithImage) return res.sendFile(filePath);

    if (req.user) {
      const message = await Message.findOne({
        "attachments.file_url": { $regex: filename }
      });
      if (message) {
        const chat = await Chat.findByChatId(message.chat_id);
        if (chat && chat.members.some(m => m.user_id === req.user.user_id)) {
          return res.sendFile(filePath);
        }
      }
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('[upload.getFile]', error);
    res.status(500).json({ error: 'Error serving file' });
  }
};
