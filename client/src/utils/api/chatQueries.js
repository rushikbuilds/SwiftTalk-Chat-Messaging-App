import { fetchChatInfo, fetchChatMessages } from './chatService';

export const chatKeys = {
  all: ['chats'],
  info: (chatId) => ['chat', 'info', chatId],
  messages: (chatId, userId) => ['chat', 'messages', chatId, userId],
};

export const chatInfoQueryOptions = (chatId) => ({
  queryKey: chatKeys.info(chatId),
  queryFn: () => fetchChatInfo(chatId),
  staleTime: 30_000,      // treat data fresh for 30s — won't re-fetch on every hover
  gcTime: 5 * 60_000,     // keep in cache for 5 minutes
  enabled: !!chatId,
});

export const chatMessagesQueryOptions = (chatId, userId) => ({
  queryKey: chatKeys.messages(chatId, userId),
  queryFn: () => fetchChatMessages(chatId, userId),
  staleTime: 10_000,
  gcTime: 5 * 60_000,
  enabled: !!chatId && !!userId,
});