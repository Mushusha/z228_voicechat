#pragma once

#include <optional>
#include <string>
#include <vector>

#include "domain/ChatMessage.h"

namespace lvchat::infrastructure {

class IChatRepository {
 public:
  virtual ~IChatRepository() = default;

  virtual domain::ChatMessage saveMessage(const domain::ChatMessage& message) = 0;
  virtual std::vector<domain::ChatMessage> getRecentMessages(std::size_t limit) = 0;
  virtual std::optional<domain::ChatMessage> findById(const std::string& id) = 0;
  virtual bool updateMessageText(const std::string& id, const std::string& text) = 0;
  virtual bool deleteMessage(const std::string& id) = 0;
  virtual bool setReaction(
      const std::string& id,
      const std::string& emoji,
      const std::string& nickname) = 0;
};

}  // namespace lvchat::infrastructure
