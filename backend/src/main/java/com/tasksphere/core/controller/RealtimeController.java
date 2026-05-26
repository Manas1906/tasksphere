package com.tasksphere.core.controller;

import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.model.Task;
import com.tasksphere.core.service.ChatService;
import com.tasksphere.core.service.TaskService;
import com.tasksphere.core.service.RedisCacheService;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.time.Instant;
import java.util.Map;

@Controller
public class RealtimeController {

    @Autowired
    private ChatService chatService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /**
     * Receives a chat message from a user, saves it, and broadcasts it to all listeners.
     */
    @MessageMapping("/chat.send")
    @SendTo("/topic/chat")
    public ChatMessage sendMessage(ChatMessage message) {
        message.setTimestamp(Instant.now());
        ChatMessage saved = chatService.saveMessage(message);
        
        // Cache the newly saved message in Redis capped list
        redisCacheService.cacheChatMessage(saved);
        
        return saved;
    }

    /**
     * Receives task updates (like card column changes) and broadcasts it to synched boards.
     */
    @MessageMapping("/board.move")
    @SendTo("/topic/board")
    public TaskMovePayload moveTask(TaskMovePayload payload) {
        // Persist the status transition in the database
        taskService.updateTaskStatus(payload.getTaskId(), payload.getToStatus());
        return payload;
    }

    /**
     * Receives notifications that users are active or changed their presence and syncs them.
     */
    @MessageMapping("/user.presence")
    @SendTo("/topic/users")
    public Map<String, Object> syncUserPresence(Map<String, Object> presenceUpdate) {
        presenceUpdate.put("syncedAt", Instant.now());
        
        // Synchronize in-memory/Redis TTL presence registration
        String username = (String) presenceUpdate.get("username");
        if (username != null) {
            redisCacheService.cachePresence(username);
        }
        
        return presenceUpdate;
    }

    /**
     * Receives throttled cursor coordinates and broadcasts them over the collaborative sync channel.
     */
    @MessageMapping("/cursors.move")
    @SendTo("/topic/cursors")
    public Map<String, Object> syncCursor(Map<String, Object> cursorUpdate) {
        return cursorUpdate;
    }

    @Data
    public static class TaskMovePayload {
        private Long taskId;
        private String title;
        private String fromStatus;
        private String toStatus;
        private String username;
    }
}
