package com.tasksphere.core.controller;

import com.tasksphere.core.model.Sprint;
import com.tasksphere.core.service.SprintService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sprints")
public class SprintController {

    private static final Logger log = LoggerFactory.getLogger(SprintController.class);

    @Autowired
    private SprintService sprintService;

    @GetMapping
    public ResponseEntity<List<Sprint>> getAllSprints() {
        return ResponseEntity.ok(sprintService.getAllSprints());
    }

    @GetMapping("/active")
    public ResponseEntity<Sprint> getActiveSprint() {
        return sprintService.getActiveSprint()
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.noContent().build());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Sprint> getSprintById(@PathVariable Long id) {
        return ResponseEntity.ok(sprintService.getSprintById(id));
    }

    @PostMapping
    public ResponseEntity<Sprint> createSprint(@RequestBody Sprint sprint) {
        return new ResponseEntity<>(sprintService.createSprint(sprint), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Sprint> updateSprint(@PathVariable Long id, @RequestBody Sprint sprint) {
        return ResponseEntity.ok(sprintService.updateSprint(id, sprint));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<Sprint> updateStatus(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String status = body.get("status");
        if (status == null || status.isBlank()) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(sprintService.updateStatus(id, status));
    }

    @PostMapping("/{id}/tasks/{taskId}")
    public ResponseEntity<Sprint> addTask(@PathVariable Long id, @PathVariable Long taskId) {
        return ResponseEntity.ok(sprintService.addTaskToSprint(id, taskId));
    }

    @DeleteMapping("/{id}/tasks/{taskId}")
    public ResponseEntity<Sprint> removeTask(@PathVariable Long id, @PathVariable Long taskId) {
        return ResponseEntity.ok(sprintService.removeTaskFromSprint(id, taskId));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSprint(@PathVariable Long id) {
        sprintService.deleteSprint(id);
        return ResponseEntity.noContent().build();
    }
}
