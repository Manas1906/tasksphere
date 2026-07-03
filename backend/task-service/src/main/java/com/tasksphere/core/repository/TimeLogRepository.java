package com.tasksphere.core.repository;

import com.tasksphere.core.model.TimeLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TimeLogRepository extends JpaRepository<TimeLog, Long> {
    List<TimeLog> findByTaskIdOrderByLoggedAtDesc(Long taskId);
    void deleteByTaskId(Long taskId);

    @Query("SELECT COALESCE(SUM(t.minutes), 0) FROM TimeLog t WHERE t.taskId = :taskId")
    int sumMinutesByTaskId(@Param("taskId") Long taskId);
}
