const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const aiService = require('../services/ai.service');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

exports.generateSmartReplies = async (req, res) => {
  try {
    const { chat_id, limit = 3 } = req.body;
    const userId = req.user.user_id;

    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }

    const chat = await Chat.findByChatId(chat_id);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }

    const messages = await Message.find({
      chat_id: chat.chat_id,
      message_type: 'text'
    })
      .sort({ created_at: -1 })
      .limit(10);

    if (messages.length === 0) {
      return res.status(400).json({
        error: 'No messages found in this chat',
        suggestions: [],
      });
    }

    const messageHistory = messages.reverse().map(msg => ({
      sender: msg.sender?.username || msg.sender?.full_name || 'User',
      text: msg.message_text,
    }));

    const suggestions = await aiService.generateSmartReplies(
      messageHistory,
      parseInt(limit)
    );

    res.status(200).json({
      success: true,
      chat_id: chat.chat_id,
      suggestions,
      context_messages: messages.length,
    });
  } catch (error) {
    console.error('[ai.generateSmartReplies]', error);
    res.status(500).json({ error: 'Failed to generate smart replies', details: error.message });
  }
};

exports.translateMessage = async (req, res) => {
  try {
    const { message_id, text, target_language, source_language = 'auto' } = req.body;
    const userId = req.user.user_id;

    if (!target_language) {
      return res.status(400).json({ error: 'target_language is required' });
    }

    let messageText = text;

    if (message_id) {
      const message = await Message.findByMessageId(message_id);

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const chat = await Chat.findByChatId(message.chat_id);
      if (!chat || !chat.members.some(m => m.user_id === userId)) {
        return res.status(403).json({ error: 'You do not have access to this message' });
      }

      messageText = message.message_text;
    }

    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ error: 'text or message_id is required' });
    }

    const translation = await aiService.translateMessage(
      messageText,
      target_language,
      source_language
    );

    res.status(200).json({
      success: true,
      original_text: messageText,
      ...translation,
    });
  } catch (error) {
    console.error('[ai.translateMessage]', error);
    res.status(500).json({ error: 'Failed to translate message', details: error.message });
  }
};

exports.summarizeConversation = async (req, res) => {
  try {
    const { chat_id, message_count = 50, summary_type = 'brief' } = req.body;
    const userId = req.user.user_id;

    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }

    const chat = await Chat.findByChatId(chat_id);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }

    const messages = await Message.find({
      chat_id: chat.chat_id,
      message_type: 'text',
    })
      .sort({ created_at: -1 })
      .limit(parseInt(message_count) || 50);

    if (messages.length === 0) {
      return res.status(400).json({
        error: 'No messages found to summarize',
      });
    }

    const formattedMessages = messages.reverse().map(msg => ({
      sender: msg.sender?.username || msg.sender?.full_name || 'User',
      text: msg.message_text,
      timestamp: msg.created_at,
    }));

    const summary = await aiService.summarizeConversation(
      formattedMessages,
      summary_type
    );

    res.status(200).json({
      success: true,
      chat_id: chat.chat_id,
      summary,
      summary_type,
      messages_analyzed: messages.length,
      time_range: {
        from: messages[0].created_at,
        to: messages[messages.length - 1].created_at,
      },
    });
  } catch (error) {
    console.error('[ai.summarizeConversation]', error);
    res.status(500).json({ error: 'Failed to summarize conversation', details: error.message });
  }
};

exports.detectLanguage = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await aiService.detectLanguage(text);

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[ai.detectLanguage]', error);
    res.status(500).json({ error: 'Failed to detect language', details: error.message });
  }
};

exports.generateConversationStarters = async (req, res) => {
  try {
    const { chat_id } = req.body;
    const userId = req.user.user_id;

    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }

    const chat = await Chat.findByChatId(chat_id);

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = chat.members.some(m => m.user_id === userId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }

    let recipientName = '';
    if (chat.chat_type === 'private') {
      const otherMember = chat.members.find(member => member.user_id !== userId);
      if (otherMember) {
        const user = await prisma.user.findUnique({
          where: { user_id: otherMember.user_id },
          select: { full_name: true }
        });
        recipientName = user?.full_name?.split(' ')[0] || '';
      }
    }

    const context = {
      chatType: chat.chat_type === 'group' ? 'group' : 'direct',
      chatName: chat.chat_name,
      recipientName
    };

    const starters = await aiService.generateConversationStarters(context);
    res.status(200).json({ success: true, chat_id: chat.chat_id, starters });
  } catch (error) {
    console.error('[ai.generateConversationStarters]', error);
    res.status(500).json({ error: 'Failed to generate conversation starters', details: error.message });
  }
};

exports.checkStatus = async (req, res) => {
  try {
    const isConfigured = aiService.isConfigured();
    res.status(200).json({
      success: true,
      ai_enabled: isConfigured,
      features: isConfigured ? [
        'smart_replies',
        'translation',
        'summarization',
        'language_detection',
        'conversation_starters',
      ] : [],
      message: isConfigured
        ? 'AI service is configured and ready (powered by Groq)'
        : 'AI service is not configured. Please add AI_API_KEY to environment variables.',
    });
  } catch (error) {
    console.error('[ai.checkStatus]', error);
    res.status(500).json({ error: 'Failed to check AI service status', details: error.message });
  }
};