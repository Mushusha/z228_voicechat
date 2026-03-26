#include "infrastructure/MemoryChatRepository.h"

#include <algorithm>

namespace lvchat::infrastructure {

domain::ChatMessage MemoryChatRepository::saveMessage(const domain::ChatMessage& message) {
  std::scoped_lock lock(mutex_);
  domain::ChatMessage row = message;
  row.id = nextId();
  messages_.push_back(row);
  return row;
}

std::vector<domain::ChatMessage> MemoryChatRepository::getRecentMessages(std::size_t limit) {
  std::scoped_lock lock(mutex_);
  if (limit >= messages_.size()) {
    return messages_;
  }
  return std::vector<domain::ChatMessage>(messages_.end() - static_cast<long long>(limit), messages_.end());
}

std::optional<domain::ChatMessage> MemoryChatRepository::findById(const std::string& id) {
  std::scoped_lock lock(mutex_);
  const auto it = std::find_if(messages_.begin(), messages_.end(), [&](const domain::ChatMessage& m) {
    return m.id == id;
  });
  if (it == messages_.end()) {
    return std::nullopt;
  }
  return *it;
}

bool MemoryChatRepository::updateMessageText(const std::string& id, const std::string& text) {
  std::scoped_lock lock(mutex_);
  for (auto& message : messages_) {
    if (message.id == id) {
      message.text = text;
      return true;
    }
  }
  return false;
}

bool MemoryChatRepository::deleteMessage(const std::string& id) {
  std::scoped_lock lock(mutex_);
  const auto it = std::remove_if(messages_.begin(), messages_.end(), [&](const domain::ChatMessage& m) {
    return m.id == id;
  });
  if (it == messages_.end()) {
    return false;
  }
  messages_.erase(it, messages_.end());
  return true;
}

bool MemoryChatRepository::setReaction(
    const std::string& id,
    const std::string& emoji,
    const std::string& nickname) {
  std::scoped_lock lock(mutex_);
  for (auto& message : messages_) {
    if (message.id != id) {
      continue;
    }
    auto& users = message.reactions[emoji];
    const auto it = std::find(users.begin(), users.end(), nickname);
    if (it == users.end()) {
      users.push_back(nickname);
      return true;
    }
    users.erase(it);
    if (users.empty()) {
      message.reactions.erase(emoji);
    }
    return true;
  }
  return false;
}

std::string MemoryChatRepository::nextId() {
  return std::to_string(nextSeq_++);
}

}  // namespace lvchat::infrastructure
