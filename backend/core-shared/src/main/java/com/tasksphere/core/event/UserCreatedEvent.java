package com.tasksphere.core.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserCreatedEvent {
    private String id;
    private String username;
    private String role;
    private String email;
    private String avatarUrl;
    private Instant timestamp;
}
