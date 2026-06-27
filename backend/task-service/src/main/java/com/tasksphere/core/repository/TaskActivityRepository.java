package com.tasksphere.core.repository;

import com.tasksphere.core.model.TaskActivity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TaskActivityRepository extends JpaRepository<TaskActivity, Long> {
    List<TaskActivity> findByTaskIdOrderByCreatedAtDesc(Long taskId);
    void deleteByTaskId(Long taskId);
}
