package com.tasksphere.core.service;

import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
@Profile("!kafka")
public class UserEventListener {

    private static final Logger log = LoggerFactory.getLogger(UserEventListener.class);

    @Autowired
    private UserEventProcessor eventProcessor;

    @EventListener
    public void onLocalUserCreated(UserCreatedEvent event) {
        log.info("[EVENT-LOCAL-CONSUMER] Received UserCreatedEvent: {}", event.getUsername());
        eventProcessor.processUserCreated(event);
    }

    @EventListener
    public void onLocalUserPresence(UserPresenceEvent event) {
        log.debug("[EVENT-LOCAL-CONSUMER] Received UserPresenceEvent: {} -> {}", event.getUsername(), event.getStatus());
        eventProcessor.processUserPresence(event);
    }
}
