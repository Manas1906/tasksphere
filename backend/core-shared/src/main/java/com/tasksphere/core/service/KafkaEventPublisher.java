package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@Profile("kafka")
public class KafkaEventPublisher implements EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(KafkaEventPublisher.class);

    @Autowired(required = false)
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    public static final String USER_CREATED_TOPIC = "user-created-events";
    public static final String USER_PRESENCE_TOPIC = "user-presence-events";

    @Override
    public void publishUserCreated(UserCreatedEvent event) {
        log.info("[EVENT-KAFKA] Publishing UserCreatedEvent for: {} to topic {}", event.getUsername(), USER_CREATED_TOPIC);
        publish(USER_CREATED_TOPIC, event.getUsername(), event);
    }

    @Override
    public void publishUserPresence(UserPresenceEvent event) {
        log.debug("[EVENT-KAFKA] Publishing UserPresenceEvent for: {} ({}) to topic {}", event.getUsername(), event.getStatus(), USER_PRESENCE_TOPIC);
        publish(USER_PRESENCE_TOPIC, event.getUsername(), event);
    }

    private void publish(String topic, String key, Object payload) {
        if (kafkaTemplate == null) {
            log.warn("[EVENT-KAFKA-WARNING] KafkaTemplate not initialized. Event drop: {}", payload);
            return;
        }
        try {
            String json = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(topic, key, json);
        } catch (Exception e) {
            log.error("[EVENT-KAFKA-ERROR] Failed to serialize or send event to Kafka topic {}: {}", topic, e.getMessage(), e);
        }
    }
}
