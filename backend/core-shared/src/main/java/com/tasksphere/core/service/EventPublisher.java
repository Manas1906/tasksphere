package com.tasksphere.core.service;

import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;

public interface EventPublisher {
    void publishUserCreated(UserCreatedEvent event);
    void publishUserPresence(UserPresenceEvent event);
}
