package com.tasksphere.core.controller;

import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.service.ChatService;
import com.tasksphere.core.service.RedisCacheService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

@RestController
@RequestMapping("/api/chat-messages")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    @Autowired
    private ChatService chatService;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private com.tasksphere.core.repository.UserSessionRepository userSessionRepository;

    @Autowired
    private org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;

    /**
     * Retrieve the recent 50 chat messages from the cache or database.
     */
    @GetMapping
    public ResponseEntity<List<ChatMessage>> getRecentChatHistory() {
        // Try reading from high-speed cache first
        List<ChatMessage> cached = redisCacheService.getCachedChatHistory();
        if (cached != null) {
            System.out.println("[CHAT-CACHE-HIT] Served recent chat history directly from Redis Cache.");
            return ResponseEntity.ok(cached);
        }

        System.out.println("[CHAT-CACHE-MISS] Cold history cache. Accessing database context...");
        List<ChatMessage> messages = chatService.getRecentMessages();
        
        // Populate cache for subsequent hits
        if (messages != null) {
            // Invalidate first to ensure we write clean list
            redisCacheService.invalidateChatHistory();
            for (ChatMessage msg : messages) {
                redisCacheService.cacheChatMessage(msg);
            }
        }

        return ResponseEntity.ok(messages);
    }

    /**
     * Delete all chat messages from the database history and invalidate cache.
     */
    @DeleteMapping
    public ResponseEntity<Void> clearChatHistory() {
        chatService.clearHistory();
        redisCacheService.invalidateChatHistory();
        return ResponseEntity.noContent().build();
    }

    /**
     * Delete direct message history between requester and partner, and invalidate cache.
     * Accessible by the authenticated participants only.
     */
    @DeleteMapping("/dm")
    public ResponseEntity<Void> clearDirectMessageHistory(
            @RequestParam String partner,
            @RequestParam String requester,
            java.security.Principal principal) {
        
        if (principal != null) {
            String principalEmail = principal.getName();
            String resolvedUsername = userSessionRepository.findByEmail(principalEmail)
                    .map(com.tasksphere.core.model.UserSession::getUsername)
                    .orElse(principalEmail);
            if (!resolvedUsername.equalsIgnoreCase(requester)) {
                return ResponseEntity.status(403).build();
            }
        }
        
        chatService.clearDirectMessages(requester, partner);
        redisCacheService.invalidateChatHistory();
        
        // Broadcast a socket notification so both users refresh in real time
        java.util.Map<String, String> broadcast = java.util.Map.of(
            "type", "CLEAR_DM",
            "requester", requester,
            "partner", partner
        );
        messagingTemplate.convertAndSend("/topic/chat", broadcast);
        
        return ResponseEntity.noContent().build();
    }

    /**
     * Edit a chat message in the database, invalidate cache, and broadcast update over WebSocket.
     */
    @PutMapping("/{id}")
    public ResponseEntity<ChatMessage> editChatMessage(
            @PathVariable Long id,
            @RequestBody java.util.Map<String, String> payload) {
        
        String newText = payload.get("message");
        ChatMessage updated = chatService.updateMessage(id, newText);
        
        // Invalidate message history cache to guarantee data consistency
        redisCacheService.invalidateChatHistory();
        
        // Broadcast the updated message to all live WebSocket listeners
        messagingTemplate.convertAndSend("/topic/chat", updated);
        
        return ResponseEntity.ok(updated);
    }
}
