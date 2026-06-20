package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workspace_upgrade_sessions")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkspaceUpgradeSession {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @Column(name = "workspace_name", nullable = false)
    @Builder.Default
    private String workspaceName = "Workspace Alpha";

    @Column(name = "target_pledges", nullable = false)
    @Builder.Default
    private int targetPledges = 5;

    @Column(name = "pledges_count", nullable = false)
    @Builder.Default
    private int pledgesCount = 0;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "ACTIVE";

    @Column(name = "expiry_time", nullable = false)
    private Instant expiryTime;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
