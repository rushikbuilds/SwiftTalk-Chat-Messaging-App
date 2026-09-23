const mongoose = require('mongoose');

const ChatMemberSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  joined_at: { type: Date, default: Date.now },
  is_visible: { type: Boolean, default: true },
  is_archived: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  hidden_at: { type: Date, default: null },
  archived_at: { type: Date, default: null }
}, { _id: false });

const LastMessageSchema = new mongoose.Schema({
  message_id: { type: String, default: null },
  sender_id: { type: Number, default: null },
  message_text: { type: String, default: '' },
  message_type: { type: String, default: 'text' },
  created_at: { type: Date, default: Date.now }
}, { _id: false });

const ChatSchema = new mongoose.Schema({
  chat_id: {
    type: String,
    index: true,
    default: function () {
      return this._id ? this._id.toString() : new mongoose.Types.ObjectId().toString();
    }
  },
  chat_type: { type: String, enum: ['private', 'group'], required: true },
  chat_name: { type: String, default: null },
  chat_image: { type: String, default: null },
  description: { type: String, default: null },
  created_by: { type: Number, default: null },
  private_chat_key: { type: String, default: null, index: true },
  members: [ChatMemberSchema],
  last_message: { type: LastMessageSchema, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Ensure chat_id is populated from _id if not explicitly provided
ChatSchema.pre('save', function () {
  if (!this.chat_id && this._id) {
    this.chat_id = this._id.toString();
  }
});

// Indexes for high performance
ChatSchema.index({ "members.user_id": 1, updated_at: -1 });
ChatSchema.index({ chat_type: 1, private_chat_key: 1 }, { unique: true, sparse: true });

// Static helper to query by chat_id or ObjectId seamlessly
ChatSchema.statics.findByChatId = function (id) {
  if (!id) return null;
  const idStr = String(id);
  const conditions = [{ chat_id: idStr }];
  if (mongoose.isValidObjectId(idStr)) {
    conditions.push({ _id: idStr });
  }
  return this.findOne({ $or: conditions });
};

const Chat = mongoose.models.Chat || mongoose.model('Chat', ChatSchema);

module.exports = Chat;
