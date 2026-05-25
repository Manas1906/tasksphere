package com.tasksphere.core.controller;

import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.service.ChatService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/chat-messages")
public class ChatController {

    @Autowired
    private ChatService chatService;

    @Autowired
    private org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;

    /**
     * Retrieve the recent 50 chat messages from the database.
     */
    @GetMapping
    public ResponseEntity<List<ChatMessage>> getRecentChatHistory() {
        return ResponseEntity.ok(chatService.getRecentMessages());
    }

    /**
     * Delete all chat messages from the database history.
     */
    @DeleteMapping
    public ResponseEntity<Void> clearChatHistory() {
        chatService.clearHistory();
        return ResponseEntity.noContent().build();
    }

    /**
     * Edit a chat message in the database and broadcast the update over WebSocket.
     */
    @org.springframework.web.bind.annotation.PutMapping("/{id}")
    public ResponseEntity<ChatMessage> editChatMessage(
            @org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestBody java.util.Map<String, String> payload) {
        
        String newText = payload.get("message");
        ChatMessage updated = chatService.updateMessage(id, newText);
        
        // Broadcast the updated message to all live WebSocket listeners
        messagingTemplate.convertAndSend("/topic/chat", updated);
        
        return ResponseEntity.ok(updated);
    }
}
