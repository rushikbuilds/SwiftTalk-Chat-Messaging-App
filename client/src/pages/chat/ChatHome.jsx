import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from '@tanstack/react-query';
import { chatInfoQueryOptions, chatMessagesQueryOptions } from '../../utils/api/chatQueries';
import {
  MessageCircle,
  X,
  Search,
  Check,
  Pin,
  Trash2,
  LogOut,
  CircleCheckBig,
  BellOff,
  Archive,
  Users,
} from "lucide-react";
import SimpleBar from "simplebar-react";
import "simplebar-react/dist/simplebar.min.css";
import BottomTabBar from "../../components/common/BottomTabBar";
import SearchBar from "../../components/common/SearchBar";
import ChatInfoModal from "../../components/modals/ChatInfoModal";
import CreateGroupModal from "../../components/modals/CreateGroupModal";
import ContextMenu from "../../components/common/ContextMenu";
import ConfirmationBox from "../../components/common/ConfirmationBox";
import ToastContainer from "../../components/common/ToastContainer";
import NewBtn from "../../components/common/NewBtn";
import useContextMenu from "../../hooks/useContextMenu";
import { useToast } from "../../hooks/useToast";
import useResponsive from "../../hooks/useResponsive";
import useSplitPane from "../../hooks/useSplitPane";
import ChatWindow from "./ChatWindow";
import { formatChatPreviewTime } from "../../utils/date";
import socketService from "../../utils/socket";
import {
  getSidebarWidth,
  setSidebarWidth,
  SIDEBAR_CONFIG,
} from "../../utils/storage";
import {
  fetchUserProfileById,
  fetchChatImage as fetchChatImageApi,
  fetchChatInfo,
  fetchActiveChats,
  searchUsers as searchUsersService,
  markChatAsRead,
  toggleChatPin,
  deleteChat,
  exitGroupChat,
  batchDeleteChats,
  batchMarkChatsAsRead,
  batchPinChats,
} from '../../utils/api';
import "./ChatHome.css";

const ChatHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toasts, showToast, removeToast } = useToast();
  const isWideScreen = useResponsive();

  const [greeting, setGreeting] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const userId =
    location.state?.userId ||
    JSON.parse(localStorage.getItem("user") || "{}").user_id;
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userProfiles, setUserProfiles] = useState({});
  const [chatImages, setChatImages] = useState({});
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchUsers, setSearchUsers] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUserForNewChat, setSelectedUserForNewChat] = useState(null);
  const [newPrivateChatUser, setNewPrivateChatUser] = useState(null);
  const [showNewChatConfirmation, setShowNewChatConfirmation] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [showChatInfoModal, setShowChatInfoModal] = useState(false);
  const [selectedChatInfo, setSelectedChatInfo] = useState(null);
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [selectedUserForModal, setSelectedUserForModal] = useState(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [selectedChats, setSelectedChats] = useState({});
  const [chatSelection, setChatSelection] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState(
    () => location.state?.selectedChatId || null
  );
  const containerRef = useRef(null);
  const { paneWidth: leftPanelWidth, startDragging, isDragging } = useSplitPane(
    getSidebarWidth(),
    {
      minWidth: SIDEBAR_CONFIG.MIN_WIDTH,
      maxWidth: SIDEBAR_CONFIG.MAX_WIDTH,
      edge: "left",
    }
  );
  const headerRef = useRef(null);
  const bottomTabBarRef = useRef(null);
  const [chatListHeight, setChatListHeight] = useState("calc(100vh - 200px)");

  const chatContextMenu = useContextMenu();
  const newChatContextMenu = useContextMenu();
  const [selectedChatForMenu, setSelectedChatForMenu] = useState(null);


  useEffect(() => {
    const calculateHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight || 0;
      const bottomTabHeight = bottomTabBarRef.current?.offsetHeight || 0;
      const totalOffset = headerHeight + bottomTabHeight + 20;
      setChatListHeight(`calc(100vh - ${totalOffset}px)`);
    };

    calculateHeight();
    window.addEventListener("resize", calculateHeight);
    return () => window.removeEventListener("resize", calculateHeight);
  }, [chatSelection, showNewChatModal]);

  const sortChatsByTimestamp = (chatsToSort) => {
    return [...chatsToSort].sort((a, b) => {
      if (a.pinned === b.pinned) {
        const timeA = new Date(
          a.last_message_timestamp || a.created_at || 0
        ).getTime();
        const timeB = new Date(
          b.last_message_timestamp || b.created_at || 0
        ).getTime();
        return timeB - timeA;
      }
      return a.pinned ? -1 : 1;
    });
  };

  const fetchUserProfile = useCallback(async (otherUserId) => {
    if (userProfiles[otherUserId] || otherUserId === userId) return;
    try {
      const userData = await fetchUserProfileById(otherUserId);
      if (userData) {
        setUserProfiles((prev) => ({
          ...prev,
          [otherUserId]: userData,
        }));
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
    }
  }, [userProfiles, userId]);

  const fetchChatImage = useCallback(async (chatId, imagePath) => {
    if (chatImages[chatId] || !imagePath) return;
    try {
      const blobUrl = await fetchChatImageApi(imagePath);
      if (blobUrl) {
        setChatImages((prev) => ({
          ...prev,
          [chatId]: blobUrl,
        }));
      }
    } catch (err) {
      console.error("Error fetching chat image:", err);
    }
  }, [chatImages]);

  useEffect(() => {
    const fetchChats = async () => {
      if (!userId) {
        setError("User ID not found.");
        setLoading(false);
        return;
      }
      try {
        const data = await fetchActiveChats(userId);

        const sortedChats = sortChatsByTimestamp(data.chats || []);
        setChats(sortedChats);

        setSelectedChats((prev) => ({
          ...prev,
          ...Object.fromEntries(
            sortedChats.map((item) => [item.chat_id, false])
          ),
        }));
      } catch (err) {
        console.error("Error fetching chats:", err);
        if (err.message && err.message.includes("Failed to fetch")) {
          setError("Unable to connect to server. Please check your connection.");
        } else {
          setError(err.message || "Error loading chats. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    };
    fetchChats();
  }, [userId]);

  useEffect(() => {
    chats.forEach((chat) => {
      if (chat.chat_type === "private" && Array.isArray(chat.members)) {
        const other = chat.members.find((m) => m.user_id !== userId);
        if (other && other.user_id) {
          fetchUserProfile(other.user_id);
        }
      } else if (chat.chat_type === "group" && chat.chat_image) {
        fetchChatImage(chat.chat_id, chat.chat_image);
      }
    });
  }, [chats, fetchChatImage, fetchUserProfile, userId]);

  const filteredChats = chats.filter((chat) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;

      if (chat.chat_type === "group") {
        return (chat.chat_name || "").toLowerCase().includes(q);
      }

      if (chat.chat_type === "private") {
        const otherMember = chat.members?.find(
          (m) => m.user_id !== userId
        );
        if (!otherMember) return false;
        return (
          (otherMember.user.full_name || "").toLowerCase().includes(q) ||
          (otherMember.user.user_name || "").toLowerCase().includes(q)
        );
      }
      return false;
    });

  useEffect(() => {
    if (!showOptionsMenu) return;

    const handleClickOutside = (e) => {
      const menu = document.querySelector(".chat-options-menu");
      const btn = document.querySelector(".new-chat-btn");
      if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        setShowOptionsMenu(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showOptionsMenu]);

  useEffect(() => {
    return () => {
      Object.values(chatImages).forEach((blobUrl) => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      });
    };
  }, [chatImages]);

  useEffect(() => {
    if (!userId) return;

    socketService.connect(userId);

    const handleNewMessage = async (message) => {
      setChats((prevChats) => {
        const chatIndex = prevChats.findIndex(
          (chat) => chat.chat_id === message.chat_id
        );

        if (chatIndex !== -1) {
          const existingChat = prevChats[chatIndex];
          if (existingChat.last_message?.message_id === message.message_id) {
            return prevChats;
          }

          let unreadCount = prevChats[chatIndex].unread_count || 0;
          if (
            message.sender_id !== userId &&
            String(selectedChatId) !== String(message.chat_id)
          ) {
            unreadCount += 1;
          }

          const updatedChat = {
            ...prevChats[chatIndex],
            last_message: {
              message_id: message.message_id,
              preview_text:
                message.message_text ||
                (message.attachments?.length ? "[Attachment]" : "Empty message"),
              sender: message.sender,
              has_attachment: !!(
                message.attachments && message.attachments.length
              ),
              created_at: message.created_at,
            },
            last_message_timestamp: message.created_at,
            sender_id: message.sender_id,
            unread_count: unreadCount,
          };

          const chatsWithoutCurrent = prevChats.filter(
            (_, index) => index !== chatIndex
          );

          const sortedChats = sortChatsByTimestamp([
            updatedChat,
            ...chatsWithoutCurrent,
          ]);

          return sortedChats;
        }

        return prevChats;
      });

      setChats((prevChats) => {
        const chatExists = prevChats.some((chat) => chat.chat_id === message.chat_id);
        if (!chatExists) {
          fetchNewChatDetails(message.chat_id, message);
        }
        return prevChats;
      });
    };

    const fetchNewChatDetails = async (chatId, message) => {
      try {
        const data = await fetchChatInfo(chatId);
        const chatFromServer = data.chat;

        const newChat = {
          chat_id: chatFromServer.chat_id,
          chat_name: chatFromServer.chat_name,
          chat_type: chatFromServer.chat_type,
          chat_image: chatFromServer.chat_image,
          members: chatFromServer.members || [],
          last_message: {
            message_id: message.message_id,
            preview_text:
              message.message_text ||
              (message.attachments?.length ? "[Attachment]" : "Empty message"),
            sender: message.sender,
            has_attachment: !!(message.attachments && message.attachments.length),
            created_at: message.created_at,
          },
          last_message_timestamp: message.created_at,
          sender_id: message.sender_id,
          created_at: chatFromServer.created_at,
          unread_count: message.sender_id !== userId ? 1 : 0,
        };

        setChats((prevChats) => {
          if (prevChats.some((c) => c.chat_id === chatId)) {
            return prevChats;
          }
          const sortedChats = sortChatsByTimestamp([newChat, ...prevChats]);
          return sortedChats;
        });

        socketService.joinChat(chatId);

        if (chatFromServer.chat_type === "private" && chatFromServer.members) {
          chatFromServer.members.forEach((member) => {
            if (member.user_id !== userId) {
              fetchUserProfile(member.user_id);
            }
          });
        }
      } catch (err) {
        console.error('Error fetching new chat details:', err);
      }
    };

    const handleUserOnline = ({ user_id }) => {
      setChats((prevChats) =>
        prevChats.map((chat) => {
          if (chat.chat_type === "private" && chat.members) {
            const other = chat.members.find((m) => m.user_id !== userId);
            if (other && other.user_id === user_id) {
              return {
                ...chat,
                members: chat.members.map((m) =>
                  m.user_id === user_id ? { ...m, is_online: true } : m
                ),
              };
            }
          }
          return chat;
        })
      );
    };

    const handleUserOffline = ({ user_id, lastSeen }) => {
      setChats((prevChats) =>
        prevChats.map((chat) => {
          if (chat.chat_type === "private" && chat.members) {
            const other = chat.members.find((m) => m.user_id !== userId);
            if (other && other.user_id === user_id) {
              return {
                ...chat,
                members: chat.members.map((m) =>
                  m.user_id === user_id
                    ? { ...m, is_online: false, last_seen: lastSeen }
                    : m
                ),
              };
            }
          }
          return chat;
        })
      );
    };

    const handleAddedToGroup = ({
      chat_id,
      group_name,
      chat_image,
      message,
    }) => {
      const newGroupChat = {
        chat_id,
        chat_name: group_name,
        chat_type: "group",
        chat_image: chat_image || null,
        members: [],
        last_message: {
          message_id: null,
          preview_text: message,
          sender: "System",
          has_attachment: false,
          created_at: new Date().toISOString(),
        },
        last_message_timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        unread_count: 0,
      };

      setChats((prevChats) => [newGroupChat, ...prevChats]);

      if (chat_image) {
        fetchChatImage(chat_id, chat_image);
      }

      showToast(`Added to group "${group_name}"`, "success");
    };

    const handleRemovedFromGroup = ({ chat_id, group_name, message }) => {
      setChats((prevChats) => prevChats.filter((c) => String(c.chat_id) !== String(chat_id)));

      if (selectedChatId != null && String(selectedChatId) === String(chat_id)) {
        setSelectedChatId(null);
      }

      showToast(message, "warning");
    };

    socketService.onNewMessage(handleNewMessage);
    socketService.onUserOnline(handleUserOnline);
    socketService.onUserOffline(handleUserOffline);
    socketService.onAddedToGroup(handleAddedToGroup);
    socketService.onRemovedFromGroup(handleRemovedFromGroup);

    return () => {
      const socket = socketService.getSocket();
      if (socket) {
        socket.off("new_message", handleNewMessage);
        socket.off("user_online", handleUserOnline);
        socket.off("user_offline", handleUserOffline);
        socket.off("you_were_added_to_group", handleAddedToGroup);
        socket.off("you_were_removed_from_group", handleRemovedFromGroup);
      }
    };
  }, [userId, selectedChatId, showToast, fetchChatImage, fetchUserProfile]);

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();

      if (hour >= 5 && hour < 12) {
        setGreeting("Good Morning 🌅");
      } else if (hour >= 12 && hour < 17) {
        setGreeting("Good Afternoon ☀️");
      } else if (hour >= 17 && hour < 21) {
        setGreeting("Good Evening 🌇");
      } else {
        setGreeting("Good Night 🌙");
      }
    };

    updateGreeting();

    const interval = setInterval(updateGreeting, 3600000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setSidebarWidth(leftPanelWidth);
  }, [leftPanelWidth]);

  const showDesktopSplit = typeof window !== "undefined" && window.innerWidth >= 900;


  const handleChatClick = (chatOrId) => {
    const chat = typeof chatOrId === 'object' ? chatOrId : filteredChats.find(c => c.chat_id === chatOrId);

    // Clear new private chat user when clicking on an existing chat
    setNewPrivateChatUser(null);

    if (typeof window !== "undefined" && window.innerWidth < 900) {
      navigate(`/chat/${chat?.chat_id || chatOrId}`);
    } else {
      handleMarkAsRead(chat?.chat_id || chatOrId);
      setSelectedChatId(chat?.chat_id || chatOrId);
    }
  };

  useEffect(() => {
    const path = location.pathname || "";
    const match = path.match(/\/chat\/([^/?#]+)/);
    if (match && typeof window !== "undefined" && window.innerWidth < 900) {
      setSelectedChatId(match[1]);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!isWideScreen && selectedChatId) {
      navigate(`/chat/${selectedChatId}`);
    }
  }, [isWideScreen, selectedChatId, navigate]);



  const handleChatAvatarClick = (e, chat) => {
    e.stopPropagation();

    if (chat.chat_type === "group") {
      setSelectedChatInfo({
        chatId: chat.chat_id,
        chatType: "group",
        otherUserId: null,
      });
    } else if (chat.chat_type === "private") {
      const other = chat.members.find((m) => m.user_id !== userId);
      setSelectedChatInfo({
        chatId: chat.chat_id,
        chatType: "private",
        otherUserId: other?.user_id,
      });
    }

    setShowChatInfoModal(true);
  };

  const handleNewChat = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();

    newChatContextMenu.setMenu({
      isOpen: true,
      x: rect.left + rect.width / 2,
      y: rect.top,
      position: 'top-left',
      maxX: window.innerWidth >= 900 ? leftPanelWidth : undefined
    });
  };

  const handleNewChatWithUser = () => {
    setShowOptionsMenu(false);
    setShowNewChatModal(true);
    setSearchUsers("");
    setSearchResults([]);
  };

  const handleCreateNewGroup = () => {
    setShowOptionsMenu(false);
    setShowCreateGroupModal(true);
  };

  const handleChatContextMenu = (e, chat) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedChatForMenu(chat);
    chatContextMenu.handleContextMenu(e);
  };

  const handleChatsSelection = (chat_id) => {
    if (!selectedChatForMenu && !chat_id) return;
    const id = chat_id || selectedChatForMenu.chat_id;

    setSelectedChats((prevItems) => {
      const newSelectedChats = {
        ...prevItems,
        [id]: !prevItems[id],
      };

      const selectedCount =
        Object.values(newSelectedChats).filter(Boolean).length;

      setChatSelection(selectedCount > 0);

      return newSelectedChats;
    });
  };

  const handleMarkAsRead = async (selectedChatIdParam) => {
    if (!selectedChatForMenu && !selectedChatIdParam) return;
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const currentUserId = user.user_id;

      const chatId = selectedChatIdParam || selectedChatForMenu.chat_id;

      await markChatAsRead(chatId, currentUserId);

      // Update local state
      setChats((prevChats) =>
        prevChats.map((c) =>
          c.chat_id === chatId
            ? { ...c, unread_count: 0 }
            : c
        )
      );
    } catch (err) {
      console.error("Error marking chat as read:", err);
      showToast("Failed to mark messages as read", "error");
    }
  };

  const handlePinChat = async () => {
    if (!selectedChatForMenu) return;
    try {
      const isPinned =
        selectedChatForMenu.pinned || selectedChatForMenu.is_pinned;

      await toggleChatPin(selectedChatForMenu.chat_id, !isPinned);

      const updated = chats.map((chat) =>
        chat.chat_id === selectedChatForMenu.chat_id
          ? { ...chat, pinned: !isPinned, is_pinned: !isPinned }
          : chat
      );

      setChats(sortChatsByTimestamp(updated));
      showToast(isPinned ? "Chat unpinned" : "Chat pinned", "success");
    } catch (err) {
      console.error("Error pinning chat:", err);
      showToast("Error updating pin status", "error");
    }
  };

  const handleDeleteChat = async (chatIdParam) => {
    if (!selectedChatForMenu && !chatIdParam) return;

    const chatId = chatIdParam || selectedChatForMenu.chat_id;

    const confirmed = window.confirm(
      `Are you sure you want to delete this chat?`
    );
    if (!confirmed) return;

    try {
      await deleteChat(chatId);

      setChats((prevChats) =>
        prevChats.filter((c) => String(c.chat_id) !== String(chatId))
      );

      if (selectedChatId != null && String(selectedChatId) === String(chatId)) {
        setSelectedChatId(null);
      }
    } catch (err) {
      console.error("Error deleting chat:", err);
    }
  };

  const handleExitGroupChat = async () => {
    if (!selectedChatForMenu) return;

    const confirmed = window.confirm(
      "Are you sure you want to exit this group?"
    );
    if (!confirmed) return;

    try {
      await exitGroupChat(selectedChatForMenu.chat_id);

      setChats((prevChats) =>
        prevChats.filter((c) => String(c.chat_id) !== String(selectedChatForMenu.chat_id))
      );

      if (selectedChatId != null && String(selectedChatId) === String(selectedChatForMenu.chat_id)) {
        setSelectedChatId(null);
      }
    } catch (err) {
      console.error("Error exiting group chat:", err);
    }
  };

  const getContextMenuItems = (chat) => {
    const items = [
      {
        id: "select",
        label: "Select",
        icon: <Check size={16} />,
        onClick: handleChatsSelection,
      },
      {
        id: "mark-read",
        label: "Mark as Read",
        icon: <Check size={16} />,
        onClick: handleMarkAsRead,
      },
      {
        id: "pin",
        label: chat?.is_pinned || chat?.pinned ? "Unpin" : "Pin",
        icon: <Pin size={16} />,
        onClick: handlePinChat,
      },
      { id: "divider1", divider: true },
    ];

    if (chat?.chat_type === "private") {
      items.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={16} />,
        color: "danger",
        onClick: handleDeleteChat,
      });
    } else if (chat?.chat_type === "group") {
      items.push({
        id: "exit",
        label: "Exit Group",
        icon: <LogOut size={16} />,
        color: "danger",
        onClick: handleExitGroupChat,
      });
    }

    return items;
  };

  const getNewChatContextMenuItems = (chat) => {
    const items = [
      {
        id: "new-private-chat",
        label: "Chat with user",
        icon: <MessageCircle size={16} />,
        onClick: handleNewChatWithUser,
      },
      {
        id: "new-group",
        label: "Create New Group",
        icon: <Users size={16} />,
        onClick: handleCreateNewGroup,
      },
    ];

    return items;
  };

  const handleGroupCreated = async (newChatId) => {
    setShowCreateGroupModal(false);
    setShowOptionsMenu(false);

    try {
      const data = await fetchChatInfo(newChatId);
      const newChat = data.chat;

      setChats((prevChats) => [newChat, ...prevChats]);

      if (newChat.chat_image) {
        fetchChatImage(newChat.chat_id, newChat.chat_image);
      }
    } catch (err) {
      console.error("Error fetching newly created group:", err);
    }

    if (typeof window !== "undefined" && window.innerWidth >= 900) {
      setSelectedChatId(newChatId);
    } else {
      navigate(`/chat/${newChatId}`);
    }
  };

  const searchUsersAPI = useCallback(
    async (query) => {
      if (!query.trim()) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }

      try {
        const users = await searchUsersService(query, 1, 10);
        const filteredUsers = users.filter(
          (user) => Number(user.user_id) !== Number(userId)
        );
        setSearchResults(filteredUsers);
      } catch (err) {
        console.error("Error searching users:", err);
      } finally {
        setSearchLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!searchUsers.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const debounceTimer = setTimeout(() => {
      searchUsersAPI(searchUsers);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchUsers, searchUsersAPI]);

  useEffect(() => {
    if (!showNewChatModal) {
      setShowNewChatConfirmation(false);
      setSelectedUserForNewChat(null);
      setIsCreatingChat(false);
    }
  }, [showNewChatModal]);

  const handleSearchUsers = (query) => {
    setSearchUsers(query);
  };

  const handleSelectUserClick = (selectedUser) => {
    setSelectedUserForNewChat(selectedUser);
    setShowNewChatConfirmation(true);
  };

  const handleSelectUser = async () => {
    if (!selectedUserForNewChat) return;

    try {
      setIsCreatingChat(true);
      setShowNewChatModal(false);
      setShowNewChatConfirmation(false);
      setSelectedUserForNewChat(null);

      if (typeof window !== "undefined" && window.innerWidth < 900) {
        navigate('/chat/new', { state: { recipient: selectedUserForNewChat } });
      } else {
        setNewPrivateChatUser(selectedUserForNewChat);
        setSelectedChatId(null);
      }
    } catch (err) {
      console.error("Error setting up new chat:", err);
      alert("Failed to start chat. Please try again.");
    } finally {
      setIsCreatingChat(false);
    }
  };

  const clearAllSelection = (e) => {
    if (e && e.target && (
      e.target.closest('.context-menu') ||
      e.target.closest('.chat-item') ||
      e.target.closest('.header-actions') ||
      e.target.closest('.modal-overlay')
    )) {
      return;
    }
    setSelectedChats((prev) =>
      Object.fromEntries(Object.keys(prev).map((key) => [key, false]))
    );
    setChatSelection(false);
  };

  const deleteAllSelectedChats = async () => {
    try {
      const selectedChatIds = Object.keys(selectedChats)
        .filter((key) => selectedChats[key] === true)
        .map((key) => Number(key));

      if (selectedChatIds.length > 0) {
        await batchDeleteChats(selectedChatIds);

        setChats((prevChats) =>
          prevChats.filter((c) => !selectedChats[c.chat_id])
        );

        if (selectedChatId && selectedChatIds.includes(selectedChatId)) {
          setSelectedChatId(null);
        }

        showToast("Deleted Selected Chats successfully", "success");
      }
    } catch (err) {
      console.error("Error deleting chats:", err);
      showToast("Error deleting chats", "error");
    } finally {
      clearAllSelection();
    }
  };

  const markReadAllSelectedChats = async () => {
    try {
      const selectedChatIds = Object.keys(selectedChats)
        .filter((key) => selectedChats[key] === true)
        .map((key) => Number(key));

      if (selectedChatIds.length > 0) {
        await batchMarkChatsAsRead(selectedChatIds);

        setChats((prevChats) =>
          prevChats.map((c) =>
            selectedChats[c.chat_id] ? { ...c, unread_count: 0 } : c
          )
        );
      }
    } catch (err) {
      console.error("Error marking chats as read:", err);
      showToast("Error marking chats as read", "error");
    } finally {
      clearAllSelection();
    }
  };

  const pinAllSelectedChats = async () => {
    try {
      const selectedChatIds = Object.keys(selectedChats)
        .filter((key) => selectedChats[key] === true)
        .map((key) => Number(key));

      if (selectedChatIds.length > 0) {
        await batchPinChats(selectedChatIds);

        const updated = chats.map((chat) =>
          selectedChats[chat.chat_id] ? { ...chat, pinned: true } : chat
        );

        setChats(sortChatsByTimestamp(updated));
      }
    } catch (err) {
      console.error("Error pinning chats:", err);
      showToast("Error pinning chats", "error");
    } finally {
      clearAllSelection();
    }
  };

  const ChatItem = ({ chat }) => {
    let displayName = chat.chat_name;
    let otherUserId = null;
    let chatImage = null;



    const handleMouseEnter = () => {
      if (chatSelection) return;
      const chatId = chat.chat_id;

      // prefetchQuery respects staleTime — won't fire a duplicate request
      // if the data is already fresh in cache
      queryClient.prefetchQuery(chatInfoQueryOptions(chatId));
      queryClient.prefetchQuery(chatMessagesQueryOptions(chatId, userId));
    };

    if (
      chat.chat_type === "private" &&
      Array.isArray(chat.members)
    ) {
      const currentUserId = Number(userId);
      const other = chat.members.find(
        (m) => Number(m.user_id) !== currentUserId
      );

      if (other) {
        otherUserId = other.user_id;
        if (other.user && other.user.full_name) {
          displayName = other.user.full_name;
        } else if (other.user && other.user.username) {
          displayName = other.user.username;
        } else if (userProfiles[other.user_id]?.full_name) {
          displayName = userProfiles[other.user_id].full_name;
        } else if (userProfiles[other.user_id]?.username) {
          displayName = userProfiles[other.user_id].username;
        }
      }
    } else if (chat.chat_type === "group") {
      chatImage = chatImages[chat.chat_id];
    }
    const profilePic =
      otherUserId && userProfiles[otherUserId]?.profile_pic;

    const getInitials = (name) => {
      if (!name) return "💬";
      const words = name.trim().split(" ");
      if (words.length >= 2) {
        return (
          words[0][0] + words[words.length - 1][0]
        ).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    };

    return (
      <div
        key={chat.chat_id}
        className={`chat-item ${selectedChatId != null && String(selectedChatId) === String(chat.chat_id) ? "selected" : ""
          } ${selectedChats[chat.chat_id] ? "selection" : ""}`}
        onMouseEnter={handleMouseEnter}
        onClick={(e) => {
          if (chatSelection) {
            e.stopPropagation();
            handleChatsSelection(chat.chat_id);
          } else handleChatClick(chat.chat_id);
        }}
        onContextMenu={(e) => handleChatContextMenu(e, chat)}
      >
        <div
          className="chat-avatar"
          onClick={(e) => handleChatAvatarClick(e, chat)}
          style={{ cursor: "pointer" }}
        >
          {profilePic || chatImage ? (
            <img
              src={profilePic || chatImage}
              alt={
                chat.chat_type === "group" ? "group" : "profile"
              }
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          ) : (
            <span className="avatar-emoji">
              {chat.chat_type === "private"
                ? getInitials(displayName)
                : "💬"}
            </span>
          )}
        </div>
        <div className="chat-info">
          <div className="chat-header-info">
            <h3 className="chat-name">{displayName}</h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {chat.unread_count > 0 && (
                <span
                  style={{
                    backgroundColor: "var(--accent-color)",
                    color: "white",
                    borderRadius: "50%",
                    width: "24px",
                    height: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: "600",
                    flexShrink: 0,
                  }}
                >
                  {chat.unread_count > 99
                    ? "99+"
                    : chat.unread_count}
                </span>
              )}
              {chat.pinned && (
                <Pin
                  color="var(--accent-color)"
                  size={16}
                  strokeWidth={2}
                />
              )}
              <span className="chat-time">
                {formatChatPreviewTime(
                  chat.last_message?.created_at
                )}
              </span>
            </div>
          </div>
          <div className="chat-last-message">
            <p className="last-message">
              {chat.last_message?.preview_text ||
                "No messages yet"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Chats | SwiftTalk</title>
        <meta name="description" content="View and manage your conversations on SwiftTalk." />
        <meta property="og:title" content="Chats | SwiftTalk" />
        <meta property="og:description" content="View and manage your conversations on SwiftTalk." />
      </Helmet>
      <div className="chat-home" onClick={clearAllSelection}>
        <div
          className="chat-home-container"
          ref={containerRef}
          style={
            showDesktopSplit
              ? {
                gridTemplateColumns: `${leftPanelWidth}px 10px 1fr`,
              }
              : {}
          }
        >
          <div className="left-panel">
            <div className="chat-home-header" ref={headerRef}>
              <div className="header-top">
                <h1>{greeting}</h1>
                <div className="header-actions">
                  {chatSelection ? (
                    <>
                      <button
                        className="delete-chats-header-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteAllSelectedChats();
                        }}
                      >
                        <Trash2 size={24} />
                      </button>
                      <button
                        className="mark-all-read-header-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markReadAllSelectedChats();
                        }}
                      >
                        <CircleCheckBig size={24} />
                      </button>
                      <button className="mute-all-header-btn">
                        <BellOff size={24} />
                      </button>
                      <button className="archive-all-header-btn">
                        <Archive size={24} />
                      </button>
                      <button
                        className="pin-all-header-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          pinAllSelectedChats();
                        }}
                      >
                        <Pin size={24} />
                      </button>
                      <button
                        className="cancel-all-selection-header-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearAllSelection();
                        }}
                      >
                        <X size={24} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search conversations..."
              />
            </div>

            <div className="chat-list-wrapper">
              <SimpleBar style={{ maxHeight: chatListHeight }}>
                <div className="chat-list">
                  {loading ? (
                    <div className="no-chats">
                      <p>Loading chats...</p>
                    </div>
                  ) : error ? (
                    <div className="no-chats">
                      <p>{error}</p>
                    </div>
                  ) : filteredChats.length > 0 ? (
                    filteredChats.map((chat) => {
                      return <ChatItem key={chat.chat_id} chat={chat} />;
                    })
                  ) : (
                    <div className="no-chats">
                      <MessageCircle size={64} className="no-chats-icon" />
                      <p>No conversations found</p>
                    </div>
                  )}
                </div>
              </SimpleBar>
            </div>

            <NewBtn onClick={handleNewChat} />

            <div ref={bottomTabBarRef}>
              <BottomTabBar activeTab="chats" />
            </div>
          </div>

          {showDesktopSplit && (
            <div
              className={`chat-split-divider ${isDragging ? "active" : ""}`}
              onMouseDown={startDragging}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat list panel"
            />
          )}

          <div className="right-panel">
            {(selectedChatId || newPrivateChatUser) ? (
              <ChatWindow
                key={selectedChatId || `new-${newPrivateChatUser?.user_id}`}
                chatId={selectedChatId}
                recipient={newPrivateChatUser}
                isEmbedded={true}
                onMemberClick={(memberId) => {
                  setSelectedUserForModal(memberId);
                  setShowUserProfileModal(true);
                }}
                onChatCreated={(newChatId) => {
                  // When a new chat is created, update the selected chat ID
                  // and clear the newPrivateChatUser
                  setSelectedChatId(newChatId);
                  setNewPrivateChatUser(null);
                }}
              />
            ) : (
              <div className="chat-placeholder">
                <p>Select a conversation to start chatting</p>
              </div>
            )}
          </div>
        </div>

        {showNewChatModal && (
          <div
            className="modal-overlay"
            onClick={() => setShowNewChatModal(false)}
          >
            <div className="new-chat-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>New Chat</h2>
                <button
                  className="modal-close-btn"
                  onClick={() => setShowNewChatModal(false)}
                >
                  ×
                </button>
              </div>
              <div className="modal-search">
                <Search className="search-icon" size={20} />
                <input
                  type="text"
                  placeholder="Search by username..."
                  value={searchUsers}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  className="modal-search-input"
                  autoFocus
                />
              </div>
              <div className="modal-results">
                {searchLoading ? (
                  <p className="modal-message">Searching...</p>
                ) : searchUsers && searchResults.length === 0 ? (
                  <p className="modal-message">No users found</p>
                ) : searchResults.length > 0 ? (
                  searchResults.map((user) => (
                    <div
                      key={user.user_id}
                      className="user-result-item"
                      onClick={() => handleSelectUserClick(user)}
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
                    Search for users to start a new chat
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <ChatInfoModal
          isOpen={showChatInfoModal}
          onClose={() => setShowChatInfoModal(false)}
          chatId={selectedChatInfo?.chatId}
          chatType={selectedChatInfo?.chatType}
          otherUserId={selectedChatInfo?.otherUserId}
        />

        <ChatInfoModal
          isOpen={showUserProfileModal}
          onClose={() => {
            setShowUserProfileModal(false);
            if (selectedChatInfo) {
              setShowChatInfoModal(true);
            }
          }}
          chatId={null}
          chatType="private"
          otherUserId={selectedUserForModal}
        />

        <CreateGroupModal
          isOpen={showCreateGroupModal}
          onClose={() => setShowCreateGroupModal(false)}
          onGroupCreated={handleGroupCreated}
          currentUserId={userId}
        />

        <ContextMenu
          isOpen={newChatContextMenu.isOpen}
          x={newChatContextMenu.x}
          y={newChatContextMenu.y}
          position={newChatContextMenu.position}
          maxX={newChatContextMenu.maxX}
          items={getNewChatContextMenuItems()}
          onClose={newChatContextMenu.closeMenu}
        />

        <ContextMenu
          isOpen={chatContextMenu.isOpen}
          x={chatContextMenu.x}
          y={chatContextMenu.y}
          items={getContextMenuItems(selectedChatForMenu)}
          onClose={chatContextMenu.closeMenu}
        />

        <ConfirmationBox
          isOpen={showNewChatConfirmation}
          title="Start New Chat"
          message={`Start a new conversation with ${selectedUserForNewChat?.full_name || selectedUserForNewChat?.username
            }?`}
          confirmText="Start Chat"
          cancelText="Cancel"
          isLoading={isCreatingChat}
          onConfirm={handleSelectUser}
          onCancel={() => {
            setShowNewChatConfirmation(false);
            setSelectedUserForNewChat(null);
          }}
        />

        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </>
  );
};

export default ChatHome;
