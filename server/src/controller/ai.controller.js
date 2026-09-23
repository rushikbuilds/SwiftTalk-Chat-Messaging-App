const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const aiService = require('../services/ai.service');
const aiChatStream = require('../services/aiChatStream.service');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

const getRelativeTime = (date) => {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
};

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
        'ai_chat',
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

exports.streamChatController = async (req, res) => {
  const user_id = req.user.user_id;
  let { message, session_id } = req.body;
  let streamEnded = false;
  let accumulatedResponse = '';

  try {
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!session_id || session_id === 'null' || session_id === 'undefined') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // validate session
    session_id = await aiChatStream.getOrCreateSession(user_id, session_id);

    
    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    
    // Handle client disconnect
    res.on('close', () => {
      streamEnded = true;
      console.log('Client disconnected from chat stream');
    });

    // Create and iterate through stream
    const stream = aiChatStream.createChatStream(message, session_id);
    
    for await (const event of stream) {
      // Check if client disconnected
      if (streamEnded) {
        console.log('Stream aborted due to client disconnect');
        break;
      }

      try {
        if (event.type === 'error') {
          console.error('Stream error:', event.error);
          res.write(`event: error\ndata: ${JSON.stringify({
            error: event.data,
            details: event.error,
          })}\n\n`);
          break;
        } else if (event.type === 'end') {
          // Send end event
          res.write(`event: end\ndata: ${JSON.stringify({
            message: 'Stream completed',
          })}\n\n`);
          streamEnded = true;
          await aiChatStream.saveMessage(session_id, 'user', message.trim());
          await aiChatStream.saveMessage(session_id, 'assistant', accumulatedResponse.trim());
        } else if (event.type === 'chunk') {
          // Send data chunk (already a string)
          accumulatedResponse += event.data; 
          res.write(`event: chunk\ndata: ${JSON.stringify({
            chunk: event.data,
          })}\n\n`);
        }
      } catch (writeError) {
        console.error('Error writing to response:', writeError);
        streamEnded = true;
        break;
      }
    }

    if (!streamEnded) {
      res.end();
    }
  } catch (error) {
    if (error.message === 'Session ID is required') {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === 'Session not found') {
      return res.status(404).json({ error: error.message });
    }

    if (error.message === 'Unauthorized' || error.message === 'Session not found or unauthorized') {
      return res.status(403).json({ error: 'Session unauthorized' });
    }

    console.error('Stream controller error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to create chat stream',
        details: error.message,
      });
    } else {
      // Headers already sent, write error event
      try {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: 'Stream error',
          details: error.message,
        })}\n\n`);
        res.end();
      } catch (writeErr) {
        console.error('Failed to send error event:', writeErr);
      }
    }
  }
}

exports.createSession = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const result = await aiChatStream.createSession(userId);

    res.status(201).json({
      success: true,
      ...result,
      message: 'New chat session created',
    });
  } catch (error) {
    console.error('[ai.createSession]', error);
    res.status(500).json({ error: error.message });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const sessions = await prisma.aISession.findMany({
      where: { user_id: userId },
      select: {
        session_id: true,
        title: true,
        created_at: true,
        last_activity: true,
      },
      orderBy: { last_activity: 'desc' },
    });

    res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('[ai.listSessions]', error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteSession = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { session_id } = req.params;

    await aiChatStream.deleteSession(userId, session_id);

    res.status(200).json({ success: true, message: 'Session deleted' });
  } catch (error) {
    console.error('[ai.deleteSession]', error);
    res.status(error.message === 'Unauthorized' ? 403 : 500)
      .json({ error: error.message });
  }
};

exports.getUserSessions = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userSession = await prisma.aISession.findMany({
      where: {
        user_id: userId
      },
      select: {
        session_id: true,
        title: true,
        created_at: true,
        last_activity: true
      },
      orderBy: {
        last_activity: 'desc'
      }
    });

    const sessionsWithRelativeTime = userSession.map(session => ({
      ...session,
      relative_time: getRelativeTime(session.last_activity)
    }));
    res.status(200).json({ success: true, sessions: sessionsWithRelativeTime });
  } catch (err) {
    console.error('[ai.getUserSessions]', err);
    res.status(err.message === 'Unauthorized' ? 403 : 500)
      .json({ error: err.message });
  }
};

exports.getSession = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { session_id } = req.params;

    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const session = await prisma.aISession.findUnique({
      where: {
        session_id: session_id
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify ownership
    if (session.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to this session' });
    }

    res.status(200).json({
      success: true,
      session_id: session.session_id,
      title: session.title,
      conversation: session.conversation || [],
      created_at: session.created_at,
      last_activity: session.last_activity
    });
  } catch (err) {
    console.error('[ai.getSession]', err);
    res.status(err.message === 'Unauthorized' ? 403 : 500)
      .json({ error: err.message });
  }
}