const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    channel: { type: String, maxlength: 32, default: "general" },
    nickname: { type: String, required: true, maxlength: 30 },
    text: { type: String, maxlength: 500, default: "" },
    imageMime: { type: String, maxlength: 40 },
    imageData: { type: String, maxlength: 3_500_000 },
    /** { "👍": ["nick1", "nick2"], … } */
    reactions: { type: Object, default: {} },
  },
  { timestamps: true }
);

chatMessageSchema.index({ channel: 1, createdAt: -1 });
chatMessageSchema.index({ createdAt: 1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
