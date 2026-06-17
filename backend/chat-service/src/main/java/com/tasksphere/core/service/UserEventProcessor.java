package com.tasksphere.core.service;

import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import java.util.Map;

@Service
public class UserEventProcessor {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private RedisCacheService redisCacheService;

    public void processUserCreated(UserCreatedEvent event) {
        messagingTemplate.convertAndSend("/topic/users", Map.of(
                "username", event.getUsername(),
                "role", event.getRole(),
                "status", "OFFLINE",
                "avatarUrl", event.getAvatarUrl(),
                "action", "USER_REGISTERED"
        ));
    }

    public void processUserPresence(UserPresenceEvent event) {
        if ("ONLINE".equalsIgnoreCase(event.getStatus())) {
            redisCacheService.cachePresence(event.getUsername());
        }

        messagingTemplate.convertAndSend("/topic/users", Map.of(
                "username", event.getUsername(),
                "status", event.getStatus(),
                "syncedAt", event.getTimestamp().toString()
        ));
    }
}
