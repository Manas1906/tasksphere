package com.tasksphere.core.repository;

import com.tasksphere.core.model.Sprint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface SprintRepository extends JpaRepository<Sprint, Long> {
    List<Sprint> findAllByOrderByCreatedAtDesc();
    Optional<Sprint> findFirstByStatusOrderByCreatedAtDesc(String status);
    List<Sprint> findByStatus(String status);
}
