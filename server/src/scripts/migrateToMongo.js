/**
 * Migration Script: MySQL (Prisma) to MongoDB (Mongoose)
 * 
 * Migrates Chats, ChatMembers, ChatVisibility, Messages, Attachments, 
 * MessageStatus, and MessageVisibility from MySQL into MongoDB collections.
 * 
 * Usage:
 *   node src/scripts/migrateToMongo.js [--dry-run]
 */

const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const { connectMongo, disconnectMongo } = require('../config/mongo');
const Chat = require('../models/mongo/Chat');
const Message = require('../models/mongo/Message');

async function migrate() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[Migration] Starting migration from MySQL to MongoDB... ${isDryRun ? '(DRY RUN)' : ''}`);

  await connectMongo();

  try {
    // 1. Fetch all chats with relational data from MySQL
    console.log('[Migration] Fetching chats from MySQL...');
    const mysqlChats = await prisma.chat.findMany({
      include: {
        members: true,
        admins: true,
        chatVisibility: true
      }
    });

    console.log(`[Migration] Found ${mysqlChats.length} chats in MySQL.`);

    let chatsMigrated = 0;
    for (const chat of mysqlChats) {
      const adminUserIds = new Set(chat.admins.map(a => a.user_id));
      const visibilityMap = new Map();
      chat.chatVisibility.forEach(v => {
        visibilityMap.set(v.user_id, v);
      });

      const members = chat.members.map(member => {
        const vis = visibilityMap.get(member.user_id) || {};
        return {
          user_id: member.user_id,
          role: adminUserIds.has(member.user_id) ? 'admin' : member.role || 'member',
          joined_at: member.joined_at,
          is_visible: vis.is_visible !== undefined ? vis.is_visible : true,
          is_archived: vis.is_archived !== undefined ? vis.is_archived : false,
          pinned: vis.pinned !== undefined ? vis.pinned : false,
          hidden_at: vis.hidden_at || null,
          archived_at: vis.archived_at || null
        };
      });

      if (!isDryRun) {
        await Chat.findOneAndUpdate(
          { chat_id: String(chat.chat_id) },
          {
            chat_id: String(chat.chat_id),
            chat_type: chat.chat_type,
            chat_name: chat.chat_name,
            chat_image: chat.chat_image,
            description: chat.description,
            created_by: chat.created_by,
            private_chat_key: chat.private_chat_key,
            members,
            created_at: chat.created_at,
            updated_at: chat.created_at
          },
          { upsert: true, new: true }
        );
      }
      chatsMigrated++;
    }

    console.log(`[Migration] Processed ${chatsMigrated} chats into MongoDB.`);

    // 2. Fetch all messages in batches
    console.log('[Migration] Fetching messages from MySQL...');
    const totalMessages = await prisma.message.count();
    console.log(`[Migration] Total messages in MySQL: ${totalMessages}`);

    const batchSize = 200;
    let offset = 0;
    let messagesMigrated = 0;

    while (offset < totalMessages) {
      const mysqlMessages = await prisma.message.findMany({
        skip: offset,
        take: batchSize,
        include: {
          sender: {
            select: {
              user_id: true,
              username: true,
              full_name: true,
              profile_pic: true
            }
          },
          attachments: true,
          status: true,
          visibility: true,
          referenced_message: {
            select: {
              message_id: true,
              message_text: true,
              sender: {
                select: {
                  user_id: true,
                  username: true,
                  full_name: true
                }
              }
            }
          }
        },
        orderBy: { message_id: 'asc' }
      });

      for (const msg of mysqlMessages) {
        const deletedFor = msg.visibility
          .filter(v => v.is_visible === false)
          .map(v => v.user_id);

        const attachments = msg.attachments.map(att => ({
          attachment_id: String(att.attachment_id),
          file_url: att.file_url,
          original_filename: att.original_filename,
          file_type: att.file_type,
          file_size: att.file_size,
          uploaded_at: att.uploaded_at
        }));

        const status = msg.status.map(st => ({
          user_id: st.user_id,
          status: st.status,
          updated_at: st.updated_at
        }));

        const visibility = msg.visibility.map(vis => ({
          user_id: vis.user_id,
          is_visible: vis.is_visible,
          hidden_at: vis.hidden_at
        }));

        let referencedMessage = null;
        if (msg.referenced_message) {
          referencedMessage = {
            message_id: String(msg.referenced_message.message_id),
            message_text: msg.referenced_message.message_text,
            is_reply: msg.is_reply,
            sender: msg.referenced_message.sender ? {
              user_id: msg.referenced_message.sender.user_id,
              username: msg.referenced_message.sender.username,
              full_name: msg.referenced_message.sender.full_name
            } : null
          };
        }

        if (!isDryRun) {
          await Message.findOneAndUpdate(
            { message_id: String(msg.message_id) },
            {
              message_id: String(msg.message_id),
              chat_id: String(msg.chat_id),
              sender_id: msg.sender_id,
              sender: msg.sender ? {
                user_id: msg.sender.user_id,
                username: msg.sender.username,
                full_name: msg.sender.full_name,
                profile_pic: msg.sender.profile_pic
              } : null,
              message_text: msg.message_text || '',
              message_type: msg.message_type || 'text',
              is_reply: msg.is_reply,
              is_forward: msg.is_forward,
              referenced_message_id: msg.referenced_message_id ? String(msg.referenced_message_id) : null,
              referenced_message: referencedMessage,
              attachments,
              status,
              deleted_for: deletedFor,
              visibility,
              updated: msg.updated || false,
              created_at: msg.created_at,
              updated_at: msg.updated_at
            },
            { upsert: true, new: true }
          );
        }
        messagesMigrated++;
      }

      offset += batchSize;
      console.log(`[Migration] Processed ${messagesMigrated}/${totalMessages} messages...`);
    }

    // 3. Update last_message on each Chat in MongoDB
    if (!isDryRun) {
      console.log('[Migration] Updating last_message on all chats...');
      const allMongoChats = await Chat.find();
      for (const mChat of allMongoChats) {
        const latestMsg = await Message.findOne({ chat_id: mChat.chat_id })
          .sort({ created_at: -1 });

        if (latestMsg) {
          await Chat.updateOne(
            { chat_id: mChat.chat_id },
            {
              last_message: {
                message_id: latestMsg.message_id,
                sender_id: latestMsg.sender_id,
                message_text: latestMsg.message_text,
                message_type: latestMsg.message_type,
                created_at: latestMsg.created_at
              },
              updated_at: latestMsg.created_at
            }
          );
        }
      }
    }

    console.log('\n=======================================');
    console.log('[Migration] COMPLETE!');
    console.log(`- Chats Migrated: ${chatsMigrated}`);
    console.log(`- Messages Migrated: ${messagesMigrated}`);
    console.log('=======================================\n');

  } catch (error) {
    console.error('[Migration] Failed with error:', error);
  } finally {
    await prisma.$disconnect();
    await disconnectMongo();
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrate };
