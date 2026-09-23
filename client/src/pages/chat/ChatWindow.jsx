import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import SimpleBar from "simplebar-react";
import { useQuery } from '@tanstack/react-query';
import { chatInfoQueryOptions, chatMessagesQueryOptions } from '../../utils/api/chatQueries';
import "simplebar-react/dist/simplebar.min.css";
import {
  ArrowLeft,
  MoreVertical,
  Send,
  Paperclip,
  Smile,
  Image,
  File,
  Check,
  X,
  Loader,
  Copy,
  Reply,
  Forward,
  Trash2,
  Search,
  Eraser,
  UserCheck,
  Ban,
  Users,
  UserPlus,
  LogOut,
  ChevronUp,
  ChevronDown,
  Languages,
  FileText,
  Sparkles,
  Edit,
} from "lucide-react";
import ChatInfoModal from "../../components/modals/ChatInfoModal";
import UpdateGroupInfoModal from "../../components/modals/UpdateGroupInfoModal";
import AttachmentPreview from "../../components/messages/AttachmentPreview";
import ToastContainer from "../../components/common/ToastContainer";
import TypingIndicator from "../../components/messages/TypingIndicator";
import ContextMenu from "../../components/common/ContextMenu";
import ConfirmationBox from "../../components/common/ConfirmationBox";
import MessageStatusIndicator from "../../components/messages/MessageStatusIndicator";
import SystemMessage from "../../components/messages/SystemMessage";
import SmartReplies from "../../components/features/SmartReplies";
import MessageTranslator from "../../components/modals/MessageTranslator";
import ChatSummary from "../../components/modals/ChatSummary";
import ConversationStarters from "../../components/features/ConversationStarters";
import MessageForward from "../../components/modals/MessageForward";
import useContextMenu from "../../hooks/useContextMenu";
import { useToast } from "../../hooks/useToast";
import useResponsive from "../../hooks/useResponsive";
import { formatMessageTime, formatLastSeen } from "../../utils/date";
import socketService from "../../utils/socket";
import { getFileLogo, isImageFile, formatFileSize } from "../../utils/file";
import {
  blockUser,
  unblockUser,
  checkBlockStatus,
  fetchUserProfileById,
  fetchChatImage as fetchChatImageApi,
  deleteMessage,
  deleteMessagesBatch,
  clearChat,
  searchUsers,
  addMemberToGroup,
  exitGroup,
  translateText,
  createChat,
} from "../../utils/api";
import EmojiPicker from "../../components/common/EmojiPicker";
import "./ChatWindow.css";

