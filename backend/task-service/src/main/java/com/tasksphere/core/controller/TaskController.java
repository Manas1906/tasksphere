package com.tasksphere.core.controller;

import com.tasksphere.core.model.Task;
import com.tasksphere.core.service.TaskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private static final Logger log = LoggerFactory.getLogger(TaskController.class);

    @Autowired
    private TaskService taskService;

    @GetMapping
    public ResponseEntity<List<Task>> getAllTasks() {
        return ResponseEntity.ok(taskService.getAllTasks());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Task> getTaskById(@PathVariable Long id) {
        return ResponseEntity.ok(taskService.getTaskById(id));
    }

    @PostMapping
    public ResponseEntity<Task> createTask(@RequestBody Task task) {
        return new ResponseEntity<>(taskService.createTask(task), HttpStatus.CREATED);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Task> updateTask(@PathVariable Long id, @RequestBody Task taskDetails) {
        return ResponseEntity.ok(taskService.updateTask(id, taskDetails));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<Task> updateTaskStatus(@PathVariable Long id, @RequestBody String status) {
        // Strip out enclosing quotes from raw string request bodies if sent
        String cleanedStatus = status.replace("\"", "").trim();
        return ResponseEntity.ok(taskService.updateTaskStatus(id, cleanedStatus));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTask(@PathVariable Long id) {
        taskService.deleteTask(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/export/csv")
    public ResponseEntity<byte[]> exportCsv() {
        List<Task> tasks = taskService.getAllTasks();
        StringBuilder csv = new StringBuilder("ID,Title,Description,Status,Priority,StoryPoints,DueDate,Assignee,RecurringType,CreatedAt\n");
        for (Task t : tasks) {
            csv.append(t.getId()).append(",")
               .append(escapeCsv(t.getTitle())).append(",")
               .append(escapeCsv(t.getDescription())).append(",")
               .append(escapeCsv(t.getStatus())).append(",")
               .append(escapeCsv(t.getPriority())).append(",")
               .append(t.getStoryPoints()).append(",")
               .append(t.getDueDate() != null ? t.getDueDate() : "").append(",")
               .append(t.getAssignee() != null ? escapeCsv(t.getAssignee().getUsername()) : "").append(",")
               .append(t.getRecurringType() != null ? escapeCsv(t.getRecurringType()) : "").append(",")
               .append(t.getCreatedAt() != null ? t.getCreatedAt() : "")
               .append("\n");
        }
        byte[] bytes = csv.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv"));
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"tasks-export.csv\"");
        return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        String escaped = value.replace("\"", "\"\"");
        if (escaped.contains(",") || escaped.contains("\n") || escaped.contains("\"")) {
            return "\"" + escaped + "\"";
        }
        return escaped;
    }
}
