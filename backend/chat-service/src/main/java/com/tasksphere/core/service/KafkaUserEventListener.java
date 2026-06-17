package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@Profile("kafka")
public class KafkaUserEventListener {

    private static final Logger log = LoggerFactory.getLogger(KafkaUserEventListener.class);

    @Autowired
    private UserEventProcessor eventProcessor;

    @Autowired
    private ObjectMapper objectMapper;

    @KafkaListener(topics = "user-created-events", groupId = "chat-service-group")
    public void onKafkaUserCreated(String message) {
        log.info("[EVENT-KAFKA-CONSUMER] Dequeued UserCreatedEvent from topic: {}", message);
        try {
            UserCreatedEvent event = objectMapper.readValue(message, UserCreatedEvent.class);
            eventProcessor.processUserCreated(event);
        } catch (Exception e) {
            log.error("[EVENT-KAFKA-CONSUMER-ERROR] Failed to deserialize UserCreatedEvent: {}", e.getMessage());
        }
    }

    @KafkaListener(topics = "user-presence-events", groupId = "chat-service-group")
    public void onKafkaUserPresence(String message) {
        log.debug("[EVENT-KAFKA-CONSUMER] Dequeued UserPresenceEvent from topic: {}", message);
        try {
            UserPresenceEvent event = objectMapper.readValue(message, UserPresenceEvent.class);
            eventProcessor.processUserPresence(event);
        } catch (Exception e) {
            log.error("[EVENT-KAFKA-CONSUMER-ERROR] Failed to deserialize UserPresenceEvent: {}", e.getMessage());
        }
    }
}
