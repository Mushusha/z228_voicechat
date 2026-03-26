#include "application/ChatService.h"

#include <chrono>
#include <stdexcept>

namespace lvchat::application {

ChatService::ChatService(std::shared_ptr<infrastructure::IChatRepository> repository)
    : repository_(std::move(repository)) {
  if (!repository_) {
    throw std::invalid_argument("ChatService requires a repository");
  }
}

domain::ChatMessage ChatService::createMessage(
    const std::string& nickname,
    const std::string& text,
    const std::string& imageMime,
    const std::string& imageData) {
  domain::ChatMessage message{};
  message.nickname = nickname;
  message.text = text;
  message.imageMime = imageMime;
  message.imageData = imageData;
  message.createdAt = std::chrono::system_clock::now();
  return repository_->saveMessage(message);
}

std::optional<domain::ChatMessage> ChatService::getMessageById(const std::string& messageId) const {
  return repository_->findById(messageId);
}

std::vector<domain::ChatMessage> ChatService::history(std::size_t limit) const {
  return repository_->getRecentMessages(limit);
}

bool ChatService::editMessage(const std::string& messageId, const std::string& actor, const std::string& text) {
  const auto message = repository_->findById(messageId);
  if (!message.has_value() || message->nickname != actor) {
    return false;
  }
  return repository_->updateMessageText(messageId, text);
}

bool ChatService::deleteMessage(const std::string& messageId, const std::string& actor) {
  const auto message = repository_->findById(messageId);
  if (!message.has_value() || message->nickname != actor) {
    return false;
  }
  return repository_->deleteMessage(messageId);
}

bool ChatService::react(const std::string& messageId, const std::string& actor, const std::string& emoji) {
  if (emoji.empty() || emoji.size() > 16U) {
    return false;
  }
  return repository_->setReaction(messageId, emoji, actor);
}

}  // namespace lvchat::application
