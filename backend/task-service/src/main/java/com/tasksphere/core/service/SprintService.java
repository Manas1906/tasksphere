package com.tasksphere.core.service;

import com.tasksphere.core.exception.ResourceNotFoundException;
import com.tasksphere.core.model.Sprint;
import com.tasksphere.core.repository.SprintRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class SprintService {

    private static final Logger log = LoggerFactory.getLogger(SprintService.class);

    @Autowired
    private SprintRepository sprintRepository;

    public List<Sprint> getAllSprints() {
        return sprintRepository.findAllByOrderByCreatedAtDesc();
    }

    public Sprint getSprintById(Long id) {
        return sprintRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Sprint not found with ID: " + id));
    }

    public Optional<Sprint> getActiveSprint() {
        return sprintRepository.findFirstByStatusOrderByCreatedAtDesc("ACTIVE");
    }

    public Sprint createSprint(Sprint sprint) {
        return sprintRepository.save(sprint);
    }

    public Sprint updateSprint(Long id, Sprint details) {
        Sprint sprint = getSprintById(id);
        sprint.setName(details.getName());
        sprint.setGoal(details.getGoal());
        sprint.setStartDate(details.getStartDate());
        sprint.setEndDate(details.getEndDate());
        if (details.getTaskIds() != null) {
            sprint.getTaskIds().clear();
            sprint.getTaskIds().addAll(details.getTaskIds());
        }
        return sprintRepository.save(sprint);
    }

    public Sprint updateStatus(Long id, String newStatus) {
        Sprint sprint = getSprintById(id);
        // Only one sprint can be ACTIVE at a time
        if ("ACTIVE".equals(newStatus)) {
            sprintRepository.findFirstByStatusOrderByCreatedAtDesc("ACTIVE").ifPresent(active -> {
                if (!active.getId().equals(id)) {
                    active.setStatus("PLANNING");
                    sprintRepository.save(active);
                }
            });
        }
        sprint.setStatus(newStatus);
        return sprintRepository.save(sprint);
    }

    public void deleteSprint(Long id) {
        Sprint sprint = getSprintById(id);
        sprintRepository.delete(sprint);
    }

    public Sprint addTaskToSprint(Long sprintId, Long taskId) {
        Sprint sprint = getSprintById(sprintId);
        if (!sprint.getTaskIds().contains(taskId)) {
            sprint.getTaskIds().add(taskId);
        }
        return sprintRepository.save(sprint);
    }

    public Sprint removeTaskFromSprint(Long sprintId, Long taskId) {
        Sprint sprint = getSprintById(sprintId);
        sprint.getTaskIds().remove(taskId);
        return sprintRepository.save(sprint);
    }
}
