import { io } from "socket.io-client";

// Ensure the configured socket URL does not end with a slash to avoid `//` when joining paths
const SOCKET_URL = (
  import.meta.env.VITE_APP_SOCKET_URL || "http://localhost:3002"
).replace(/\/+$/, "");

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.userId = null;
    this.uploadProgressCallbacks = new Map(); // Track upload progress callbacks per tempId
  }

  connect(userId) {
    // If already connected with the same user, return existing socket
    if (this.socket && this.isConnected && this.userId === userId) {
      return this.socket;
    }

    // If connecting with a different user, disconnect first
    if (this.socket && this.userId && this.userId !== userId) {
      this.disconnect();
    }

    this.userId = userId;
    const token = localStorage.getItem("accessToken");

    this.socket = io(SOCKET_URL, {
      auth: {
        token,
        userId,
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on("connect", () => {
      this.isConnected = true;
    });

    this.socket.on("disconnect", () => {
      this.isConnected = false;
    });

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      this.isConnected = false;
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.userId = null;
    }
  }

  // Join a chat room
  joinChat(chatId) {
    if (this.socket && this.isConnected) {
      const normalizedChatId = chatId != null ? String(chatId) : chatId;
      this.socket.emit("join_chat", { chat_id: normalizedChatId, chatId: normalizedChatId });
    } else {
      console.warn("⚠️ Cannot join chat - socket not connected");
    }
  }

  // Leave a chat room
  leaveChat(chatId) {
    if (this.socket && this.isConnected) {
      const normalizedChatId = chatId != null ? String(chatId) : chatId;
      this.socket.emit("leave_chat", { chat_id: normalizedChatId, chatId: normalizedChatId });
    }
  }

  // Send a text message
  sendMessage(messageData) {
    if (this.socket && this.isConnected) {
      const dataToSend = {
        ...messageData,
        chat_id: messageData.chat_id != null ? String(messageData.chat_id) : messageData.chat_id,
        tempId: messageData.tempId, // Ensure tempId is always passed
      };

      // Use acknowledgment to ensure server received and saved the message
      this.socket.emit("send_message", dataToSend, (response) => {
        if (!response || !response.success) {
          console.error(
            "Server failed to save message:",
            response?.error || "Unknown error"
          );
        }
      });
    } else {
      console.error("Cannot send message - socket not connected");
    }
  }

  // Send a message with file attachment via WebSocket using chunking for large files
  sendFileMessage(fileMessageData, onProgress) {
    if (this.socket && this.isConnected) {
      const {
        fileBuffer,
        tempId,
      } = fileMessageData;

      // Store progress callback for this upload
      if (onProgress && tempId) {
        this.uploadProgressCallbacks.set(tempId, onProgress);
      }

      // Check if file is too large for single message (>3MB after base64 encoding ~4MB)
      // Use chunking for files larger than 3MB to avoid WebSocket buffer limits
      const CHUNK_THRESHOLD = 3 * 1024 * 1024; // 3MB threshold (base64 string length)

      if (fileBuffer && fileBuffer.length > CHUNK_THRESHOLD) {
        this._sendFileMessageInChunks(fileMessageData, onProgress);
      } else {
        // For small files, report progress immediately
        if (onProgress) {
          onProgress(50); // Start at 50% (reading done, sending)
        }
        
        // Use acknowledgment to ensure server received and saved the message
        this.socket.emit("send_file_message", fileMessageData, (response) => {
          if (response && response.success) {
            if (onProgress) {
              onProgress(100); // Complete
            }
            this.uploadProgressCallbacks.delete(tempId);
          } else {
            console.error(
              "❌ Server failed to save file message:",
              response?.error || "Unknown error"
            );
            this.uploadProgressCallbacks.delete(tempId);
          }
        });
      }
    } else {
      console.error("Cannot send file message - socket not connected");
    }
  }

  // Helper method to send large files in chunks
  _sendFileMessageInChunks(fileMessageData, onProgress) {
    const {
      fileBuffer,
      chat_id,
      fileName,
      fileSize,
      fileType,
      message_text,
      tempId,
    } = fileMessageData;
    
    // Use 1MB chunks for reliable transmission
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
    const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);
    
    // Send chunks sequentially to avoid overwhelming the socket
    const sendChunk = (chunkIndex) => {
      const startIdx = chunkIndex * CHUNK_SIZE;
      const endIdx = Math.min(startIdx + CHUNK_SIZE, fileBuffer.length);
      const chunk = fileBuffer.substring(startIdx, endIdx);
      const isFirstChunk = chunkIndex === 0;
      const isLastChunk = chunkIndex === totalChunks - 1;

      const chunkPayload = {
        tempId,
        chunk, // Server expects 'chunk' property
        chunkIndex,
        totalChunks,
        isFirstChunk,
        isLastChunk,
      };

      // Include metadata only on first chunk
      if (isFirstChunk) {
        chunkPayload.chat_id = chat_id;
        chunkPayload.fileName = fileName;
        chunkPayload.fileSize = fileSize;
        chunkPayload.fileType = fileType;
        chunkPayload.message_text = message_text;
      }

      this.socket.emit("send_file_message_chunk", chunkPayload, (response) => {
        if (response && response.success) {
          // Calculate and report progress (reserve last 5% for server processing)
          const progress = Math.min(95, Math.round(((chunkIndex + 1) / totalChunks) * 95));
          if (onProgress) {
            onProgress(progress);
          }
          
          // Send next chunk if not last
          if (!isLastChunk) {
            // Small delay between chunks to prevent overwhelming
            setTimeout(() => sendChunk(chunkIndex + 1), 50);
          } else {
            // Last chunk sent, wait for server confirmation
            // Progress will be set to 100 when file_upload_success is received
          }
        } else {
          console.error(`❌ Chunk ${chunkIndex + 1} failed:`, response?.error);
          this.uploadProgressCallbacks.delete(tempId);
        }
      });
    };

    // Start sending from first chunk
    sendChunk(0);
  }

  // Listen for new messages
  onNewMessage(callback) {
    if (this.socket) {
      this.socket.on("new_message", callback);
    }
  }

  deleteMessageForAll(messageId) {
    if (this.socket && this.isConnected) {
      this.socket.emit("delete_message_for_all", {
        message_id: messageId,
      });
    } else {
      console.warn("⚠️ Cannot delete message - socket not connected");
    }
  }

  // Listen for message status updates
  onMessageStatusUpdate(callback) {
    if (this.socket) {
      this.socket.on("message_status_update", callback);
    }
  }

  // Listen for typing indicators
  onUserTyping(callback) {
    if (this.socket) {
      this.socket.on("user_typing", callback);
    }
  }

  onUserStoppedTyping(callback) {
    if (this.socket) {
      this.socket.on("user_stopped_typing", callback);
    }
  }

  // Send typing indicator
  sendTyping(chatId, userId) {
    if (this.socket && this.isConnected) {
      this.socket.emit("typing_start", { chat_id: chatId, user_id: userId });
    } else {
      console.warn("[SOCKET ERROR] Cannot send typing - socket not connected");
    }
  }

  sendStoppedTyping(chatId, userId) {
    if (this.socket && this.isConnected) {
      this.socket.emit("typing_stop", { chat_id: chatId, user_id: userId });
    } else {
      console.warn(
        "[SOCKET ERROR] Cannot send stopped_typing - socket not connected"
      );
    }
  }

  // Listen for user online status
  onUserOnlineStatus(callback) {
    if (this.socket) {
      this.socket.on("user_online_status", callback);
    }
  }

  // Listen for user online event
  onUserOnline(callback) {
    if (this.socket) {
      this.socket.on("user_online", callback);
    }
  }

  // Listen for user offline event
  onUserOffline(callback) {
    if (this.socket) {
      this.socket.on("user_offline", callback);
    }
  }

  // Listen for being added to a group
  onAddedToGroup(callback) {
    if (this.socket) {
      this.socket.on("you_were_added_to_group", callback);
    }
  }

  // Listen for being removed from a group
  onRemovedFromGroup(callback) {
    if (this.socket) {
      this.socket.on("you_were_removed_from_group", callback);
    }
  }

  // Listen for file upload success
  onFileUploadSuccess(callback) {
    if (this.socket) {
      this.socket.on("file_upload_success", (data) => {
        // Mark progress as 100% for the completed upload
        const progressCallback = this.uploadProgressCallbacks.get(data.tempId);
        if (progressCallback) {
          progressCallback(100);
          this.uploadProgressCallbacks.delete(data.tempId);
        }
        callback(data);
      });
    }
  }

  // Get upload progress callback for a specific tempId
  getUploadProgressCallback(tempId) {
    return this.uploadProgressCallbacks.get(tempId);
  }

  // Clear upload progress callback
  clearUploadProgressCallback(tempId) {
    this.uploadProgressCallbacks.delete(tempId);
  }

  // Mark message as read
  markMessageAsRead(messageId, userId) {
    if (this.socket && this.isConnected) {
      this.socket.emit("mark_read", { messageId, userId });
    }
  }

  // Update message status (delivered/read)
  updateMessageStatus(messageId, status) {
    if (this.socket && this.isConnected) {
      this.socket.emit("update_message_status", {
        message_id: messageId,
        status: status,
      });
    } else {
      console.warn(
        "[SOCKET ERROR] Cannot update message status - socket not connected"
      );
    }
  }

  // Update/edit message
  updateMessage(messageData) {
    if (this.socket && this.isConnected) {
      this.socket.emit("update_message", {
        message_id: messageData.message_id,
        message_text: messageData.message_text
      });
    } else {
      console.warn(
        "[SOCKET ERROR] Cannot update message - socket not connected"
      );
    }
  }

  // Remove specific event listener
  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  // Remove all listeners for an event
  removeAllListeners(event) {
    if (this.socket) {
      this.socket.removeAllListeners(event);
    }
  }

  getSocket() {
    return this.socket;
  }

  isSocketConnected() {
    return this.isConnected && this.socket?.connected;
  }
}

// Export a singleton instance
const socketService = new SocketService();
export default socketService;
