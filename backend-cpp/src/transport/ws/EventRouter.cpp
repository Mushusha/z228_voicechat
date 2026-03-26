#include "transport/ws/EventRouter.h"

#include <cctype>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <optional>
#include <sstream>
#include <unordered_set>

namespace lvchat::transport::ws {

namespace {

void pushSelf(RouteResult& result, std::string payload) {
  result.events.push_back(OutgoingEvent{
      .scope = OutgoingEvent::Scope::Self,
      .targetSessionId = "",
      .payloadJson = std::move(payload)});
}

void pushBroadcast(RouteResult& result, std::string payload) {
  result.events.push_back(OutgoingEvent{
      .scope = OutgoingEvent::Scope::Broadcast,
      .targetSessionId = "",
      .payloadJson = std::move(payload)});
}

void pushTarget(RouteResult& result, std::string targetSessionId, std::string payload) {
  result.events.push_back(OutgoingEvent{
      .scope = OutgoingEvent::Scope::TargetSession,
      .targetSessionId = std::move(targetSessionId),
      .payloadJson = std::move(payload)});
}

std::string jsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  for (char c : value) {
    if (c == '\\' || c == '"') {
      out.push_back('\\');
    }
    out.push_back(c);
  }
  return out;
}

bool isServerOnlyMessageType(const std::string& type) {
  static const std::unordered_set<std::string> blocked = {
      "hello",
      "chat-history",
      "chat-message",
      "join-accepted",
      "join-rejected",
      "peer-joined",
      "peer-left",
      "signal-error",
      "error",
      "kicked",
      "admin-verify-ok",
      "admin-peers-result",
      "chat-message-updated",
      "chat-message-deleted",
      "chat-message-reactions"};
  return blocked.contains(type);
}

std::string isoUtc(const std::chrono::system_clock::time_point& tp) {
  const std::time_t t = std::chrono::system_clock::to_time_t(tp);
  std::tm tmUtc{};
#if defined(_WIN32)
  gmtime_s(&tmUtc, &t);
#else
  gmtime_r(&t, &tmUtc);
#endif
  std::ostringstream out;
  out << std::put_time(&tmUtc, "%Y-%m-%dT%H:%M:%SZ");
  return out.str();
}

std::string serializeMessageForEvent(const domain::ChatMessage& msg) {
  std::ostringstream out;
  out << "{\"id\":\"" << jsonEscape(msg.id) << "\",\"nickname\":\"" << jsonEscape(msg.nickname)
      << "\",\"text\":\"" << jsonEscape(msg.text) << "\",\"createdAt\":\"" << isoUtc(msg.createdAt)
      << "\"";
  if (!msg.imageMime.empty() && !msg.imageData.empty()) {
    out << ",\"imageMime\":\"" << jsonEscape(msg.imageMime) << "\",\"imageData\":\""
        << jsonEscape(msg.imageData) << "\"";
  }
  out << ",\"reactions\":{";
  bool firstEmoji = true;
  for (const auto& [emoji, users] : msg.reactions) {
    if (!firstEmoji) {
      out << ",";
    }
    firstEmoji = false;
    out << "\"" << jsonEscape(emoji) << "\":[";
    for (std::size_t i = 0; i < users.size(); ++i) {
      if (i > 0U) {
        out << ",";
      }
      out << "\"" << jsonEscape(users[i]) << "\"";
    }
    out << "]";
  }
  out << "}}";
  return out.str();
}

}  // namespace

EventRouter::EventRouter(
    application::ChatService& chatService,
    application::RoomService& roomService,
    application::SignalingService& signalingService,
    std::string adminSecret)
    : chatService_(chatService),
      roomService_(roomService),
      signalingService_(signalingService),
      adminSecret_(std::move(adminSecret)) {}

