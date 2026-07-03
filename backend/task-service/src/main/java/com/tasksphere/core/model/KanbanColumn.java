package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "kanban_columns")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KanbanColumn {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "column_key", unique = true, nullable = false, length = 50)
    private String columnKey;

    @Column(name = "column_name", nullable = false, length = 100)
    private String columnName;

    @Column(nullable = false)
    private int position;

    @Column(length = 20)
    private String color;
}
