package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class UserEventListener {

    private static final Logger log = LoggerFactory.getLogger(UserEventListener.class);

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private ObjectMapper objectMapper;

    // =========================================================================
    // LOCAL JVM-WIDE LISTENERS (Active when Kafka is NOT used)
    // =========================================================================

    @EventListener
    @Profile("!kafka")
    public void onLocalUserCreated(UserCreatedEvent event) {
        log.info("[EVENT-LOCAL-CONSUMER] Received UserCreatedEvent: {}", event.getUsername());
        processUserCreated(event);
    }

    @EventListener
    @Profile("!kafka")
    public void onLocalUserPresence(UserPresenceEvent event) {
        log.debug("[EVENT-LOCAL-CONSUMER] Received UserPresenceEvent: {} -> {}", event.getUsername(), event.getStatus());
        processUserPresence(event);
    }

    // =========================================================================
    // DISTRIBUTED KAFKA LISTENERS (Active under "kafka" profile)
    // =========================================================================

    @KafkaListener(topics = "user-created-events", groupId = "chat-service-group")
    @Profile("kafka")
    public void onKafkaUserCreated(String message) {
        log.info("[EVENT-KAFKA-CONSUMER] Dequeued UserCreatedEvent from topic: {}", message);
        try {
            UserCreatedEvent event = objectMapper.readValue(message, UserCreatedEvent.class);
            processUserCreated(event);
        } catch (Exception e) {
            log.error("[EVENT-KAFKA-CONSUMER-ERROR] Failed to deserialize UserCreatedEvent: {}", e.getMessage());
        }
    }

    @KafkaListener(topics = "user-presence-events", groupId = "chat-service-group")
    @Profile("kafka")
    public void onKafkaUserPresence(String message) {
        log.debug("[EVENT-KAFKA-CONSUMER] Dequeued UserPresenceEvent from topic: {}", message);
        try {
            UserPresenceEvent event = objectMapper.readValue(message, UserPresenceEvent.class);
            processUserPresence(event);
        } catch (Exception e) {
            log.error("[EVENT-KAFKA-CONSUMER-ERROR] Failed to deserialize UserPresenceEvent: {}", e.getMessage());
        }
    }

    // =========================================================================
    // REUSABLE EVENT PROCESSING LOGIC
    // =========================================================================

    private void processUserCreated(UserCreatedEvent event) {
        // Broadcast user details or refresh user directories on frontend
        messagingTemplate.convertAndSend("/topic/users", Map.of(
                "username", event.getUsername(),
                "role", event.getRole(),
                "status", "OFFLINE",
                "avatarUrl", event.getAvatarUrl(),
                "action", "USER_REGISTERED"
        ));
    }

    private void processUserPresence(UserPresenceEvent event) {
        // Cache presence TTL in Redis (online tracker)
        if ("ONLINE".equalsIgnoreCase(event.getStatus())) {
            redisCacheService.cachePresence(event.getUsername());
        }

        // Broadcast to WebSocket subscribers to dynamically update UI badges
        messagingTemplate.convertAndSend("/topic/users", Map.of(
                "username", event.getUsername(),
                "status", event.getStatus(),
                "syncedAt", event.getTimestamp().toString()
        ));
    }
}