RouteResult EventRouter::route(const std::string& sessionId, const std::string& rawJson) const {
  RouteResult result;
  const std::string type = normalizeType(extractString(rawJson, "type"));
  if (type.empty()) {
    return result;
  }
  if (isServerOnlyMessageType(type)) {
    return result;
  }

  if (type == "join") {
    const auto join = roomService_.join(sessionId, extractString(rawJson, "nickname"));
    if (!join.ok) {
      pushSelf(result, "{\"type\":\"join-rejected\",\"reason\":\"" + escapeJson(join.reason) + "\"}");
      return result;
    }
    std::ostringstream peers;
    peers << "[";
    for (std::size_t i = 0; i < join.peers.size(); ++i) {
      if (i > 0U) {
        peers << ",";
      }
      peers << "\"" << escapeJson(join.peers[i]) << "\"";
    }
    peers << "]";
    pushSelf(
        result,
        "{\"type\":\"join-accepted\",\"nickname\":\"" + escapeJson(join.nickname) + "\",\"peers\":" + peers.str() + "}");
    for (const auto& peerNickname : join.peers) {
      const auto peerSession = roomService_.sessionForNickname(peerNickname);
      if (peerSession.has_value()) {
        pushTarget(result, *peerSession, "{\"type\":\"peer-joined\",\"nickname\":\"" + escapeJson(join.nickname) + "\"}");
      }
    }

    std::ostringstream out;
    out << "{\"type\":\"chat-history\",\"messages\":[";
    const auto history = chatService_.history(100);
    for (std::size_t i = 0; i < history.size(); ++i) {
      if (i > 0U) {
        out << ",";
      }
      out << serializeMessageForEvent(history[i]);
    }
    out << "]}";
    pushSelf(result, out.str());
    return result;
  }

  if (!roomService_.ensureJoined(sessionId)) {
    pushSelf(result, "{\"type\":\"error\",\"message\":\"Join before signaling.\"}");
    return result;
  }

  if (type == "chat") {
    const std::string nickname = roomService_.nicknameFor(sessionId);
    std::string text = extractString(rawJson, "text");
    if (text.size() > 500U) {
      text.resize(500U);
    }
    if (text.empty()) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Пустое сообщение.\"}");
      return result;
    }
    const auto msg = chatService_.createMessage(nickname, text, "", "");
    pushBroadcast(result, "{\"type\":\"chat-message\"," + serializeMessageForEvent(msg).substr(1));
    return result;
  }

  if (type == "chat-edit") {
    const std::string id = extractString(rawJson, "id");
    std::string text = extractString(rawJson, "text");
    if (text.size() > 500U) {
      text.resize(500U);
    }
    if (id.empty()) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Нет id сообщения.\"}");
      return result;
    }
    const auto ok = chatService_.editMessage(
        id,
        roomService_.nicknameFor(sessionId),
        text);
    if (ok) {
      const auto updated = chatService_.getMessageById(id);
      if (updated.has_value()) {
        pushBroadcast(result, "{\"type\":\"chat-message-updated\"," + serializeMessageForEvent(*updated).substr(1));
      } else {
        pushBroadcast(result, "{\"type\":\"chat-message-updated\",\"id\":\"" + escapeJson(id) + "\"}");
      }
    } else {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Сообщение не найдено.\"}");
    }
    return result;
  }

  if (type == "chat-delete") {
    const std::string id = extractString(rawJson, "id");
    if (id.empty()) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Нет id сообщения.\"}");
      return result;
    }
    const auto ok = chatService_.deleteMessage(
        id, roomService_.nicknameFor(sessionId));
    if (ok) {
      pushBroadcast(result, "{\"type\":\"chat-message-deleted\",\"id\":\"" + escapeJson(id) + "\"}");
    } else {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Сообщение не найдено.\"}");
    }
    return result;
  }

  if (type == "chat-react") {
    const std::string id = extractString(rawJson, "id");
    const std::string emoji = extractString(rawJson, "emoji");
    if (id.empty() || emoji.empty()) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Нужны id сообщения и реакция.\"}");
      return result;
    }
    const auto ok = chatService_.react(
        id,
        roomService_.nicknameFor(sessionId),
        emoji);
    if (ok) {
      const auto updated = chatService_.getMessageById(id);
      if (updated.has_value()) {
        std::ostringstream payload;
        payload << "{\"type\":\"chat-message-reactions\",\"id\":\"" << escapeJson(id) << "\",\"reactions\":{";
        bool firstEmoji = true;
        for (const auto& [emoji, users] : updated->reactions) {
          if (!firstEmoji) {
            payload << ",";
          }
          firstEmoji = false;
          payload << "\"" << escapeJson(emoji) << "\":[";
          for (std::size_t i = 0; i < users.size(); ++i) {
            if (i > 0U) {
              payload << ",";
            }
            payload << "\"" << escapeJson(users[i]) << "\"";
          }
          payload << "]";
        }
        payload << "}}";
        pushBroadcast(result, payload.str());
      } else {
        pushBroadcast(result, "{\"type\":\"chat-message-reactions\",\"id\":\"" + escapeJson(id) + "\",\"reactions\":{}}");
      }
    } else {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Сообщение не найдено.\"}");
    }
    return result;
  }

  if (type == "signal") {
    const std::string targetNick = extractString(rawJson, "target");
    if (targetNick.empty()) {
      pushSelf(result, "{\"type\":\"signal-error\",\"target\":\"\",\"reason\":\"Target not found.\"}");
      return result;
    }
    const std::optional<std::string> targetSession = roomService_.sessionForNickname(targetNick);
    if (!targetSession.has_value()) {
      pushSelf(
          result,
          "{\"type\":\"signal-error\",\"target\":\"" + escapeJson(targetNick) + "\",\"reason\":\"Target not found.\"}");
      return result;
    }
    const auto relay = signalingService_.buildRelayEvent(
        roomService_.nicknameFor(sessionId),
        targetNick,
        extractRawValue(rawJson, "payload"));
    pushTarget(result, *targetSession, relay);
    return result;
  }

  if (type == "admin-verify") {
    const auto secret = extractString(rawJson, "secret");
    if (secret != adminSecret_) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Неверный пароль.\"}");
      return result;
    }
    pushSelf(result, "{\"type\":\"admin-verify-ok\"}");
    return result;
  }

  if (type == "admin-peers") {
    const auto secret = extractString(rawJson, "secret");
    if (secret != adminSecret_) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Неверный пароль админ-панели.\"}");
      return result;
    }
    const auto peers = roomService_.adminPeers();
    std::ostringstream out;
    out << "{\"type\":\"admin-peers-result\",\"peers\":[";
    for (std::size_t i = 0; i < peers.size(); ++i) {
      if (i > 0U) {
        out << ",";
      }
      out << "\"" << escapeJson(peers[i]) << "\"";
    }
    out << "]}";
    pushSelf(result, out.str());
    return result;
  }

  if (type == "admin-kick") {
    const auto secret = extractString(rawJson, "secret");
    if (secret != adminSecret_) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Неверный пароль админ-панели.\"}");
      return result;
    }
    const std::string targetNick = extractString(rawJson, "target");
    if (targetNick.empty()) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Укажите ник участника.\"}");
      return result;
    }
    const auto kickResult = roomService_.adminKick(targetNick);
    if (!kickResult.ok) {
      pushSelf(result, "{\"type\":\"error\",\"message\":\"Участник не в комнате.\"}");
      return result;
    }
    const std::string operatorNick = roomService_.nicknameFor(sessionId);
    pushTarget(
        result,
        kickResult.kickedSessionId,
        "{\"type\":\"kicked\",\"reason\":\"Вас исключили из комнаты (оператор: " + escapeJson(operatorNick) + ").\"}");
    pushBroadcast(result, "{\"type\":\"peer-left\",\"nickname\":\"" + escapeJson(kickResult.kickedNickname) + "\"}");
    return result;
  }

  pushSelf(result, "{\"type\":\"error\",\"message\":\"Unknown message type: " + escapeJson(type) + "\"}");
  return result;
}

