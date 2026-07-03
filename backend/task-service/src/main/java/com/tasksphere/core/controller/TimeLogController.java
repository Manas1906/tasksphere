package com.tasksphere.core.controller;

import com.tasksphere.core.model.TimeLog;
import com.tasksphere.core.repository.TimeLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks/{taskId}/time-logs")
public class TimeLogController {

    private static final Logger log = LoggerFactory.getLogger(TimeLogController.class);

    @Autowired
    private TimeLogRepository timeLogRepository;

    @GetMapping
    public ResponseEntity<Map<String, Object>> getTimeLogs(@PathVariable Long taskId) {
        List<TimeLog> logs = timeLogRepository.findByTaskIdOrderByLoggedAtDesc(taskId);
        int totalMinutes = timeLogRepository.sumMinutesByTaskId(taskId);
        Map<String, Object> result = new HashMap<>();
        result.put("logs", logs);
        result.put("totalMinutes", totalMinutes);
        result.put("totalHours", Math.round(totalMinutes / 60.0 * 10.0) / 10.0);
        return ResponseEntity.ok(result);
    }

    @PostMapping
    public ResponseEntity<TimeLog> addTimeLog(@PathVariable Long taskId,
                                               @RequestBody Map<String, Object> body) {
        String username = (String) body.get("username");
        Object minutesObj = body.get("minutes");
        if (username == null || minutesObj == null) {
            return ResponseEntity.badRequest().build();
        }
        int minutes = Integer.parseInt(minutesObj.toString());
        if (minutes <= 0) return ResponseEntity.badRequest().build();

        TimeLog entry = TimeLog.builder()
                .taskId(taskId)
                .username(username)
                .minutes(minutes)
                .note((String) body.get("note"))
                .build();
        log.info("[TIME-LOG] {} logged {}m on task #{}", username, minutes, taskId);
        return new ResponseEntity<>(timeLogRepository.save(entry), HttpStatus.CREATED);
    }

    @DeleteMapping("/{logId}")
    public ResponseEntity<Void> deleteTimeLog(@PathVariable Long taskId,
                                               @PathVariable Long logId,
                                               @RequestParam String username) {
        timeLogRepository.findById(logId).ifPresent(entry -> {
            if (entry.getTaskId().equals(taskId) && entry.getUsername().equals(username)) {
                timeLogRepository.delete(entry);
                log.info("[TIME-LOG] Deleted log #{} on task #{} by {}", logId, taskId, username);
            }
        });
        return ResponseEntity.noContent().build();
    }
}
