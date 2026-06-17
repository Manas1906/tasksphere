package com.tasksphere.core.service;

import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("!kafka")
public class LocalEventPublisher implements EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(LocalEventPublisher.class);

    @Autowired
    private ApplicationEventPublisher applicationEventPublisher;

    @Override
    public void publishUserCreated(UserCreatedEvent event) {
        log.info("[EVENT-LOCAL] Publishing UserCreatedEvent for: {}", event.getUsername());
        applicationEventPublisher.publishEvent(event);
    }

    @Override
    public void publishUserPresence(UserPresenceEvent event) {
        log.debug("[EVENT-LOCAL] Publishing UserPresenceEvent for: {} ({})", event.getUsername(), event.getStatus());
        applicationEventPublisher.publishEvent(event);
    }
}
