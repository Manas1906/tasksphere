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
}
