package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
    name = "oauth_accounts",
    uniqueConstraints = {
        @UniqueConstraint(columnNames = {"provider", "provider_user_id"})
    }
)
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OAuthAccount {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserSession user;

    @Column(nullable = false)
    private String provider; // 'google', 'github'

    @Column(name = "provider_user_id", nullable = false)
    private String providerUserId; // Google 'sub' claim or GitHub numeric 'id'

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
