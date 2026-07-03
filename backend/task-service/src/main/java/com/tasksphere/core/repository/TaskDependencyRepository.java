package com.tasksphere.core.repository;

import com.tasksphere.core.model.TaskDependency;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TaskDependencyRepository extends JpaRepository<TaskDependency, Long> {
    List<TaskDependency> findByTaskId(Long taskId);
    void deleteByTaskIdAndBlockingTaskId(Long taskId, Long blockingTaskId);
    boolean existsByTaskIdAndBlockingTaskId(Long taskId, Long blockingTaskId);
}
