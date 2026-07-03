package com.tasksphere.core.model;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "tasks")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(nullable = false)
    private String status; // TODO, IN_PROGRESS, REVIEW, DONE

    @Column(nullable = false)
    private String priority; // LOW, MEDIUM, HIGH, URGENT

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "assignee_id")
    private UserSession assignee;

    @Column(name = "story_points")
    @Builder.Default
    private int storyPoints = 1;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "recurring_type")
    private String recurringType; // null, DAILY, WEEKLY, BIWEEKLY, MONTHLY

    // Comma-separated label keys e.g. "bug,feature,backend"
    @Column(name = "labels", length = 512)
    private String labels;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @OneToMany(mappedBy = "task", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @JsonManagedReference
    @Builder.Default
    private List<TaskChecklistItem> checklist = new ArrayList<>();

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
        if (status == null) status = "TODO";
        if (priority == null) priority = "LOW";
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }

    // Helper method for sync relationship management
    public void addChecklistItem(TaskChecklistItem item) {
        checklist.add(item);
        item.setTask(this);
    }
}