RouteResult EventRouter::onDisconnect(const std::string& sessionId) const {
  RouteResult result;
  const std::string nickname = roomService_.nicknameFor(sessionId);
  if (nickname.empty()) {
    return result;
  }
  roomService_.leave(sessionId);
  pushBroadcast(result, "{\"type\":\"peer-left\",\"nickname\":\"" + escapeJson(nickname) + "\"}");
  return result;
}

std::string EventRouter::extractString(const std::string& rawJson, const std::string& key) {
  const std::string pattern = "\"" + key + "\"";
  const std::size_t keyPos = rawJson.find(pattern);
  if (keyPos == std::string::npos) {
    return "";
  }
  const std::size_t colonPos = rawJson.find(':', keyPos + pattern.size());
  if (colonPos == std::string::npos) {
    return "";
  }
  const std::size_t quoteStart = rawJson.find('"', colonPos + 1U);
  if (quoteStart == std::string::npos) {
    return "";
  }
  std::size_t quoteEnd = quoteStart + 1U;
  while (quoteEnd < rawJson.size()) {
    if (rawJson[quoteEnd] == '"' && rawJson[quoteEnd - 1U] != '\\') {
      break;
    }
    ++quoteEnd;
  }
  if (quoteEnd == std::string::npos || quoteEnd <= quoteStart) {
    return "";
  }
  return rawJson.substr(quoteStart + 1U, quoteEnd - quoteStart - 1U);
}

