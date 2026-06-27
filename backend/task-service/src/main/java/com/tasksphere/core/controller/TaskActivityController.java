package com.tasksphere.core.controller;

import com.tasksphere.core.model.TaskActivity;
import com.tasksphere.core.service.TaskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/activity")
public class TaskActivityController {

    @Autowired
    private TaskService taskService;

    @GetMapping
    public ResponseEntity<List<TaskActivity>> getActivity(@PathVariable Long taskId) {
        return ResponseEntity.ok(taskService.getActivities(taskId));
    }
}
