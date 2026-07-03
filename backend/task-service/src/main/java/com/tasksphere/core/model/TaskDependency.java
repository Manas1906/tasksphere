package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "task_dependencies",
       uniqueConstraints = @UniqueConstraint(columnNames = {"task_id", "blocking_task_id"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TaskDependency {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** The task that is blocked. */
    @Column(name = "task_id", nullable = false)
    private Long taskId;

    /** The task that must be DONE before taskId can progress. */
    @Column(name = "blocking_task_id", nullable = false)
    private Long blockingTaskId;
}
