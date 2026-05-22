package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserSession {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @Column(unique = true, nullable = false)
    private String username;

    private String role; // e.g. PRODUCT_OWNER, DEVELOPER, DESIGNER, STAKEHOLDER

    @Column(name = "avatar_url")
    private String avatarUrl;

    private String status; // ONLINE, AWAY, DND, OFFLINE

    @Column(name = "last_active_time")
    @Builder.Default
    private Instant lastActiveTime = Instant.now();
}
