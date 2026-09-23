import React, { useState, useEffect } from "react";
import { handleSessionExpiry } from "../../utils/auth";
import { MessageCircle, X, Send, Search } from 'lucide-react';
import SimpleBar from "simplebar-react";
import "./MessageForward.css";

const MessageForward = ({ onClose, userId, messageId, onForward, currentChatId }) => {
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [forwarding, setForwarding] = useState(false);
    const [chats, setChats] = useState([]);
    const [selectedChatIds, setSelectedChatIds] = useState([]);
    const [chatImages, setChatImages] = useState({});
    const [userProfiles, setUserProfiles] = useState({});
    const [searchQuery, setSearchQuery] = useState("");

    // Helper function to sort chats by last message timestamp (newest first)
    const sortChatsByTimestamp = (chatsToSort) => {
        return [...chatsToSort].sort((a, b) => {
            if (a.pinned === b.pinned) {
                const timeA = new Date(
                    a.last_message_timestamp || a.created_at || 0
                ).getTime();
                const timeB = new Date(
                    b.last_message_timestamp || b.created_at || 0
                ).getTime();
                return timeB - timeA; // Descending order (newest first)
            }
            return a.pinned ? -1 : 1;
        });
    };

    // Function to fetch chat image with token
    const fetchChatImage = async (chatId, imagePath) => {
        if (chatImages[chatId] || !imagePath) return;
        try {
            const API_URL = (
                import.meta.env.VITE_APP_API_URL || "http://localhost:3001"
            ).replace(/\/+$/, "");
            const token = localStorage.getItem("accessToken");
            const filename = imagePath.split("/uploads/").pop();
            const res = await fetch(`${API_URL}/uploads/chat-images/${filename}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (res.ok) {
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                setChatImages((prev) => ({
                    ...prev,
                    [chatId]: blobUrl,
                }));
            }
        } catch (err) {
            console.error("Error fetching chat image:", err);
        }
    };

    // Function to fetch user profile picture
    const fetchUserProfile = async (otherUserId) => {
        if (userProfiles[otherUserId]) return;
        try {
            const API_URL = (
                import.meta.env.VITE_APP_API_URL || "http://localhost:3001"
            ).replace(/\/+$/, "");
            const token = localStorage.getItem("accessToken");
            const res = await fetch(`${API_URL}/api/users/${otherUserId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (res.ok) {
                const userData = await res.json();
                if (userData.profile_pic) {
                    const filename = userData.profile_pic.split("/uploads/").pop();
                    const picRes = await fetch(`${API_URL}/uploads/profile-pics/${filename}`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    });
                    if (picRes.ok) {
                        const blob = await picRes.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        setUserProfiles((prev) => ({
                            ...prev,
                            [otherUserId]: blobUrl,
                        }));
                    }
                }
            }
        } catch (err) {
            console.error("Error fetching user profile:", err);
        }
    };

    useEffect(() => {
        const fetchChats = async (retry = false) => {
            if (!userId) {
                setError("User ID not found.");
                setLoading(false);
                return;
            }
            try {
                const API_URL = (
                    import.meta.env.VITE_APP_API_URL || "http://localhost:3001"
                ).replace(/\/+$/, "");
                const token = localStorage.getItem("accessToken");
                const res = await fetch(
                    `${API_URL}/api/chats/active`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json",
                        },
                    }
                );
                if (res.status === 401 && !retry) {
                    // Try to refresh token
                    const refreshToken = localStorage.getItem("refreshToken");
                    if (!refreshToken) {
                        handleSessionExpiry();
                        return;
                    }
                    try {
                        const refreshRes = await fetch(
                            `${API_URL}/api/auth/refresh-token`,
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ refreshToken: String(refreshToken) }),
                            }
                        );
                        if (!refreshRes.ok) {
                            handleSessionExpiry();
                            return;
                        }
                        const contentType = refreshRes.headers.get("content-type");
                        if (!contentType || !contentType.includes("application/json")) {
                            setError("Unable to connect to server. Please check your connection.");
                            setLoading(false);
                            return;
                        }
                        const refreshData = await refreshRes.json();
                        localStorage.setItem("accessToken", refreshData.accessToken);
                        // Retry fetching chats with new token
                        await fetchChats(true);
                        return;
                    } catch (refreshErr) {
                        handleSessionExpiry();
                        return;
                    }
                }
                if (!res.ok) {
                    throw new Error("Failed to fetch chats");
                }
                const contentType = res.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    throw new Error("Unable to connect to server. Please check your connection.");
                }
                const data = await res.json();

                // Sort chats by last_message_timestamp (newest first)
                const sortedChats = sortChatsByTimestamp(data.chats || []);
                setChats(sortedChats);
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

    // Fetch user profiles for private chats and group images
    useEffect(() => {
        chats.forEach((chat) => {
            if (chat.chat_type === "private" && Array.isArray(chat.members)) {
                const other = chat.members.find((m) => Number(m.user_id) !== Number(userId));
                if (other) {
                    fetchUserProfile(other.user_id);
                }
            } else if (chat.chat_type === "group" && chat.chat_image) {
                fetchChatImage(chat.chat_id, chat.chat_image);
            }
        });
        // eslint-disable-next-line
    }, [chats]);

    const filteredChats = chats.filter((chat) => {
        // Exclude the current chat from forward options
        if (currentChatId && String(chat.chat_id) === String(currentChatId)) {
            return false;
        }

        const searchLower = searchQuery.toLowerCase();
        // If no search query, include the chat
        if (!searchLower) {
            return true;
        }
        // Check chat name
        if ((chat.chat_name || "").toLowerCase().includes(searchLower)) {
            return true;
        }
        // For private chats, also check the other user's name
        if (chat.chat_type === "private" && Array.isArray(chat.members)) {
            const other = chat.members.find((m) => Number(m.user_id) !== Number(userId));
            if (other && other.user) {
                const fullName = other.user.full_name || "";
                const username = other.user.username || "";
                if (fullName.toLowerCase().includes(searchLower) ||
                    username.toLowerCase().includes(searchLower)) {
                    return true;
                }
            }
        }
        return false;
    });

    const toggleSelect = (chatId) => {
        setSelectedChatIds((prev) =>
            prev.includes(chatId)
                ? prev.filter((id) => id !== chatId)
                : [...prev, chatId]
        );
    };

    const handleForward = async () => {
        if (selectedChatIds.length === 0) return;

        setForwarding(true);
        setError(null);
        try {
            const API_URL = (
                import.meta.env.VITE_APP_API_URL || "http://localhost:3001"
            ).replace(/\/+$/, "");
            const token = localStorage.getItem("accessToken");

            const res = await fetch(`${API_URL}/api/messages/forward`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message_id: messageId,
                    chat_ids: selectedChatIds,
                    sender_id: userId,
                }),
            });

            if (res.status === 401) {
                // Try to refresh token
                const refreshToken = localStorage.getItem("refreshToken");
                if (!refreshToken) {
                    handleSessionExpiry();
                    return;
                }
                const refreshRes = await fetch(`${API_URL}/api/auth/refresh-token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ refreshToken: String(refreshToken) }),
                });
                if (!refreshRes.ok) {
                    handleSessionExpiry();
                    return;
                }
                const refreshData = await refreshRes.json();
                localStorage.setItem("accessToken", refreshData.accessToken);
                // Retry forwarding with new token
                return handleForward();
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.message || "Failed to forward message");
            }

            // Call optional callback if provided
            if (onForward) {
                await onForward(selectedChatIds, messageId);
            }
            onClose();
        } catch (err) {
            console.error("Error forwarding message:", err);
            setError(err.message || "Failed to forward message. Please try again.");
        } finally {
            setForwarding(false);
        }
    };

    // Get initials from display name
    const getInitials = (name) => {
        if (!name) return "💬";
        const words = name.trim().split(" ");
        if (words.length >= 2) {
            return (words[0][0] + words[words.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    // Get display info for a chat
    const getChatDisplayInfo = (chat) => {
        let displayName = chat.chat_name;
        let profilePic = null;

        if (chat.chat_type === "private" && Array.isArray(chat.members)) {
            const currentUserId = Number(userId);
            const other = chat.members.find(
                (m) => Number(m.user_id) !== currentUserId
            );

            if (other) {
                if (other.user && other.user.full_name) {
                    displayName = other.user.full_name;
                } else if (other.user && other.user.username) {
                    displayName = other.user.username;
                }
                profilePic = userProfiles[other.user_id];
            }
        } else if (chat.chat_type === "group") {
            profilePic = chatImages[chat.chat_id];
        }

        return { displayName, profilePic };
    };

    return (
        <div className="message-forward-overlay blurred-light" onClick={onClose}>
            <div className="message-forward-modal" onClick={(e) => e.stopPropagation()}>
                <div className="message-forward-header">
                    <h2>Forward Message</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="message-forward-search">
                    <Search size={18} />
                    <input
                        type="text"
                        placeholder="Search chats..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="message-forward-list-wrapper">
                    <SimpleBar style={{ maxHeight: "400px" }}>
                        <div className="message-forward-list">
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
                                    const { displayName, profilePic } = getChatDisplayInfo(chat);
                                    const isSelected = selectedChatIds.includes(chat.chat_id);

                                    return (
                                        <div
                                            key={chat.chat_id}
                                            className={`forward-chat-item ${isSelected ? "selected" : ""}`}
                                            onClick={() => toggleSelect(chat.chat_id)}
                                        >
                                            <label className="checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(chat.chat_id)}
                                                />
                                                <span className="checkmark" />
                                            </label>

                                            <div className="chat-avatar">
                                                {profilePic ? (
                                                    <img
                                                        src={profilePic}
                                                        alt={chat.chat_type === "group" ? "group" : "profile"}
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
                                                <h3 className="chat-name">{displayName}</h3>
                                                <span className="chat-type">
                                                    {chat.chat_type === "group" ? "Group" : "Private"}
                                                </span>
                                            </div>
                                        </div>
                                    );
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

                <div className="message-forward-footer">
                    <span className="selected-count">
                        {selectedChatIds.length} chat{selectedChatIds.length !== 1 ? "s" : ""} selected
                    </span>
                    <button
                        className="forward-btn"
                        onClick={handleForward}
                        disabled={selectedChatIds.length === 0 || forwarding}
                    >
                        {forwarding ? (
                            "Forwarding..."
                        ) : (
                            <>
                                <Send size={16} />
                                Forward
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MessageForward;