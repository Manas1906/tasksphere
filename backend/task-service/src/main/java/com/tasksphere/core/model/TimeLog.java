package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity
@Table(name = "time_logs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TimeLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @Column(nullable = false)
    private String username;

    @Column(nullable = false)
    private int minutes;

    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(name = "logged_at", updatable = false)
    private Instant loggedAt;

    @PrePersist
    protected void onCreate() {
        loggedAt = Instant.now();
    }
}
