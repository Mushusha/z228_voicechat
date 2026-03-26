#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "infrastructure/IChatRepository.h"

namespace lvchat::infrastructure {

class MemoryChatRepository final : public IChatRepository {
 public:
  domain::ChatMessage saveMessage(const domain::ChatMessage& message) override;
  std::vector<domain::ChatMessage> getRecentMessages(std::size_t limit) override;
  std::optional<domain::ChatMessage> findById(const std::string& id) override;
  bool updateMessageText(const std::string& id, const std::string& text) override;
  bool deleteMessage(const std::string& id) override;
  bool setReaction(const std::string& id, const std::string& emoji, const std::string& nickname) override;

 private:
  std::string nextId();

  std::mutex mutex_;
  std::vector<domain::ChatMessage> messages_;
  std::size_t nextSeq_{1};
};

}  // namespace lvchat::infrastructure