std::string EventRouter::extractRawValue(const std::string& rawJson, const std::string& key) {
  const std::string pattern = "\"" + key + "\"";
  const std::size_t keyPos = rawJson.find(pattern);
  if (keyPos == std::string::npos) {
    return "null";
  }
  const std::size_t colonPos = rawJson.find(':', keyPos + pattern.size());
  if (colonPos == std::string::npos) {
    return "null";
  }
  std::size_t start = colonPos + 1U;
  while (start < rawJson.size() && std::isspace(static_cast<unsigned char>(rawJson[start]))) {
    ++start;
  }
  if (start >= rawJson.size()) {
    return "null";
  }
  if (rawJson[start] == '{') {
    int depth = 0;
    for (std::size_t i = start; i < rawJson.size(); ++i) {
      if (rawJson[i] == '{') {
        ++depth;
      } else if (rawJson[i] == '}') {
        --depth;
        if (depth == 0) {
          return rawJson.substr(start, i - start + 1U);
        }
      }
    }
  }
  if (rawJson[start] == '"') {
    std::size_t end = start + 1U;
    while (end < rawJson.size()) {
      if (rawJson[end] == '"' && rawJson[end - 1U] != '\\') {
        return rawJson.substr(start, end - start + 1U);
      }
      ++end;
    }
  }
  std::size_t end = start;
  while (end < rawJson.size() && rawJson[end] != ',' && rawJson[end] != '}') {
    ++end;
  }
  return rawJson.substr(start, end - start);
}

std::string EventRouter::escapeJson(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  for (char c : value) {
    if (c == '\\' || c == '"') {
      out.push_back('\\');
    }
    out.push_back(c);
  }
  return out;
}

std::string EventRouter::normalizeType(const std::string& rawType) {
  auto isAsciiSpace = [](char ch) {
    return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\f' || ch == '\v';
  };
  std::size_t start = 0;
  while (start < rawType.size() && isAsciiSpace(rawType[start])) {
    ++start;
  }
  std::size_t end = rawType.size();
  while (end > start && isAsciiSpace(rawType[end - 1U])) {
    --end;
  }
  std::string s;
  s.reserve(end - start);
  for (std::size_t i = start; i < end; ++i) {
    const char c = rawType[i];
    if (c == '_') {
      s.push_back('-');
      continue;
    }
    s.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  }
  return s;
}

}  // namespace lvchat::transport::ws
