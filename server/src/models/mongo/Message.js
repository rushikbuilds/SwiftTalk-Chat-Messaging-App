const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
  attachment_id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  file_url: { type: String, required: true },
  original_filename: { type: String, default: null },
  file_type: { type: String, default: null },
  file_size: { type: Number, default: 0 },
  uploaded_at: { type: Date, default: Date.now }
}, { _id: false });

const MessageStatusSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  updated_at: { type: Date, default: Date.now }
}, { _id: false });

const MessageVisibilitySchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  is_visible: { type: Boolean, default: true },
  hidden_at: { type: Date, default: null }
}, { _id: false });

const SenderSnapshotSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  username: { type: String, default: '' },
  full_name: { type: String, default: '' },
  profile_pic: { type: String, default: null }
}, { _id: false });

const ReferencedMessageSchema = new mongoose.Schema({
  message_id: { type: String, default: null },
  message_text: { type: String, default: '' },
  is_reply: { type: Boolean, default: false },
  sender: {
    user_id: { type: Number },
    username: { type: String, default: '' },
    full_name: { type: String, default: '' }
  }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  message_id: {
    type: String,
    index: true,
    default: function () {
      return this._id ? this._id.toString() : new mongoose.Types.ObjectId().toString();
    }
  },
  chat_id: { type: String, required: true, index: true },
  sender_id: { type: Number, required: true, index: true },
  sender: { type: SenderSnapshotSchema, default: null },
  message_text: { type: String, default: '' },
  message_type: { type: String, default: 'text' },
  is_reply: { type: Boolean, default: false },
  is_forward: { type: Boolean, default: false },
  referenced_message_id: { type: String, default: null },
  referenced_message: { type: ReferencedMessageSchema, default: null },
  attachments: [AttachmentSchema],
  status: [MessageStatusSchema],
  deleted_for: [{ type: Number }], // Soft deletion user_ids
  visibility: [MessageVisibilitySchema],
  updated: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Ensure message_id is populated from _id if not provided
MessageSchema.pre('save', function () {
  if (!this.message_id && this._id) {
    this.message_id = this._id.toString();
  }
});

// Indexes for pagination and visibility
MessageSchema.index({ chat_id: 1, created_at: -1 });
MessageSchema.index({ chat_id: 1, deleted_for: 1, created_at: -1 });
MessageSchema.index({ "status.user_id": 1, "status.status": 1 });

// Static helper to query by message_id or ObjectId seamlessly
MessageSchema.statics.findByMessageId = function (id) {
  if (!id) return null;
  const idStr = String(id);
  const conditions = [{ message_id: idStr }];
  if (mongoose.isValidObjectId(idStr)) {
    conditions.push({ _id: idStr });
  }
  return this.findOne({ $or: conditions });
};

const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

module.exports = Message;
