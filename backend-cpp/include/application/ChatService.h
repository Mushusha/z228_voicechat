#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "domain/ChatMessage.h"
#include "infrastructure/IChatRepository.h"

namespace lvchat::application {

class ChatService {
 public:
  explicit ChatService(std::shared_ptr<infrastructure::IChatRepository> repository);

  domain::ChatMessage createMessage(
      const std::string& nickname,
      const std::string& text,
      const std::string& imageMime,
      const std::string& imageData);

  std::optional<domain::ChatMessage> getMessageById(const std::string& messageId) const;
  std::vector<domain::ChatMessage> history(std::size_t limit) const;
  bool editMessage(const std::string& messageId, const std::string& actor, const std::string& text);
  bool deleteMessage(const std::string& messageId, const std::string& actor);
  bool react(const std::string& messageId, const std::string& actor, const std::string& emoji);

 private:
  std::shared_ptr<infrastructure::IChatRepository> repository_;
};

}  // namespace lvchat::application
