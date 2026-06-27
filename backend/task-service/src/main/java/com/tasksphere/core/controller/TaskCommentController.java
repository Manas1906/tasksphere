package com.tasksphere.core.controller;

import com.tasksphere.core.model.TaskComment;
import com.tasksphere.core.service.TaskCommentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks/{taskId}/comments")
public class TaskCommentController {

    private static final Logger log = LoggerFactory.getLogger(TaskCommentController.class);

    @Autowired
    private TaskCommentService taskCommentService;

    @GetMapping
    public ResponseEntity<List<TaskComment>> getComments(@PathVariable Long taskId) {
        return ResponseEntity.ok(taskCommentService.getComments(taskId));
    }

    @PostMapping
    public ResponseEntity<TaskComment> addComment(@PathVariable Long taskId,
                                                   @RequestBody Map<String, String> body) {
        String author = body.get("author");
        String avatarUrl = body.getOrDefault("avatarUrl", "");
        String content = body.get("content");
        if (content == null || content.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return new ResponseEntity<>(taskCommentService.addComment(taskId, author, avatarUrl, content), HttpStatus.CREATED);
    }

    @PutMapping("/{commentId}")
    public ResponseEntity<TaskComment> updateComment(@PathVariable Long taskId,
                                                      @PathVariable Long commentId,
                                                      @RequestBody Map<String, String> body) {
        String requestingUser = body.get("author");
        String content = body.get("content");
        if (content == null || content.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(taskCommentService.updateComment(commentId, requestingUser, content));
    }

    @DeleteMapping("/{commentId}")
    public ResponseEntity<Void> deleteComment(@PathVariable Long taskId,
                                               @PathVariable Long commentId,
                                               @RequestParam String author) {
        taskCommentService.deleteComment(commentId, author);
        return ResponseEntity.noContent().build();
    }
}
