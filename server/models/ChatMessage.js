const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    nickname: { type: String, required: true, maxlength: 30 },
    text: { type: String, maxlength: 500, default: "" },
    imageMime: { type: String, maxlength: 40 },
    imageData: { type: String, maxlength: 3_500_000 },
  },
  { timestamps: true }
);

chatMessageSchema.index({ createdAt: 1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