const ChatWindow = ({
  chatId: propChatId,
  isEmbedded = false,
  recipient: propRecipient = null,
  onMemberClick = null,
  onChatCreated = null,
}) => {
  const params = useParams();
  const location = useLocation();
  const chatId = propChatId || params?.chatId;
  const recipient = propRecipient || location.state?.recipient || null;
  const isNewChat = !chatId && recipient !== null;
  const navigate = useNavigate();
  const isWideScreen = useResponsive();
  const messagesEndRef = useRef(null);
  const simpleBarRef = useRef(null);
  const fileInputRef = useRef(null);
  const headerRef = useRef(null);
  const inputContainerRef = useRef(null);
  const smartRepliesRef = useRef(null);
  const observerTimeoutRef = useRef(null);
  const [messageText, setMessageText] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingMessages, setUploadingMessages] = useState({});
  const { toasts, showError, showSuccess, removeToast } = useToast();
  const messageContextMenu = useContextMenu();
  const [selectedMessage, setSelectedMessage] = useState(null);
  const headerContextMenu = useContextMenu();

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userId = user.user_id;
  const [currentChatId, setCurrentChatId] = useState(chatId);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  useEffect(() => {
    if (chatId !== undefined && chatId !== null) {
      setCurrentChatId(chatId);
    }
  }, [chatId]);

  const [chatInfo, setChatInfo] = useState({
    id: chatId,
    name: "",
    avatar: "💬",
    online: false,
    is_online: false,
    last_seen: null,
    admins: [],
    is_admin: false,
    description: "",
    chat_image: null,
  });
  const [messages, setMessages] = useState([]);
  const [userProfiles, setUserProfiles] = useState({});
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByOther, setIsBlockedByOther] = useState(false);
  const [chatImageUrl, setChatImageUrl] = useState(null); // Store blob URL for chat image
  const [showChatInfoModal, setShowChatInfoModal] = useState(false);
  const [showUpdateGroupInfoModal, setShowUpdateGroupInfoModal] =
    useState(false);
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const typingTimeoutRef = useRef(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [searchAddMember, setSearchAddMember] = useState("");

  const [showSmartReplies, setShowSmartReplies] = useState(false);
  const [showTranslator, setShowTranslator] = useState(false);
  const [translateMessage, setTranslateMessage] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showConversationStarters, setShowConversationStarters] =
    useState(false);
  const [messageTranslations, setMessageTranslations] = useState({}); // {message_id: {text: string, lang: string, loading: boolean}}
  const [addMemberResults, setAddMemberResults] = useState([]);
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [selectedUserToAdd, setSelectedUserToAdd] = useState(null);
  const [showAddMemberConfirmation, setShowAddMemberConfirmation] =
    useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [messageStatuses, setMessageStatuses] = useState({}); // {message_id: {user_id: status}}

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  const [selectedMessages, setSelectedMessages] = useState({});
  const [messageSelection, setMessageSelection] = useState(false);

  const [replyToMessage, setReplyToMessage] = useState(null);
  const [messageForwarding, setMessageForwarding] = useState(false);
  const [forwardMessageId, setForwardMessageId] = useState(null);
  const messageRefs = useRef({});
  const searchInputRef = useRef(null);

  const [showEmoji, setShowEmoji] = useState(false);

  const [messageEditing, setMessageEditing] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessage, setEditingMessage] = useState('');

  const chatIdToFetch = currentChatId || chatId;

  const {
    data: chatData,
    isLoading: chatInfoLoading,
    error: chatInfoError,
  } = useQuery({
    ...chatInfoQueryOptions(chatIdToFetch),
    enabled: !!chatIdToFetch && !isNewChat,
  });

  const {
    data: messagesData,
    isLoading: messagesLoading,
    error: messagesError,
  } = useQuery({
    ...chatMessagesQueryOptions(chatIdToFetch, userId),
    enabled: !!chatIdToFetch && !isNewChat,
  });

  // Derive loading / error directly from queries
  const loading = (chatInfoLoading || messagesLoading) && !isNewChat;
  const error = chatInfoError?.message || messagesError?.message || '';

  const fetchUserProfile = useCallback(async (senderId) => {
    if (senderId === userId) return;
    try {
      const userData = await fetchUserProfileById(senderId);
      if (userData) {
        setUserProfiles((prev) => {
          if (prev[senderId]) return prev;
          return { ...prev, [senderId]: userData };
        });
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
    }
  }, [userId]);

  const fetchChatImage = async (imagePath) => {
    if (!imagePath) return;
    try {
      const blobUrl = await fetchChatImageApi(imagePath);
      if (blobUrl) {
        setChatImageUrl(blobUrl);
      }
    } catch (err) {
      console.error("Error fetching chat image:", err);
    }
  };

  // Process chatData into chatInfo state when it arrives
  useEffect(() => {
    if (!chatData) return;
    const chat = chatData.chat;
    const chatType = chat.chat_type;
    const members = chat.members || [];
    let chatName = '';
    let otherUserId = null;

    if (chatType === 'private' && Array.isArray(members)) {
      const other = members.find((m) => m.user_id !== userId);
      if (other) {
        otherUserId = other.user_id;
        chatName = other.user?.full_name || other.user?.username || '';
      }
    } else if (chatType === 'group') {
      chatName = chat.chat_name;
      if (chat.chat_image) fetchChatImage(chat.chat_image);
    }

    if (otherUserId) fetchUserProfile(otherUserId);

    let isOnline = false;
    let lastSeen = null;
    if (chatType === 'private' && otherUserId) {
      const otherMember = members.find((m) => m.user_id === otherUserId);
      if (otherMember?.user) {
        isOnline = otherMember.user.is_online || false;
        lastSeen = otherMember.user.last_seen || null;
      }
    }

    setChatInfo({
      name: chatName,
      avatar: '💬',
      online: isOnline,
      is_online: isOnline,
      last_seen: lastSeen,
      chat_type: chatType,
      members,
      otherUserId,
      admins: chat.admins || [],
      description: chat.chat_description || chat.description || '',
      chat_image: chat.chat_image || null,
      is_admin: Array.isArray(chat.admins) && chat.admins.some((a) => a.user_id === userId),
    });

    // Check block status for private chats
    if (chatType === 'private' && otherUserId) {
      checkBlockStatus(userId, otherUserId).then((status) => {
        if (status?.isBlocked) {
          setIsBlocked(true);
          if (status.otherUserBlockedCurrent) setIsBlockedByOther(true);
        }
      }).catch(console.error);
    }
  }, [chatData, userId, fetchUserProfile]);

  // Process messagesData into messages state when it arrives
  useEffect(() => {
    if (!messagesData?.messages) return;
    setMessages(messagesData.messages);

    const statusMap = {};
    messagesData.messages.forEach((message) => {
      if (message.status && Array.isArray(message.status)) {
        statusMap[message.message_id] = {};
        message.status.forEach((s) => {
          statusMap[message.message_id][s.user_id] = s.status;
        });
      }
    });
    setMessageStatuses(statusMap);

    setSelectedMessages(
      Object.fromEntries(messagesData.messages.map((m) => [m.message_id, false]))
    );
  }, [messagesData]);

  useEffect(() => {
    const calculateHeight = () => {
      requestAnimationFrame(() => {
      });
    };
    calculateHeight();

    const timer = setTimeout(calculateHeight, 150);

    const observer = new MutationObserver(() => {
      calculateHeight();
    });

    if (inputContainerRef.current) {
      observer.observe(inputContainerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    if (headerRef.current) {
      observer.observe(headerRef.current, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    window.addEventListener("resize", calculateHeight);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", calculateHeight);
    };
  }, [
    showSearch,
    showFilePreview,
    replyToMessage,
    uploading,
    showTranslator,
    showSummary,
    showConversationStarters,
  ]);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setSearchResults([]);
      setCurrentResultIndex(0);
      return;
    }

    const results = messages
      .map((msg, index) => ({
        ...msg,
        originalIndex: index,
      }))
      .filter((msg) =>
        msg.message_text.toLowerCase().includes(searchQuery.toLowerCase())
      );

    setSearchResults(results);
    setCurrentResultIndex(results.length > 0 ? 0 : -1);
  }, [searchQuery, messages]);

  useEffect(() => {
    if (searchResults.length > 0 && currentResultIndex >= 0) {
      const currentMessage = searchResults[currentResultIndex];
      const messageElement = messageRefs.current[currentMessage.message_id];

      if (messageElement) {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [currentResultIndex, searchResults]);

  const highlightText = (text, query) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-300 text-black rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const handleNextResult = () => {
    if (searchResults.length > 0) {
      setCurrentResultIndex((prev) =>
        prev < searchResults.length - 1 ? prev + 1 : 0
      );
    }
  };

  const handlePrevResult = () => {
    if (searchResults.length > 0) {
      setCurrentResultIndex((prev) =>
        prev > 0 ? prev - 1 : searchResults.length - 1
      );
    }
  };

  const handleCloseSearch = () => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    setCurrentResultIndex(0);
  };

  const isCurrentResult = (msgId) => {
    return (
      searchResults.length > 0 &&
      searchResults[currentResultIndex]?.message_id === msgId
    );
  };

  const handleShowChatInfo = () => {
    setShowChatInfoModal(true);
  };

  const handleShowUserProfile = (senderId) => {
    setSelectedUserId(senderId);
    setShowUserProfileModal(true);
  };

  const handleMemberClick = (memberId) => {
    if (onMemberClick) {
      onMemberClick(memberId);
      return;
    }
    navigate(`/user/${memberId}`);
  };

  useEffect(() => {
    if (
      !isEmbedded &&
      isWideScreen &&
      typeof window !== "undefined" &&
      window.innerWidth >= 900
    ) {
      navigate("/chats", { state: { selectedChatId: currentChatId || chatId } });
    }
  }, [isWideScreen, isEmbedded, currentChatId, chatId, navigate]);

  useEffect(() => {
    if (isNewChat && recipient) {
      const recipientName = recipient.full_name || recipient.username || '';
      const isOnline = recipient.is_online || false;
      const lastSeen = recipient.last_seen || null;

      setChatInfo({
        id: null,
        name: recipientName,
        avatar: "💬",
        online: isOnline,
        is_online: isOnline,
        last_seen: lastSeen,
        chat_type: "private",
        members: [],
        otherUserId: recipient.user_id,
        admins: [],
        is_admin: false,
        description: "",
        chat_image: null,
      });


      setUserProfiles(prev => ({
        ...prev,
        [recipient.user_id]: recipient,
      }));
    }
  }, [isNewChat, recipient]);

  useEffect(() => {
    messages.forEach((message) => {
      if (message.sender_id && message.sender_id !== userId) {
        fetchUserProfile(message.sender_id);
      }
    });
  }, [messages, fetchUserProfile, userId]);

  useEffect(() => {
    if (messages.length === 0) return;

    messages.forEach((message) => {
      if (message.sender_id !== userId) {
        const currentStatus = messageStatuses[message.message_id];
        const userStatus = currentStatus?.[userId];

        if (userStatus !== "read") {
          socketService.updateMessageStatus(message.message_id, "read");
        }
      }
    });
  }, [messages, userId, messageStatuses]);

  useEffect(() => {
    return () => {
      if (chatImageUrl) {
        URL.revokeObjectURL(chatImageUrl);
      }
    };
  }, [chatImageUrl]);

  useEffect(() => {
    // Skip socket setup if no chat exists yet (new chat scenario)
    const activeChatId = currentChatId || chatId;
    if (!activeChatId) {
      return;
    }

    const socket = socketService.connect(userId);

    const joinChatWhenReady = () => {
      if (socketService.isSocketConnected()) {
        socketService.joinChat(activeChatId);
      } else {
        socket.once("connect", () => {
          socketService.joinChat(activeChatId);
        });
      }
    };

    joinChatWhenReady();

    const onAnyEvent = (event, data) => {
      if (
        event.includes("member") ||
        event.includes("add") ||
        event.includes("remove")
      ) {
      }
    };
    socket.onAny(onAnyEvent);

    const handleNewMessage = (message) => {
      if (String(message.chat_id) !== String(activeChatId)) {
        return;
      }

      setMessages((prevMessages) => {
        const isRealMessage =
          message.message_id &&
          !message.message_id.toString().startsWith("temp");

        if (isRealMessage) {
          const existingRealMessage = prevMessages.some(
            (m) => m.message_id === message.message_id && !m.isOptimistic
          );
          if (existingRealMessage) {
            return prevMessages;
          }

          const filteredMessages = prevMessages.filter((m) => {
            if (!m.isOptimistic) return true;

            if (m.tempId === message.tempId) {
              return false;
            }

            return true;
          });

          return [...filteredMessages, message];
        } else {
          return [...prevMessages, message];
        }
      });

      if (message.sender_id && message.sender_id !== userId) {
        fetchUserProfile(message.sender_id);
      }
    };

    const handleUserTyping = ({ userId: typingUserId, userName }) => {
      if (typingUserId !== userId) {
        setTypingUsers((prev) => {
          const alreadyTyping = prev.some((u) => u.userId === typingUserId);

          if (!alreadyTyping) {
            return [...prev, { userId: typingUserId, userName }];
          }
          return prev;
        });
      }
    };

    const handleUserStoppedTyping = ({ userId: typingUserId }) => {
      setTypingUsers((prev) => {
        const wasTyping = prev.some((u) => u.userId === typingUserId);

        if (wasTyping) {
          return prev.filter((u) => u.userId !== typingUserId);
        }
        return prev;
      });
    };

    const handleUserOnline = ({ user_id, username, full_name, status }) => {
      setChatInfo((prev) => {
        if (prev.otherUserId === user_id) {
          return {
            ...prev,
            is_online: true,
            last_seen: null,
          };
        }
        return prev;
      });
    };

    const handleUserOffline = ({ user_id, username, lastSeen }) => {
      setChatInfo((prev) => {
        if (prev.otherUserId === user_id) {
          return {
            ...prev,
            is_online: false,
            last_seen: lastSeen,
          };
        }
        return prev;
      });
    };

    const handleUserOnlineStatus = ({
      userId: statusUserId,
      isOnline,
      lastSeen,
    }) => {
      setChatInfo((prev) => {
        if (prev.otherUserId === statusUserId) {
          return {
            ...prev,
            is_online: isOnline,
            last_seen: lastSeen,
          };
        }
        return prev;
      });
    };

    const handleFileUploadProgress = (progressData) => {
      const { progress, tempId } = progressData;
      setUploadProgress(progress);
      if (tempId) {
        setUploadingMessages(prev => ({
          ...prev,
          [tempId]: { ...prev[tempId], progress }
        }));
      }
    };

    const handleFileUploadSuccess = (messageData) => {
      const { tempId } = messageData;

      if (tempId) {
        setUploadingMessages(prev => {
          const newState = { ...prev };
          delete newState[tempId];

          if (Object.keys(newState).length === 0) {
            setUploading(false);
            setUploadProgress(0);
          }

          return newState;
        });

        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.tempId === tempId
              ? { ...msg, isUploading: false }
              : msg
          )
        );
      }

      showSuccess("File uploaded successfully!");
    };

    const handleMessageStatusUpdated = (statusData) => {
      const { message_id, user_id, status } = statusData;

      setMessageStatuses((prev) => {
        return {
          ...prev,
          [message_id]: {
            ...prev[message_id],
            [user_id]: status,
          },
        };
      });
    };

    const handleMessageUpdated = (data) => {
      setMessages((prevMessages) =>
        prevMessages.map((m) =>
          m.message_id === data.message_id
            ? {
              ...m,
              message_text: data.message_text,
              updated_at: data.updated_at,
              updated: data.updated,
            }
            : m
        )
      );
    };

    const handleMessageDeletedForAllUsers = (data) => {
      setMessages((prevMessages) =>
        prevMessages.filter((m) => m.message_id !== data.message_id)
      );
      showSuccess("Message deleted for everyone");
    };

    const handleDeleteSuccess = (data) => {
      showSuccess(data.message || "Message deleted");
      messageContextMenu.closeMenu();
    };

    const handleDeleteError = (data) => {
      console.error("Delete error:", data);
      showError(data.error || "Failed to delete message");
    };

    const handleUpdateError = (data) => {
      console.error("Update error:", data);
      showError(data.error || "Failed to update message");
      setMessageEditing(false);
      setEditingMessageId(null);
    };

    const handleMemberAdded = (data) => {
      if (String(data.chat_id) !== String(activeChatId)) {
        return;
      }

      const systemMessage = {
        message_id: `system_${Date.now()}_${Math.random()}`,
        chat_id: activeChatId,
        message_text:
          data.message ||
          `${data.member?.full_name || data.member?.username} joined the group`,
        message_type: "system",
        type: "member_added",
        created_at: data.timestamp || new Date().toISOString(),
        sender: {
          user_id: null,
          username: "system",
          full_name: "System",
          profile_pic: null,
        },
        isSystem: true,
      };

      setMessages((prevMessages) => [...prevMessages, systemMessage]);
    };

    const handleMemberExited = (data) => {
      if (String(data.chat_id) !== String(activeChatId)) {
        return;
      }

      const systemMessage = {
        message_id: `system_${Date.now()}_${Math.random()}`,
        chat_id: activeChatId,
        message_text:
          data.message ||
          `${data.member?.full_name || data.member?.username} joined the group`,
        message_type: "system",
        type: "member_added",
        created_at: data.timestamp || new Date().toISOString(),
        sender: {
          user_id: null,
          username: "system",
          full_name: "System",
          profile_pic: null,
        },
        isSystem: true,
      };

      setMessages((prevMessages) => [...prevMessages, systemMessage]);
    };

    socket.on("new_message", handleNewMessage);
    socket.on("user_typing", handleUserTyping);
    socket.on("user_stopped_typing", handleUserStoppedTyping);
    socket.on("user_online", handleUserOnline);
    socket.on("user_offline", handleUserOffline);
    socket.on("user_online_status", handleUserOnlineStatus);
    socket.on("file_upload_progress_update", handleFileUploadProgress);
    socket.on("file_upload_success", handleFileUploadSuccess);
    socket.on("message_status_updated", handleMessageStatusUpdated);
    socket.on("message_updated", handleMessageUpdated);
    socket.on("message_deleted_for_all", handleMessageDeletedForAllUsers);
    socket.on("delete_success", handleDeleteSuccess);
    socket.on("delete_error", handleDeleteError);
    socket.on("update_error", handleUpdateError);
    socket.on("member_added", handleMemberAdded);
    socket.on("member_removed", handleMemberAdded);
    socket.on("member_exited", handleMemberExited);

    return () => {
      socketService.leaveChat(activeChatId);

      if (socket) {
        socket.offAny(onAnyEvent);

        socket.off("new_message", handleNewMessage);
        socket.off("user_typing", handleUserTyping);
        socket.off("user_stopped_typing", handleUserStoppedTyping);
        socket.off("user_online", handleUserOnline);
        socket.off("user_offline", handleUserOffline);
        socket.off("user_online_status", handleUserOnlineStatus);
        socket.off("file_upload_progress_update", handleFileUploadProgress);
        socket.off("file_upload_success", handleFileUploadSuccess);
        socket.off("message_status_updated", handleMessageStatusUpdated);
        socket.off("message_updated", handleMessageUpdated);
        socket.off("message_deleted_for_all", handleMessageDeletedForAllUsers);
        socket.off("delete_success", handleDeleteSuccess);
        socket.off("delete_error", handleDeleteError);
        socket.off("update_error", handleUpdateError);
        socket.off("member_added", handleMemberAdded);
        socket.off("member_removed", handleMemberAdded);
        socket.off("member_exited", handleMemberExited);
      }
    };
  }, [chatId, currentChatId, userId, fetchUserProfile, messageContextMenu, showError, showSuccess]);

  const scrollToBottom = useCallback(() => {
    const performScroll = () => {
      const scrollableElement = simpleBarRef.current?.getScrollElement?.();

      if (scrollableElement) {
        scrollableElement.scrollTo({
          top: scrollableElement.scrollHeight,
          behavior: 'smooth'
        });
      } else if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end"
        });
      }
    };

    requestAnimationFrame(() => {
      performScroll();
    });

    if (observerTimeoutRef.current) {
      clearTimeout(observerTimeoutRef.current);
    }
    observerTimeoutRef.current = setTimeout(() => {
      performScroll();
    }, 400);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [messages, scrollToBottom]);

  const createNewChat = async () => {
    if (!recipient) {
      throw new Error("No recipient specified for new chat");
    }

    setIsCreatingChat(true);
    try {
      const chatData = await createChat("private", [userId, recipient.user_id]);
      const newChatId = chatData.chat?.chat_id || chatData.chatId || chatData.chat_id;

      if (!newChatId) {
        throw new Error("Failed to get chat ID from response");
      }

      setCurrentChatId(newChatId);

      socketService.joinChat(newChatId);

      if (onChatCreated) {
        onChatCreated(newChatId);
      }

      if (!isEmbedded) {
        navigate(`/chat/${newChatId}`, { replace: true });
      }

      return newChatId;
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    if (isCreatingChat) return;

    const messageToSend = messageText.trim();
    setMessageText("");

    let activeChatId = currentChatId || chatId;

    if (isNewChat && !currentChatId) {
      try {
        activeChatId = await createNewChat();
      } catch (err) {
        console.error("Error creating new chat:", err);
        showError("Failed to create chat. Please try again.");
        setMessageText(messageToSend);
        return;
      }
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    socketService.sendStoppedTyping(activeChatId, userId);

    const tempId = `temp_${Date.now()}_${Math.random()}`;

    const targetReplyId = replyToMessage?.message_id || replyToMessage?.tempId || null;

    const messageData = {
      chat_id: activeChatId,
      sender_id: userId,
      message_text: messageToSend,
      message_type: "text",
      tempId: tempId,
      reply_to_id: targetReplyId,
      referenced_message_id: targetReplyId,
      is_reply: !!targetReplyId,
    };

    socketService.sendMessage(messageData);

    const optimisticMessage = {
      message_id: tempId,
      tempId: tempId,
      ...messageData,
      created_at: new Date().toISOString(),
      sender: {
        user_id: userId,
        username: user.username,
        full_name: user.full_name,
        profile_pic: user.profile_pic,
      },
      status: [{ status: "sending" }],
      isOptimistic: true,
      is_reply: !!targetReplyId,
      referenced_message_id: targetReplyId,
      referenced_message: replyToMessage,
      reply_to_message: replyToMessage,
      reply_to_id: targetReplyId,
    };

    setMessages((prevMessages) => [...prevMessages, optimisticMessage]);

    setReplyToMessage(null);
  };

  const handleSendEditedMessage = async () => {
    if (!messageText.trim()) return;

    const updatedText = messageText.trim();

    const messageData = {
      message_id: editingMessageId,
      message_text: updatedText
    };

    socketService.updateMessage(messageData);

    setMessageEditing(false);
    setEditingMessageId(null);
    setMessageText("");
    setEditingMessage("");
  }

  const handleEditMessage = async () => {
    const messageIndex = messages.findIndex(m => m.message_id === selectedMessage.message_id);
    messageContextMenu.closeMenu();
    if (messageIndex === -1) return;

    setMessageEditing(true);
    setEditingMessage(selectedMessage.message_text);
    setMessageText(selectedMessage.message_text);
    setEditingMessageId(selectedMessage.message_id);
  }

  const handleTyping = useCallback(() => {
    const activeChatId = currentChatId || chatId;
    if (!activeChatId) return;

    if (!socketService.isSocketConnected()) {
      return;
    }

    socketService.sendTyping(activeChatId, userId);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socketService.sendStoppedTyping(activeChatId, userId);
    }, 2000);
  }, [chatId, currentChatId, userId]);

  const handleReplyMessage = (referenced_message) => {
    const messageToReply = (referenced_message && (referenced_message.message_id || referenced_message.tempId))
      ? referenced_message
      : selectedMessage;
    if (messageToReply) {
      setReplyToMessage(messageToReply);
      messageContextMenu.closeMenu();
      if (messageInputRef?.current) {
        messageInputRef.current.focus();
      }
    }
  };

  const handleForwardMessage = () => {
    if (selectedMessage) {
      setMessageForwarding(true);
      setForwardMessageId(selectedMessage.message_id);
      messageContextMenu.closeMenu();
    }
  };

  const handleCopyMessage = () => {
    if (selectedMessage?.message_text) {
      navigator.clipboard.writeText(selectedMessage.message_text);
    }
  };

  const handleDeleteMessage = async () => {
    if (!selectedMessage) return;

    try {
      const success = await deleteMessage(selectedMessage.message_id);

      if (success) {
        setMessages((prevMessages) =>
          prevMessages.filter(
            (m) => m.message_id !== selectedMessage.message_id
          )
        );
        showSuccess("Message deleted");
      } else {
        showError("Failed to delete message");
      }
    } catch (err) {
      console.error("Error deleting message:", err);
      showError("Error deleting message");
    }
  };

  const handleDeleteMessageForAll = async () => {
    if (!selectedMessage) return;

    const isOwn = selectedMessage.sender_id === userId;
    const isAdmin = chatInfo.is_admin;

    if (!isOwn && !isAdmin) {
      showError("You can only delete your own messages");
      return;
    }

    if (!window.confirm("Delete this message for everyone in the chat?")) {
      return;
    }

    try {
      socketService.deleteMessageForAll(selectedMessage.message_id);
      showSuccess("Message deleted for everyone");
      messageContextMenu.closeMenu();
    } catch (err) {
      console.error("Error deleting message for all:", err);
      showError("Error deleting message");
    }
  };

  const handleTranslateMessage = async (message, targetLanguage) => {
    if (!message?.message_text) return;

    const messageId = message.message_id;

    setMessageTranslations(prev => ({
      ...prev,
      [messageId]: { text: '', lang: targetLanguage, loading: true }
    }));

    try {
      const result = await translateText(message.message_text, targetLanguage);
      const translatedText = result.translatedText || result.translated_text || '';

      setMessageTranslations(prev => ({
        ...prev,
        [messageId]: { text: translatedText, lang: targetLanguage, loading: false }
      }));
    } catch (error) {
      console.error('Translation error:', error);
      showError('Translation failed. Please try again.');
      setMessageTranslations(prev => {
        const newTranslations = { ...prev };
        delete newTranslations[messageId];
        return newTranslations;
      });
    }
  };

  const handleShowOriginal = (messageId) => {
    setMessageTranslations(prev => {
      const newTranslations = { ...prev };
      delete newTranslations[messageId];
      return newTranslations;
    });
  };

  const getDefaultTranslationLanguage = () => {
    return localStorage.getItem("defaultTranslationLanguage") || "en";
  };

  const getMessageContextMenuItems = (message) => {
    const isOwn = message?.sender_id === userId;
    const hasTranslation = messageTranslations[message?.message_id];
    const defaultLang = getDefaultTranslationLanguage();

    const items = [
      {
        id: "select",
        label: "Select",
        icon: <Check size={16} />,
        onClick: () => handleMessageSelection(message.message_id, isOwn),
      },
      {
        id: "copy",
        label: "Copy",
        icon: <Copy size={16} />,
        onClick: handleCopyMessage,
        disabled: !message?.message_text,
      },
    ];

    if (isOwn && isWithinTwoHours(message.created_at)) {
      items.push({
        id: "edit",
        label: "Edit",
        icon: <Edit size={16} />,
        onClick: handleEditMessage,
      })
    }

    if (hasTranslation) {
      items.push({
        id: "show-original",
        label: "Show Original",
        icon: <Languages size={16} />,
        onClick: () => {
          handleShowOriginal(message.message_id);
          messageContextMenu.closeMenu();
        },
      });
    } else {
      items.push({
        id: "translate-default",

        label: `Translate (${defaultLang.toUpperCase()})`,
        icon: <Languages size={16} />,
        onClick: () => {
          handleTranslateMessage(message, defaultLang);
          messageContextMenu.closeMenu();
        },
        disabled: !message?.message_text,
      });
      items.push({
        id: "translate-to",
        label: "Translate to...",
        icon: <Languages size={16} />,
        onClick: () => {
          setTranslateMessage(message);
          setShowTranslator(true);
          messageContextMenu.closeMenu();
        },
        disabled: !message?.message_text,
      });
    }

    items.push(
      {
        id: "reply",
        label: "Reply",
        icon: <Reply size={16} />,
        onClick: handleReplyMessage,
      },
      {
        id: "forward",
        label: "Forward",
        icon: <Forward size={16} />,
        onClick: handleForwardMessage,
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={16} />,
        color: "danger",
        onClick: handleDeleteMessage,
      }
    );

    if (isOwn || chatInfo.is_admin) {
      items.push({ id: "divider", divider: true });
      items.push({
        id: "delete-for-all",
        label: "Delete For All",
        icon: <Trash2 size={16} />,
        color: "danger",
        onClick: handleDeleteMessageForAll,
      });
    }


    return items;
  };

  const handleSentMessageContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    messageContextMenu.setMenu({
      isOpen: true,
      x: rect.right,
      y: rect.top,
      position: 'top-left',
    });
  };

  const handleReceivedMessageContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    messageContextMenu.setMenu({
      isOpen: true,
      x: rect.left,
      y: rect.top,
      position: 'top-right',
    });
  };

  const handleClearChat = async () => {
    if (
      window.confirm(
        "Are you sure you want to clear this chat? This will delete all messages for you only. This action cannot be undone."
      )
    ) {
      try {
        const data = await clearChat(chatId);
        setMessages([]);
        showSuccess(`Chat cleared successfully (${data.deletedCount} messages)`);
      } catch (err) {
        console.error("Error clearing chat:", err);
        showError(err.message || "Error clearing chat");
      }
    }
  };

  const handleViewContactOrGroupInfo = () => {
    setShowChatInfoModal(true);
  };

  const handleBlockUser = async () => {
    if (chatInfo.chat_type !== "private") return;

    const otherUserId = chatInfo.otherUserId;
    if (!otherUserId) return;

    if (
      window.confirm(
        "Are you sure you want to block this user? They will not be able to send you messages."
      )
    ) {
      try {
        await blockUser(otherUserId);
        showSuccess("User blocked successfully");
        setIsBlocked(true);
        setTimeout(() => navigate("/chats"), 1500);
      } catch (err) {
        console.error("Error blocking user:", err);
        showError("Failed to block user");
      }
    }
  };

  const handleUnblockUser = async () => {
    if (chatInfo.chat_type !== "private") return;

    const otherUserId = chatInfo.otherUserId;
    if (!otherUserId) return;

    if (
      window.confirm(
        "Are you sure you want to unblock this user? They will be able to send you messages again."
      )
    ) {
      try {
        await unblockUser(otherUserId);
        showSuccess("User unblocked successfully");
        setIsBlocked(false);
      } catch (err) {
        console.error("Error unblocking user:", err);
        showError("Failed to unblock user");
      }
    }
  };

  const handleAddMember = () => {
    setShowAddMemberModal(true);
    setSearchAddMember("");
    setAddMemberResults([]);
  };

  const searchUsersForAddMember = useCallback(
    async (query) => {
      if (!query.trim()) {
        setAddMemberResults([]);
        setAddMemberLoading(false);
        return;
      }

      try {
        const users = await searchUsers(query, 1, 10);

        const existingMemberIds =
          chatInfo.members?.map((m) => m.user_id) || [];

        const filteredUsers = users.filter(
          (user) =>
            user.user_id !== userId &&
            !existingMemberIds.includes(user.user_id)
        );

        setAddMemberResults(filteredUsers);
      } catch (err) {
        console.error("Error searching users:", err);
        showError("Error searching users");
      } finally {
        setAddMemberLoading(false);
      }
    },
    [chatInfo.members, userId, showError]
  );

  useEffect(() => {
    if (!searchAddMember.trim()) {
      setAddMemberResults([]);
      setAddMemberLoading(false);
      return;
    }

    setAddMemberLoading(true);
    const debounceTimer = setTimeout(() => {
      searchUsersForAddMember(searchAddMember);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchAddMember, searchUsersForAddMember]);

  useEffect(() => {
    if (!showAddMemberModal) {
      setShowAddMemberConfirmation(false);
      setSelectedUserToAdd(null);
      setIsAddingMember(false);
    }
  }, [showAddMemberModal]);

  const handleSelectUserToAddClick = (selectedUser) => {
    setSelectedUserToAdd(selectedUser);
    setShowAddMemberConfirmation(true);
  };

  const handleSelectUserToAdd = async () => {
    if (!selectedUserToAdd) return;

    try {
      setIsAddingMember(true);

      await addMemberToGroup(chatId, selectedUserToAdd.user_id);

      showSuccess(
        `${selectedUserToAdd.full_name || selectedUserToAdd.username
        } added to group`
      );

      setShowAddMemberModal(false);
      setShowAddMemberConfirmation(false);
      setSearchAddMember("");
      setAddMemberResults([]);
      setSelectedUserToAdd(null);
    } catch (err) {
      console.error("Error adding member:", err);
      showError(err.message || "Failed to add member");
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleUpdateGroupInfo = () => {
    setShowUpdateGroupInfoModal(true);
  };

  const handleGroupInfoUpdateSuccess = (updatedChat) => {
    setChatInfo((prev) => ({
      ...prev,
      name: updatedChat.chat_name || prev.name,
      chat_image: updatedChat.chat_image || null,
      description: updatedChat.chat_description || "",
    }));

    if (updatedChat.chat_image) {
      fetchChatImage(updatedChat.chat_image);
    }

    showSuccess("Group info updated successfully");
  };

  const handleExitGroup = async () => {
    if (chatInfo.chat_type !== "group") return;

    if (window.confirm("Are you sure you want to exit this group?")) {
      try {
        const success = await exitGroup(chatId, userId);

        if (success) {
          showSuccess("Exited group successfully");
          setTimeout(() => navigate("/chats"), 1500);
        } else {
          showError("Failed to exit group");
        }
      } catch (err) {
        console.error("Error exiting group:", err);
        showError("Failed to exit group");
      }
    }
  };

  const getHeaderMenuItems = () => {
    const items = [
      {
        id: "search",
        label: "Search",
        icon: <Search size={16} />,
        onClick: () => setShowSearch(!showSearch),
        disabled: isNewChat && !currentChatId,
      },
      {
        id: "summary",
        label: "Summarize Chat",
        icon: <FileText size={16} />,
        onClick: () => setShowSummary(true),
        disabled: isNewChat && !currentChatId,
      },
      {
        id: "clear",
        label: "Clear Chat",
        icon: <Eraser size={16} />,
        onClick: handleClearChat,
        disabled: isNewChat && !currentChatId,
      },
      { id: "divider1", divider: true },
    ];

    if (chatInfo.chat_type === "private") {
      items.push({
        id: "view-contact",
        label: "View Contact",
        icon: <UserCheck size={16} />,
        onClick: handleViewContactOrGroupInfo,
      });

      if (isBlocked && !isBlockedByOther) {
        items.push({
          id: "unblock",
          label: "Unblock User",
          icon: <Ban size={16} />,
          color: "success",
          onClick: handleUnblockUser,
        });
      } else if (!isBlocked) {
        items.push({
          id: "block",
          label: "Block User",
          icon: <Ban size={16} />,
          color: "danger",
          onClick: handleBlockUser,
        });
      }
    } else if (chatInfo.chat_type === "group") {
      items.push({
        id: "view-info",
        label: "View Group Info",
        icon: <Users size={16} />,
        onClick: handleViewContactOrGroupInfo,
      });

      if (chatInfo.is_admin) {
        items.push({
          id: "add-member",
          label: "Add Member",
          icon: <UserPlus size={16} />,
          onClick: handleAddMember,
        });
        items.push({
          id: "update-info",
          label: "Update Group Info",
          icon: <Users size={16} />,
          onClick: handleUpdateGroupInfo,
        });
      }

      items.push(
        { id: "divider2", divider: true },
        {
          id: "exit",
          label: "Exit Group",
          icon: <LogOut size={16} />,
          color: "danger",
          onClick: handleExitGroup,
        }
      );
    }

    return items;
  };

  const handleAttachment = (type) => {
    setShowAttachMenu(false);

    if (type === "Image") {
      fileInputRef.current.accept = "image/*";
    } else if (type === "File") {
      fileInputRef.current.accept = "*/*";
    }

    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      alert("File size exceeds 50MB limit");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setSelectedFile(file);
    setShowFilePreview(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setShowFilePreview(false);
  };

  const handleSendWithAttachment = async () => {
    if (!selectedFile) return;
    if (isCreatingChat) return;

    // Determine the chat ID to use
    let activeChatId = currentChatId || chatId;

    // If this is a new chat (no chatId), create it first
    if (isNewChat && !currentChatId) {
      try {
        activeChatId = await createNewChat();
      } catch (err) {
        console.error("Error creating new chat:", err);
        showError("Failed to create chat. Please try again.");
        return;
      }
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const tempId = `temp-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      setUploadingMessages(prev => ({
        ...prev,
        [tempId]: { progress: 0, fileName: selectedFile.name, fileSize: selectedFile.size }
      }));

      const reader = new FileReader();
      reader.onload = () => {
        const base64File = reader.result.split(",")[1];

        setUploadingMessages(prev => ({
          ...prev,
          [tempId]: { ...prev[tempId], progress: 10 }
        }));
        setUploadProgress(10);

        const targetReplyId = replyToMessage?.message_id || replyToMessage?.tempId || null;
        const fileMessageData = {
          chat_id: activeChatId,
          message_text: messageText.trim() || "",
          fileBuffer: base64File,
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          tempId: tempId,
          reply_to_id: targetReplyId,
          referenced_message_id: targetReplyId,
          is_reply: !!targetReplyId,
        };

        const optimisticMessage = {
          message_id: tempId,
          tempId: tempId,
          isOptimistic: true,
          isUploading: true,
          sender_id: userId,
          message_text: fileMessageData.message_text,
          chat_id: activeChatId,
          is_reply: !!targetReplyId,
          referenced_message_id: targetReplyId,
          referenced_message: replyToMessage,
          reply_to_message: replyToMessage,
          reply_to_id: targetReplyId,
          attachments: [
            {
              file_url: "",
              fileName: selectedFile.name,
              file_name: selectedFile.name,
              fileSize: selectedFile.size,
              file_size: selectedFile.size,
              fileType: selectedFile.type,
              file_type: selectedFile.type,
              original_filename: selectedFile.name,
            },
          ],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_read: false,
          deleted_at: null,
        };

        setMessages((prevMessages) => [...prevMessages, optimisticMessage]);

        const onProgress = (progress) => {
          const scaledProgress = 10 + (progress * 0.9);
          setUploadingMessages(prev => ({
            ...prev,
            [tempId]: { ...prev[tempId], progress: scaledProgress }
          }));
          setUploadProgress(scaledProgress);
        };

        socketService.sendFileMessage(fileMessageData, onProgress);

        setSelectedFile(null);
        setShowFilePreview(false);
        setMessageText("");
        setReplyToMessage(null);
      };

      reader.onerror = () => {
        setUploading(false);
        setUploadProgress(0);
        setUploadingMessages(prev => {
          const newState = { ...prev };
          delete newState[tempId];
          return newState;
        });
        throw new Error("Failed to read file");
      };

      reader.readAsDataURL(selectedFile);
    } catch (err) {
      console.error("File upload error:", err);

      let errorMessage = "File upload failed";
      const errorStr = err.message || err.toString();

      if (errorStr.includes("read file")) {
        errorMessage = "Failed to read file";
      } else if (errorStr.includes("not supported")) {
        errorMessage = "File type not supported";
      } else if (
        errorStr.includes("too large") ||
        errorStr.includes("exceeds")
      ) {
        errorMessage = "File is too large";
      } else {
        errorMessage = errorStr;
      }

      setSelectedFile(null);
      setShowFilePreview(false);
      setUploading(false);
      setUploadProgress(0);

      showError(errorMessage, 4000);
    }
  };

  const getInitials = (name) => {
    if (!name) return "💬";
    const words = name.trim().split(" ");
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getReferencedMessage = (referencedMessageId, currentMessage = null) => {
    if (!referencedMessageId && !currentMessage?.referenced_message && !currentMessage?.reply_to_message) return null;
    if (referencedMessageId) {
      const found = messages.find(
        (msg) =>
          String(msg.message_id) === String(referencedMessageId) ||
          String(msg.tempId) === String(referencedMessageId)
      );
      if (found) return found;
    }
    return currentMessage?.referenced_message || currentMessage?.reply_to_message || null;
  };

  const scrollToReferencedMessage = (referencedMessageId) => {
    if (!referencedMessageId) return;
    const targetEl =
      messageRefs.current[referencedMessageId] ||
      document.getElementById(`message-${referencedMessageId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEl.classList.add("message-highlight");
      setTimeout(() => {
        targetEl.classList.remove("message-highlight");
      }, 1500);
    }
  };

  const handleMessageSelection = (message_id, isOwn) => {
    if (!message_id) return;
    const id = message_id;

    setSelectedMessages((prevItems) => {
      const newSelectedMessages = {
        ...prevItems,
        [id]: !prevItems[id],
      };

      const selectedCount =
        Object.values(newSelectedMessages).filter(Boolean).length;

      setMessageSelection(selectedCount > 0);

      return newSelectedMessages;
    });
  };

  const clearAllSelection = async () => {
    setSelectedMessages((prev) =>
      Object.fromEntries(Object.keys(prev).map((key) => [key, false]))
    );
    setMessageSelection(false);
  };

  const handleDeleteSelectedMessages = async () => {
    const selectedIds = Object.keys(selectedMessages).filter(
      (id) => selectedMessages[id]
    );

    if (selectedIds.length === 0) {
      showError("No messages selected");
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to delete ${selectedIds.length} selected message(s)? This will delete them for you only.`
      )
    ) {
      return;
    }

    try {
      const data = await deleteMessagesBatch(selectedIds);
      setMessages((prevMessages) =>
        prevMessages.filter((m) => !selectedIds.includes(m.message_id))
      );
      clearAllSelection();
      showSuccess(`${data.deletedCount} message(s) deleted`);
    } catch (err) {
      console.error("Error deleting messages:", err);
      showError(err.message || "Error deleting messages");
    }
  };

  const addEmoji = (emoji) => {
    setMessageText((prev) => prev + emoji.native);
  };

  const isWithinTwoHours = (timestamp) => {
    const now = Date.now();
    const past = new Date(timestamp).getTime();

    const diffMs = now - past;
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    return diffMs < TWO_HOURS;
  };

  const messageInputRef = useRef(null);

  return (
    <div className="chat-window">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {messageForwarding && (
        <MessageForward
          onClose={() => setMessageForwarding(false)}
          userId={userId}
          messageId={forwardMessageId}
          currentChatId={currentChatId || chatId}
        />
      )}
      <div className="chat-window-header" ref={headerRef}>
        {!isEmbedded && (
          <button className="back-btn" onClick={() => navigate("/chats")}>
            <ArrowLeft size={24} />
          </button>
        )}
        <div
          className="header-info"
          onClick={handleShowChatInfo}
          style={{ cursor: "pointer" }}
        >
          {chatInfo.otherUserId &&
            userProfiles[chatInfo.otherUserId]?.profile_pic ? (
            <div className="chat-avatar-small" style={{ position: "relative" }}>
              <img
                src={userProfiles[chatInfo.otherUserId].profile_pic}
                alt="profile"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
              {chatInfo.is_online && chatInfo.chat_type === "private" && (
                <span className="online-dot"></span>
              )}
            </div>
          ) : chatInfo.chat_type === "group" && chatImageUrl ? (
            <div className="chat-avatar-small" style={{ position: "relative" }}>
              <img
                src={chatImageUrl}
                alt="group"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            </div>
          ) : (
            <div className="chat-avatar-small">
              <span style={{ fontSize: "16px", fontWeight: "600" }}>
                {chatInfo.chat_type === "private"
                  ? getInitials(chatInfo.name)
                  : "💬"}
              </span>
              {chatInfo.is_online && chatInfo.chat_type === "private" && (
                <span className="online-dot"></span>
              )}
            </div>
          )}
          <div className="header-text">
            <h2>{chatInfo.name}</h2>
            {chatInfo.chat_type === "private" && (
              <span className="status-text">
                {chatInfo.is_online
                  ? "Online"
                  : chatInfo.last_seen
                    ? `Last seen ${formatLastSeen(chatInfo.last_seen)}`
                    : "Offline"}
              </span>
            )}
          </div>
        </div>

        {messageSelection ? (
          <>
            <button
              className="header-delete-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteSelectedMessages();
              }}
            >
              <Trash2 size={24} />
            </button>

            <button
              className="header-forward-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMessageForwarding(true);
              }}
            >
              <Forward size={24} />
            </button>

            <button
              className="header-clear-selection-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearAllSelection();
              }}
            >
              <X size={24} />
            </button>
          </>
        ) : (
          <>
            <button
              className="header-search-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSearch(!showSearch);
              }}
            >
              <Search size={24} />
            </button>

            <button
              className="header-more-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                headerContextMenu.setMenu({ isOpen: !headerContextMenu.isOpen, x: 0, y: 0, anchorEl: e.currentTarget });
              }}
            >
              <MoreVertical size={24} />
            </button>
          </>
        )}
      </div>

      {showSearch && (
        <div className="search-box-container">
          <div className="search-box-wrapper">
            <div className="search-input-wrapper">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="search-clear-btn"
                  type="button"
                >
                  <X size={20} />
                </button>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="search-results-info">
                <span className="search-counter">
                  {currentResultIndex + 1} / {searchResults.length}
                </span>
                <button
                  onClick={handlePrevResult}
                  className="search-nav-btn search-prev-btn"
                  type="button"
                  title="Previous result"
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  onClick={handleNextResult}
                  className="search-nav-btn search-next-btn"
                  type="button"
                  title="Next result"
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            )}

            {!searchQuery && (
              <button
                onClick={handleCloseSearch}
                className="search-close-btn"
                type="button"
                title="Close search"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {searchQuery && searchResults.length === 0 && (
            <p className="search-no-results">No messages found</p>
          )}
        </div>
      )}

      <SimpleBar
        ref={simpleBarRef}
        style={{ flex: 1, minHeight: 0, width: "100%" }}
        autoHide={true}
      >
        <div
          className="messages-container"
        >
          {loading ? (
            <div className="no-chats">
              <p>Loading messages...</p>
            </div>
          ) : error ? (
            <div className="no-chats">
              <p>{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="no-chats">
              <p>No messages yet</p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.isSystem || message.message_type === "system") {
                return (
                  <SystemMessage
                    key={message.message_id}
                    type={message.type || "info"}
                    message={message.message_text}
                    timestamp={message.created_at}
                    icon={
                      message.type === "member_added" ? UserPlus : undefined
                    }
                  />
                );
              }

              const isSelf = message.sender_id === userId;
              const isGroup = chatInfo.chat_type === "group";
              if (isSelf) {
                return (
                  <>
                    <div
                      key={message.message_id || message.tempId}
                      id={`message-${message.message_id || message.tempId}`}
                      className={`message message-sent ${isCurrentResult(message.message_id)
                        ? "search-result-current"
                        : ""
                        } ${selectedMessages[message.message_id] ? "selection" : ""
                        }`}
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginBottom: 8,
                      }}
                      ref={(el) => {
                        if (el) {
                          if (message.message_id) messageRefs.current[message.message_id] = el;
                          if (message.tempId) messageRefs.current[message.tempId] = el;
                        }
                      }}
                      onClick={() => {
                        if (messageSelection)
                          handleMessageSelection(message.message_id, true);
                      }}
                      onContextMenu={(e) => {
                        setSelectedMessage(message);
                        handleSentMessageContextMenu(e);
                      }}
                      onTouchStart={() => {
                        setSelectedMessage(message);
                      }}
                      onTouchEnd={(e) => {
                        messageContextMenu.handleLongPress(e, 500);
                      }}
                    >
                      <button
                        className="message_sent_reply_btn"
                        onClick={() => {
                          handleReplyMessage(message);
                        }}
                      >
                        <Reply size={16} />
                      </button>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          maxWidth: "80%",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        {message.attachments &&
                          message.attachments.length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 0,
                              }}
                            >
                              {message.attachments.map((att, idx) => (
                                <AttachmentPreview
                                  key={
                                    (att.file_url ||
                                      att.fileUrl ||
                                      att.url ||
                                      idx) + idx
                                  }
                                  attachment={att}
                                  isUploading={message.isUploading && !att.file_url}
                                  uploadProgress={uploadingMessages[message.tempId]?.progress || 0}
                                />
                              ))}
                            </div>
                          )}
                        {message.message_text && (
                          <div className="message-bubble">
                            {message.is_forward && (
                              <div className="forwarded-indicator">
                                <Forward size={12} />
                                <span>Forwarded</span>
                              </div>
                            )}
                            {(message.is_reply || message.referenced_message_id || message.reply_to_id || message.referenced_message || message.reply_to_message) && (
                              <div
                                className="message-reply-reference clickable"
                                title="Click to view message"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  scrollToReferencedMessage(message.referenced_message_id || message.reply_to_id);
                                }}
                              >
                                {(() => {
                                  const refId = message.referenced_message_id || message.reply_to_id;
                                  const refMsg = getReferencedMessage(refId, message);
                                  if (!refMsg) {
                                    return (
                                      <div className="reply-ref-deleted">
                                        <span className="reply-ref-sender">
                                          Deleted message
                                        </span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <>
                                      <div className="reply-ref-sender">
                                        {refMsg.sender?.full_name ||
                                          refMsg.sender?.username ||
                                          "Unknown"}
                                      </div>
                                      <div className="reply-ref-text">
                                        {refMsg.message_text?.substring(
                                          0,
                                          80
                                        ) || "[Attachment]"}
                                        {refMsg.message_text?.length > 80
                                          ? "..."
                                          : ""}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            <p className="message-text">
                              {showSearch && searchQuery
                                ? highlightText(
                                  message.message_text,
                                  searchQuery
                                )
                                : message.message_text}
                            </p>
                            {messageTranslations[message.message_id] && (
                              <div className="message-translation">
                                {messageTranslations[message.message_id].loading ? (
                                  <div className="translation-loading">
                                    <Loader size={14} className="spinning" />
                                    <span>Translating...</span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="translation-header">
                                      <Languages size={12} />
                                      <span>Translated to {messageTranslations[message.message_id].lang.toUpperCase()}</span>
                                      <button
                                        className="show-original-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShowOriginal(message.message_id);
                                        }}
                                      >
                                        Hide
                                      </button>
                                    </div>
                                    <p className="translation-text">
                                      {messageTranslations[message.message_id].text}
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
                            <div className="message-meta">
                              <span className="message-time">
                                {message.updated ? `Edited at ${formatMessageTime(message.updated_at)}` : formatMessageTime(message.created_at)}
                              </span>
                              <MessageStatusIndicator
                                messageId={message.message_id}
                                statuses={messageStatuses[message.message_id]}
                                currentUserId={userId}
                              />
                            </div>
                          </div>
                        )}
                        {!message.message_text && !message.attachments && (
                          <div className="message-bubble">
                            <p className="message-text">Empty message</p>
                            <div className="message-meta">
                              <span className="message-time">
                                {formatMessageTime(message.created_at)}
                              </span>
                              <MessageStatusIndicator
                                messageId={message.message_id}
                                statuses={messageStatuses[message.message_id]}
                                currentUserId={userId}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              }
              return (
                <div
                  key={message.message_id || message.tempId}
                  id={`message-${message.message_id || message.tempId}`}
                  className={`message message-received ${isCurrentResult(message.message_id)
                    ? "search-result-current"
                    : ""
                    } ${selectedMessages[message.message_id] ? "selection" : ""
                    }`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    marginBottom: 8,
                  }}
                  ref={(el) => {
                    if (el) {
                      if (message.message_id) messageRefs.current[message.message_id] = el;
                      if (message.tempId) messageRefs.current[message.tempId] = el;
                    }
                  }}
                  onClick={() => {
                    if (messageSelection)
                      handleMessageSelection(message.message_id, false);
                  }}
                  onContextMenu={(e) => {
                    setSelectedMessage(message);
                    handleReceivedMessageContextMenu(e);
                  }}
                  onTouchStart={() => {
                    setSelectedMessage(message);
                  }}
                  onTouchEnd={(e) => {
                    messageContextMenu.handleLongPress(e, 500);
                  }}
                >
                  {isGroup && (
                    <img
                      src={
                        message.sender_id &&
                          userProfiles[message.sender_id]?.profile_pic
                          ? userProfiles[message.sender_id].profile_pic
                          : message.sender?.profile_picture_url ||
                          "https://ui-avatars.com/api/?name=" +
                          (message.sender?.full_name ||
                            message.sender?.username ||
                            "User")
                      }
                      alt="profile"
                      className="message-avatar"
                      onClick={() => handleShowUserProfile(message.sender_id)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        objectFit: "cover",
                        marginRight: 8,
                        marginTop: 2,
                        background: "#eee",
                        flexShrink: 0,
                        cursor: "pointer",
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      maxWidth: "70%",
                    }}
                  >
                    {message.attachments &&
                      message.attachments.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 0,
                          }}
                        >
                          {message.attachments.map((att, idx) => (
                            <AttachmentPreview
                              key={
                                (att.file_url ||
                                  att.fileUrl ||
                                  att.url ||
                                  idx) + idx
                              }
                              attachment={att}
                            />
                          ))}
                        </div>
                      )}
                    {message.message_text && (
                      <div className="message-bubble">
                        {message.is_forward && (
                          <div className="forwarded-indicator">
                            <Forward size={12} />
                            <span>Forwarded</span>
                          </div>
                        )}
                        {isGroup && (
                          <div
                            className="message-sender clickable"
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: "var(--sender-name-color, #1976d2)",
                              marginBottom: 2,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              /* Placeholder for future action */
                            }}
                          >
                            {message.sender_id &&
                              userProfiles[message.sender_id]?.full_name
                              ? userProfiles[message.sender_id].full_name
                              : message.sender?.full_name ||
                              message.sender?.username ||
                              "Unknown User"}
                          </div>
                        )}
                        {(message.is_reply || message.referenced_message_id || message.reply_to_id || message.referenced_message || message.reply_to_message) && (
                          <div
                            className="message-reply-reference clickable"
                            title="Click to view message"
                            onClick={(e) => {
                              e.stopPropagation();
                              scrollToReferencedMessage(message.referenced_message_id || message.reply_to_id);
                            }}
                          >
                            {(() => {
                              const refId = message.referenced_message_id || message.reply_to_id;
                              const refMsg = getReferencedMessage(refId, message);
                              if (!refMsg) {
                                return (
                                  <div className="reply-ref-deleted">
                                    <span className="reply-ref-sender">
                                      Deleted message
                                    </span>
                                  </div>
                                );
                              }
                              return (
                                <>
                                  <div className="reply-ref-sender">
                                    {refMsg.sender?.full_name ||
                                      refMsg.sender?.username ||
                                      "Unknown"}
                                  </div>
                                  <div className="reply-ref-text">
                                    {refMsg.message_text?.substring(
                                      0,
                                      80
                                    ) || "[Attachment]"}
                                    {refMsg.message_text?.length > 80
                                      ? "..."
                                      : ""}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        )}
                        <p className="message-text">
                          {showSearch && searchQuery
                            ? highlightText(message.message_text, searchQuery)
                            : message.message_text}
                        </p>
                        {/* Inline Translation */}
                        {messageTranslations[message.message_id] && (
                          <div className="message-translation">
                            {messageTranslations[message.message_id].loading ? (
                              <div className="translation-loading">
                                <Loader size={14} className="spinning" />
                                <span>Translating...</span>
                              </div>
                            ) : (
                              <>
                                <div className="translation-header">
                                  <Languages size={12} />
                                  <span>Translated to {messageTranslations[message.message_id].lang.toUpperCase()}</span>
                                  <button
                                    className="show-original-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleShowOriginal(message.message_id);
                                    }}
                                  >
                                    Hide
                                  </button>
                                </div>
                                <p className="translation-text">
                                  {messageTranslations[message.message_id].text}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                        <div className="message-meta">
                          <span className="message-time">
                            {message.updated ? `Edited at ${formatMessageTime(message.updated_at)}` : formatMessageTime(message.created_at)}
                          </span>
                        </div>
                      </div>
                    )}
                    {!message.message_text &&
                      message.attachments &&
                      message.attachments.length > 0 && (
                        <div className="message-bubble">
                          {isGroup && (
                            <div
                              className="message-sender clickable"
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: "#555",
                                marginBottom: 2,
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                /* Placeholder for future action */
                              }}
                            >
                              {message.sender_id &&
                                userProfiles[message.sender_id]?.full_name
                                ? userProfiles[message.sender_id].full_name
                                : message.sender?.full_name ||
                                message.sender?.username ||
                                "Unknown User"}
                            </div>
                          )}
                          <div className="message-meta">
                            <span className="message-time">
                              {formatMessageTime(message.created_at)}
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                  <button
                    className="message_received_reply_btn"
                    onClick={() => {
                      handleReplyMessage(message);
                    }}
                  >
                    <Reply size={16} />
                  </button>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} style={{ height: '20px', marginTop: '15px' }} />
        </div>
      </SimpleBar>

      {showEmoji && (
        <div
          style={{
            position: "absolute",
            bottom: "70px",
            right: "10px",
            zIndex: 1000,
          }}
        >
          <EmojiPicker onSelect={addEmoji} />
        </div>
      )}

      <div className="message-input-container" ref={inputContainerRef}>
        {isBlocked ? (
          <div className="blocked-user-notice">
            <Ban size={24} />
            <span>
              {isBlockedByOther
                ? "This user has blocked you."
                : "You have blocked this user."}{" "}
              Messages cannot be sent or received.
            </span>
          </div>
        ) : (
          <>
            {showAttachMenu && (
              <div className="attach-menu">
                <button
                  className="attach-option"
                  onClick={() => handleAttachment("Image")}
                  disabled={uploading}
                >
                  <Image size={24} />
                  <span>Image</span>
                </button>
                <button
                  className="attach-option"
                  onClick={() => handleAttachment("File")}
                  disabled={uploading}
                >
                  <File size={24} />
                  <span>File</span>
                </button>
              </div>
            )}

            {showFilePreview && selectedFile && (
              <div className="file-preview-container">
                {isImageFile(selectedFile.name, selectedFile.type) ? (
                  <div className="file-preview-image">
                    <img
                      src={URL.createObjectURL(selectedFile)}
                      alt={selectedFile.name}
                    />
                    <button
                      type="button"
                      className="remove-file-btn"
                      onClick={handleRemoveFile}
                      disabled={uploading}
                      title="Remove file"
                    >
                      <X size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="file-preview-card">
                    <div className="file-logo-wrapper">
                      <img
                        src={getFileLogo(selectedFile.name, selectedFile.type)}
                        alt={selectedFile.name}
                        className="file-logo"
                      />
                    </div>
                    <div className="file-card-info">
                      <div className="file-name" title={selectedFile.name}>
                        {selectedFile.name}
                      </div>
                      <div className="file-size">
                        {formatFileSize(selectedFile.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="remove-file-btn-card"
                      onClick={handleRemoveFile}
                      disabled={uploading}
                      title="Remove file"
                    >
                      <X size={20} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {uploading && (
              <div className="upload-progress-container">
                <div className="upload-progress-bar">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="upload-progress-text">
                  <Loader
                    size={16}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                  {Math.round(uploadProgress)}%
                </span>
              </div>
            )}

            {replyToMessage && (
              <div className="reply-preview-container">
                <div className="reply-preview">
                  <div className="reply-preview-header">
                    <span className="reply-label">Replying to</span>
                    <button
                      type="button"
                      className="reply-cancel-btn"
                      onClick={() => setReplyToMessage(null)}
                      title="Cancel reply"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="reply-preview-content">
                    <div className="reply-sender-name">
                      {replyToMessage.sender?.full_name ||
                        replyToMessage.sender?.username ||
                        "Unknown"}
                    </div>
                    <div className="reply-message-text">
                      {replyToMessage.message_text?.substring(0, 100) ||
                        "[Attachment]"}
                      {replyToMessage.message_text?.length > 100 ? "..." : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messageEditing && (
              <div className="edit-indicator">
                <div className="edit-label">
                  <Edit size={16} className="edit-icon" />
                  <span>Editing message</span>
                </div>
                <button className="cancel-edit" onClick={() => {
                  setMessageEditing(false);
                  setEditingMessageId(null);
                  setEditingMessage('');
                  setMessageText('');
                }} title="Cancel editing">
                  ✕
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                if (messageEditing) {
                  handleSendEditedMessage();
                }
                else {
                  e.preventDefault();
                  if (selectedFile) {
                    handleSendWithAttachment();
                  } else {
                    handleSendMessage(e);
                  }
                }
              }}
              className="message-input-form"
            >
              <button
                type="button"
                className="attach-btn"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={uploading || selectedFile !== null || messageEditing}
                title={
                  selectedFile
                    ? "Remove file first to select another"
                    : "Attach file"
                }
              >
                <Paperclip size={22} />
              </button>

              <textarea
                ref={messageInputRef}
                className="message-input"
                placeholder={
                  selectedFile ? "Add message (optional)" : "Type a message..."
                }
                value={messageText}
                rows={1}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  handleTyping();
                  const el = messageInputRef.current;
                  if (el) {
                    el.style.minHeight = '46px';
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (messageEditing) {
                      handleSendEditedMessage();
                    } else if (selectedFile) {
                      handleSendWithAttachment();
                    } else {
                      handleSendMessage(e);
                    }
                  }
                }}
                disabled={uploading}
              />

              <button
                type="button"
                className="emoji-btn"
                disabled={uploading}
                onClick={() => {
                  setShowEmoji(!showEmoji);
                  setShowSmartReplies(false);
                }}
              >
                <Smile size={22} />
              </button>

              <button
                type="button"
                className="ai-btn"
                onClick={() => {
                  setShowSmartReplies(!showSmartReplies);
                  setShowEmoji(false);
                }}
                disabled={uploading}
                title="Smart Replies"
              >
                <Sparkles size={22} />
              </button>

              <button
                type="submit"
                className="send-btn"
                disabled={uploading || isCreatingChat || (!messageText.trim() && !selectedFile) || (messageText === editingMessage)}
              >
                <Send size={22} />
              </button>
            </form>

            {typingUsers.length > 0 && !selectedFile && (
              <TypingIndicator typingUsers={typingUsers} />
            )}

            {showSmartReplies && !isNewChat && (
              <div ref={smartRepliesRef} className="smart-replies-wrapper">
                <SmartReplies
                  chatId={currentChatId || chatId}
                  onSelectReply={(reply) => {
                    setMessageText(reply);
                    setShowSmartReplies(false);
                  }}
                  onClose={() => setShowSmartReplies(false)}
                  disabled={uploading}
                />
              </div>
            )}

            {messages.length === 0 && !loading && showConversationStarters && !isNewChat && (
              <div className="conversation-starters-wrapper">
                <ConversationStarters
                  chatId={currentChatId || chatId}
                  onSelectStarter={(starter) => {
                    setMessageText(starter);
                  }}
                  onClose={() => setShowConversationStarters(false)}
                  disabled={uploading}
                />
              </div>
            )}
          </>
        )}
      </div>

      <ChatInfoModal
        isOpen={showChatInfoModal}
        onClose={() => setShowChatInfoModal(false)}
        chatId={currentChatId || chatId}
        chatType={chatInfo.chat_type}
        otherUserId={chatInfo.otherUserId}
        onMemberClick={handleMemberClick}
      />

      <UpdateGroupInfoModal
        isOpen={showUpdateGroupInfoModal}
        onClose={() => setShowUpdateGroupInfoModal(false)}
        chatId={currentChatId || chatId}
        currentChatInfo={{
          name: chatInfo.name,
          description: chatInfo.description || "",
          chat_image: chatImageUrl || chatInfo.chat_image,
        }}
        onUpdateSuccess={handleGroupInfoUpdateSuccess}
      />

      <ChatInfoModal
        isOpen={showUserProfileModal}
        onClose={() => setShowUserProfileModal(false)}
        chatId={null}
        chatType="private"
        otherUserId={selectedUserId}
      />

      <ContextMenu
        isOpen={messageContextMenu.isOpen}
        x={messageContextMenu.x}
        y={messageContextMenu.y}
        items={getMessageContextMenuItems(selectedMessage)}
        onClose={messageContextMenu.closeMenu}
      />

      <ContextMenu
        isOpen={headerContextMenu.isOpen}
        x={headerContextMenu.x}
        y={headerContextMenu.y}
        anchorEl={headerContextMenu.anchorEl}
        items={getHeaderMenuItems()}
        onClose={headerContextMenu.closeMenu}
      />

      {showAddMemberModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowAddMemberModal(false)}
        >
          <div className="new-chat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Member</h2>
              <button
                className="modal-close-btn"
                onClick={() => setShowAddMemberModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-search">
              <Search className="search-icon" size={20} />
              <input
                type="text"
                placeholder="Search by username..."
                value={searchAddMember}
                onChange={(e) => setSearchAddMember(e.target.value)}
                className="modal-search-input"
                autoFocus
              />
            </div>
            <div className="modal-results">
              {addMemberLoading ? (
                <p className="modal-message">Searching...</p>
              ) : searchAddMember && addMemberResults.length === 0 ? (
                <p className="modal-message">No users found</p>
              ) : addMemberResults.length > 0 ? (
                addMemberResults.map((user) => (
                  <div
                    key={user.user_id}
                    className="user-result-item"
                    onClick={() => handleSelectUserToAddClick(user)}
                  >
                    <div className="user-avatar">
                      {user.profile_pic ? (
                        <img
                          src={user.profile_pic}
                          alt="profile"
                          style={{
                            width: "100%",
                            height: "100%",
                            borderRadius: "50%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <span className="avatar-text">
                          {user.full_name
                            ? user.full_name.split(" ").length >= 2
                              ? (
                                user.full_name.split(" ")[0][0] +
                                user.full_name.split(" ")[
                                user.full_name.split(" ").length - 1
                                ][0]
                              ).toUpperCase()
                              : user.full_name.substring(0, 2).toUpperCase()
                            : user.username.substring(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="user-info">
                      <h4>{user.full_name || user.username}</h4>
                      <p>@{user.username}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="modal-message">
                  Search for users to add to the group
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmationBox
        isOpen={showAddMemberConfirmation}
        title="Add Member"
        message={`Add ${selectedUserToAdd?.full_name || selectedUserToAdd?.username
          } to this group?`}
        confirmText="Add"
        cancelText="Cancel"
        isLoading={isAddingMember}
        onConfirm={handleSelectUserToAdd}
        onCancel={() => {
          setShowAddMemberConfirmation(false);
          setSelectedUserToAdd(null);
        }}
      />

      {showTranslator && translateMessage && (
        <MessageTranslator
          messageText={translateMessage.message_text}
          messageId={translateMessage.message_id}
          onClose={() => {
            setShowTranslator(false);
            setTranslateMessage(null);
          }}
          onTranslate={(msgId, translatedText, lang) => {
            setMessageTranslations(prev => ({
              ...prev,
              [msgId]: { text: translatedText, lang: lang, loading: false }
            }));
          }}
        />
      )}

      {showSummary && (currentChatId || chatId) && (
        <ChatSummary chatId={currentChatId || chatId} onClose={() => setShowSummary(false)} />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
};

export default ChatWindow;
