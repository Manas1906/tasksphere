package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity
@Table(name = "task_activities")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TaskActivity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @Column(nullable = false)
    private String actor; // username of who performed the action

    @Column(nullable = false)
    private String action; // CREATED, STATUS_CHANGED, ASSIGNED, UNASSIGNED, UPDATED, DELETED, COMMENT_ADDED

    @Column(columnDefinition = "TEXT")
    private String detail; // human-readable description

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
    }
}
