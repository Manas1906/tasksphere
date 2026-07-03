package com.tasksphere.core.controller;

import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.TaskDependency;
import com.tasksphere.core.repository.TaskDependencyRepository;
import com.tasksphere.core.repository.TaskRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/tasks/{taskId}/dependencies")
public class TaskDependencyController {

    private static final Logger log = LoggerFactory.getLogger(TaskDependencyController.class);

    @Autowired
    private TaskDependencyRepository dependencyRepository;

    @Autowired
    private TaskRepository taskRepository;

    /** Returns all blocking tasks for the given task, enriched with title and status. */
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getDependencies(@PathVariable Long taskId) {
        List<TaskDependency> deps = dependencyRepository.findByTaskId(taskId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (TaskDependency dep : deps) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", dep.getId());
            entry.put("blockingTaskId", dep.getBlockingTaskId());
            taskRepository.findById(dep.getBlockingTaskId()).ifPresent(blocker -> {
                entry.put("blockingTaskTitle", blocker.getTitle());
                entry.put("blockingTaskStatus", blocker.getStatus());
            });
            result.add(entry);
        }
        return ResponseEntity.ok(result);
    }

    /** Adds a blocking dependency: blockingTaskId must be DONE before taskId can progress. */
    @PostMapping("/{blockingTaskId}")
    public ResponseEntity<?> addDependency(@PathVariable Long taskId,
                                            @PathVariable Long blockingTaskId) {
        if (taskId.equals(blockingTaskId)) {
            return ResponseEntity.badRequest().body(Map.of("error", "A task cannot block itself."));
        }
        if (dependencyRepository.existsByTaskIdAndBlockingTaskId(taskId, blockingTaskId)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Dependency already exists."));
        }
        if (!taskRepository.existsById(blockingTaskId)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Blocking task #" + blockingTaskId + " not found."));
        }
        TaskDependency dep = TaskDependency.builder()
                .taskId(taskId).blockingTaskId(blockingTaskId).build();
        log.info("[DEPENDENCY] Task #{} is now blocked by #{}", taskId, blockingTaskId);
        return new ResponseEntity<>(dependencyRepository.save(dep), HttpStatus.CREATED);
    }

    /** Removes a blocking dependency. */
    @DeleteMapping("/{blockingTaskId}")
    public ResponseEntity<Void> removeDependency(@PathVariable Long taskId,
                                                  @PathVariable Long blockingTaskId) {
        dependencyRepository.deleteByTaskIdAndBlockingTaskId(taskId, blockingTaskId);
        log.info("[DEPENDENCY] Removed blocker #{} from task #{}", blockingTaskId, taskId);
        return ResponseEntity.noContent().build();
    }
}
